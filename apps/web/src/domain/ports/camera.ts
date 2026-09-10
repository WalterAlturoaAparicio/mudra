/**
 * The camera, as an interface (constitution Principle I).
 *
 * The domain never learns that a camera is a `MediaStream` behind `getUserMedia`. What it
 * needs is narrower and more honest: something that can be acquired, that exposes **one
 * mirrored surface**, and that can be closed exactly once.
 *
 * The failure cases are part of the type rather than an afterthought, because "we could
 * not open a camera" is four genuinely different situations to a person (FR-003) and a
 * single boolean would flatten them into an unhelpful apology.
 */

/** Why a camera could not be opened. */
export type CameraFailureReason =
  /** No camera device exists on this machine. */
  | 'noCamera'
  /** The person actively refused, or a policy refuses on their behalf. */
  | 'permissionDenied'
  /** The prompt was dismissed without an answer — not the same as a refusal. */
  | 'permissionDismissed'
  /** A camera exists but another application holds it. */
  | 'deviceInUse'
  /** The browser cannot do this at all (insecure context, unsupported API). */
  | 'unsupported'
  /** Something else went wrong; `message` carries what is known. */
  | 'unknown';

/** A camera failure, in a form the shell can turn into plain language. */
export class CameraError extends Error {
  readonly reason: CameraFailureReason;

  /** @param reason Which of the distinguishable situations this is (FR-003). */
  constructor(reason: CameraFailureReason, message: string) {
    super(message);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

/**
 * The single surface everything downstream sees.
 *
 * It is mirrored exactly once, and it is **simultaneously** what the detector analyses and
 * what the user is shown (research D1). Presentation and recognition cannot disagree about
 * mirroring because they are literally the same pixels — which is the structural answer to
 * FR-013, rather than a rule someone has to remember.
 */
export interface MirroredSurface {
  /** Width in device pixels. */
  readonly width: number;
  /** Height in device pixels. */
  readonly height: number;
  /**
   * Draw the newest camera frame into the surface, mirrored.
   *
   * @returns `true` when a frame was drawn; `false` when the source had nothing new.
   */
  update(): boolean;
  /** The drawable/analysable image itself. Typed loosely so the domain stays DOM-free. */
  readonly image: unknown;
}

/** An open camera. Closing it is terminal. */
export interface CameraSession {
  /** The one mirrored surface (FR-009, FR-013). */
  readonly surface: MirroredSurface;
  /**
   * Register a callback to run once per delivered camera frame.
   *
   * @returns A function that stops the callbacks.
   */
  onFrame(callback: (timestampMs: number) => void): () => void;
  /**
   * Release the camera. Idempotent, and terminal: a closed session is never reopened.
   *
   * Called when the experience stops and when the page is left (FR-004). The camera light
   * going out is the only signal a visitor has that it really did stop.
   */
  close(): void;
}

/** Opens cameras. */
export interface CameraSource {
  /**
   * Acquire the camera.
   *
   * @throws CameraError with a specific {@link CameraFailureReason} on every failure path.
   */
  open(): Promise<CameraSession>;
}
