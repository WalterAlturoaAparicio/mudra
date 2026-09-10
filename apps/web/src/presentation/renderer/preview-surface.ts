/**
 * A small canvas an editor panel can render **render commands** into (item 5).
 *
 * The point is what it is *not*: a second way of drawing. A preview panel builds the exact
 * commands the shipped action produces and hands them here, and this runs them through the
 * same `Canvas2DRenderer` the stage uses. If the preview and the live effect ever disagreed,
 * it would have to be because the *commands* differed — which is a real, findable bug — and
 * never because a preview drew circles its own way.
 *
 * It also keeps `presentation/editor/**` free of drawing calls, which
 * `test/architecture/layering.test.ts` requires: the panel owns the configuration, this owns
 * the canvas.
 */

import { Canvas2DRenderer } from './canvas2d-renderer';
import type { Renderer2DContext } from './canvas2d-renderer';
import type { RenderCommand } from '../../domain/runtime/frame-output';

/** What the surface needs to exist. */
export interface PreviewSurfaceOptions {
  readonly document: Document;
  /** Backing-store size in device pixels. */
  readonly width: number;
  readonly height: number;
  readonly className?: string;
}

/** A canvas that executes render commands. */
export class PreviewSurface {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: Canvas2DRenderer | null;

  constructor(options: PreviewSurfaceOptions) {
    this.canvas = options.document.createElement('canvas');
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    if (options.className !== undefined) {
      this.canvas.className = options.className;
    }
    const context = this.canvas.getContext('2d');
    // A refused context is not an error worth taking a panel down for — the preview simply
    // shows nothing, exactly as the stage's own camera image shows nothing before it arrives.
    this.renderer =
      context === null ? null : new Canvas2DRenderer(context as unknown as Renderer2DContext);
  }

  /** Width of the drawing surface in device pixels — the space commands are in. */
  get width(): number {
    return this.canvas.width;
  }

  /** Height of the drawing surface in device pixels. */
  get height(): number {
    return this.canvas.height;
  }

  /** Clear and execute `commands`. */
  render(commands: readonly RenderCommand[]): void {
    this.renderer?.render([{ kind: 'clear' }, ...commands]);
  }
}
