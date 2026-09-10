/**
 * Person segmentation, as an interface (data-model.md `PersonSegmenter`, research D7).
 *
 * Mirrors `HandDetector`'s shape exactly, for the same reason: the backend (MediaPipe Tasks
 * Vision's `ImageSegmenter`) is a choice this milestone makes, not a commitment the
 * architecture carries, and the capability-gating mechanism (`domain/runtime/capabilities.ts`)
 * — not this interface — is what makes its absence a first-class, honestly-reported state.
 */

import type { MirroredSurface } from './camera';
import type { SegmentationFrame } from '../editor/segmentation-frame';

/** Turns a surface into a person/background mask, or reports that this frame had no result. */
export interface PersonSegmenter {
  /**
   * Segment the current contents of `surface`.
   *
   * @returns `null` when this frame produced no usable result — distinct from the capability
   *   being unavailable at all, which is decided once, at session start, by whether a
   *   `PersonSegmenter` was constructed in the first place.
   */
  segment(surface: MirroredSurface, timestampMs: number): SegmentationFrame | null;
  /** Release backend resources. Idempotent. */
  close(): void;
}
