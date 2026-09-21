/**
 * MediaPipe Tasks Vision `FaceLandmarker`, behind {@link FaceDetector} (Spec 011).
 *
 * **This is the only file that names a MediaPipe face symbol.** MediaPipe's types end here: what
 * leaves is a domain `FaceFrame` — numbers only — and nothing else from the result is read. In
 * particular blendshapes and the facial transformation matrix are **not requested** from the
 * model and not represented, so there is no unrequested output to leak (spec D13).
 *
 * VIDEO running mode, like the hand detector, for MediaPipe's inter-frame tracking. It is handed
 * the same mirrored surface the hand detector reads, so its coordinates are in the same mirrored
 * space; nothing is flipped here.
 *
 * The model is a repository-level shared asset (`assets/face_landmarker.task`), **absent by
 * default** and provisioned only by `npm run fetch-face-model`. Its absence is a normal state:
 * construction rejects and `probeCapabilities` reports `face_landmarks` unavailable. Nothing here
 * ever downloads a model at run time — `FACE_MODEL_URL` is a same-origin path.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { Logger } from '../../domain/config/logger';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../domain/landmarks/face';
import type { FaceFrame } from '../../domain/landmarks/face';
import type { MirroredSurface } from '../../domain/ports/camera';
import { DetectorError } from '../../domain/ports/detector';
import type { FaceDetector, FaceDetectorDiagnostics } from '../../domain/ports/face-detector';

/** Where the shared face-landmark model is served from, in dev and in build alike. */
export const FACE_MODEL_URL = '/face_landmarker.task';

/** Detector settings. Centralized rather than written at the construction site. */
export interface FaceDetectorConfig {
  /** Exactly one face is tracked (Spec 011, assumption A-1). */
  readonly maxFaces: number;
  readonly minFaceDetectionConfidence: number;
  readonly minFacePresenceConfidence: number;
  readonly minTrackingConfidence: number;
}

/** MediaPipe's documented defaults, with a single tracked face. */
export const DEFAULT_FACE_DETECTOR_CONFIG: FaceDetectorConfig = {
  maxFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/**
 * The slice of `FaceLandmarker` this adapter uses. Structural, so a test can supply a fake with
 * no MediaPipe or WASM. Only `faceLandmarks` is ever read from a result.
 */
export interface FaceLandmarkerLike {
  detectForVideo(
    image: HTMLCanvasElement,
    timestampMs: number,
  ): { readonly faceLandmarks: ReadonlyArray<ReadonlyArray<{ x: number; y: number; z: number }>> };
  close(): void;
}

/** What {@link createMediaPipeFaceDetector} needs. */
export interface MediaPipeFaceDetectorOptions {
  /** Where the WASM runtime lives. Bundled with the package, resolved at build time. */
  readonly wasmPath: string;
  readonly modelUrl?: string;
  readonly config?: FaceDetectorConfig;
  readonly logger?: Logger;
}

/** The adapter itself; built by {@link createMediaPipeFaceDetector} once the model loads. */
export class MediaPipeFaceDetector implements FaceDetector {
  private landmarker: FaceLandmarkerLike | null;
  private readonly logger: Logger;
  /** The last timestamp handed to the library, so the next one is strictly greater. */
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  /** Whether the current run of consecutive failures has already been reported. */
  private reportedThisStreak = false;
  private status: FaceDetectorDiagnostics = { outcome: 'none-yet', pointCount: null, atMs: null };

  /** @param landmarker A constructed landmarker, or a structural fake in a test. */
  constructor(landmarker: FaceLandmarkerLike, logger: Logger = new Logger()) {
    this.landmarker = landmarker;
    this.logger = logger;
  }

  detect(surface: MirroredSurface, timestampMs: number): FaceFrame | null {
    const landmarker = this.landmarker;
    if (landmarker === null) {
      return null;
    }

    // The library requires strictly increasing timestamps, but this detector can be called from
    // more than one place per moment (a live tick, Test Trigger, Play Timeline) with clocks that
    // need not agree. Clamp rather than let one call poison the instance (spec D19, FR-022a).
    const timestamp = Math.max(timestampMs, this.lastTimestampMs + 1);
    this.lastTimestampMs = timestamp;

    try {
      const result = landmarker.detectForVideo(surface.image as HTMLCanvasElement, timestamp);
      const first = result.faceLandmarks[0];
      if (first === undefined) {
        this.status = { outcome: 'no-face', pointCount: 0, atMs: timestamp };
        this.reportedThisStreak = false;
        return null; // no face this frame: normal, not a failure
      }
      if (first.length !== FACE_LANDMARK_COUNT) {
        this.status = { outcome: 'count-mismatch', pointCount: first.length, atMs: timestamp };
        this.reportFailure('The face detector returned an unexpected number of landmarks.', {
          expected: FACE_LANDMARK_COUNT,
          received: first.length,
        });
        return null;
      }
      const frame = faceFrame(
        first.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        timestamp,
        surface.width,
        surface.height,
      );
      this.status = { outcome: 'face', pointCount: first.length, atMs: timestamp };
      this.reportedThisStreak = false;
      return frame;
    } catch (error) {
      this.status = { outcome: 'error', pointCount: null, atMs: timestamp };
      // A frame that cannot be analysed is "no face"; it never ends the frame loop (FR-022).
      this.reportFailure('Face detection failed on a frame.', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  diagnostics(): FaceDetectorDiagnostics {
    return this.status;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }

  /** Warn once per consecutive run of failures, not once per frame. */
  private reportFailure(message: string, fields: Record<string, unknown>): void {
    if (!this.reportedThisStreak) {
      this.reportedThisStreak = true;
      this.logger.warn(message, fields);
    }
  }
}

/**
 * Load the model and build a face detector.
 *
 * Rejects (never throws synchronously) with a {@link DetectorError} on any failure — unsupported
 * browser, model absent, no compatible delegate — which is exactly what `probeCapabilities`
 * expects to catch and report as `face_landmarks: unavailable`. An absent model is the normal
 * default state, not a fault.
 */
export async function createMediaPipeFaceDetector(
  options: MediaPipeFaceDetectorOptions,
): Promise<FaceDetector> {
  let fileset;
  try {
    fileset = await FilesetResolver.forVisionTasks(options.wasmPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DetectorError(
      'unsupportedBrowser',
      'Face detection could not start in this browser: ' + detail,
    );
  }

  const config = options.config ?? DEFAULT_FACE_DETECTOR_CONFIG;
  try {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelUrl ?? FACE_MODEL_URL },
      runningMode: 'VIDEO',
      numFaces: config.maxFaces,
      minFaceDetectionConfidence: config.minFaceDetectionConfidence,
      minFacePresenceConfidence: config.minFacePresenceConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
      // Geometry only: nothing else is requested from the model (spec D13).
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    return new MediaPipeFaceDetector(landmarker, options.logger);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DetectorError(
      'modelUnavailable',
      'The face-landmark model could not be loaded from ' +
        (options.modelUrl ?? FACE_MODEL_URL) +
        '. ' +
        detail,
    );
  }
}
