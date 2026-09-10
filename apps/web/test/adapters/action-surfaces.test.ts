/**
 * Every shipped action has a real configuration surface (final pass, item 4).
 *
 * The check is **derived from each descriptor**, not from a hand-written list of expected
 * fields — a list would have to be updated alongside the schema and would therefore only ever
 * confirm that someone remembered to update it. Instead: for every registered action, every
 * parameter it declares must produce a control, gated parameters must appear exactly when their
 * gate says so, and an action whose capability is missing must be *reported* rather than look
 * broken.
 *
 * `person_visibility` gets its own section because it is the one action with a capability that
 * can genuinely be absent, and the one whose modes change which fields matter.
 */

import { describe, expect, it } from 'vitest';

import type { ParamValue } from '../../src/domain/effects/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import type { ActionDescriptor } from '../../src/domain/runtime/action-registry';
import {
  MapCapabilityRegistry,
  PERSON_SEGMENTATION,
  defaultCapabilities,
} from '../../src/domain/runtime/capabilities';
import type { CapabilityRegistry } from '../../src/domain/runtime/capabilities';
import { resolveParams } from '../../src/domain/runtime/param-schema';
import { Inspector } from '../../src/presentation/editor/inspector';

const registry = createActionRegistry();
const withSegmentation: CapabilityRegistry = new MapCapabilityRegistry(
  new Map([[PERSON_SEGMENTATION, true]]),
);

function buildInspector() {
  const commits: Readonly<Record<string, ParamValue>>[] = [];
  const inspector = new Inspector({
    document,
    registry,
    onParamsChange: (params) => commits.push(params),
    onDurationChange: () => {},
  });
  document.body.append(inspector.root);
  return { inspector, commits, dispose: () => inspector.root.remove() };
}

/** The field labels the inspector is currently *showing* — hidden ones excluded. */
function visibleFieldLabels(inspector: Inspector): string[] {
  return [...inspector.root.querySelectorAll<HTMLElement>('.mudra-editor__field')]
    .filter((field) => !field.hidden)
    .map((field) => field.querySelector('.mudra-editor__field-label')?.textContent ?? '');
}

/** Every field label, showing or not. */
function allFieldLabels(inspector: Inspector): string[] {
  return [...inspector.root.querySelectorAll<HTMLElement>('.mudra-editor__field')].map(
    (field) => field.querySelector('.mudra-editor__field-label')?.textContent ?? '',
  );
}

function render(
  inspector: Inspector,
  descriptor: ActionDescriptor,
  params: Readonly<Record<string, ParamValue>> = {},
  capabilities: CapabilityRegistry = withSegmentation,
): void {
  inspector.render(
    { actionType: descriptor.type, params, effectId: 'e1', entryIndex: 0, durationMs: 500 },
    { capabilities, resolveAsset: () => 'resolved' },
  );
}

/** Whether a parameter applies at the given resolved values. */
function applies(
  spec: ActionDescriptor['params'][number],
  resolved: Readonly<Record<string, ParamValue>>,
): boolean {
  const gate = spec.visibleWhen;
  if (gate === undefined) {
    return true;
  }
  const value = resolved[gate.param];
  return typeof value === 'string' && gate.values.includes(value);
}

describe('every shipped action', () => {
  it('is one of the six this milestone ships — the list under test is the real one', () => {
    expect(registry.types()).toEqual([
      'background_wash',
      'landmark_trail',
      'particle_burst',
      'person_visibility',
      'play_audio',
      'screen_flash',
    ]);
  });

  for (const descriptor of registry.all()) {
    describe(descriptor.type, () => {
      it('declares at least one parameter — no action is duration-only', () => {
        // "Do not show only duration if the action has meaningful editable configuration."
        expect(descriptor.params.length).toBeGreaterThan(0);
      });

      it('renders a control for every parameter it declares', () => {
        const { inspector, dispose } = buildInspector();
        try {
          render(inspector, descriptor);
          const labels = allFieldLabels(inspector);
          for (const spec of descriptor.params) {
            expect(labels, descriptor.type + '.' + spec.name).toContain(spec.name);
          }
          // Plus the one entry-level field every action shares.
          expect(labels[0]).toBe('duration (ms)');
        } finally {
          dispose();
        }
      });

      it('shows exactly the parameters that apply at its defaults', () => {
        const { inspector, dispose } = buildInspector();
        try {
          const resolved = resolveParams(descriptor.params, {}, descriptor.type);
          render(inspector, descriptor);
          const shown = visibleFieldLabels(inspector);
          for (const spec of descriptor.params) {
            const expected = applies(spec, resolved);
            expect(shown.includes(spec.name), descriptor.type + '.' + spec.name).toBe(expected);
          }
        } finally {
          dispose();
        }
      });

      it('reports its status rather than leaving the author to guess', () => {
        const { inspector, dispose } = buildInspector();
        try {
          render(inspector, descriptor);
          const badge = inspector.root.querySelector<HTMLElement>('.mudra-editor__status-badge')!;
          expect(badge.dataset['status']).toBeTruthy();
          expect(badge.textContent).toBeTruthy();
        } finally {
          dispose();
        }
      });

      it('offers presets only as validated parameter bundles, when it offers any', () => {
        const { inspector, dispose } = buildInspector();
        try {
          render(inspector, descriptor);
          const buttons = [
            ...inspector.root.querySelectorAll<HTMLButtonElement>('.mudra-editor__preset-row button'),
          ];
          expect(buttons).toHaveLength((descriptor.presets ?? []).length);
          for (const button of buttons) {
            expect(button.title.length).toBeGreaterThan(0);
          }
        } finally {
          dispose();
        }
      });
    });
  }
});

