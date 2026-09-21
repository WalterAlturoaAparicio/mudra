/**
 * Face landmark detection, as an interface (Spec 011, constitution v1.10.0 Milestone 4).
 *
 * Mirrors `PersonSegmenter`'s shape rather than `HandDetector`'s: "no face this frame" is
 * `null`, not an empty frame, because the hand detector emits a frame every call only for the
 * stability tracker and pose events — and faces feed neither. Face tracking supplies geometry
 * to effects; it is not a recognition system.
 *
 * "This capability does not exist" is a different thing from "no face this frame": it is the
 * absence of a detector altogether, decided once by `probeCapabilities`.
 */

import type { FaceFrame } from '../landmarks/face';
import type { MirroredSurface } from './camera';

/**
 * What the detector last did, for development diagnostics (Amendment A, FR-038). Three scalars —
 * an outcome, the landmark count the model actually returned, and when. Never geometry. The
 * count is recorded *before* the count guard decides, so a wrong `FACE_LANDMARK_COUNT` reads as
 * `count-mismatch (received N)` rather than as "no face".
 */
export interface FaceDetectorDiagnostics {
  readonly outcome: 'none-yet' | 'face' | 'no-face' | 'count-mismatch' | 'error';
  readonly pointCount: number | null;
  readonly atMs: number | null;
}

/** Turns a surface into one face's landmarks, or reports that there is none this frame. */
export interface FaceDetector {
  /**
   * Detect a face in the current contents of `surface`.
   *
   * Never throws for a per-frame failure: a frame that could not be analysed is `null`, exactly
   * as if no face were present (the adapter reports it once, not per frame).
   *
   * @returns `null` when no usable face was found this frame.
   */
  detect(surface: MirroredSurface, timestampMs: number): FaceFrame | null;
  /** Release backend resources. Idempotent and terminal — the detector is unusable afterwards. */
  close(): void;
  /** Read-only status of the last genuine analysis. Optional: a detector without it is
   *  tolerated. Reading it never runs the detector. */
  diagnostics?(): FaceDetectorDiagnostics;
}
