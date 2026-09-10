/**
 * Pure session operations (data-model.md, FR-012 – FR-014b).
 *
 * Every function here is `CaptureSession → CaptureSession` or a validation. Nothing reaches storage,
 * nothing reads a clock it was not handed, and nothing knows a browser exists — so the rules about
 * what a session *is* are asserted in Node with no IndexedDB attached (FR-038, FR-060).
 *
 * There is no `reopen`: a closed session stays closed, which is why the type has no transition for
 * it rather than a guard against it.
 */

import type { CaptureConfig } from '../config/capture-config';
import { engineTimestamp } from './engine-timestamp';
import type { CaptureSession, RequiredHands } from './types';
import { CaptureError } from './types';

/** What creating a session needs. */
export interface NewSessionInput {
  readonly id: string;
  readonly contributorLabel: string;
  readonly poseId: string;
  /** From the dataset when the pose is known; the operator's entry for a new pose; else `null`. */
  readonly displayName: string | null;
  readonly requiredHands: RequiredHands;
  readonly startedAt: Date;
}

/**
 * Validate a contributor label against the configured pattern (FR-005).
 *
 * @returns `null` when valid, otherwise a message written for the operator, not for a log.
 */
export function contributorLabelProblem(label: string, config: CaptureConfig): string | null {
  if (label.length === 0) {
    return 'Enter a contributor label so these samples can be traced back later.';
  }
  if (!new RegExp(config.contributorLabelPattern).test(label)) {
    return (
      'A contributor label is 2–24 characters, lower-case letters, digits, “-” or “_” — ' +
      'a short handle, not a name or an email address.'
    );
  }
  return null;
}

/**
 * Validate a pose identifier against the dataset's existing identity rule (FR-013).
 *
 * A pose that is not in the dataset yet is deliberately permitted: collecting samples for a new
 * pose is one of the reasons Capture Mode exists.
 */
export function poseIdProblem(poseId: string, config: CaptureConfig): string | null {
  if (poseId.length === 0) {
    return 'Choose a pose, or type an identifier for a new one.';
  }
  if (!new RegExp(config.poseIdPattern).test(poseId)) {
    return 'A pose id uses lower-case letters, digits and underscores only — for example “dragon”.';
  }
  return null;
}

/**
 * Build a new, active session.
 *
 * @throws CaptureError when the label or the pose id fails validation, so an invalid session can
 *   never reach storage in the first place.
 */
export function createSession(input: NewSessionInput, config: CaptureConfig): CaptureSession {
  const labelProblem = contributorLabelProblem(input.contributorLabel, config);
  if (labelProblem !== null) {
    throw new CaptureError(labelProblem);
  }
  const poseProblem = poseIdProblem(input.poseId, config);
  if (poseProblem !== null) {
    throw new CaptureError(poseProblem);
  }
  if (input.requiredHands !== 1 && input.requiredHands !== 2) {
    throw new CaptureError(`A pose requires 1 or 2 hands, got ${String(input.requiredHands)}.`);
  }
  return {
    id: input.id,
    contributorLabel: input.contributorLabel,
    poseId: input.poseId,
    displayName: input.displayName,
    requiredHands: input.requiredHands,
    status: 'active',
    startedAt: engineTimestamp(input.startedAt),
    sampleCount: 0,
    discardedCount: 0,
  };
}

/** A session with one more accepted sample. */
export function withAcceptedSample(session: CaptureSession): CaptureSession {
  return { ...session, sampleCount: session.sampleCount + 1 };
}

/** A session with one more rejected frame recorded. Rejected frames are never stored. */
export function withDiscardedFrame(session: CaptureSession): CaptureSession {
  return { ...session, discardedCount: session.discardedCount + 1 };
}

/**
 * A session with one fewer sample.
 *
 * Clamped at zero rather than allowed to go negative: a count that disagreed with the store would
 * be worse than a count that refuses to.
 */
export function withDeletedSample(session: CaptureSession): CaptureSession {
  return { ...session, sampleCount: Math.max(0, session.sampleCount - 1) };
}

/** A closed session. Closing twice is harmless; there is no way back. */
export function closeSession(session: CaptureSession): CaptureSession {
  return session.status === 'closed' ? session : { ...session, status: 'closed' };
}

/** Whether a session may still accept takes. */
export function acceptsTakes(session: CaptureSession): boolean {
  return session.status === 'active';
}
