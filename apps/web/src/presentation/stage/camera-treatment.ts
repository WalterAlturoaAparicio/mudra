/**
 * Applies `CameraTreatmentSettings` to the camera image **for display only** (T063,
 * FR-048–FR-051).
 *
 * This runs strictly between the camera surface and the renderer: it reads `surface.image`
 * and writes a **new**, separate offscreen canvas — it never mutates the surface itself, so
 * the imagery `HandDetector`/`PersonSegmenter` analyse (which is handed the surface directly,
 * upstream of this file) is untouched by any adjustment an author makes here (FR-051).
 *
 * Brightness/contrast/saturation use Canvas2D's `filter` — a render-time compositing step,
 * never a request to the camera device (FR-049). Zoom/crop select a source rectangle via
 * `drawImage`'s source-rect form, again display-only.
 */

import type { CameraTreatmentSettings } from '../../domain/editor/types';

/** Whether `settings` differs from the identity transform — worth skipping work for. */
export function isIdentityTreatment(settings: CameraTreatmentSettings): boolean {
  return (
    settings.brightness === 0 &&
    settings.contrast === 0 &&
    settings.saturation === 0 &&
    settings.zoom === 1 &&
    settings.crop === null
  );
}

function filterString(settings: CameraTreatmentSettings): string {
  // Each setting is authored in [-1, 1] (or [1, 4] for zoom); mapped onto the multiplicative
  // range each CSS/Canvas2D filter function expects.
  const brightness = 1 + settings.brightness;
  const contrast = 1 + settings.contrast;
  const saturate = 1 + settings.saturation;
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
}

/** A minimal 2D context surface, narrowed the same way `Renderer2DContext` is. */
export interface TreatmentContext {
  filter: string;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** A reusable offscreen destination the treated image is drawn into. */
export interface TreatmentCanvas {
  width: number;
  height: number;
  getTreatmentContext(): TreatmentContext | null;
  /**
   * The drawable surface itself, once painted — what `applyCameraTreatment` hands back to the
   * renderer (P0.2). `Stage`'s implementation of this interface is a plain object wrapping a
   * real `<canvas>`, not a canvas itself; without this accessor, the non-identity branch below
   * had nothing honest to return and cast the *wrapper* to `CanvasImageSource` instead — a
   * value `drawImage` genuinely cannot draw, which is the exact `TypeError` this fixes.
   */
  asImageSource(): CanvasImageSource;
}

/**
 * Draw `source` into `canvas`, with `settings` applied, and return the canvas as the image
 * the renderer should composite instead of `source` directly.
 *
 * @returns `source` unchanged when `settings` is the identity transform — no offscreen pass,
 *   no copy, for the common case of an author who never touched these controls. Also `null`
 *   unchanged when `source` is `null` (no camera attached yet, or between detach/reattach) —
 *   never reaches `drawImage` with an invalid source.
 */
export function applyCameraTreatment(
  source: CanvasImageSource | null,
  settings: CameraTreatmentSettings,
  canvas: TreatmentCanvas,
  width: number,
  height: number,
): CanvasImageSource | null {
  if (source === null || isIdentityTreatment(settings)) {
    return source;
  }

  const context = canvas.getTreatmentContext();
  if (context === null) {
    return source;
  }

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.filter = filterString(settings);

  const crop = settings.crop;
  const zoom = settings.zoom;
  // Crop takes precedence when set; otherwise zoom crops symmetrically around the centre.
  const sx = crop !== null ? crop.x * width : ((1 - 1 / zoom) / 2) * width;
  const sy = crop !== null ? crop.y * height : ((1 - 1 / zoom) / 2) * height;
  const sw = crop !== null ? crop.w * width : width / zoom;
  const sh = crop !== null ? crop.h * height : height / zoom;

  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.asImageSource();
}
