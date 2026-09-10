/**
 * One frame of person-segmentation output (data-model.md `SegmentationFrame`, research D8).
 *
 * `mask` is an opaque handle, typed loosely exactly as `MirroredSurface.image` already is
 * (`domain/ports/camera.ts`) — the domain never learns it is an `ImageBitmap`. The runtime
 * never reads its pixels; it only ever passes the handle through to a render command, which
 * the renderer (the one place a concrete DOM/canvas type is allowed) resolves.
 */

/** A per-pixel person/background mask for the current frame. */
export interface SegmentationFrame {
  /** The mask image itself. Typed loosely so the domain stays DOM-free. */
  readonly mask: unknown;
  readonly width: number;
  readonly height: number;
}
