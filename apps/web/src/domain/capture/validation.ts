/**
 * Frame validation — the quality gate before storage (FR-017, FR-018).
 *
 * A deliberate port of Mudra Capture's `PoseSampleValidator`, preserving its rules and its four
 * rejection reasons **verbatim**, so the two applications reject the same frames for the same
 * stated reasons and neither invents a Web-specific notion of validity.
 *
 * Like Capture's, it never judges whether the operator performed the *correct* pose. That would be
 * recognition, and Capture Mode does none (FR-022, FR-025).
 */

import { HAND_LANDMARK_COUNT } from '../landmarks/topology';
import type { LandmarkFrame } from '../landmarks/types';
import type { RequiredHands } from './types';

/** Why a frame did not become a sample. The wire values match Mudra Capture's. */
export type RejectionReason =
  /** Nothing was in frame. */
  | 'no_hands'
  /** Fewer hands than the pose requires. */
  | 'insufficient_hands'
  /** A hand did not carry exactly 21 landmarks. */
  | 'wrong_landmark_count'
  /** A coordinate was NaN or infinite. */
  | 'non_finite_coordinates';

/** Accepted, or rejected with a reason. */
export type CaptureValidationOutcome =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: RejectionReason };

const ACCEPTED: CaptureValidationOutcome = { accepted: true };

/** Validate one detected frame against the pose's needs and the engine's own rules. */
export function validateFrame(
  frame: LandmarkFrame,
  requiredHands: RequiredHands,
): CaptureValidationOutcome {
  if (frame.hands.length === 0) {
    return { accepted: false, reason: 'no_hands' };
  }
  if (frame.hands.length < requiredHands) {
    return { accepted: false, reason: 'insufficient_hands' };
  }
  for (const hand of frame.hands) {
    if (hand.landmarks.points.length !== HAND_LANDMARK_COUNT) {
      return { accepted: false, reason: 'wrong_landmark_count' };
    }
    for (const point of hand.landmarks.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
        return { accepted: false, reason: 'non_finite_coordinates' };
      }
    }
  }
  return ACCEPTED;
}

/**
 * A rejection reason in the operator's language (FR-019, FR-071).
 *
 * Kept beside the reasons themselves so a new reason cannot be added without someone deciding what
 * the person in front of the camera should be told about it.
 */
export function explainRejection(reason: RejectionReason, requiredHands: RequiredHands): string {
  switch (reason) {
    case 'no_hands':
      return 'No hands were visible — nothing was recorded. Move into frame and try again.';
    case 'insufficient_hands':
      return `This pose needs ${requiredHands} hands in frame — nothing was recorded.`;
    case 'wrong_landmark_count':
      return 'A hand was only partly detected — nothing was recorded. Move fully into frame.';
    case 'non_finite_coordinates':
      return 'The detector returned an unusable reading — nothing was recorded. Try again.';
  }
}
