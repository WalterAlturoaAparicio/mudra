/**
 * The renderer — **the only component in the application that draws** (FR-067, FR-070).
 *
 * It consumes the command vocabulary and knows nothing about effects, actions, poses, or the
 * runtime's state. Given the same command list it draws the same picture, which is what
 * `test/adapters/renderer.test.ts` asserts against a recording fake context, and what makes
 * an alternative renderer (WebGL, say) a drop-in rather than a rewrite (FR-068).
 *
 * Coordinates arrive in mirrored display space (research D1), so no transform is applied
 * here. That is deliberate: a renderer that re-mirrored would reintroduce exactly the
 * second representation the single-surface design exists to eliminate.
 *
 * **Region compositing** (`fillMaskedRegion`, `drawMaskedImage`, and `maskedErase`'s
 * `background` region) is done through one reusable offscreen buffer, supplied by the stage
 * exactly as the camera image and the person mask already are — the renderer still creates
 * and owns no canvas. The buffer is what makes "everything *except* the person" expressible:
 * Canvas2D has no native mask-inversion, and producing one by hand would mean reading pixels
 * back (`getImageData`), which `test/architecture/privacy.test.ts` prohibits everywhere. The
 * buffer inverts by *compositing* instead — paint, then `destination-out` the mask — which
 * reads nothing.
 */

import type {
  BlendMode,
  DrawCirclesCommand,
  DrawMaskedImageCommand,
  DrawPolylineCommand,
  FillMaskedRegionCommand,
  FillScreenCommand,
  MaskedEraseCommand,
  RenderCommand,
} from '../../domain/runtime/frame-output';

/** The 2D operations the renderer uses. Narrowed so a fake context is small to write. */
export interface Renderer2DContext {
  canvas: { width: number; height: number };
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
}

/** The subset of a 2D context the region buffer is painted with. */
export interface RegionBufferContext {
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
}

/**
 * A reusable offscreen surface region compositing paints into.
 *
 * Supplied by the stage, never created here — the same arrangement
 * `presentation/stage/camera-treatment.ts`'s `TreatmentCanvas` already uses, and for the same
 * reason: the renderer owns no canvas, so it stays constructible in a test out of a plain
 * recording object.
 */
export interface RegionBuffer {
  width: number;
  height: number;
  getBufferContext(): RegionBufferContext | null;
  /** The painted surface itself, for compositing onto the destination. */
  asImageSource(): CanvasImageSource;
}

/** Resolves an already-resolved asset URL to something drawable, or `null` when not ready. */
export type ImageProvider = (source: string) => CanvasImageSource | null;

/**
 * Map the vocabulary's small closed blend enum onto Canvas2D's own names.
 *
 * The mapping lives here rather than in the vocabulary because a vocabulary that spoke
 * `globalCompositeOperation` strings would be un-implementable by a WebGL renderer.
 */
const BLEND: Readonly<Record<BlendMode, string>> = {
  normal: 'source-over',
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
};

/** What the renderer optionally needs beyond a destination context. */
export interface Canvas2DRendererOptions {
  /** The offscreen surface region compositing uses. Without it, region commands no-op. */
  readonly regionBuffer?: RegionBuffer;
}

/** Draws render commands onto a 2D context. */
export class Canvas2DRenderer {
  private readonly context: Renderer2DContext;
  private readonly regionBuffer: RegionBuffer | null;
  /** The live camera image `drawCamera` composites, set once per frame by the stage. */
  private cameraImage: CanvasImageSource | null = null;
  /**
   * This frame's person-segmentation mask (constitution v1.7.0, research D8) — supplied
   * out-of-band exactly as `cameraImage` already is, so region commands stay small commands
   * naming intent rather than carrying pixels of their own.
   */
  private personMask: CanvasImageSource | null = null;
  private images: ImageProvider = () => null;

  /** @param context The destination. The renderer never creates or owns a canvas. */
  constructor(context: Renderer2DContext, options: Canvas2DRendererOptions = {}) {
    this.context = context;
    this.regionBuffer = options.regionBuffer ?? null;
  }

  /** Tell the renderer what `drawCamera` should draw this frame. */
  setCameraImage(image: CanvasImageSource | null): void {
    this.cameraImage = image;
  }

  /** Tell the renderer what the region commands should use this frame. `null` when unavailable. */
  setPersonMask(mask: CanvasImageSource | null): void {
    this.personMask = mask;
  }

  /**
   * Supply the lookup `drawMaskedImage` resolves its `source` URL through.
   *
   * The renderer decodes nothing itself: an image that has not finished loading resolves to
   * `null` and the command draws nothing that frame, which is the same "not ready yet"
   * behaviour `drawCamera` already has before the first camera frame.
   */
  setImageProvider(provider: ImageProvider): void {
    this.images = provider;
  }

