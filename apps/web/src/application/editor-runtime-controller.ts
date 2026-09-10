/**
 * Drives the effect runtime for the editor, **independent of whether a camera is open**
 * (research D11, contracts/editor-runtime-boundary.md).
 *
 * `Session` bundles camera lifecycle with runtime advancement because Milestone 1 had
 * exactly one reason to run the runtime: a live pose driving it. The editor has two — a live
 * pose (unchanged, reusing the same domain pieces `Session` composes) and an author's
 * explicit Test Trigger / Play Timeline action, which must work with **no** camera at all
 * (FR-026). This type is the smaller change that serves both without forcing a fake camera
 * into existence for every preview, and without adding a conditional camera-or-not branch
 * inside `Session` itself.
 *
 * It calls `EffectRuntime.advance()`/`startEffect()` and nothing else executes an effect;
 * it calls the renderer's `Stage.present()` and nothing else draws (FR-003, FR-004,
 * contracts/editor-runtime-boundary.md).
 */

import type { SessionConfig } from '../domain/config/session-config';
import { Logger } from '../domain/config/logger';
import type { EffectDefinition } from '../domain/effects/types';
import { PoseEventEmitter } from '../domain/events/pose-events';
import type { PoseEvent } from '../domain/events/pose-events';
import type { LandmarkFrame } from '../domain/landmarks/types';
import { landmarkFrame } from '../domain/landmarks/types';
import type { CameraSession, MirroredSurface } from '../domain/ports/camera';
import type { HandDetector } from '../domain/ports/detector';
import type { PersonSegmenter } from '../domain/ports/segmenter';
import type { SegmentationFrame } from '../domain/editor/segmentation-frame';
import { previewFrame } from '../domain/editor/preview-frame';
import type { CameraTreatmentSettings } from '../domain/editor/types';
import { DEFAULT_CAMERA_TREATMENT } from '../domain/editor/types';
import { classify } from '../domain/recognition/classify';
import type { PoseMatcher, RecognitionOutcome } from '../domain/recognition/types';
import type { EffectRuntime, RuntimeFrame } from '../domain/runtime/effect-runtime';
import type { AudioCue, RenderCommand } from '../domain/runtime/frame-output';
import type { AudioSink } from './session';
import type { PerformanceSnapshot } from './metrics';
import { SessionMetrics } from './metrics';

/** Surface size assumed when no camera is attached (FR-026) — anchor math still needs one. */
const NO_CAMERA_WIDTH = 1280;
const NO_CAMERA_HEIGHT = 720;

/**
 * The one `Stage` method this controller needs, as a narrow interface rather than the
 * concrete class — so the controller (and its domain-level tests, run with no DOM) never
 * depend on `Stage`'s canvas/2D-context construction. The real `Stage` satisfies this
 * structurally; nothing about the boundary in contracts/editor-runtime-boundary.md changes —
 * `Stage`/`Canvas2DRenderer` remain the only place a drawing call exists.
 */
export interface StagePresenter {
  present(
    surface: MirroredSurface,
    commands: readonly RenderCommand[],
    overlay?: readonly RenderCommand[],
    segmentation?: SegmentationFrame | null,
    cameraTreatment?: CameraTreatmentSettings,
  ): void;
}

/** What the controller reports back after each tick, for the editor's own UI to render. */
export interface EditorFrameSnapshot {
  readonly outcome: RecognitionOutcome | null;
  readonly events: readonly PoseEvent[];
  readonly holdProgress: number;
  readonly activePlaybacks: number;
  readonly runtime: RuntimeFrame;
  readonly cameraAttached: boolean;
  /** Whether this frame's landmarks were the synthetic preview hand rather than a real one. */
  readonly syntheticInput: boolean;
  readonly activePoseSet: readonly string[];
  /**
   * Milestone 1's own frame-rate/recognition-latency figures (FR-058, SC-010), measured the
   * same way `Session` measures them — over frames the live camera pipeline actually
   * processed, not the editor's own idle UI ticks. Wired to `presentation/debug/
   * diagnostics-panel.ts` in `editor-main.ts`, the same panel `main.ts` already uses, so
   * quickstart scenario 14 has somewhere to read these from while a clip is being dragged.
   */
  readonly performance: PerformanceSnapshot;
}

