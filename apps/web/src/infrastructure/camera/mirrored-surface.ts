/**
 * The single mirrored surface (research D1, FR-009–FR-013).
 *
 * One canvas. The camera frame is drawn into it with a horizontal flip, **once**, and that
 * canvas is then both the detector's input and the image the user sees. Landmarks come
 * back already in the space the user is looking at, so no coordinate is ever flipped again
 * and no handedness label is ever swapped.
 *
 * This is the structural answer to the milestone's highest-risk requirement. Every
 * alternative keeps two representations that have to be kept in agreement by hand, and a
 * mirror bug produces no exception and no error — only worse matches, invisible in
 * one-handed testing. Here, disagreement is unrepresentable: presentation and recognition
 * are the same pixels.
 *
 * The cost is one canvas draw per frame, which the compositor was going to do anyway to
 * show the video.
 */

import type { MirroredSurface } from '../../domain/ports/camera';

/** A source of frames to mirror — the video element, in production. */
export interface FrameSource {
  readonly videoWidth: number;
  readonly videoHeight: number;
}

/** The 2D drawing operations this surface needs. Narrowed so tests can fake it. */
export interface MirrorContext {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
}

/** A canvas this surface owns and draws into. */
export interface MirrorCanvas {
  width: number;
  height: number;
}

/** Everything {@link CanvasMirroredSurface} needs, injected. */
export interface MirroredSurfaceOptions {
  readonly canvas: MirrorCanvas;
  readonly context: MirrorContext;
  readonly source: FrameSource & CanvasImageSource;
}

/**
 * A canvas that holds the mirrored camera image.
 *
 * Resizes itself to the source's natural resolution, so the detector always sees full
 * camera detail regardless of how large the element is displayed. Display size is CSS's
 * problem; this is the recognition surface.
 */
export class CanvasMirroredSurface implements MirroredSurface {
  private readonly canvas: MirrorCanvas;
  private readonly context: MirrorContext;
  private readonly source: FrameSource & CanvasImageSource;

  /** Store the collaborators; nothing is drawn until {@link update}. */
  constructor(options: MirroredSurfaceOptions) {
    this.canvas = options.canvas;
    this.context = options.context;
    this.source = options.source;
  }

  /** Width of the recognition surface, in device pixels. */
  get width(): number {
    return this.canvas.width;
  }

  /** Height of the recognition surface, in device pixels. */
  get height(): number {
    return this.canvas.height;
  }

  /** The canvas itself — what MediaPipe analyses and what the stage composites. */
  get image(): unknown {
    return this.canvas;
  }

  /**
   * Draw the newest camera frame, mirrored.
   *
   * The mirror is a `setTransform(-1, 0, 0, 1, width, 0)`: negate x and translate by the
   * full width, so column 0 of the source lands on the last column of the canvas. Written
   * as an explicit transform rather than a negative-width `drawImage`, because a negative
   * width is a trick and this is the one operation in the application that must be
   * obvious.
   */
  update(): boolean {
    const sourceWidth = this.source.videoWidth;
    const sourceHeight = this.source.videoHeight;
    if (sourceWidth === 0 || sourceHeight === 0) {
      return false;
    }

    if (this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
      this.canvas.width = sourceWidth;
      this.canvas.height = sourceHeight;
    }

    this.context.save();
    this.context.setTransform(-1, 0, 0, 1, sourceWidth, 0);
    this.context.clearRect(0, 0, sourceWidth, sourceHeight);
    this.context.drawImage(this.source, 0, 0, sourceWidth, sourceHeight);
    this.context.restore();
    return true;
  }
}

/**
 * Mirror a normalized x coordinate.
 *
 * Exported for **one** purpose: the mirroring test feeds a known-convention input through
 * it and asserts known output (FR-012). Nothing in the pipeline calls it — a second place
 * that flipped coordinates would be exactly the duplication research D1 rejected.
 */
export function mirrorNormalizedX(x: number): number {
  return 1 - x;
}
