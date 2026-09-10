/**
 * The other half of the colour-picker bug (item 1/P0): the inspector must not **rebuild** its
 * controls on the re-render that a committed edit triggers.
 *
 * The original failure had nothing to do with the picker's own event handling. Editing a colour
 * committed a project edit, which re-rendered the inspector, which called `replaceChildren()` —
 * destroying and recreating the very `<input type="color">` hosting the open OS picker, which
 * therefore shut. Every control had the same problem in milder form (a number field lost its
 * caret mid-typing); the colour picker is only where it was fatal.
 *
 * So the assertions here are about **element identity**: the same selection, re-rendered, must
 * keep the same DOM nodes and only update their values.
 */

import { describe, expect, it } from 'vitest';

import type { ActionDescriptor } from '../../src/domain/runtime/action-registry';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { Inspector } from '../../src/presentation/editor/inspector';
import type { ParamValue } from '../../src/domain/effects/types';

const TYPE = 'test_reconcile_action';

const descriptor: ActionDescriptor = {
  type: TYPE,
  behaviour: 'duration',
  params: [
    { name: 'tint', kind: 'color', defaultValue: '#112233', description: 'A colour.' },
    { name: 'level', kind: 'number', defaultValue: 3, min: 0, max: 10, description: 'A number.' },
    {
      name: 'mode',
      kind: 'enum',
      defaultValue: 'a',
      values: ['a', 'b'],
      description: 'A pick-one.',
    },
    {
      name: 'onlyForB',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 5,
      visibleWhen: { param: 'mode', values: ['b'] },
      description: 'Shown only in mode b.',
    },
  ],
  update: () => ({ commands: [] }),
};

function buildInspector() {
  const registry = createActionRegistry();
  registry.register(descriptor);
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

function fieldFor(root: HTMLElement, name: string): HTMLElement {
  const field = [...root.querySelectorAll<HTMLElement>('.mudra-editor__field')].find(
    (candidate) => candidate.querySelector('.mudra-editor__field-label')?.textContent === name,
  );
  if (field === undefined) {
    throw new Error('No field labelled "' + name + '" was rendered.');
  }
  return field;
}

function render(
  inspector: Inspector,
  params: Readonly<Record<string, ParamValue>>,
  entryIndex = 0,
): void {
  inspector.render(
    { actionType: TYPE, params, effectId: 'e1', entryIndex, durationMs: 400 },
    { capabilities: defaultCapabilities() },
  );
}

describe('re-rendering the same selection', () => {
  it('keeps the very same control elements — nothing is destroyed mid-interaction', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, {});
      const colorBefore = fieldFor(inspector.root, 'tint');
      const numberBefore = fieldFor(inspector.root, 'level');

      render(inspector, { tint: '#ff0000' });

      expect(fieldFor(inspector.root, 'tint')).toBe(colorBefore);
      expect(fieldFor(inspector.root, 'level')).toBe(numberBefore);
    } finally {
      dispose();
    }
  });

  it('an open colour popover survives the re-render its own edit causes', () => {
    const { inspector, commits, dispose } = buildInspector();
    try {
      render(inspector, {});
      const swatchTrigger = inspector.root.querySelector<HTMLButtonElement>(
        '.mudra-color-picker__trigger',
      )!;
      swatchTrigger.click();
      expect(
        inspector.root.querySelector<HTMLElement>('.mudra-color-picker__popover')!.hidden,
      ).toBe(false);

      // Pick a colour — which commits, which is what used to re-render the picker away.
      inspector.root
        .querySelector<HTMLButtonElement>('.mudra-color-picker__swatch[data-color="#ffd166"]')!
        .click();
      expect(commits).toHaveLength(1);
      expect(commits[0]!['tint']).toBe('#ffd166');

      // The editor re-renders after every commit; simulate exactly that.
      render(inspector, commits[0]!);

      const popover = inspector.root.querySelector<HTMLElement>('.mudra-color-picker__popover')!;
      expect(popover.hidden).toBe(false);
    } finally {
      dispose();
    }
  });

  it('reflects new values into the existing controls', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, {});
      render(inspector, { level: 8 });

      const input = fieldFor(inspector.root, 'level').querySelector<HTMLInputElement>('input')!;
      expect(input.value).toBe('8');
    } finally {
      dispose();
    }
  });

  it('rebuilds when a DIFFERENT clip is selected', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, {}, 0);
      const before = fieldFor(inspector.root, 'tint');

      render(inspector, {}, 1);

      expect(fieldFor(inspector.root, 'tint')).not.toBe(before);
    } finally {
      dispose();
    }
  });
});

describe('visibleWhen (schema-driven, no action-specific branch)', () => {
  it('hides a gated field until its gate value is chosen, and shows it in place after', () => {
    const { inspector, dispose } = buildInspector();
    try {
      render(inspector, { mode: 'a' });
      const gated = fieldFor(inspector.root, 'onlyForB');
      expect(gated.hidden).toBe(true);

      render(inspector, { mode: 'b' });

      // Same element — reconciled, not rebuilt — now showing.
      expect(fieldFor(inspector.root, 'onlyForB')).toBe(gated);
      expect(gated.hidden).toBe(false);
    } finally {
      dispose();
    }
  });
});
