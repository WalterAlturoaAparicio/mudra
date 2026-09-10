/**
 * How long the current pose has been held, and whether it has been confirmed.
 *
 * **The rule that governs this type**: any outcome other than a confident, unambiguous
 * match *of the same pose* resets it (FR-032). Confirmation is therefore always relative
 * to one continuous, uninterrupted hold — which is what makes "hold this for a second" a
 * meaningful instruction rather than "accumulate a second of it eventually".
 *
 * Timing is elapsed wall-clock throughout, never a frame count (FR-036), so a hold is one
 * second on a 15 fps laptop and on a 144 Hz desktop alike.
 */

/** An immutable snapshot of the current hold. */
export interface HoldState {
  /** The pose being held, or `null` when nothing is. */
  readonly poseId: string | null;
  /** When the current continuous hold began, in milliseconds. */
  readonly heldSince: number | null;
  /** When this hold was confirmed, or `null` if it has not been. */
  readonly confirmedAt: number | null;
}

/** Nothing is being held. */
export const IDLE_HOLD: HoldState = { poseId: null, heldSince: null, confirmedAt: null };

/**
 * Advance the hold given a confident match of `poseId` at `nowMs`.
 *
 * Starts a new hold when the pose changed or none was in progress; otherwise continues
 * the existing one, carrying `confirmedAt` forward so a second confirmation cannot fire.
 */
export function holding(previous: HoldState, poseId: string, nowMs: number): HoldState {
  if (previous.poseId !== poseId || previous.heldSince === null) {
    return { poseId, heldSince: nowMs, confirmedAt: null };
  }
  return previous;
}

/** Break the hold. The next confident match starts counting from zero again. */
export function released(): HoldState {
  return IDLE_HOLD;
}

/**
 * How far through the required hold this is, clamped to `[0,1]`.
 *
 * Drives the visible build-up (FR-035/FR-088), so it must be continuous rather than a
 * step at the end — a progress value that only ever read 0 or 1 would leave the user with
 * no idea whether anything was happening.
 */
export function progress(state: HoldState, nowMs: number, targetMs: number): number {
  if (state.heldSince === null || targetMs <= 0) {
    return state.heldSince === null ? 0 : 1;
  }
  const elapsed = nowMs - state.heldSince;
  if (elapsed <= 0) {
    return 0;
  }
  return elapsed >= targetMs ? 1 : elapsed / targetMs;
}

/**
 * Whether this hold has reached its target and has not already been confirmed.
 *
 * The `confirmedAt === null` half is what makes FR-034 true: exactly one confirmation per
 * continuous hold, no matter how many frames arrive after it.
 */
export function readyToConfirm(state: HoldState, nowMs: number, targetMs: number): boolean {
  if (state.heldSince === null || state.confirmedAt !== null) {
    return false;
  }
  return nowMs - state.heldSince >= targetMs;
}

/** Mark this hold confirmed at `nowMs`. */
export function confirmed(state: HoldState, nowMs: number): HoldState {
  return { poseId: state.poseId, heldSince: state.heldSince, confirmedAt: nowMs };
}
