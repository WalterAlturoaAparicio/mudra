/**
 * The stage: one visible canvas, composited once per frame.
 *
 * It owns the display surface and the render order — camera underneath, effects over the
 * top, debug overlay over everything — and delegates every actual drawing call to the
 * renderer.
 *
 * **Resize handling matters more than it looks** (FR-011). The recognition surface is the
 * camera's natural resolution; the display canvas is whatever size the window allows. If
 * the two drifted, an effect anchored to a fingertip would drift off the finger. So the
 * stage keeps the display canvas at the camera's aspect ratio and scales the whole
 * composite uniformly, which means anchors stay aligned by construction rather than by
 * per-anchor correction.
 */

import type { CameraTreatmentSettings } from '../../domain/editor/types';
import type { SegmentationFrame } from '../../domain/editor/segmentation-frame';
import type { MirroredSurface } from '../../domain/ports/camera';
import type { RenderCommand } from '../../domain/runtime/frame-output';
import { applyCameraTreatment } from './camera-treatment';
import type { TreatmentCanvas, TreatmentContext } from './camera-treatment';
import { Canvas2DRenderer } from '../renderer/canvas2d-renderer';
import type {
  ImageProvider,
  RegionBuffer,
  RegionBufferContext,
  Renderer2DContext,
} from '../renderer/canvas2d-renderer';
import { ImageCache } from '../renderer/image-cache';

/** What the stage draws into. */
export interface StageOptions {
  readonly canvas: HTMLCanvasElement;
  /** Device pixel ratio to render at. Clamped, because 3× on a 4K panel is wasted work. */
  readonly maxDevicePixelRatio?: number;
  /**
   * Where `drawMaskedImage` gets its decoded images (items 2 and 3). Defaults to a
   * `ImageCache` this stage owns, which loads on demand from the URLs commands name.
   */
  readonly images?: ImageProvider;
}

/** Composites the camera and the runtime's commands onto one visible canvas. */
export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: Renderer2DContext;
  private readonly renderer: Canvas2DRenderer;
  private readonly maxDevicePixelRatio: number;
  /** Reused across frames for camera-treatment's offscreen pass (T063) — never re-created. */
  private readonly treatmentCanvas: TreatmentCanvas;
  /** Reused across frames for region compositing (items 2 and 3) — never re-created. */
  private readonly regionBuffer: RegionBuffer;
  /** Owned only when the caller supplied no provider of its own. */
  private readonly ownImageCache: ImageCache | null;

  /** @throws Error when the browser refuses a 2D context. */
  constructor(options: StageOptions) {
    this.canvas = options.canvas;
    const context = options.canvas.getContext('2d');
    if (context === null) {
      throw new Error('This browser did not provide a 2D canvas context for the stage.');
    }
    this.context = context as unknown as Renderer2DContext;
    this.maxDevicePixelRatio = options.maxDevicePixelRatio ?? 2;

    const offscreen = document.createElement('canvas');
    this.treatmentCanvas = {
      get width() {
        return offscreen.width;
      },
      set width(value: number) {
        offscreen.width = value;
      },
      get height() {
        return offscreen.height;
      },
      set height(value: number) {
        offscreen.height = value;
      },
      getTreatmentContext: () => offscreen.getContext('2d') as TreatmentContext | null,
      asImageSource: () => offscreen,
    };

    // A second offscreen surface, separate from the treatment one: the two are live at the
    // same moment within a single frame (a treated camera image beneath a masked region fill),
    // so sharing one canvas between them would have each overwrite the other's contents.
    const regionCanvas = document.createElement('canvas');
    this.regionBuffer = {
      get width() {
        return regionCanvas.width;
      },
      set width(value: number) {
        regionCanvas.width = value;
      },
      get height() {
        return regionCanvas.height;
      },
      set height(value: number) {
        regionCanvas.height = value;
      },
      getBufferContext: () => regionCanvas.getContext('2d') as RegionBufferContext | null,
      asImageSource: () => regionCanvas,
    };

    this.renderer = new Canvas2DRenderer(this.context, { regionBuffer: this.regionBuffer });
    this.ownImageCache = options.images === undefined ? new ImageCache({ document }) : null;
    this.renderer.setImageProvider(options.images ?? this.ownImageCache!.provider);
  }

  /** The stage's own image cache, when it built one — for the diagnostics panel. */
  get imageCache(): ImageCache | null {
    return this.ownImageCache;
  }

  /** Width of the drawing surface in device pixels — the space commands are in. */
  get width(): number {
    return this.canvas.width;
  }

  /** Height of the drawing surface in device pixels. */
  get height(): number {
    return this.canvas.height;
  }

  /**
   * Match the drawing surface to the camera's resolution.
   *
   * Drawing at exactly the recognition resolution is what keeps anchors aligned: a
   * landmark's normalized `x` times this width is the same pixel the detector saw.
   */
  syncTo(surface: MirroredSurface): void {
    if (surface.width === 0 || surface.height === 0) {
      return;
    }
    const ratio = Math.min(this.maxDevicePixelRatio, globalThis.devicePixelRatio || 1);
    const width = Math.round(surface.width * Math.min(1, ratio));
    const height = Math.round(surface.height * Math.min(1, ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Draw one frame.
   *
   * @param surface The mirrored camera surface — the same object the detector analysed.
   * @param commands Effect output, drawn over the camera.
   * @param overlay Debug output, drawn over everything. Empty by default.
   * @param segmentation This frame's person mask (constitution v1.7.0), or `null`/absent
   *   when the capability is unavailable — `maskedErase` commands then no-op harmlessly.
   * @param cameraTreatment Render-time visual adjustment of the camera feed (FR-048–FR-051).
   *   Applied to a separate offscreen copy — `surface.image` itself, which detection already
   *   read this same frame, is never touched.
   */
  present(
    surface: MirroredSurface,
    commands: readonly RenderCommand[],
    overlay: readonly RenderCommand[] = [],
    segmentation: SegmentationFrame | null = null,
    cameraTreatment?: CameraTreatmentSettings,
  ): void {
    this.syncTo(surface);
    // `surface.image` is `null` before a camera has delivered its first frame, and while no
    // camera is attached at all (`EditorRuntimeController`'s placeholder surface) — read it as
    // such rather than force-casting, so a non-identity treatment can never reach `drawImage`
    // with an invalid source.
    const rawImage = surface.image as CanvasImageSource | null;
    const cameraImage =
      cameraTreatment === undefined
        ? rawImage
        : applyCameraTreatment(
            rawImage,
            cameraTreatment,
            this.treatmentCanvas,
            this.width,
            this.height,
          );
    this.renderer.setCameraImage(cameraImage);
    this.renderer.setPersonMask((segmentation?.mask as CanvasImageSource | undefined) ?? null);
    this.renderer.render([
      { kind: 'clear' },
      { kind: 'drawCamera', opacity: 1 },
      ...commands,
      ...overlay,
    ]);
  }

  /** The renderer, for tests and for the debug overlay's own drawing. */
  get commandRenderer(): Canvas2DRenderer {
    return this.renderer;
  }
}