/** Everything the controller is built from. Injected; nothing is a module singleton. */
export interface EditorRuntimeControllerOptions {
  readonly runtime: EffectRuntime;
  readonly stage: StagePresenter;
  readonly matcher: PoseMatcher;
  readonly config: SessionConfig;
  /** Reads the current time. Injected so timing is deterministic in tests. */
  readonly now?: () => number;
  /** Schedules the next tick. Injected so the loop is testable with no real animation frame. */
  readonly scheduleTick?: (callback: (nowMs: number) => void) => void;
  readonly onFrame?: (snapshot: EditorFrameSnapshot) => void;
  /** Where a tick that threw is reported (P0.2). Defaults to a console-backed `Logger`, same
   *  as `probeCapabilities()`'s default. */
  readonly logger?: Logger;
  /**
   * Consumes `play_audio` cues (P1.2) — the editor's counterpart to `Session.processFrame()`'s
   * own `this.options.audio?.play(...)` call. Optional and absent by default, same as
   * `Session` itself: with no sink, a cue is simply not played, never an error.
   */
  readonly audio?: AudioSink;
  /**
   * Whether a stand-in hand is supplied while no camera is attached (item 15).
   *
   * Defaults to `true` for the editor, where an author needs a hand-anchored effect to
   * actually show something before deciding whether it looks right. Never consulted while a
   * camera *is* attached, and never fed to the matcher: the synthetic hand produces no
   * `RecognitionOutcome` and fires no trigger by itself.
   */
  readonly syntheticInputWhenCameraless?: boolean;
}

/**
 * What one Test Trigger actually did (item 15).
 *
 * Test Trigger is not "play this effect": it injects the event and lets the runtime decide,
 * conditions included. An effect whose cooldown has not elapsed genuinely does not fire — and
 * an author tuning that cooldown needs to see exactly that, rather than a preview that always
 * plays and tells them nothing. So the result reports what started, which may be nothing, or
 * may be *more* than the effect asked about when several share a trigger (FR-044).
 */
export interface TestTriggerResult {
  /** The event that was injected. */
  readonly event: PoseEvent;
  /** Every effect the runtime actually started, in catalog order. */
  readonly startedEffectIds: readonly string[];
}

/** One attached camera and the collaborators needed to recognize poses from it. */
interface AttachedCamera {
  readonly session: CameraSession;
  readonly detector: HandDetector;
  readonly segmenter: PersonSegmenter | null;
}

/** Runs the effect runtime for the editor's stage, with or without a live camera. */
export class EditorRuntimeController {
  private readonly runtime: EffectRuntime;
  private readonly stage: StagePresenter;
  private readonly matcher: PoseMatcher;
  private readonly config: SessionConfig;
  private readonly now: () => number;
  private readonly scheduleTick: (callback: (nowMs: number) => void) => void;
  private readonly onFrame: ((snapshot: EditorFrameSnapshot) => void) | undefined;
  private readonly logger: Logger;
  private readonly audio: AudioSink | undefined;
  private readonly events: PoseEventEmitter;
  private readonly metrics = new SessionMetrics();
  private readonly syntheticInputWhenCameraless: boolean;
  private readonly frameListeners = new Set<(snapshot: EditorFrameSnapshot) => void>();
  private overlay: ((frame: LandmarkFrame) => readonly RenderCommand[]) | null = null;

  private camera: AttachedCamera | null = null;
  private cameraTreatment: CameraTreatmentSettings = DEFAULT_CAMERA_TREATMENT;
  private lastFrame: LandmarkFrame;
  private lastSegmentation: SegmentationFrame | null = null;
  private running = false;
  private stopTicking: (() => void) | null = null;

