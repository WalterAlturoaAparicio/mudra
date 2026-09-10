/**
 * One frame of the capture pipeline, in order, once:
 * **camera → detector → normalize → validate → sample** (FR-022).
 *
 * Compare this with `session.ts`, which is the same shape for the *experience*. What is missing
 * here is the point: there is no `classify`, no `PoseEventEmitter`, no `EffectRuntime`, and no
 * matcher. Capture Mode collects landmark samples; it is not a second recognition system, and it
 * cannot become one by accident because none of those collaborators is injected (FR-022, FR-023,
 * FR-025).
 *
 * It reuses the application's existing `normalize()` rather than defining a second normalization
 * (FR-024), and the existing `FrameRateMeter` rather than a second metrics system (FR-068).
 *
 * Recording is **always** operator-initiated: `beginTake()` is the only way a sample is ever
 * written, and a controller that is merely running writes nothing at all (FR-011).
 */

import { engineTimestamp, secondsBetween } from '../domain/capture/engine-timestamp';
import { captureHand } from '../domain/capture/types';
import type { CaptureHand, CaptureSample, CaptureSession } from '../domain/capture/types';
import type { RejectionReason } from '../domain/capture/validation';
import { validateFrame } from '../domain/capture/validation';
import type { CaptureConfig } from '../domain/config/capture-config';
import { HAND_LANDMARK_COUNT } from '../domain/landmarks/topology';
import type { LandmarkFrame } from '../domain/landmarks/types';
import { handLandmarks } from '../domain/landmarks/types';
import { normalize } from '../domain/normalization/normalize';
import type { CameraSession, CameraSource } from '../domain/ports/camera';
import type { CaptureRepository } from '../domain/ports/capture-repository';
import type { CaptureTimeSource } from '../domain/ports/clock';
import type { HandDetector } from '../domain/ports/detector';
import type { RenderCommand } from '../domain/runtime/frame-output';
import type { Stage } from '../presentation/stage/stage';
import { FrameRateMeter } from './metrics';

/** What the capture surface can see about the running controller. */
export interface CaptureSnapshot {
  /** Hands currently in frame — the operator's live feedback. */
  readonly handCount: number;
  /** Whether a take is counting down or bursting right now. */
  readonly takeState: 'idle' | 'countdown' | 'recording';
  /** Whole seconds still to wait, when counting down. */
  readonly countdownRemaining: number;
  /** Samples accepted in this take so far, and how many it will record. */
  readonly burstProgress: { readonly recorded: number; readonly total: number };
  /** Accepted samples in the session (FR-020). */
  readonly sampleCount: number;
  /** Frames this session rejected. */
  readonly discardedCount: number;
  /** Rolling frame rate, from the existing meter (FR-068, FR-069). */
  readonly fps: number;
  /** The most recent rejection, cleared when the next take succeeds. */
  readonly lastRejection: RejectionReason | null;
}

/** Draws technical information over the frame — the landmark overlay, reused as-is. */
export type CaptureOverlay = (frame: LandmarkFrame) => readonly RenderCommand[];

/** Everything a capture controller is built from. Injected; nothing imported as a singleton. */
export interface CaptureControllerOptions {
  readonly camera: CameraSource;
  readonly detector: HandDetector;
  readonly stage: Stage;
  readonly repository: CaptureRepository;
  readonly config: CaptureConfig;
  readonly time: CaptureTimeSource;
  /** Landmark overlay commands. The controller never builds render commands itself. */
  readonly overlay?: CaptureOverlay;
  /** Monotonic time for frame pacing. Injected so takes are deterministic in tests. */
  readonly nowMs?: () => number;
  /** Called after each frame, so the surface updates without polling. */
  readonly onFrame?: (snapshot: CaptureSnapshot) => void;
  /** Called when a take finishes or is rejected, so the surface can report it. */
  readonly onTakeFinished?: (accepted: number, rejection: RejectionReason | null) => void;
  /** Called when persisting a sample fails, so nothing fails silently (FR-071). */
  readonly onError?: (error: unknown) => void;
}

