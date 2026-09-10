/**
 * Hand detection, as an interface (FR-016).
 *
 * Exactly one method, taking a surface and a timestamp and returning coordinates. Engine
 * wraps its detector the same way for the same reason: the backend is a choice this
 * milestone makes, not a commitment the architecture carries.
 */

import type { LandmarkFrame } from '../landmarks/types';
import type { MirroredSurface } from './camera';

/** Why detection could not start. */
export type DetectorFailureReason =
  /** The model file could not be fetched or read. */
  | 'modelUnavailable'
  /** The browser cannot run the backend (no WASM, no WebGL, blocked). */
  | 'unsupportedBrowser'
  /** Something else; `message` carries what is known. */
  | 'unknown';

/** A detection failure, in a form the shell can turn into plain language (FR-017). */
export class DetectorError extends Error {
  readonly reason: DetectorFailureReason;

  /** @param reason Which situation this is, so the shell need not parse a message. */
  constructor(reason: DetectorFailureReason, message: string) {
    super(message);
    this.name = 'DetectorError';
    this.reason = reason;
  }
}

/** Turns a surface into landmarks. */
export interface HandDetector {
  /**
   * Detect hands in the current contents of `surface`.
   *
   * Returns a frame for **every** call, including one with no hands (FR-015): "nothing in
   * frame" is a recognition outcome the stability tracker must see, not the absence of one.
   *
   * @param timestampMs Monotonic frame time; the backend uses it for inter-frame tracking.
   */
  detect(surface: MirroredSurface, timestampMs: number): LandmarkFrame;
  /** Release backend resources. Idempotent. */
  close(): void;
}
