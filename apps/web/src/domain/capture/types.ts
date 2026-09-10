/**
 * Capture Mode's value objects (data-model.md).
 *
 * The most important property of this file is what it does **not** contain. Every field below is a
 * number, a string, a boolean, or an array of those — there is no `unknown`, no `any`, no index
 * signature, no `Blob`, no `ImageBitmap`, no `MirroredSurface`, and no `SegmentationFrame`. So
 * "Capture Mode must never persist a camera frame" (FR-040, constitution v1.8.0 categories 1 and 2)
 * is not a rule a reviewer has to remember: there is no field an image could be assigned to, and
 * attempting it does not compile.
 *
 * Framework-free and constructible in a plain Node test with no camera and no storage (FR-060).
 */

import type { Handedness, Landmark } from '../landmarks/types';

/** Raised when a capture value object's invariant is violated at construction. */
export class CaptureError extends Error {
  /** Name the failing invariant in the message; there is no error code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** How many hands a pose needs. Derived from the dataset, or stated by the operator (FR-014). */
export type RequiredHands = 1 | 2;

/** Whether a session is still accepting takes. There is deliberately no reopen transition. */
export type CaptureSessionStatus = 'active' | 'closed';

/**
 * One detected hand, as stored.
 *
 * `raw` is the earliest **canonical** observation — the detector's own output, already in the
 * mirrored (selfie) space the dataset uses, because `MirroredSurface` flips the pixels *before*
 * detection. No coordinate is ever flipped afterwards (FR-026, FR-027).
 */
export interface CaptureHand {
  readonly handedness: Handedness;
  /** The detector's handedness score, in `[0,1]`. */
  readonly confidence: number;
  /** 21 canonical-raw points. */
  readonly raw: readonly Landmark[];
  /** 21 points from the application's existing `normalize()` — never a second algorithm. */
  readonly normalized: readonly Landmark[];
}

/** One accepted observation. Carries nothing that could hold an image. */
export interface CaptureSample {
  /** Becomes `sample_uuid`. Globally unique, so a repeated export's duplicates stay detectable. */
  readonly id: string;
  readonly sessionId: string;
  /** ISO-8601 UTC in Engine's format (see `engine-timestamp.ts`). */
  readonly capturedAt: string;
  /** Source surface size in device pixels; becomes `metadata.camera.width`/`.height`. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** When the take was armed; `null` only if a take somehow recorded without being armed. */
  readonly countdownStartedAt: string | null;
  /** Configured countdown in seconds; `0` when disabled. */
  readonly countdownSeconds: number;
  /** Distinguishes "no countdown" from "a countdown of zero seconds". */
  readonly countdownEnabled: boolean;
  readonly hands: readonly CaptureHand[];
}

/** One operator's recording session for exactly one pose. The unit of review, deletion, export. */
export interface CaptureSession {
  /** Becomes `metadata.capture.session_uuid`. */
  readonly id: string;
  /** Dataset provenance only — never identity, never authorization (FR-005). */
  readonly contributorLabel: string;
  readonly poseId: string;
  /** From the dataset when the pose is known; operator-supplied for a new pose; else `null`. */
  readonly displayName: string | null;
  readonly requiredHands: RequiredHands;
  readonly status: CaptureSessionStatus;
  /** ISO-8601 UTC in Engine's format. */
  readonly startedAt: string;
  /** Accepted samples currently stored for this session. */
  readonly sampleCount: number;
  /** Frames this session rejected. Manifest provenance; no sample carries it. */
  readonly discardedCount: number;
}

/** A session plus its samples, as the review and export surfaces consume it. */
export interface CaptureSessionWithSamples {
  readonly session: CaptureSession;
  readonly samples: readonly CaptureSample[];
}

/**
 * Build a {@link CaptureHand}, enforcing the invariants a stored sample depends on.
 *
 * Deliberately stricter than "it has some points": a hand with 20 landmarks or a `NaN` coordinate
 * would serialize into a document Engine rejects, and the failure would surface at import time
 * rather than here (FR-017).
 */
export function captureHand(
  handedness: Handedness,
  confidence: number,
  raw: readonly Landmark[],
  normalized: readonly Landmark[],
  expectedLandmarkCount: number,
): CaptureHand {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new CaptureError(`Handedness confidence must lie in [0,1], got ${confidence}.`);
  }
  for (const [label, points] of [
    ['raw', raw],
    ['normalized', normalized],
  ] as const) {
    if (points.length !== expectedLandmarkCount) {
      throw new CaptureError(
        `A captured hand's ${label} set must hold exactly ${expectedLandmarkCount} landmarks, got ${points.length}.`,
      );
    }
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
        throw new CaptureError(`A captured hand's ${label} set holds a non-finite coordinate.`);
      }
    }
  }
  return { handedness, confidence, raw, normalized };
}