/** Internal state of an in-progress take. */
interface Take {
  readonly startedAtMs: number;
  readonly countdownStartedAt: string;
  readonly countdownSeconds: number;
  readonly countdownEnabled: boolean;
  recorded: number;
  lastSampleAtMs: number | null;
  rejection: RejectionReason | null;
}

/** A running capture surface. */
export class CaptureController {
  private readonly options: CaptureControllerOptions;
  private readonly frameRate = new FrameRateMeter();
  private readonly nowMs: () => number;

  private cameraSession: CameraSession | null = null;
  private stopFrames: (() => void) | null = null;
  private running = false;
  private session: CaptureSession | null = null;
  private take: Take | null = null;
  private sampleCount = 0;
  private discardedCount = 0;
  private lastRejection: RejectionReason | null = null;

  /** Build a controller. Nothing is opened until {@link start}. */
  constructor(options: CaptureControllerOptions) {
    this.options = options;
    this.nowMs = options.nowMs ?? (() => performance.now());
  }

  /** Whether the camera is running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The session takes are appended to, or `null` before one is started. */
  get activeSession(): CaptureSession | null {
    return this.session;
  }

  /** Whether a take is in progress. */
  get isRecording(): boolean {
    return this.take !== null;
  }

  /** Open the camera and begin previewing. **Records nothing** until a take is begun. */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.cameraSession = await this.options.camera.open();
    this.running = true;
    this.stopFrames = this.cameraSession.onFrame((timestampMs) => {
      this.processFrame(timestampMs);
    });
  }

  /** Stop previewing and release the camera (FR-010). Idempotent. */
  stop(): void {
    this.running = false;
    this.take = null;
    this.stopFrames?.();
    this.stopFrames = null;
    this.cameraSession?.close();
    this.cameraSession = null;
    this.options.detector.close();
    this.frameRate.reset();
  }

  /** Point subsequent takes at `session`, and adopt its counts. */
  useSession(session: CaptureSession | null): void {
    this.session = session;
    this.take = null;
    this.sampleCount = session?.sampleCount ?? 0;
    this.discardedCount = session?.discardedCount ?? 0;
    this.lastRejection = null;
  }

  /**
   * Begin a take: an optional countdown, then a burst.
   *
   * This is the **only** path by which a sample is ever recorded (FR-011). Returns `false` when
   * there is no active session or a take is already running.
   */
  beginTake(): boolean {
    if (this.session === null || this.take !== null || !this.running) {
      return false;
    }
    const countdownEnabled = this.options.config.countdownMs > 0;
    this.take = {
      startedAtMs: this.nowMs(),
      countdownStartedAt: engineTimestamp(this.options.time.now()),
      countdownSeconds: this.options.config.countdownMs / 1000,
      countdownEnabled,
      recorded: 0,
      lastSampleAtMs: null,
      rejection: null,
    };
    this.lastRejection = null;
    return true;
  }

  /** Abandon an in-progress take. Samples already accepted stay; nothing is rolled back. */
  cancelTake(): void {
    this.take = null;
  }

  /**
   * Process one frame.
   *
   * Public so a test can drive the pipeline with no camera and no event loop — including the test
   * that advances many frames with no take and asserts nothing was recorded.
   */
  processFrame(timestampMs: number): CaptureSnapshot | null {
    const cameraSession = this.cameraSession;
    if (cameraSession === null || !this.running) {
      return null;
    }

    cameraSession.surface.update();
    const frame = this.options.detector.detect(cameraSession.surface, timestampMs);
    const nowMs = this.nowMs();
    this.frameRate.tick(nowMs);

    if (this.take !== null && this.session !== null) {
      this.advanceTake(this.take, this.session, frame, nowMs);
    }

    // The renderer is the only thing that draws, here as everywhere else. Capture passes no
    // effect commands at all — only the landmark overlay (research D8).
    const overlay = this.options.overlay?.(frame) ?? [];
    this.options.stage.present(cameraSession.surface, [], overlay);

    const snapshot = this.snapshot(frame, nowMs);
    this.options.onFrame?.(snapshot);
    return snapshot;
  }

  /** What the surface renders. Also the shape the shell tests assert against. */
  snapshot(frame: LandmarkFrame | null = null, nowMs: number = this.nowMs()): CaptureSnapshot {
    const take = this.take;
    const elapsed = take === null ? 0 : nowMs - take.startedAtMs;
    const counting = take !== null && elapsed < this.options.config.countdownMs;
    return {
      handCount: frame?.hands.length ?? 0,
      takeState: take === null ? 'idle' : counting ? 'countdown' : 'recording',
      countdownRemaining: counting
        ? Math.ceil((this.options.config.countdownMs - elapsed) / 1000)
        : 0,
      burstProgress: {
        recorded: take?.recorded ?? 0,
        total: this.options.config.burstSize,
      },
      sampleCount: this.sampleCount,
      discardedCount: this.discardedCount,
      fps: this.frameRate.fps,
      lastRejection: this.lastRejection,
    };
  }

  // -- take mechanics ------------------------------------------------------------

  private advanceTake(
    take: Take,
    session: CaptureSession,
    frame: LandmarkFrame,
    nowMs: number,
  ): void {
    if (nowMs - take.startedAtMs < this.options.config.countdownMs) {
      return; // still counting down
    }
    if (
      take.lastSampleAtMs !== null &&
      nowMs - take.lastSampleAtMs < this.options.config.burstIntervalMs
    ) {
      return; // spacing within the burst
    }

    const outcome = validateFrame(frame, session.requiredHands);
    if (!outcome.accepted) {
      // A rejected frame is never persisted. The whole take ends, so the operator gets one clear
      // answer rather than a partial burst they have to reason about (FR-019).
      this.discardedCount += 1;
      this.lastRejection = outcome.reason;
      this.take = null;
      void this.persistDiscarded(session.id);
      this.options.onTakeFinished?.(take.recorded, outcome.reason);
      return;
    }

    const sample = this.buildSample(take, session, frame);
    take.recorded += 1;
    take.lastSampleAtMs = nowMs;
    this.sampleCount += 1;
    // Persisted off the frame loop: the preview must not stall on storage (FR-021, FR-070).
    void this.persistSample(sample);

    if (take.recorded >= this.options.config.burstSize) {
      this.take = null;
      this.options.onTakeFinished?.(take.recorded, null);
    }
  }

  private buildSample(take: Take, session: CaptureSession, frame: LandmarkFrame): CaptureSample {
    const capturedAt = engineTimestamp(this.options.time.now());
    const hands: CaptureHand[] = frame.hands.map((observation) =>
      captureHand(
        observation.handedness,
        observation.confidence,
        observation.landmarks.points,
        // The application's existing normalizer. There is no second one (FR-024).
        normalize(handLandmarks(observation.landmarks.points)).points,
        HAND_LANDMARK_COUNT,
      ),
    );
    return {
      id: this.options.time.newId(),
      sessionId: session.id,
      capturedAt,
      frameWidth: frame.width,
      frameHeight: frame.height,
      countdownStartedAt: take.countdownStartedAt,
      countdownSeconds: take.countdownEnabled ? take.countdownSeconds : 0,
      countdownEnabled: take.countdownEnabled,
      hands,
    };
  }

  private async persistSample(sample: CaptureSample): Promise<void> {
    try {
      await this.options.repository.appendSample(sample);
    } catch (error) {
      // The in-memory count would otherwise claim a sample that is not stored.
      this.sampleCount = Math.max(0, this.sampleCount - 1);
      this.options.onError?.(error);
    }
  }

  private async persistDiscarded(sessionId: string): Promise<void> {
    try {
      await this.options.repository.recordDiscarded(sessionId);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}

/** Seconds between two Engine-format instants, for a take's countdown record. */
export { secondsBetween };
