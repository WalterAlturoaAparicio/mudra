/**
 * `validateConditionValue` — the single shared rule both `catalog-loader.ts`'s `parseCondition`
 * (at load) and `pose-trigger-panel.ts` (before ever committing an edit) enforce, so a value
 * that would fail to reload is rejected the moment it is typed instead (P0.1).
 */

import { describe, expect, it } from 'vitest';

import { ConditionValueError, validateConditionValue } from '../../src/domain/effects/conditions';

describe('validateConditionValue — confidenceAtLeast', () => {
  it('accepts the boundaries and everything between them', () => {
    expect(() => validateConditionValue('confidenceAtLeast', 0)).not.toThrow();
    expect(() => validateConditionValue('confidenceAtLeast', 0.5)).not.toThrow();
    expect(() => validateConditionValue('confidenceAtLeast', 1)).not.toThrow();
  });

  it('rejects a value outside [0, 1], naming the value', () => {
    expect(() => validateConditionValue('confidenceAtLeast', 50)).toThrow(ConditionValueError);
    expect(() => validateConditionValue('confidenceAtLeast', 50)).toThrow(/\[0, 1\], got 50/);
    expect(() => validateConditionValue('confidenceAtLeast', -0.1)).toThrow(ConditionValueError);
  });
});

describe('validateConditionValue — cooldown', () => {
  it('accepts zero and any positive number', () => {
    expect(() => validateConditionValue('cooldown', 0)).not.toThrow();
    expect(() => validateConditionValue('cooldown', 5000)).not.toThrow();
  });

  it('rejects a negative cooldown', () => {
    expect(() => validateConditionValue('cooldown', -1)).toThrow(ConditionValueError);
    expect(() => validateConditionValue('cooldown', -1)).toThrow(/not be negative, got -1/);
  });
});
