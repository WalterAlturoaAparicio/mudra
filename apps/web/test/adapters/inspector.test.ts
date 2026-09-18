/**
 * SC-002: registering a new action type through the production `ActionRegistry` renders
 * correct controls for it in the inspector — with **zero** changes to `inspector.ts` or
 * `inspector-controls.ts`. This test is that proof: it registers a throwaway type nobody
 * shipped and asserts the inspector renders it correctly anyway (T036, research D6).
 *
 * The inspector always prepends one entry-level `duration (ms)` field (P1.1) ahead of the
 * schema-driven ones — `fieldFor()` below locates a control by its own field label so these
 * tests keep targeting the throwaway type's own params regardless of that fixed first field.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createActionRegistry } from '../../src/domain/runtime/actions';
import type { ActionDescriptor } from '../../src/domain/runtime/action-registry';
import { Inspector } from '../../src/presentation/editor/inspector';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';

const THROWAWAY_TYPE = 'test_throwaway_action_' + Math.random().toString(36).slice(2);

const throwawayDescriptor: ActionDescriptor = {
  type: THROWAWAY_TYPE,
  behaviour: 'duration',
  params: [
    { name: 'level', kind: 'number', defaultValue: 3, min: 0, max: 10, description: 'A number.' },
    {
      name: 'tint',
      kind: 'color',
      defaultValue: '#112233',
      description: 'A colour nobody shipped.',
    },
    {
      name: 'mode',
      kind: 'enum',
      defaultValue: 'a',
      values: ['a', 'b', 'c'],
      description: 'A pick-one.',
    },
    { name: 'on', kind: 'boolean', defaultValue: true, description: 'A toggle.' },
    { name: 'label', kind: 'string', defaultValue: 'hi', description: 'Free text.' },
  ],
  update: () => ({ commands: [] }),
};

/** Locate a rendered control by its own field label — robust against the fixed leading
 *  `duration (ms)` field (P1.1) that every selection now also renders. */
