/**
 * A whole session assembled out of fakes.
 *
 * Every collaborator the session needs is an interface, so this needs no special support
 * from the production code — which is the practical payoff of the composition root, and
 * worth having a test that demonstrates it.
 */

import { Session } from '../../src/application/session';
import type { DebugOverlay, SessionOptions, SessionSnapshot } from '../../src/application/session';
import type { SessionConfig } from '../../src/domain/config/session-config';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import type { LandmarkFrame } from '../../src/domain/landmarks/types';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { CameraSession, CameraSource, MirroredSurface } from '../../src/domain/ports/camera';
import type { HandDetector } from '../../src/domain/ports/detector';
import type { PoseMatcher, RawScore } from '../../src/domain/recognition/types';
import type { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { Stage } from '../../src/presentation/stage/stage';

/** A surface that reports a fixed size and records how often it was updated. */
export class FakeSurface implements MirroredSurface {
  updates = 0;
  readonly image = { fake: 'surface' };

  constructor(
    readonly width = 1280,
    readonly height = 720,
  ) {}

  update(): boolean {
    this.updates += 1;
    return true;
  }
}

/** A camera that never opens a device. */
export class FakeCamera implements CameraSource {
  closed = 0;
  readonly surface = new FakeSurface();
  private callback: ((timestampMs: number) => void) | null = null;

  open(): Promise<CameraSession> {
    return Promise.resolve({
      surface: this.surface,
      onFrame: (callback) => {
        this.callback = callback;
        return () => {
          this.callback = null;
        };
      },
      close: () => {
        this.closed += 1;
      },
    });
  }

  /** Deliver a frame, as a real camera would. */
  emit(timestampMs: number): void {
    this.callback?.(timestampMs);
  }
}

/** A detector that returns whatever frame it was told to. */
export class FakeDetector implements HandDetector {
  closed = 0;
  frame: LandmarkFrame = landmarkFrame([], 0, 1280, 720);

  detect(surface: MirroredSurface, timestampMs: number): LandmarkFrame {
    return landmarkFrame(this.frame.hands, timestampMs, surface.width, surface.height);
  }

  close(): void {
    this.closed += 1;
  }
}

/** A matcher that returns scripted distances. */
export class FakeMatcher implements PoseMatcher {
  scores: RawScore[] = [];

  score(_hands: unknown, poseIds: readonly string[]): readonly RawScore[] {
    return this.scores.filter((score) => poseIds.includes(score.poseId));
  }
}

/** A stage that records what it was asked to present. */
export class FakeStage {
  readonly frames: { commands: readonly RenderCommand[]; overlay: readonly RenderCommand[] }[] = [];

  present(
    _surface: MirroredSurface,
    commands: readonly RenderCommand[],
    overlay: readonly RenderCommand[] = [],
  ): void {
    this.frames.push({ commands, overlay });
  }

  /** The last frame presented, or `undefined`. */
  get last():
    { commands: readonly RenderCommand[]; overlay: readonly RenderCommand[] } | undefined {
    return this.frames[this.frames.length - 1];
  }
}

/** Everything a fake session exposes to a test. */
export interface FakeSessionParts {
  readonly session: Session;
  readonly camera: FakeCamera;
  readonly detector: FakeDetector;
  readonly matcher: FakeMatcher;
  readonly stage: FakeStage;
  readonly snapshots: SessionSnapshot[];
  readonly audioPlayed: { asset: string; volume: number }[];
  /** Deliver one frame at `nowMs`. */
  step(nowMs: number): void;
}

/** Assemble a session from fakes, with a controllable clock. */
export function fakeSession(options: {
  runtime: EffectRuntime;
  config?: SessionConfig;
  debug?: DebugOverlay;
}): FakeSessionParts {
  const camera = new FakeCamera();
  const detector = new FakeDetector();
  const matcher = new FakeMatcher();
  const stage = new FakeStage();
  const snapshots: SessionSnapshot[] = [];
  const audioPlayed: { asset: string; volume: number }[] = [];

  let now = 0;

  const sessionOptions: SessionOptions = {
    camera,
    detector,
    matcher,
    runtime: options.runtime,
    stage: stage as unknown as Stage,
    config: options.config ?? DEFAULT_SESSION_CONFIG,
    audio: {
      play: (asset, volume) => audioPlayed.push({ asset, volume }),
    },
    now: () => now,
    scheduleAfterPaint: (callback) => callback(now),
    onFrame: (snapshot) => snapshots.push(snapshot),
    ...(options.debug === undefined ? {} : { debug: options.debug }),
  };

  const session = new Session(sessionOptions);

  return {
    session,
    camera,
    detector,
    matcher,
    stage,
    snapshots,
    audioPlayed,
    step(nowMs: number) {
      now = nowMs;
      camera.emit(nowMs);
    },
  };
}
