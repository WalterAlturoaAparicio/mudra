/**
 * Authoring a face-landmark anchor in the Inspector (Spec 011 FR-007, FR-015a; decision D21).
 *
 * The Inspector is the *authoring* boundary for the model-dependent index range: it rejects an
 * index outside the (provisional, until verified) landmark count and names the range. It also
 * works while `face_landmarks` is unavailable — authoring is never gated — and it never shows a
 * hand selector for a face anchor, which has no hand.
 */

import { describe, expect, it } from 'vitest';

import type { ParamValue } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT } from '../../src/domain/landmarks/face';
import type { ParamSpec } from '../../src/domain/runtime/action-registry';
import { renderControl } from '../../src/presentation/editor/inspector-controls';

const anchorSpec: ParamSpec = {
  name: 'anchor',
  kind: 'anchor',
  defaultValue: { kind: 'landmark', hand: 'first', index: 8 },
  description: 'Where it follows.',
};

function build(value: ParamValue) {
  const changes: ParamValue[] = [];
  const control = renderControl({
    document,
    spec: anchorSpec,
    value,
    onChange: (next) => changes.push(next),
  });
  const kindSelect = control.root.querySelector<HTMLSelectElement>('select')!;
  return { control, changes, kindSelect };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the face-landmark anchor control', () => {
  it('offers the face kind, and choosing it stores a face anchor at index 0 with no hand', () => {
    const { changes, kindSelect } = build({ kind: 'screen', x: 0.5, y: 0.5 });
    expect([...kindSelect.options].map((o) => o.value)).toContain('faceLandmark');

    kindSelect.value = 'faceLandmark';
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changes).toEqual([{ kind: 'faceLandmark', index: 0 }]);
    expect(changes[0]).not.toHaveProperty('hand');
  });

  it('shows only an index field for a face anchor — no hand selector', () => {
    const { control } = build({ kind: 'faceLandmark', index: 3 });
    const selects = control.root.querySelectorAll('select');
    expect(selects).toHaveLength(1); // the kind select only
    const input = control.root.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.value).toBe('3');
  });

  it('a valid index is stored as { kind, index }', () => {
    const { control, changes } = build({ kind: 'faceLandmark', index: 3 });
    type(control.root.querySelector('input')!, '33');
    expect(changes).toEqual([{ kind: 'faceLandmark', index: 33 }]);
  });

  it.each([String(FACE_LANDMARK_COUNT), '99999', '-1', '1.5', ''])(
    'rejects %j at authoring: nothing stored, the field reverts, and the range is named',
    (bad) => {
      const { control, changes } = build({ kind: 'faceLandmark', index: 3 });
      const input = control.root.querySelector<HTMLInputElement>('input')!;
      type(input, bad);

      expect(changes).toEqual([]);
      expect(input.value).toBe('3');
      const message = control.root.querySelector<HTMLElement>('.mudra-editor__field-hint')!;
      expect(message.hidden).toBe(false);
      expect(message.textContent).toContain('0 to ' + (FACE_LANDMARK_COUNT - 1));
    },
  );

  it('accepts the last valid index and clears an earlier message', () => {
    const { control, changes } = build({ kind: 'faceLandmark', index: 3 });
    const input = control.root.querySelector<HTMLInputElement>('input')!;
    type(input, '9999');
    type(input, String(FACE_LANDMARK_COUNT - 1));
    expect(changes).toEqual([{ kind: 'faceLandmark', index: FACE_LANDMARK_COUNT - 1 }]);
    expect(control.root.querySelector<HTMLElement>('.mudra-editor__field-hint')!.hidden).toBe(true);
  });

  it('leaves hand anchors exactly as they were', () => {
    const { control, changes } = build({ kind: 'landmark', hand: 'left', index: 8 });
    const selects = control.root.querySelectorAll('select');
    expect(selects).toHaveLength(2); // kind + hand
    type(control.root.querySelector('input')!, '12');
    expect(changes).toEqual([{ kind: 'landmark', hand: 'left', index: 12 }]);
  });
});
