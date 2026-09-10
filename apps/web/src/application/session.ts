/**
 * One frame of the pipeline, in order, once.
 *
 * camera → detector → normalize → classify → events → runtime → renderer.
 *
 * This is the only place those stages are wired together, and it is deliberately thin:
 * every rule it invokes lives in the domain and is asserted there without a browser. What
 * is genuinely *this* file's responsibility is the ordering, the lifecycle, and releasing
 * the camera — the things that only exist because there is a real session running.
 */

import type { SessionConfig } from '../domain/config/session-config';
import { PoseEventEmitter } from '../domain/events/pose-events';
import type { PoseEvent } from '../domain/events/pose-events';
import type { LandmarkFrame } from '../domain/landmarks/types';
import type { CameraSession, CameraSource } from '../domain/ports/camera';
import type { HandDetector } from '../domain/ports/detector';
import type { PersonSegmenter } from '../domain/ports/segmenter';
import { classify } from '../domain/recognition/classify';
import type { PoseMatcher, RecognitionOutcome } from '../domain/recognition/types';
import type { EffectRuntime } from '../domain/runtime/effect-runtime';
import type { Diagnostic, RenderCommand } from '../domain/runtime/frame-output';
import type { Stage } from '../presentation/stage/stage';
import type { PerformanceSnapshot } from './metrics';
import { SessionMetrics } from './metrics';

/** Consumes audio cues. The runtime never plays anything itself (FR-054a). */
export interface AudioSink {
  play(asset: string, volume: number): void;
  /**
   * Mark audio playable, from a genuine user gesture. Optional: `Session` never calls it
   * itself (`main.ts` holds the concrete `HtmlAudioSink` and calls its own `unlock()`
   * directly, from the camera-grant handler); `EditorRuntimeController` only has this
   * narrower interface, and Test Trigger / Play Timeline are gestures too (P1.2), so it calls
   * this — a no-op for any sink that doesn't need unlocking.
   */
  unlock?(): void;
}

/** Draws technical information over the frame when debug mode is on. */
export interface DebugOverlay {
  /** Whether debug mode is currently on. */
  readonly enabled: boolean;
  /** Commands to draw over everything else. Must be empty when disabled (FR-091). */
  commandsFor(frame: LandmarkFrame, snapshot: SessionSnapshot): readonly RenderCommand[];
}

/** What the shell and the debug panels can see about the running session. */
export interface SessionSnapshot {
  readonly outcome: RecognitionOutcome;
  readonly events: readonly PoseEvent[];
  readonly holdProgress: number;
  readonly activePoseSet: readonly string[];
  readonly activePlaybacks: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly performance: PerformanceSnapshot;
}

/** Everything a session is built from. Injected; nothing is imported as a singleton. */
export interface SessionOptions {
  readonly camera: CameraSource;
  readonly detector: HandDetector;
  readonly matcher: PoseMatcher;
  readonly runtime: EffectRuntime;
  readonly stage: Stage;
  readonly config: SessionConfig;
  readonly audio?: AudioSink;
  readonly debug?: DebugOverlay;
  /**
   * `null` when Person Segmentation is unavailable in this session (constitution v1.7.0);
   * absent entirely has the same effect. Either way, segmentation-dependent actions stay
   * inert and reported (FR-042), exactly as before this option existed.
   */
  readonly segmenter?: PersonSegmenter | null;
  /** Reads the current time. Injected so timing is deterministic in tests. */
  readonly now?: () => number;
  /** Schedules a callback for the next animation frame; the paint proxy (FR-095). */
  readonly scheduleAfterPaint?: (callback: (nowMs: number) => void) => void;
  /** Called after each frame, so the shell can update without polling. */
  readonly onFrame?: (snapshot: SessionSnapshot) => void;
}

/** A running experience. */
export class Session {
  private readonly options: SessionOptions;
  private readonly events: PoseEventEmitter;
  private readonly metrics = new SessionMetrics();
  private readonly now: () => number;
  private readonly scheduleAfterPaint: (callback: (nowMs: number) => void) => void;

  private cameraSession: CameraSession | null = null;
  private stopFrames: (() => void) | null = null;
  private running = false;

  /** Build a session. Nothing is opened until {@link start}. */
  constructor(options: SessionOptions) {
    this.options = options;
    this.events = new PoseEventEmitter(options.config.events.holdDurationMs);
    this.now = options.now ?? (() => performance.now());
    this.scheduleAfterPaint =
      options.scheduleAfterPaint ?? ((callback) => requestAnimationFrame(callback));
  }

  /** Whether the pipeline is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Performance figures, for the debug panel. */
  get performance(): PerformanceSnapshot {
    return this.metrics.snapshot();
  }

  /** Open the camera and begin processing frames. */
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

  /**
   * Stop processing and **release the camera** (FR-004).
   *
   * Idempotent, and safe to call from a page-unload handler. The camera light going out is
   * the only signal a visitor has that it really did stop.
   */
  stop(): void {
    this.running = false;
    this.stopFrames?.();
    this.stopFrames = null;
    this.cameraSession?.close();
    this.cameraSession = null;
    this.options.detector.close();
    this.options.segmenter?.close();
    this.events.reset();
    this.options.runtime.reset();
    this.metrics.reset();
  }

  /**
   * Process one frame.
   *
   * Public so a test can drive the pipeline without a camera or an event loop.
   */
  processFrame(timestampMs: number): SessionSnapshot | null {
    const session = this.cameraSession;
    if (session === null || !this.running) {
      return null;
    }

    const captureStart = this.now();
    session.surface.update();
    const frame = this.options.detector.detect(session.surface, timestampMs);
    const segmentation = this.options.segmenter?.segment(session.surface, timestampMs) ?? null;

    const outcome = classify(frame, {
      matcher: this.options.matcher,
      activePoseSet: this.options.config.activePoseSet,
      recognition: this.options.config.recognition,
      latencyMs: this.now() - captureStart,
    });

    const nowMs = this.now();
    const events = this.events.advance(outcome, nowMs);
    const output = this.options.runtime.advance(events, frame, nowMs, segmentation);

    for (const started of output.started) {
      this.metrics.triggerLatency.triggered(started.effectId, started.startedAtMs);
    }
    for (const effectId of output.firstCommands) {
      this.metrics.triggerLatency.commanded(effectId, nowMs);
    }

    for (const cue of output.audioCues) {
      this.options.audio?.play(cue.asset, cue.volume);
    }

    this.metrics.recordFrame(nowMs, outcome.latencyMs);

    const snapshot: SessionSnapshot = {
      outcome,
      events,
      holdProgress: this.events.progressAt(nowMs),
      activePoseSet: this.options.config.activePoseSet,
      activePlaybacks: output.activePlaybacks,
      diagnostics: output.diagnostics,
      performance: this.metrics.snapshot(),
    };

    const overlay = this.options.debug?.commandsFor(frame, snapshot) ?? [];
    this.options.stage.present(session.surface, output.commands, overlay, segmentation);

    for (const effectId of output.firstCommands) {
      // The draw call for this playback has now been issued; the next animation frame is
      // the practical proxy for it having been painted.
      this.metrics.triggerLatency.drawn(effectId, this.now());
    }
    if (output.firstCommands.length > 0) {
      this.scheduleAfterPaint((paintedAt) => {
        this.metrics.triggerLatency.painted(paintedAt);
      });
    }

    this.options.onFrame?.(snapshot);
    return snapshot;
  }
}
