/**
 * MediaPipe Tasks Vision `ImageSegmenter`, behind {@link PersonSegmenter} (T052, research D7).
 *
 * The **same package** (`@mediapipe/tasks-vision`) `mediapipe-detector.ts` already uses for
 * hand landmarks — no second ML runtime is introduced (FR-040). VIDEO running mode, for the
 * same inter-frame-tracking reason the hand detector uses it.
 *
 * `segment()` must be **synchronous** to match `HandDetector.detect()`'s shape (both are
 * called once per tick, in `EditorRuntimeController.captureFrame()`), but converting a raw
 * confidence mask into something the renderer can `drawImage()` is normally an async step
 * (`createImageBitmap`). This adapter avoids that entirely: it writes the mask into a reused
 * offscreen canvas via `putImageData` — synchronous, and not part of the imagery-*readback*
 * surface `test/architecture/privacy.test.ts` prohibits (that scan is about pixels *leaving*
 * a canvas via `getImageData`/`toDataURL`/etc.; `putImageData` only ever writes *into* one).
 */

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

import type { SegmentationFrame } from '../../domain/editor/segmentation-frame';
import type { MirroredSurface } from '../../domain/ports/camera';
import type { PersonSegmenter } from '../../domain/ports/segmenter';

/** Where the shared selfie-segmentation model is served from, in dev and in build alike. */
export const SEGMENTER_MODEL_URL = '/selfie_segmenter.tflite';

/** What {@link createMediaPipePersonSegmenter} needs. */
export interface MediaPipeSegmenterOptions {
  /** Where the WASM runtime lives — the same fileset the hand detector already loads. */
  readonly wasmPath: string;
  readonly modelUrl?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

class MediaPipePersonSegmenter implements PersonSegmenter {
  private segmenter: ImageSegmenter | null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  constructor(segmenter: ImageSegmenter) {
    this.segmenter = segmenter;
  }

  segment(surface: MirroredSurface, timestampMs: number): SegmentationFrame | null {
    const segmenter = this.segmenter;
    if (segmenter === null) {
      return null;
    }

    const result = segmenter.segmentForVideo(surface.image as HTMLCanvasElement, timestampMs);
    const mask = result.confidenceMasks?.[0];
    if (mask === undefined) {
      result.close();
      return null;
    }

    const { width, height } = mask;
    const data = mask.getAsFloat32Array();
    mask.close();

    const canvas = this.reuseCanvas(width, height);
    const context = this.context;
    if (context === null) {
      return null;
    }
    const imageData = context.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const alpha = Math.round(clamp01(data[i] ?? 0) * 255);
      imageData.data[i * 4 + 3] = alpha;
      // RGB channels are irrelevant — only alpha is read as the mask — but must be set so
      // the canvas is well-formed.
      imageData.data[i * 4] = 255;
      imageData.data[i * 4 + 1] = 255;
      imageData.data[i * 4 + 2] = 255;
    }
    context.putImageData(imageData, 0, 0);

    return { mask: canvas, width, height };
  }

  private reuseCanvas(width: number, height: number): HTMLCanvasElement {
    if (this.canvas === null || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.context = this.canvas.getContext('2d');
    }
    return this.canvas;
  }

  close(): void {
    this.segmenter?.close();
    this.segmenter = null;
    this.canvas = null;
    this.context = null;
  }
}

/**
 * Construct a `PersonSegmenter` backed by MediaPipe's `ImageSegmenter`.
 *
 * Rejects (never throws synchronously) on any failure — unsupported browser, model fetch
 * failure, no compatible delegate — which is exactly the shape `probeCapabilities()` expects
 * to catch and report as `person_segmentation: unavailable` (FR-041, FR-042).
 */
export async function createMediaPipePersonSegmenter(
  options: MediaPipeSegmenterOptions,
): Promise<PersonSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(options.wasmPath);
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: options.modelUrl ?? SEGMENTER_MODEL_URL },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  return new MediaPipePersonSegmenter(segmenter);
}
