/**
 * `PoseTriggerPanel` — confidence/cooldown are validated before ever reaching `onChange`
 * (P0.1), the same reject-and-show-inline-error discipline `Inspector.commit()` already uses
 * for action params. This is the fix for "project.catalog is invalid — ...value must lie in
 * [0, 1], got 50": that value must never have been writable in the first place.
 */

import { describe, expect, it } from 'vitest';

import { PoseTriggerPanel } from '../../src/presentation/editor/pose-trigger-panel';
import type { PoseOption } from '../../src/presentation/editor/pose-trigger-panel';
import type { Trigger } from '../../src/domain/effects/types';

const poses: PoseOption[] = [
  { poseId: 'dragon', displayName: 'Dragon', eligible: true, active: true },
];

function buildPanel() {
  const changes: Trigger[] = [];
  const panel = new PoseTriggerPanel({ document, onChange: (trigger) => changes.push(trigger) });
  panel.setPoses(poses);
  panel.render({ on: 'confirmed', poseId: 'dragon', conditions: [] });
  return { panel, changes };
}

function fireChange(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('PoseTriggerPanel — confidence out of [0, 1] is rejected, never committed', () => {
  it('typing 50 into confidence never calls onChange, and shows an inline error', () => {
    const { panel, changes } = buildPanel();
    const confidenceInput =
      panel.root.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]!;
    fireChange(confidenceInput, '50');

    expect(changes).toHaveLength(0);
    const error = panel.root.querySelector('.mudra-editor__inspector-error')!;
    expect(error.textContent).toMatch(/\[0, 1\], got 50/);
  });

  it('a valid confidence commits normally and clears any prior error', () => {
    const { panel, changes } = buildPanel();
    const confidenceInput =
      panel.root.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]!;
    fireChange(confidenceInput, '50');
    expect(changes).toHaveLength(0);

    fireChange(confidenceInput, '0.75');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.conditions).toContainEqual({ type: 'confidenceAtLeast', value: 0.75 });
    const error = panel.root.querySelector('.mudra-editor__inspector-error')!;
    expect(error.textContent).toBe('');
  });
});

describe('PoseTriggerPanel — cooldown must not be negative', () => {
  it('a negative cooldown never calls onChange', () => {
    const { panel, changes } = buildPanel();
    const cooldownInput = panel.root.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]!;
    fireChange(cooldownInput, '-100');

    expect(changes).toHaveLength(0);
    const error = panel.root.querySelector('.mudra-editor__inspector-error')!;
    expect(error.textContent).toMatch(/not be negative, got -100/);
  });

  it('a valid cooldown commits normally', () => {
    const { panel, changes } = buildPanel();
    const cooldownInput = panel.root.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]!;
    fireChange(cooldownInput, '1200');

    expect(changes).toHaveLength(1);
    expect(changes[0]!.conditions).toContainEqual({ type: 'cooldown', ms: 1200 });
  });
});

describe('PoseTriggerPanel — render() clears a stale error from a previous selection', () => {
  it('selecting a different effect resets the error text', () => {
    const { panel } = buildPanel();
    const confidenceInput =
      panel.root.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]!;
    fireChange(confidenceInput, '50');
    expect(panel.root.querySelector('.mudra-editor__inspector-error')!.textContent).not.toBe('');

    panel.render({ on: 'confirmed', poseId: 'dragon', conditions: [] });
    expect(panel.root.querySelector('.mudra-editor__inspector-error')!.textContent).toBe('');
  });
});
