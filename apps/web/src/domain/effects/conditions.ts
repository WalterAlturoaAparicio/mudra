/**
 * Trigger conditions (FR-043).
 *
 * Two of them, because two are what the milestone needs: a confidence threshold and a
 * cooldown. Both are evaluated against the event and the runtime's own state, and an
 * unknown condition type is rejected at load rather than ignored (FR-045) — a condition
 * silently treated as "true" is how an effect starts firing when nobody meant it to.
 */

import type { PoseEvent } from '../events/pose-events';
import type { Condition } from './types';

/** Raised when a condition's own value does not satisfy its type's rule. */
export class ConditionValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionValueError';
  }
}

/**
 * The one place a condition's value bounds are enforced (FR-043, FR-045).
 *
 * `catalog-loader.ts`'s `parseCondition` calls this at load; `pose-trigger-panel.ts` calls it
 * before ever committing an edit to the `Project` — so the same rule that would reject a
 * value on reload rejects it at the moment it is typed, and the two can never drift apart into
 * "valid in memory, invalid on disk" the way a value written straight from an unclamped
 * `<input>` used to.
 *
 * @throws ConditionValueError naming the bound and the value, in the same words
 *   `catalog-loader.ts` already used, so an author sees one consistent message whichever path
 *   caught it.
 */
export function validateConditionValue(type: Condition['type'], value: number): void {
  if (type === 'confidenceAtLeast') {
    if (value < 0 || value > 1) {
      throw new ConditionValueError('must lie in [0, 1], got ' + value + '.');
    }
    return;
  }
  if (value < 0) {
    throw new ConditionValueError('must not be negative, got ' + value + '.');
  }
}

/** What condition evaluation can see. */
export interface ConditionContext {
  readonly event: PoseEvent;
  /** When this effect last *started*, or `null` if it never has. */
  readonly lastStartedAtMs: number | null;
  readonly nowMs: number;
}

/** Whether every condition holds. An empty list holds trivially. */
export function conditionsMet(
  conditions: readonly Condition[],
  context: ConditionContext,
): boolean {
  return conditions.every((condition) => conditionMet(condition, context));
}

/** Whether one condition holds. */
export function conditionMet(condition: Condition, context: ConditionContext): boolean {
  switch (condition.type) {
    case 'confidenceAtLeast':
      return context.event.confidence >= condition.value;
    case 'cooldown': {
      // Measured from the last *start*, not the last completion: an effect with a 1500 ms
      // cooldown fires at most every 1500 ms regardless of how long it runs, which is what
      // an author means by "cool down".
      if (context.lastStartedAtMs === null) {
        return true;
      }
      return context.nowMs - context.lastStartedAtMs >= condition.ms;
    }
  }
}

/** The condition types this milestone understands, for the catalog validator. */
export const KNOWN_CONDITION_TYPES: readonly string[] = ['confidence_at_least', 'cooldown'];
