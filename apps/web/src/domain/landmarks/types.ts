/**
 * Landmark value objects — the shape every later stage consumes.
 *
 * Immutable, validated at construction, and free of any browser type: a `LandmarkFrame`
 * can be built by hand in a Node test with no camera and no canvas, which is what makes
 * the rest of the domain testable headlessly (research D13).
 */

import { HAND_LANDMARK_COUNT } from './topology';

/**
 * The user's **physical** hand.
 *
 * Correct without adjustment because the detector receives an already-mirrored image
 * (research D1): MediaPipe assumes a mirrored selfie frame, so the label it reports
 * already names the hand the user actually raised.
 */
export type Handedness = 'left' | 'right' | 'unknown';

/** A single tracked point on a hand. */
export interface Landmark {
  /** Normalized to `[0,1]` in mirrored frame space. */
  readonly x: number;
  /** Normalized to `[0,1]` in mirrored frame space. */
  readonly y: number;
  /** Relative depth. Participates in distance; never in drawing. */
  readonly z: number;
}

/** The fixed set of 21 landmarks for one hand. */
export interface HandLandmarks {
  readonly points: readonly Landmark[];
}

/** Raised when a value object's invariant is violated at construction. */
export class LandmarkError extends Error {
  /** Name the failing invariant in the message; there is no error code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'LandmarkError';
  }
}

/**
 * Build a {@link HandLandmarks}, enforcing the 21-point invariant every downstream stage
 * relies on. A short hand is rejected here rather than producing a silently wrong
 * distance twelve calls later.
 */
export function handLandmarks(points: readonly Landmark[]): HandLandmarks {
  if (points.length !== HAND_LANDMARK_COUNT) {
    throw new LandmarkError(
      `HandLandmarks requires exactly ${HAND_LANDMARK_COUNT} points, got ${points.length}.`,
    );
  }
  return { points };
}

/** One detected hand: which hand it is, how sure the detector is, and where it is. */
export interface HandObservation {
  readonly handedness: Handedness;
  /** The handedness classification score, in `[0,1]`. */
  readonly confidence: number;
  readonly landmarks: HandLandmarks;
}

/**
 * Build a {@link HandObservation}, rejecting a confidence outside `[0,1]`.
 */
export function handObservation(
  handedness: Handedness,
  confidence: number,
  landmarks: HandLandmarks,
): HandObservation {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new LandmarkError(`Handedness confidence must lie in [0,1], got ${confidence}.`);
  }
  return { handedness, confidence, landmarks };
}

/**
 * The result of processing one frame.
 *
 * Emitted for **every** processed frame, including frames with no hands (FR-015): "no
 * hands" is a recognition outcome the stability tracker must see, not an absence of one.
 */
export interface LandmarkFrame {
  /** 0–2 hands. Empty is valid and meaningful. */
  readonly hands: readonly HandObservation[];
  /** Monotonic source timestamp in milliseconds. */
  readonly timestampMs: number;
  /** Source surface width in device pixels, for anchor resolution. */
  readonly width: number;
  /** Source surface height in device pixels, for anchor resolution. */
  readonly height: number;
}

/** Build a {@link LandmarkFrame}. */
export function landmarkFrame(
  hands: readonly HandObservation[],
  timestampMs: number,
  width: number,
  height: number,
): LandmarkFrame {
  return { hands, timestampMs, width, height };
}
