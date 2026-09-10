/**
 * The `getUserMedia` camera adapter.
 *
 * Its real job is not opening the camera — that is six lines — but **telling four failure
 * modes apart** (FR-003). "Could not start the camera" is useless to a person; "another
 * app is using your camera" tells them what to do. The `DOMException` names below are the
 * only way to distinguish them, so the mapping lives here, once.
 *
 * Frame delivery uses `requestVideoFrameCallback` where available, falling back to
 * `requestAnimationFrame` (research D3). The first fires once per *decoded camera frame*,
 * so the pipeline processes each frame exactly once: no duplicate detections on a 144 Hz
 * display, no missed frames on a slow one.
 */

import type {
  CameraFailureReason,
  CameraSession,
  CameraSource,
  MirroredSurface,
} from '../../domain/ports/camera';
import { CameraError } from '../../domain/ports/camera';
import { CanvasMirroredSurface } from './mirrored-surface';

/**
 * A video element that *may* expose `requestVideoFrameCallback`.
 *
 * Written as an intersection rather than an `extends` clause, because the DOM lib declares
 * the method as required and an interface cannot widen an inherited member back to optional. It is genuinely optional at runtime — Firefox has been inconsistent — which is
 * why the fallback below exists at all.
 */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
};

/** Constraints for the camera we ask for. Centralized so nothing is hardcoded downstream. */
export interface CameraRequest {
  readonly width: number;
  readonly height: number;
  readonly facingMode: 'user' | 'environment';
}

/** The default request: a front-facing camera at a size the detector handles comfortably. */
export const DEFAULT_CAMERA_REQUEST: CameraRequest = {
  width: 1280,
  height: 720,
  facingMode: 'user',
};

/** The `navigator.mediaDevices` surface this adapter uses, injected for testing. */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/** What the adapter needs from its environment. */
export interface GetUserMediaCameraOptions {
  /** Where to get a stream. Defaults to `navigator.mediaDevices`. */
  readonly mediaDevices?: MediaDevicesLike | undefined;
  /** Builds the hidden video element. Injected so a fake can stand in. */
  readonly createVideo?: () => HTMLVideoElement;
  /** Builds the mirrored canvas. Injected for the same reason. */
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly request?: CameraRequest;
}

/**
 * Map a `getUserMedia` rejection to a reason a person can act on.
 *
 * Exported because the mapping — not the plumbing — is what the adapter tests assert.
 */
export function cameraFailureReason(error: unknown): CameraFailureReason {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        // The browser reports a refusal and a dismissal identically in most engines; the
        // message is the only hint, and it is not stable. Treated as a refusal, and the
        // shell offers to ask again — which is the right response to either.
        return 'permissionDenied';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'noCamera';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'deviceInUse';
      case 'AbortError':
        return 'permissionDismissed';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'noCamera';
      default:
        return 'unknown';
    }
  }
  return 'unknown';
}

/** A short, non-technical explanation for each reason (FR-003, SC-012). */
export const CAMERA_MESSAGES: Readonly<Record<CameraFailureReason, string>> = {
  noCamera: 'No camera was found on this device.',
  permissionDenied:
    'Camera access was blocked. Allow it in your browser’s address bar, then try again.',
  permissionDismissed: 'The camera request was dismissed. Try again when you are ready.',
  deviceInUse: 'Another application is using the camera. Close it and try again.',
  unsupported: 'This browser cannot open a camera here. Try a current Chrome, Firefox, or Safari.',
  unknown: 'The camera could not be started.',
};

class GetUserMediaSession implements CameraSession {
  readonly surface: MirroredSurface;
  private readonly stream: MediaStream;
  private readonly video: VideoWithFrameCallback;
  private readonly mirrored: CanvasMirroredSurface;
  private closed = false;

  constructor(stream: MediaStream, video: VideoWithFrameCallback, canvas: HTMLCanvasElement) {
    this.stream = stream;
    this.video = video;
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) {
      throw new CameraError('unsupported', 'This browser did not provide a 2D canvas context.');
    }
    this.mirrored = new CanvasMirroredSurface({ canvas, context, source: video });
    this.surface = this.mirrored;
  }

  onFrame(callback: (timestampMs: number) => void): () => void {
    let stopped = false;

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      const step = (now: number): void => {
        if (stopped || this.closed) {
          return;
        }
        callback(now);
        this.video.requestVideoFrameCallback?.(step);
      };
      this.video.requestVideoFrameCallback(step);
      return () => {
        stopped = true;
      };
    }

    // Firefox has been inconsistent about requestVideoFrameCallback; the fallback keeps it
    // working, at the cost of occasionally processing the same decoded frame twice.
    const step = (now: number): void => {
      if (stopped || this.closed) {
        return;
      }
      callback(now);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      stopped = true;
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
    this.video.pause();
    this.video.srcObject = null;
  }
}

/** Opens the default camera through `getUserMedia`. */
export class GetUserMediaCamera implements CameraSource {
  private readonly options: GetUserMediaCameraOptions;

  /** @param options Injection points; all default to the real browser APIs. */
  constructor(options: GetUserMediaCameraOptions = {}) {
    this.options = options;
  }

  /** Acquire the camera, reporting each distinguishable failure separately (FR-003). */
  async open(): Promise<CameraSession> {
    const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices;
    if (devices === undefined) {
      throw new CameraError('unsupported', CAMERA_MESSAGES.unsupported);
    }

    const request = this.options.request ?? DEFAULT_CAMERA_REQUEST;
    let stream: MediaStream;
    try {
      stream = await devices.getUserMedia({
        video: {
          width: { ideal: request.width },
          height: { ideal: request.height },
          facingMode: request.facingMode,
        },
        audio: false,
      });
    } catch (error) {
      const reason = cameraFailureReason(error);
      throw new CameraError(reason, CAMERA_MESSAGES[reason]);
    }

    const video = (this.options.createVideo?.() ??
      document.createElement('video')) as VideoWithFrameCallback;
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    try {
      await video.play();
    } catch (error) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new CameraError('unknown', 'The camera stream could not start: ' + detail);
    }

    const canvas = this.options.createCanvas?.() ?? document.createElement('canvas');
    return new GetUserMediaSession(stream, video, canvas);
  }
}