  /** Execute a command list, in order. */
  render(commands: readonly RenderCommand[]): void {
    for (const command of commands) {
      switch (command.kind) {
        case 'clear':
          this.clear();
          break;
        case 'drawCamera':
          this.drawCamera(command.opacity);
          break;
        case 'fillScreen':
          this.fillScreen(command);
          break;
        case 'drawCircles':
          this.drawCircles(command);
          break;
        case 'drawPolyline':
          this.drawPolyline(command);
          break;
        case 'maskedErase':
          this.maskedErase(command);
          break;
        case 'fillMaskedRegion':
          this.fillMaskedRegion(command);
          break;
        case 'drawMaskedImage':
          this.drawMaskedImage(command);
          break;
      }
    }
  }

  private clear(): void {
    const { width, height } = this.context.canvas;
    this.context.clearRect(0, 0, width, height);
  }

  private drawCamera(opacity: number): void {
    const image = this.cameraImage;
    if (image === null || opacity <= 0) {
      return;
    }
    const { width, height } = this.context.canvas;
    this.context.save();
    this.context.globalAlpha = clamp01(opacity);
    this.context.globalCompositeOperation = BLEND.normal;
    this.context.drawImage(image, 0, 0, width, height);
    this.context.restore();
  }

  private fillScreen(command: FillScreenCommand): void {
    if (command.alpha <= 0) {
      return;
    }
    const { width, height } = this.context.canvas;
    this.context.save();
    this.context.globalAlpha = clamp01(command.alpha);
    this.context.globalCompositeOperation = BLEND[command.blend];
    this.context.fillStyle = command.color;
    this.context.fillRect(0, 0, width, height);
    this.context.restore();
  }

  private drawCircles(command: DrawCirclesCommand): void {
    if (command.alpha <= 0 || command.points.length === 0) {
      return;
    }
    this.context.save();
    this.context.globalCompositeOperation = BLEND.normal;
    this.context.fillStyle = command.color;
    const alphas = command.alphas;
    if (alphas === undefined) {
      this.context.globalAlpha = clamp01(command.alpha);
      // One path for the whole batch: the command carries every particle precisely so the
      // renderer can do this rather than open a path per circle.
      this.context.beginPath();
      command.points.forEach((point, index) => {
        const radius = command.radii[index] ?? command.radii[0] ?? 1;
        if (radius <= 0) {
          return;
        }
        this.context.moveTo(point.x + radius, point.y);
        this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      });
      this.context.fill();
    } else {
      // Per-point opacity cannot share one path — `globalAlpha` applies to the whole fill.
      // Still one *command*; the batching promise is about command-list length, which is what
      // a renderer would otherwise have to optimize around.
      command.points.forEach((point, index) => {
        const radius = command.radii[index] ?? command.radii[0] ?? 1;
        const alpha = clamp01(command.alpha * (alphas[index] ?? 1));
        if (radius <= 0 || alpha <= 0) {
          return;
        }
        this.context.globalAlpha = alpha;
        this.context.beginPath();
        this.context.moveTo(point.x + radius, point.y);
        this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        this.context.fill();
      });
    }
    this.context.restore();
  }

  private drawPolyline(command: DrawPolylineCommand): void {
    if (command.alpha <= 0 || command.points.length < 2 || command.width <= 0) {
      return;
    }
    this.context.save();
    this.context.globalAlpha = clamp01(command.alpha);
    this.context.globalCompositeOperation = BLEND.normal;
    this.context.strokeStyle = command.color;
    this.context.lineWidth = command.width;
    this.context.lineJoin = 'round';
    this.context.lineCap = 'round';
    this.context.beginPath();
    command.points.forEach((point, index) => {
      if (index === 0) {
        this.context.moveTo(point.x, point.y);
      } else {
        this.context.lineTo(point.x, point.y);
      }
    });
    this.context.stroke();
    this.context.restore();
  }

  /**
   * Erase within `command.region`, clipped by the current per-frame person mask — a genuine
   * per-pixel separation, never a full-frame substitute (FR-046).
   *
   * `region: 'person'` erases straight onto the destination (`destination-out` with the mask),
   * proportionally to the mask's own per-pixel confidence. `region: 'background'` needs the
   * inverse selection, which Canvas2D cannot express directly: the region buffer is painted
   * solid, the mask is `destination-out`-ed from it — leaving coverage everywhere the person
   * is *not* — and that inverted coverage is then erased from the destination.
   */
  private maskedErase(command: MaskedEraseCommand): void {
    if (command.alpha <= 0 || this.personMask === null) {
      return;
    }
    const { width, height } = this.context.canvas;
    if (command.region === 'person') {
      this.context.save();
      this.context.globalAlpha = clamp01(command.alpha);
      this.context.globalCompositeOperation = 'destination-out';
      this.context.drawImage(this.personMask, 0, 0, width, height);
      this.context.restore();
      return;
    }
    const buffer = this.paintRegion(command.region, (bufferContext) => {
      bufferContext.fillStyle = '#ffffff';
      bufferContext.fillRect(0, 0, width, height);
    });
    if (buffer === null) {
      return;
    }
    this.context.save();
    this.context.globalAlpha = clamp01(command.alpha);
    this.context.globalCompositeOperation = 'destination-out';
    this.context.drawImage(buffer, 0, 0, width, height);
    this.context.restore();
  }

