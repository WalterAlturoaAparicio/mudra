/**
 * MediaPipe Tasks Vision `HandLandmarker`, behind {@link HandDetector}.
 *
 * VIDEO running mode, not IMAGE (research D2): VIDEO enables MediaPipe's inter-frame
 * tracking, which is both faster and more temporally stable — and stability is exactly
 * what the one-second hold gate depends on. IMAGE mode would produce jitter the gate would
 * then have to absorb.
 *
 * The model is the **identical artifact** Engine and Capture already run
 * (`assets/hand_landmarker.task`), which is the precondition for the browser's landmarks
 * meaning the same thing as the recorded dataset. It is referenced from the repository
 * asset, never copied into this application (FR-101).
 *
 * Handedness needs no adjustment: MediaPipe assumes a mirrored selfie image, and it is
 * given exactly that (research D1), so the label it reports already names the user's
 * physical hand.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

import type { LandmarkFrame } from '../../domain/landmarks/types';
import { handLandmarks, handObservation, landmarkFrame } from '../../domain/landmarks/types';
import type { Handedness, HandObservation } from '../../domain/landmarks/types';
import type { MirroredSurface } from '../../domain/ports/camera';
import type { HandDetector } from '../../domain/ports/detector';
import { DetectorError } from '../../domain/ports/detector';

/** Where the shared hand-landmark model is served from, in dev and in build alike. */
export const MODEL_URL = '/hand_landmarker.task';

/** Detector settings. Centralized rather than written at the construction site. */
export interface DetectorConfig {
  readonly maxHands: number;
  readonly minHandDetectionConfidence: number;
  readonly minHandPresenceConfidence: number;
  readonly minTrackingConfidence: number;
}

/** Defaults matching Engine's `DetectionConfig`, so both see hands on the same terms. */
export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  maxHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/** What {@link createMediaPipeDetector} needs. */
export interface MediaPipeDetectorOptions {
  /** Where the WASM runtime lives. Bundled with the package, resolved at build time. */
  readonly wasmPath: string;
  readonly modelUrl?: string;
  readonly config?: DetectorConfig;
}

function toHandedness(label: string | undefined): Handedness {
  const normalized = (label ?? '').trim().toLowerCase();
  if (normalized === 'left' || normalized === 'right') {
    return normalized;
  }
  return 'unknown';
}

/** The adapter itself; constructed by {@link createMediaPipeDetector} once the model loads. */
class MediaPipeHandDetector implements HandDetector {
  private landmarker: HandLandmarker | null;

  constructor(landmarker: HandLandmarker) {
    this.landmarker = landmarker;
  }

  detect(surface: MirroredSurface, timestampMs: number): LandmarkFrame {
    const landmarker = this.landmarker;
    if (landmarker === null) {
      // A closed detector still answers, with an empty frame. Returning nothing would make
      // a shutdown race look like a recognition failure to everything downstream.
      return landmarkFrame([], timestampMs, surface.width, surface.height);
    }

    // The surface is typed as `unknown` in the port so the domain never learns about the
    // DOM; this adapter is the one place that knows it is really a canvas.
    const result: HandLandmarkerResult = landmarker.detectForVideo(
      surface.image as HTMLCanvasElement,
      timestampMs,
    );

    const hands: HandObservation[] = [];
    result.landmarks.forEach((points, index) => {
      if (points.length !== 21) {
        return;
      }
      const category = result.handedness[index]?.[0];
      hands.push(
        handObservation(
          toHandedness(category?.categoryName),
          clamp01(category?.score ?? 0),
          handLandmarks(points.map((p) => ({ x: p.x, y: p.y, z: p.z }))),
        ),
      );
    });

    // Emitted for every processed frame, zero-hand frames included (FR-015).
    return landmarkFrame(hands, timestampMs, surface.width, surface.height);
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Load the model and build a detector.
 *
 * Every failure is reported in plain language with a reason the shell can act on (FR-017),
 * because a blank screen with a console error is not a report.
 */
export async function createMediaPipeDetector(
  options: MediaPipeDetectorOptions,
): Promise<HandDetector> {
  let fileset;
  try {
    fileset = await FilesetResolver.forVisionTasks(options.wasmPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DetectorError(
      'unsupportedBrowser',
      'Hand detection could not start in this browser: ' + detail,
    );
  }

  const config = options.config ?? DEFAULT_DETECTOR_CONFIG;
  try {
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelUrl ?? MODEL_URL },
      runningMode: 'VIDEO',
      numHands: config.maxHands,
      minHandDetectionConfidence: config.minHandDetectionConfidence,
      minHandPresenceConfidence: config.minHandPresenceConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
    });
    return new MediaPipeHandDetector(landmarker);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DetectorError(
      'modelUnavailable',
      'The hand-detection model could not be loaded from ' +
        (options.modelUrl ?? MODEL_URL) +
        '. ' +
        detail,
    );
  }
}
