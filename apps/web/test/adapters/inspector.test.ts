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
    expect(inspector.root.textContent).toMatch(/Select a clip/);
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