  /** Fill within one segmentation region with a flat colour (item 3). */
  private fillMaskedRegion(command: FillMaskedRegionCommand): void {
    if (command.alpha <= 0) {
      return;
    }
    const { width, height } = this.context.canvas;
    const buffer = this.paintRegion(command.region, (bufferContext) => {
      bufferContext.fillStyle = command.color;
      bufferContext.fillRect(0, 0, width, height);
    });
    if (buffer === null) {
      return;
    }
    this.context.save();
    this.context.globalAlpha = clamp01(command.alpha);
    this.context.globalCompositeOperation = BLEND.normal;
    this.context.drawImage(buffer, 0, 0, width, height);
    this.context.restore();
  }

  /** Draw an image within one segmentation region (items 2 and 3). */
  private drawMaskedImage(command: DrawMaskedImageCommand): void {
    if (command.alpha <= 0) {
      return;
    }
    const image = this.images(command.source);
    if (image === null) {
      return; // not loaded yet — the same "nothing to draw" drawCamera already handles
    }
    const { width, height } = this.context.canvas;
    const buffer = this.paintRegion(command.region, (bufferContext) => {
      const rect = fitRect(image, width, height, command.fit);
      bufferContext.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    });
    if (buffer === null) {
      return;
    }
    this.context.save();
    this.context.globalAlpha = clamp01(command.alpha);
    this.context.globalCompositeOperation = BLEND.normal;
    this.context.drawImage(buffer, 0, 0, width, height);
    this.context.restore();
  }

  /**
   * Paint `draw` into the region buffer and clip it to `region` with the person mask.
   *
   * @returns The buffer, ready to composite, or `null` when there is no buffer or no mask —
   *   in which case the caller draws nothing at all, which is the honest answer: without a
   *   mask there is no person and no background, only a full frame, and filling that would be
   *   exactly the fake FR-046 forbids.
   */
  private paintRegion(
    region: 'person' | 'background',
    draw: (context: RegionBufferContext) => void,
  ): CanvasImageSource | null {
    const buffer = this.regionBuffer;
    const mask = this.personMask;
    if (buffer === null || mask === null) {
      return null;
    }
    const { width, height } = this.context.canvas;
    if (width === 0 || height === 0) {
      return null;
    }
    const bufferContext = buffer.getBufferContext();
    if (bufferContext === null) {
      return null;
    }
    buffer.width = width;
    buffer.height = height;
    bufferContext.globalAlpha = 1;
    bufferContext.globalCompositeOperation = 'source-over';
    bufferContext.clearRect(0, 0, width, height);
    draw(bufferContext);
    bufferContext.globalCompositeOperation =
      region === 'person' ? 'destination-in' : 'destination-out';
    bufferContext.drawImage(mask, 0, 0, width, height);
    bufferContext.globalCompositeOperation = 'source-over';
    return buffer.asImageSource();
  }
}

/** Where an image lands inside `width`×`height` under one of the three fit modes. */
export function fitRect(
  image: CanvasImageSource,
  width: number,
  height: number,
  fit: DrawMaskedImageCommand['fit'],
): { x: number; y: number; width: number; height: number } {
  if (fit === 'stretch') {
    return { x: 0, y: 0, width, height };
  }
  const source = imageSize(image);
  if (source === null || source.width === 0 || source.height === 0) {
    return { x: 0, y: 0, width, height };
  }
  const scale =
    fit === 'cover'
      ? Math.max(width / source.width, height / source.height)
      : Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  return {
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function imageSize(image: CanvasImageSource): { width: number; height: number } | null {
  // An `<img>` reports its *layout* size in `width`/`height`, which is 0 for an element that
  // was never inserted into a document — the intrinsic size is what a fit calculation means.
  const candidate = image as {
    width?: unknown;
    height?: unknown;
    naturalWidth?: unknown;
    naturalHeight?: unknown;
  };
  const width =
    typeof candidate.naturalWidth === 'number' && candidate.naturalWidth > 0
      ? candidate.naturalWidth
      : candidate.width;
  const height =
    typeof candidate.naturalHeight === 'number' && candidate.naturalHeight > 0
      ? candidate.naturalHeight
      : candidate.height;
  if (typeof width !== 'number' || typeof height !== 'number') {
    return null;
  }
  return { width, height };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