function fieldFor(root: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement {
  const field = [...root.querySelectorAll('.mudra-editor__field')].find(
    (candidate) => candidate.querySelector('.mudra-editor__field-label')?.textContent === name,
  );
  if (field === undefined) {
    throw new Error('No field labelled "' + name + '" was rendered.');
  }
  return field.querySelector('input, select')!;
}

describe('Inspector — schema-driven, zero-code-change extensibility', () => {
  let inspector: Inspector;
  let calls: Readonly<Record<string, unknown>>[];
  let durationCalls: number[];

  beforeEach(() => {
    const registry = createActionRegistry();
    registry.register(throwawayDescriptor);
    calls = [];
    durationCalls = [];
    inspector = new Inspector({
      document,
      registry,
      onParamsChange: (params) => {
        calls.push(params);
      },
      onDurationChange: (durationMs) => {
        durationCalls.push(durationMs);
      },
      onToggleLock: () => {},
    });
  });

  it('renders one control per parameter of the throwaway type, unmodified inspector code', () => {
    inspector.render({ actionType: THROWAWAY_TYPE, params: {} }, defaultCapabilities());

    expect(fieldFor(inspector.root, 'level')).toBeInstanceOf(HTMLInputElement);
    expect(fieldFor(inspector.root, 'tint')).toBeInstanceOf(HTMLInputElement);
    expect(fieldFor(inspector.root, 'mode').tagName).toBe('SELECT');
    expect((fieldFor(inspector.root, 'on') as HTMLInputElement).type).toBe('checkbox');
    expect((fieldFor(inspector.root, 'label') as HTMLInputElement).type).toBe('text');
  });

  it('shows each control pre-filled with the descriptor default', () => {
    inspector.render({ actionType: THROWAWAY_TYPE, params: {} }, defaultCapabilities());

    expect((fieldFor(inspector.root, 'level') as HTMLInputElement).value).toBe('3');
    expect((fieldFor(inspector.root, 'mode') as HTMLSelectElement).value).toBe('a');
    expect((fieldFor(inspector.root, 'on') as HTMLInputElement).checked).toBe(true);
  });

  it('commits a validated change through onParamsChange, not a raw DOM value', () => {
    inspector.render({ actionType: THROWAWAY_TYPE, params: {} }, defaultCapabilities());
    const numberInput = fieldFor(inspector.root, 'level') as HTMLInputElement;
    numberInput.value = '7';
    numberInput.dispatchEvent(new Event('change'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!['level']).toBe(7);
    expect(calls[0]!['mode']).toBe('a'); // untouched params still present, defaults applied
    expect(durationCalls).toHaveLength(0); // the level field never touches duration
  });

  it('rejects an out-of-range value and never calls onParamsChange for it', () => {
    inspector.render({ actionType: THROWAWAY_TYPE, params: {} }, defaultCapabilities());
    const numberInput = fieldFor(inspector.root, 'level') as HTMLInputElement;
    numberInput.value = '999';
    numberInput.dispatchEvent(new Event('change'));

    expect(calls).toHaveLength(0);
    expect(inspector.root.textContent).toMatch(/level/);
  });

  it('shows an empty state when nothing is selected', () => {
    inspector.render(null, defaultCapabilities());
    // The default empty is "no effect selected". Which empty it is now matters — see
    // `test/adapters/editor-dead-ends.test.ts` for the three states and why one message
    // for all of them was wrong.
    expect(inspector.root.textContent).toMatch(/Nothing is selected/);
  });
});

describe('Inspector — duration field (P1.1)', () => {
  let inspector: Inspector;
  let paramCalls: Readonly<Record<string, unknown>>[];
  let durationCalls: number[];

  beforeEach(() => {
    const registry = createActionRegistry();
    registry.register(throwawayDescriptor);
    paramCalls = [];
    durationCalls = [];
    inspector = new Inspector({
      document,
      registry,
      onParamsChange: (params) => paramCalls.push(params),
      onDurationChange: (durationMs) => durationCalls.push(durationMs),
      onToggleLock: () => {},
    });
  });

  it('shows the selected entry’s own durationMs, defaulting to 0 when absent', () => {
    inspector.render(
      { actionType: THROWAWAY_TYPE, params: {}, durationMs: 750 },
      defaultCapabilities(),
    );
    const durationInput = inspector.root.querySelector<HTMLInputElement>(
      '.mudra-editor__field:first-child input[type="number"]',
    )!;
    expect(durationInput.value).toBe('750');

    inspector.render({ actionType: THROWAWAY_TYPE, params: {} }, defaultCapabilities());
    const durationInputNoDuration = inspector.root.querySelector<HTMLInputElement>(
      '.mudra-editor__field:first-child input[type="number"]',
    )!;
    expect(durationInputNoDuration.value).toBe('0');
  });

  it('commits a valid edit through onDurationChange, not onParamsChange', () => {
    inspector.render(
      { actionType: THROWAWAY_TYPE, params: {}, durationMs: 500 },
      defaultCapabilities(),
    );
    const durationInput = inspector.root.querySelector<HTMLInputElement>(
      '.mudra-editor__field:first-child input[type="number"]',
    )!;
    durationInput.value = '1200';
    durationInput.dispatchEvent(new Event('change'));

    expect(durationCalls).toEqual([1200]);
    expect(paramCalls).toHaveLength(0);
  });

  it('rejects a negative duration and never commits it', () => {
    inspector.render(
      { actionType: THROWAWAY_TYPE, params: {}, durationMs: 500 },
      defaultCapabilities(),
    );
    const durationInput = inspector.root.querySelector<HTMLInputElement>(
      '.mudra-editor__field:first-child input[type="number"]',
    )!;
    durationInput.value = '-100';
    durationInput.dispatchEvent(new Event('change'));

    expect(durationCalls).toHaveLength(0);
    expect(inspector.root.textContent).toMatch(/non-negative/);
  });
});

describe('Inspector — "needs a live camera" notice (item 7)', () => {
  const continuousDescriptor: ActionDescriptor = {
    type: 'test_continuous_action',
    behaviour: 'continuous',
    params: [],
    update: () => ({ commands: [] }),
  };

  it('shows a needs-camera notice for a continuous action when no camera is attached', () => {
    const registry = createActionRegistry();
    registry.register(continuousDescriptor);
    const inspector = new Inspector({
      document,
      registry,
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => {},
    });

    inspector.render(
      { actionType: 'test_continuous_action', params: {} },
      defaultCapabilities(),
      [],
      false,
    );
    expect(inspector.root.textContent).toMatch(/needs a live camera/);

    inspector.render(
      { actionType: 'test_continuous_action', params: {} },
      defaultCapabilities(),
      [],
      true,
    );
    expect(inspector.root.textContent).not.toMatch(/needs a live camera/);
  });
});

describe('Inspector — lock toggle (T028, spec 010 FR-015, FR-017)', () => {
  function lockButton(root: HTMLElement): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>('.mudra-editor__inspector-lock')!;
  }

  it('is always present, with an accessible name, and calls back when clicked', () => {
    const toggled: boolean[] = [];
    const inspector = new Inspector({
      document,
      registry: createActionRegistry(),
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => toggled.push(true),
    });

    const button = lockButton(inspector.root);
    expect(button.getAttribute('aria-label')).toBeTruthy();
    button.click();
    expect(toggled).toEqual([true]);
  });

  it('reflects the locked context flag with a visibly distinct state (FR-015, FR-017)', () => {
    const inspector = new Inspector({
      document,
      registry: createActionRegistry(),
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => {},
    });

    inspector.render(null, { capabilities: defaultCapabilities(), locked: false });
    expect(lockButton(inspector.root).getAttribute('aria-pressed')).toBe('false');
    expect(lockButton(inspector.root).dataset['locked']).toBe('false');
    const unlockedLabel = lockButton(inspector.root).getAttribute('aria-label');
    const unlockedIcon = lockButton(inspector.root).querySelector('svg')?.outerHTML;

    inspector.render(null, { capabilities: defaultCapabilities(), locked: true });
    expect(lockButton(inspector.root).getAttribute('aria-pressed')).toBe('true');
    expect(lockButton(inspector.root).dataset['locked']).toBe('true');
    expect(lockButton(inspector.root).getAttribute('aria-label')).not.toBe(unlockedLabel);
    expect(lockButton(inspector.root).querySelector('svg')?.outerHTML).not.toBe(unlockedIcon);
  });
});

describe('Inspector — section collapsing (T030, spec 010 FR-020, FR-022, FR-023)', () => {
  function groupFor(root: HTMLElement, name: string): HTMLElement {
    const group = [...root.querySelectorAll<HTMLElement>('.mudra-editor__field-group')].find(
      (candidate) => candidate.dataset['group'] === name,
    );
    if (group === undefined) {
      throw new Error('No field-group named "' + name + '" was rendered.');
    }
    return group;
  }

  function groupToggle(group: HTMLElement): HTMLButtonElement | null {
    return group.querySelector<HTMLButtonElement>('.mudra-editor__field-group-toggle');
  }

  it('collapsing a multi-group action hides that group’s fields and keeps its heading, clickable to re-expand', () => {
    const inspector = new Inspector({
      document,
      registry: createActionRegistry(), // particle_burst has 3 groups: Emission, Motion, Appearance
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => {},
    });
    inspector.render({ actionType: 'particle_burst', params: {} }, defaultCapabilities());

    const emission = groupFor(inspector.root, 'Emission');
    const toggle = groupToggle(emission)!;
    expect(toggle).toBeTruthy();
    const countField = [...emission.querySelectorAll('.mudra-editor__field')].find(
      (field) => field.querySelector('.mudra-editor__field-label')?.textContent === 'count',
    ) as HTMLElement;

    toggle.click();

    expect(emission.dataset['collapsed']).toBe('true');
    expect(countField.hidden).toBe(true);
    // the heading (and its toggle) stay present and clickable — only the fields hide
    expect(groupFor(inspector.root, 'Emission')).toBe(emission);
    expect(groupToggle(emission)).toBeTruthy();

    toggle.click();
    expect(emission.dataset['collapsed']).toBe('false');
    expect(countField.hidden).toBe(false);
  });

  it('collapse state survives an unrelated committed edit re-render of the same selection', () => {
    const inspector = new Inspector({
      document,
      registry: createActionRegistry(),
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => {},
    });
    inspector.render({ actionType: 'particle_burst', params: {} }, defaultCapabilities());
    groupToggle(groupFor(inspector.root, 'Emission'))!.click();
    expect(groupFor(inspector.root, 'Emission').dataset['collapsed']).toBe('true');

    // Same selection identity (same effectId/entryIndex/actionType) — this reconciles rather
    // than rebuilds, simulating a committed edit elsewhere on the same clip.
    inspector.render(
      { actionType: 'particle_burst', params: { count: 99 } },
      defaultCapabilities(),
    );

    expect(groupFor(inspector.root, 'Emission').dataset['collapsed']).toBe('true');
  });

  it('FR-023: a selection with exactly one parameter group renders no collapse control at all', () => {
    const registry = createActionRegistry();
    const singleGroupType = 'test_single_group_' + Math.random().toString(36).slice(2);
    registry.register({
      type: singleGroupType,
      behaviour: 'duration',
      params: [
        { name: 'a', kind: 'number', defaultValue: 1, group: 'Only', description: 'A.' },
        { name: 'b', kind: 'number', defaultValue: 2, group: 'Only', description: 'B.' },
      ],
      update: () => ({ commands: [] }),
    });
    const inspector = new Inspector({
      document,
      registry,
      onParamsChange: () => {},
      onDurationChange: () => {},
      onToggleLock: () => {},
    });

    inspector.render({ actionType: singleGroupType, params: {} }, defaultCapabilities());

    const only = groupFor(inspector.root, 'Only');
    expect(groupToggle(only)).toBeNull();
  });
});