  constructor(options: EditorRuntimeControllerOptions) {
    this.runtime = options.runtime;
    this.stage = options.stage;
    this.matcher = options.matcher;
    this.config = options.config;
    this.now = options.now ?? (() => performance.now());
    this.scheduleTick = options.scheduleTick ?? ((callback) => requestAnimationFrame(callback));
    this.onFrame = options.onFrame;
    this.logger = options.logger ?? new Logger();
    this.audio = options.audio;
    this.syntheticInputWhenCameraless = options.syntheticInputWhenCameraless ?? true;
    this.events = new PoseEventEmitter(options.config.events.holdDurationMs);
    this.lastFrame = landmarkFrame([], this.now(), NO_CAMERA_WIDTH, NO_CAMERA_HEIGHT);
  }

  /**
   * Subscribe to every tick's snapshot.
   *
   * The editor's panels react to frames; they must not run a frame loop of their own
   * (`test/architecture/layering.test.ts` forbids `requestAnimationFrame` anywhere under
   * `presentation/editor/**`, so that this controller stays the single scheduler). This is how
   * a panel gets its ticks.
   *
   * @returns An unsubscribe function.
   */
  addFrameListener(listener: (snapshot: EditorFrameSnapshot) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Supply the debug overlay's commands (item 21), or `null` for none.
   *
   * Drawn over everything, through the same `Stage.present()` overlay argument the default
   * experience's own debug mode already uses — so landmark visualization in the editor is the
   * existing overlay, in the existing slot, not a second rendering path.
   */
  setOverlayProvider(overlay: ((frame: LandmarkFrame) => readonly RenderCommand[]) | null): void {
    this.overlay = overlay;
  }

  /** Whether the tick loop is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Whether a live camera is currently attached (FR-026 — Test Trigger works either way). */
  get hasCamera(): boolean {
    return this.camera !== null;
  }

  /** Update the render-time camera visual treatment (FR-048–FR-051). */
  setCameraTreatment(settings: CameraTreatmentSettings): void {
    this.cameraTreatment = settings;
  }

  /**
   * Attach a live camera: from this tick on, the frame fed to the runtime is real, detected,
   * and classified, and a real, confirmed pose fires effects exactly as the default
   * experience's `Session` does (US1 acceptance scenario 6).
   */
  attachCamera(
    session: CameraSession,
    detector: HandDetector,
    segmenter: PersonSegmenter | null,
  ): void {
    this.camera = { session, detector, segmenter };
  }

  /** Detach the camera. Test Trigger and Play Timeline remain fully usable (FR-026). */
  detachCamera(): void {
    if (this.camera !== null) {
      this.camera.session.close();
      this.camera.detector.close();
      this.camera.segmenter?.close();
      this.camera = null;
    }
    this.events.reset();
    this.metrics.reset();
  }

  /**
   * Start the tick loop. Idempotent.
   *
   * A tick that throws must not end the loop (P0.2, item 4's "camera controls must not
   * permanently disable the camera"): `scheduleTick(loop)` used to sit *after* `this.tick()`
   * in the same call, so one bad frame — a real bug this milestone found and fixed at its
   * root (the `applyCameraTreatment` wrapper-object return) — meant no further frame was ever
   * scheduled again, for the rest of the session, with no way to recover. The `try/catch` here
   * is the lifecycle safety net *in addition to* that root fix, not a replacement for it: it
   * only ever runs if something else throws, and it logs rather than swallows.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const loop = (nowMs: number): void => {
      if (!this.running) {
        return;
      }
      try {
        this.tick(nowMs);
      } catch (error) {
        this.logger.error('Editor runtime tick failed; skipping this frame.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.scheduleTick(loop);
    };
    this.scheduleTick(loop);
    this.stopTicking = () => {
      this.running = false;
    };
  }

  /** Stop the tick loop and release any attached camera. */
  stop(): void {
    this.running = false;
    this.stopTicking?.();
    this.stopTicking = null;
    this.detachCamera();
    this.runtime.reset();
  }

  /**
   * Advance one tick.
   *
   * Public so a test can drive the controller without a real animation frame — the same
   * reason `Session.processFrame` is public.
   */
  tick(nowMs: number): EditorFrameSnapshot {
    const { frame, segmentation, outcome, synthetic } = this.captureFrame(nowMs);
    this.lastFrame = frame;
    this.lastSegmentation = segmentation;

    // Recorded only over frames the live pipeline actually processed — an idle UI tick with
    // no camera attached is not a pipeline cost and must not dilute the fps/latency figures
    // FR-058 is about (mirrors `Session.processFrame`'s own `metrics.recordFrame` call).
    if (this.camera !== null && outcome !== null) {
      this.metrics.recordFrame(nowMs, outcome.latencyMs);
    }

    const events = outcome === null ? [] : this.events.advance(outcome, nowMs);
    const runtimeFrame = this.runtime.advance(events, frame, nowMs, segmentation);
    this.playCues(runtimeFrame.audioCues);
    this.present(runtimeFrame.commands, frame);

    const snapshot: EditorFrameSnapshot = {
      outcome,
      events,
      holdProgress: this.events.progressAt(nowMs),
      activePlaybacks: runtimeFrame.activePlaybacks,
      runtime: runtimeFrame,
      cameraAttached: this.camera !== null,
      syntheticInput: synthetic,
      activePoseSet: this.config.activePoseSet,
      performance: this.metrics.snapshot(),
    };
    this.onFrame?.(snapshot);
    for (const listener of this.frameListeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  /** The one place this controller draws — through the stage, never a canvas API of its own. */
  private present(commands: readonly RenderCommand[], frame: LandmarkFrame): void {
    this.stage.present(
      this.currentSurface(),
      commands,
      this.overlay?.(frame) ?? [],
      this.lastSegmentation,
      this.cameraTreatment,
    );
  }

  /**
   * The surface `Stage.present()` composites — the real camera surface when one is attached,
   * or a neutral placeholder otherwise (FR-026). `Canvas2DRenderer.drawCamera` already
   * handles a `null` image gracefully (Milestone 1), so a camera-less tick still draws every
   * effect command in full, just with no camera picture beneath it.
   */
  private currentSurface(): MirroredSurface {
    if (this.camera !== null) {
      return this.camera.session.surface;
    }
    return { width: NO_CAMERA_WIDTH, height: NO_CAMERA_HEIGHT, image: null, update: () => false };
  }

  private captureFrame(nowMs: number): {
    frame: LandmarkFrame;
    segmentation: SegmentationFrame | null;
    outcome: RecognitionOutcome | null;
    synthetic: boolean;
  } {
    if (this.camera === null) {
      // The stand-in hand (item 15) — so a hand-anchored effect has somewhere to anchor while
      // an author is judging it. It never reaches the matcher: `outcome` stays `null` here,
      // exactly as it did before, so nothing about recognition or triggering changes.
      const frame = this.syntheticInputWhenCameraless
        ? previewFrame(nowMs, NO_CAMERA_WIDTH, NO_CAMERA_HEIGHT)
        : this.lastFrame;
      return {
        frame,
        segmentation: null,
        outcome: null,
        synthetic: this.syntheticInputWhenCameraless,
      };
    }
    const captureStart = this.now();
    const { session, detector, segmenter } = this.camera;
    session.surface.update();
    const frame = detector.detect(session.surface, nowMs);
    const segmentation = segmenter?.segment(session.surface, nowMs) ?? null;
    const outcome = classify(frame, {
      matcher: this.matcher,
      activePoseSet: this.config.activePoseSet,
      recognition: this.config.recognition,
      latencyMs: this.now() - captureStart,
    });
    return { frame, segmentation, outcome, synthetic: false };
  }

  /**
   * "Test Trigger" (research D9): construct a `PoseEvent` matching `effect`'s own trigger,
   * with a confidence guaranteed to satisfy every `confidenceAtLeast` condition (`1`, the
   * maximum a condition may require), and pass it into the exact same
   * `EffectRuntime.advance()` a real pose confirmation reaches. No parallel evaluator.
   *
   * A cooldown condition is evaluated normally — a genuine "too soon" is not suppressed,
   * because that is exactly what an author needs to see while tuning one.
   */
  testTrigger(effect: EffectDefinition): TestTriggerResult {
    // A real click, same as the camera-grant gesture — unlocks play_audio even before any
    // camera has ever been opened (P1.2), so the action is genuinely testable standalone.
    this.audio?.unlock?.();
    const nowMs = this.now();
    const event: PoseEvent = {
      kind: effect.trigger.on,
      poseId: effect.trigger.poseId,
      confidence: 1,
      atMs: nowMs,
      progress: 1,
    };
    const frame = this.previewInputFrame(nowMs);
    const runtimeFrame = this.runtime.advance([event], frame, nowMs, this.lastSegmentation);
    this.playCues(runtimeFrame.audioCues);
    this.present(runtimeFrame.commands, frame);
    return {
      event,
      startedEffectIds: runtimeFrame.started.map((started) => started.effectId),
    };
  }

  /**
   * "Play Timeline" (research D9): start `effectId`'s playback directly, with no event at
   * all — for previewing a timeline whose trigger is inconvenient to simulate (a `held`
   * trigger, say) without fabricating a synthetic hold. Presents immediately, exactly as
   * {@link testTrigger} does, so the first frame is visible without waiting for the next
   * scheduled tick.
   *
   * @returns `false` if `effectId` names no effect in the current catalog.
   */
  playTimeline(effectId: string): boolean {
    this.audio?.unlock?.();
    const nowMs = this.now();
    const started = this.runtime.startEffect(effectId, nowMs);
    if (started) {
      this.advanceAndPresent(nowMs);
    }
    return started;
  }

  /**
   * "Play Selected" (item 15): play **one** clip of `effect`, from zero.
   *
   * Distinct from `playTimeline` in what plays, not in how: `selectedClipEffect` builds an
   * ordinary `EffectDefinition` holding that clip alone, and the runtime starts it through the
   * same `pushPlayback` every other playback goes through. Nothing is appended to the authored
   * catalog, and no scheduling rule is special-cased.
   *
   * @returns `false` when `entryIndex` names no clip — the command is disabled in that state.
   */
  playSelectedClip(effect: EffectDefinition, entryIndex: number): boolean {
    const clip = selectedClipEffect(effect, entryIndex);
    if (clip === null) {
      return false;
    }
    this.audio?.unlock?.();
    const nowMs = this.now();
    this.runtime.startDefinition(clip, nowMs);
    this.advanceAndPresent(nowMs);
    return true;
  }

  /** Advance one frame with no events and present it, so a preview's first frame is visible
   *  immediately rather than at the next scheduled tick. */
  private advanceAndPresent(nowMs: number): void {
    const frame = this.previewInputFrame(nowMs);
    const runtimeFrame = this.runtime.advance([], frame, nowMs, this.lastSegmentation);
    this.playCues(runtimeFrame.audioCues);
    this.present(runtimeFrame.commands, frame);
  }

  /** The frame a preview command runs against: the live one, or the stand-in hand. */
  private previewInputFrame(nowMs: number): LandmarkFrame {
    if (this.camera !== null || !this.syntheticInputWhenCameraless) {
      return this.lastFrame;
    }
    const frame = previewFrame(nowMs, NO_CAMERA_WIDTH, NO_CAMERA_HEIGHT);
    this.lastFrame = frame;
    return frame;
  }

  /** Plays every cue this frame produced (P1.2) — `Session.processFrame()`'s own
   *  `this.options.audio?.play(...)` loop, mirrored here. A no-op with no sink injected. */
  private playCues(cues: readonly AudioCue[]): void {
    for (const cue of cues) {
      this.audio?.play(cue.asset, cue.volume);
    }
  }
}
