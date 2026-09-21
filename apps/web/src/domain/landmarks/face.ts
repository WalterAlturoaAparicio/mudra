/**
 * One tracked face's landmarks, as a framework-free value (Spec 011, constitution v1.10.0
 * Milestone 4).
 *
 * A `FaceFrame` is **geometry only**: ordered points, when they were detected, and the size of
 * the surface they are normalized against. It carries no blendshape, no transformation matrix,
 * no score, no label and no image, so there is nothing here an image, an identity or an
 * expression could be assigned to. It is transient runtime data — it is never stored,
 * serialized or transmitted, and it is deliberately **not** a member of `LandmarkFrame`, so the
 * recognition pipeline (which takes a `LandmarkFrame`) cannot see it.
 *
 * Coordinates are in the same normalized, mirrored-surface space, `y` down, as the hand
 * landmarks: the face detector is handed the same mirrored surface the hand detector reads.
 */

import type { Landmark } from './types';

/**
 * How many points one face carries.
 *
 * **Provisional and unverified.** 478 (468 mesh points plus iris points) is what the Face
 * Landmarker bundle is believed to return, but the model has not been downloaded or run, so this
 * is an assumption until the model verification of Spec 011's Definition of Done records the
 * observed count (V4, DoD-5); correct it then.
 *
 * It is a **runtime and authoring** boundary only — the detector adapter's count guard and the
 * Inspector's index range. It is never a project-load or persistence validation boundary:
 * persisted data must not depend on an unverified model fact (spec D21).
 */
export const FACE_LANDMARK_COUNT = 478;

/** Raised when a `FaceFrame`'s invariant is violated at construction. */
export class FaceFrameError extends Error {
  /** Name the failing invariant in the message; there is no error code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'FaceFrameError';
  }
}

/** One face's landmarks for one processed frame. Immutable, transient, never persisted. */
export interface FaceFrame {
  /** Exactly {@link FACE_LANDMARK_COUNT} points, normalized to `[0,1]` in mirrored surface space. */
  readonly points: readonly Landmark[];
  /** Monotonic source timestamp of the detection, in milliseconds. */
  readonly timestampMs: number;
  /** Width of the surface the detector was given, in device pixels. */
  readonly width: number;
  /** Height of the surface the detector was given, in device pixels. */
  readonly height: number;
}

/**
 * Build a {@link FaceFrame}, enforcing the invariants an anchor depends on.
 *
 * A face with the wrong number of points would misanchor every effect, and a non-finite
 * coordinate would put a NaN on the canvas, so both are rejected here rather than downstream.
 */
export function faceFrame(
  points: readonly Landmark[],
  timestampMs: number,
  width: number,
  height: number,
): FaceFrame {
  if (points.length !== FACE_LANDMARK_COUNT) {
    throw new FaceFrameError(
      `A FaceFrame requires exactly ${FACE_LANDMARK_COUNT} points, got ${points.length}.`,
    );
  }
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      throw new FaceFrameError('A FaceFrame holds a non-finite coordinate.');
    }
  }
  if (!Number.isFinite(timestampMs)) {
    throw new FaceFrameError('A FaceFrame needs a finite timestamp.');
  }
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new FaceFrameError(`A FaceFrame needs a positive surface size, got ${width}x${height}.`);
  }
  return { points, timestampMs, width, height };
}

/**
 * Supplies this frame's face, or `null` when there is none.
 *
 * The application layer builds this around a `FaceDetector`; the effect runtime calls it
 * **lazily, at most once per frame**, and only when a scheduled action's anchor needs a face —
 * so no analysis happens unless something needs it. It is never stored.
 */
export type FaceFrameSource = () => FaceFrame | null;