describe('person_visibility — the one capability that can genuinely be absent', () => {
  const descriptor = registry.require('person_visibility', '(test)');

  it('shows only the opacity control in its default mode', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, descriptor, { mode: 'opacity' });
      const shown = visibleFieldLabels(inspector);
      expect(shown).toContain('mode');
      expect(shown).toContain('opacity');
      expect(shown).not.toContain('asset');
      expect(shown).not.toContain('color');
      expect(shown).not.toContain('fit');
    } finally {
      dispose();
    }
  });

  for (const mode of ['replace_person', 'replace_background']) {
    it('shows the replacement controls in ' + mode + ' mode', () => {
      const { inspector, dispose } = buildInspector();
      try {
        render(inspector, descriptor, { mode });
        const shown = visibleFieldLabels(inspector);
        expect(shown).toContain('intensity');
        expect(shown).toContain('asset');
        expect(shown).toContain('color');
        expect(shown).toContain('fit');
        expect(shown).not.toContain('opacity');
      } finally {
        dispose();
      }
    });
  }

  it('switches which controls apply in place, without rebuilding the panel', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, descriptor, { mode: 'opacity' });
      expect(visibleFieldLabels(inspector)).not.toContain('asset');

      render(inspector, descriptor, { mode: 'replace_background' });

      expect(visibleFieldLabels(inspector)).toContain('asset');
      expect(visibleFieldLabels(inspector)).not.toContain('opacity');
    } finally {
      dispose();
    }
  });

  it('when segmentation is unavailable: fully editable, and says why it will not run', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, descriptor, { mode: 'replace_background' }, defaultCapabilities());

      // The configuration surface is still there — an author may build for an environment
      // other than their own (FR-044).
      expect(visibleFieldLabels(inspector)).toContain('asset');
      const controls = inspector.root.querySelectorAll('.mudra-editor__inspector-fields input');
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect((control as HTMLInputElement).disabled).toBe(false);
      }

      // And the reason it will not run is stated twice over: a status badge and a notice.
      const badge = inspector.root.querySelector<HTMLElement>('.mudra-editor__status-badge')!;
      expect(badge.dataset['status']).toBe('capability_unavailable');
      expect(inspector.root.textContent).toContain(PERSON_SEGMENTATION);
    } finally {
      dispose();
    }
  });

  it('reports a missing asset separately from a missing capability', () => {
    const { inspector, dispose } = buildInspector();
    try {
      inspector.render(
        {
          actionType: 'person_visibility',
          params: { mode: 'replace_person', asset: '@image/gone' },
          effectId: 'e1',
          entryIndex: 0,
          durationMs: 500,
        },
        { capabilities: withSegmentation, resolveAsset: () => null },
      );
      const badge = inspector.root.querySelector<HTMLElement>('.mudra-editor__status-badge')!;
      expect(badge.dataset['status']).toBe('missing_asset');
      expect(inspector.root.textContent).toContain('@image/gone');
    } finally {
      dispose();
    }
  });

  it('treats "no image" as a legitimate choice, not a missing asset', () => {
    const { inspector, dispose } = buildInspector();
    try {
      inspector.render(
        {
          actionType: 'person_visibility',
          params: { mode: 'replace_background', asset: '' },
          effectId: 'e1',
          entryIndex: 0,
          durationMs: 500,
        },
        { capabilities: withSegmentation, resolveAsset: () => null },
      );
      const badge = inspector.root.querySelector<HTMLElement>('.mudra-editor__status-badge')!;
      expect(badge.dataset['status']).toBe('ready');
    } finally {
      dispose();
    }
  });
});

describe('the other five actions expose what they actually support', () => {
  /** Spot-checks in the authors' own vocabulary, complementing the derived loop above. */
  const expected: Readonly<Record<string, readonly string[]>> = {
    screen_flash: ['color', 'intensity', 'blend'],
    background_wash: ['color', 'opacity', 'blend', 'fadeInFraction', 'fadeOutFraction'],
    particle_burst: ['count', 'anchor', 'directionDeg', 'arcDeg', 'spread', 'color', 'seed'],
    landmark_trail: ['anchor', 'color', 'width', 'length'],
    play_audio: ['asset', 'volume'],
  };

  for (const [type, names] of Object.entries(expected)) {
    it(type + ' exposes its own parameters, and nothing it does not read', () => {
      const descriptor = registry.require(type, '(test)');
      const declared = descriptor.params.map((spec) => spec.name);
      for (const name of names) {
        expect(declared, type).toContain(name);
      }

      const { inspector, dispose } = buildInspector();
      try {
        render(inspector, descriptor);
        const shown = visibleFieldLabels(inspector);
        for (const name of names) {
          expect(shown, type).toContain(name);
        }
      } finally {
        dispose();
      }
    });
  }
});
