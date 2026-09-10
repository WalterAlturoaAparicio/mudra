/**
 * Test Trigger and Play Timeline drive the exact same `EffectRuntime` a real pose reaches —
 * no parallel evaluator (T035, research D9, contracts/editor-runtime-boundary.md, SC-003).
 *
 * Runs entirely in Node: `EditorRuntimeController` depends on `StagePresenter`, a narrow
 * interface `Stage` satisfies structurally — never the concrete class — so this test needs
 * no DOM, no canvas, and no camera.
 */

import { describe, expect, it } from 'vitest';

import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import { Logger } from '../../src/domain/config/logger';
import type { LogFields, LogLevel } from '../../src/domain/config/logger';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import type { EffectCatalog, EffectDefinition } from '../../src/domain/effects/types';
import type { PoseEvent } from '../../src/domain/events/pose-events';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { MirroredSurface } from '../../src/domain/ports/camera';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { FakeCamera, FakeDetector, FakeMatcher } from '../support/fake-session';

const registry = createActionRegistry();

function effect(): EffectDefinition {
  return {
    id: 'e1',
    name: 'Test effect',
    trigger: { on: 'confirmed', poseId: 'x', conditions: [] },
    timeline: {
      durationMs: 500,
      entries: [{ atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } }],
    },
  };
}

function catalog(): EffectCatalog {
  return { version: 1, effects: [effect()] };
}

/** No hand ever appears, so the fake matcher is never actually asked to score anything. */
const unusedMatcher: PoseMatcher = {
  score: () => [],
};

/** Records every `present()` call, for assertions — never draws anything itself. */
class RecordingStage implements StagePresenter {
  readonly calls: { surface: MirroredSurface; commands: readonly RenderCommand[] }[] = [];

  present(surface: MirroredSurface, commands: readonly RenderCommand[]): void {
    this.calls.push({ surface, commands });
  }
}

function buildController(runtime: EffectRuntime, stage: RecordingStage, nowMs: number) {
  return new EditorRuntimeController({
    runtime,
    stage,
    matcher: unusedMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => nowMs,
    scheduleTick: () => {}, // driven manually via tick()/testTrigger()/playTimeline()
  });
}

describe('Test Trigger', () => {
  it('starts the effect and presents its first commands, with no camera attached', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const stage = new RecordingStage();
    const controller = buildController(runtime, stage, 1000);

    expect(controller.hasCamera).toBe(false);
    controller.testTrigger(effect());

    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0]!.commands.length).toBeGreaterThan(0);
    expect(stage.calls[0]!.commands[0]).toMatchObject({ kind: 'fillScreen' });
  });

  it('works identically whether or not a camera is attached (FR-026)', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const stage = new RecordingStage();
    const controller = buildController(runtime, stage, 1000);
    expect(() => controller.testTrigger(effect())).not.toThrow();
  });
});

describe('Play Timeline', () => {
  it('starts a playback with no PoseEvent at all', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const stage = new RecordingStage();
    const controller = buildController(runtime, stage, 2000);

    const started = controller.playTimeline('e1');
    expect(started).toBe(true);
    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0]!.commands.length).toBeGreaterThan(0);
  });

  it('returns false for an unknown effect id', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const controller = buildController(runtime, new RecordingStage(), 2000);
    expect(controller.playTimeline('nope')).toBe(false);
  });
});

describe('Test Trigger vs. a real pose event (SC-003)', () => {
  it('produces the identical RenderCommand[] sequence for the same simulated timing', () => {
    // Two independent runtimes over the same catalog: one driven by testTrigger's synthetic
    // event, one driven by a scripted "real" event built the same way `PoseEventEmitter`
    // would — both call the exact same `EffectRuntime.advance()`.
    const viaTestTrigger = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const viaRealEvent = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });

    const stage = new RecordingStage();
    const controller = buildController(viaTestTrigger, stage, 5000);
    controller.testTrigger(effect());

    const realEvent: PoseEvent = {
      kind: 'confirmed',
      poseId: 'x',
      confidence: 1,
      atMs: 5000,
      progress: 1,
    };
    const directFrame = landmarkFrame([], 5000, 1280, 720);
    const directResult = viaRealEvent.advance([realEvent], directFrame, 5000, null);

    expect(stage.calls[0]!.commands).toEqual(directResult.commands);
  });
});

describe('start() tick-loop resilience (P0.2 — a thrown frame must not permanently kill it)', () => {
  it('a tick that throws is logged, and the loop still reschedules and keeps ticking', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });

    let throwOnce = true;
    class ThrowingStage implements StagePresenter {
      calls = 0;
      present(): void {
        this.calls += 1;
        if (throwOnce) {
          throwOnce = false;
          throw new Error('boom — a bad frame');
        }
      }
    }
    const stage = new ThrowingStage();

    const logged: { level: LogLevel; message: string; fields: LogFields }[] = [];
    const logger = new Logger('debug', (level, message, fields) => {
      logged.push({ level, message, fields });
    });

    const scheduled: Array<(nowMs: number) => void> = [];
    const controller = new EditorRuntimeController({
      runtime,
      stage,
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: (callback) => scheduled.push(callback),
      logger,
    });

    controller.start();
    expect(scheduled).toHaveLength(1);

    // Firing the first scheduled tick is the one whose `present()` throws.
    expect(() => scheduled[0]!(1000)).not.toThrow();
    expect(stage.calls).toBe(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.level).toBe('error');

    // The critical assertion: despite the throw, `scheduleTick` was still called again — the
    // loop did not die. Before the fix, this array would still have length 1 forever.
    expect(scheduled).toHaveLength(2);

    // And the next tick genuinely runs (the loop is not just "scheduled but inert").
    scheduled[1]!(1016);
    expect(stage.calls).toBe(2);
    expect(scheduled).toHaveLength(3);
  });

  it('never throws with the default logger when nothing is injected', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    class ThrowingStage implements StagePresenter {
      present(): void {
        throw new Error('boom');
      }
    }
    const scheduled: Array<(nowMs: number) => void> = [];
    const controller = new EditorRuntimeController({
      runtime,
      stage: new ThrowingStage(),
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: (callback) => scheduled.push(callback),
    });
    controller.start();
    expect(() => scheduled[0]!(1000)).not.toThrow();
    expect(scheduled).toHaveLength(2);
  });
});

describe('editor performance metrics (FR-058, FR-059, SC-010)', () => {
  it('reports zero fps while no camera is attached — an idle UI tick is not a pipeline cost', () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const controller = buildController(runtime, new RecordingStage(), 1000);
    const snapshot = controller.tick(1000);
    expect(snapshot.performance.fps).toBe(0);
    expect(snapshot.performance.recognitionLatencyMs).toBe(0);
  });

  it('records fps and recognition latency once a camera is attached and ticking (FR-058)', async () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const camera = new FakeCamera();
    const detector = new FakeDetector();
    let now = 0;
    const controller = new EditorRuntimeController({
      runtime,
      stage: new RecordingStage(),
      matcher: new FakeMatcher(),
      config: DEFAULT_SESSION_CONFIG,
      now: () => now,
      scheduleTick: () => {},
    });
    controller.attachCamera(await camera.open(), detector, null);

    let last = controller.tick(now);
    for (let i = 1; i <= 5; i += 1) {
      now = i * (1000 / 30);
      last = controller.tick(now);
    }

    expect(last.performance.fps).toBeGreaterThan(0);
    expect(last.performance.recognitionLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('resets the metrics history when the camera is detached', async () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const camera = new FakeCamera();
    const detector = new FakeDetector();
    let now = 0;
    const controller = new EditorRuntimeController({
      runtime,
      stage: new RecordingStage(),
      matcher: new FakeMatcher(),
      config: DEFAULT_SESSION_CONFIG,
      now: () => now,
      scheduleTick: () => {},
    });
    controller.attachCamera(await camera.open(), detector, null);
    for (let i = 0; i <= 5; i += 1) {
      now = i * (1000 / 30);
      controller.tick(now);
    }
    expect(controller.tick(now).performance.fps).toBeGreaterThan(0);

    controller.detachCamera();
    now += 1000 / 30;
    expect(controller.tick(now).performance.fps).toBe(0);
  });

  it("carries the live pipeline's active pose set through, for the panel to read", () => {
    const runtime = new EffectRuntime({
      catalog: catalog(),
      registry,
      capabilities: defaultCapabilities(),
    });
    const controller = buildController(runtime, new RecordingStage(), 1000);
    expect(controller.tick(1000).activePoseSet).toBe(DEFAULT_SESSION_CONFIG.activePoseSet);
  });
});

describe('play_audio cues reach an injected AudioSink (P1.2 — the editor used to have none wired in at all)', () => {
  function playAudioEffect(): EffectDefinition {
    return {
      id: 'e.audio',
      name: 'Audio effect',
      trigger: { on: 'confirmed', poseId: 'x', conditions: [] },
      timeline: {
        durationMs: 100,
        entries: [
          {
            atMs: 0,
            action: { type: 'play_audio', params: { asset: '@audio/flash', volume: 0.5 } },
          },
        ],
      },
    };
  }

  function playAudioRuntime(): EffectRuntime {
    return new EffectRuntime({
      catalog: { version: 1, effects: [playAudioEffect()] },
      registry,
      capabilities: defaultCapabilities(),
      resolveAsset: (reference) =>
        reference === '@audio/flash' ? '/assets/audio/flash.wav' : null,
    });
  }

  class FakeAudioSink {
    readonly played: { asset: string; volume: number }[] = [];
    unlocked = false;
    play(asset: string, volume: number): void {
      this.played.push({ asset, volume });
    }
    unlock(): void {
      this.unlocked = true;
    }
  }

  it('testTrigger() plays the cue exactly once, and unlocks the sink', () => {
    const audio = new FakeAudioSink();
    const controller = new EditorRuntimeController({
      runtime: playAudioRuntime(),
      stage: new RecordingStage(),
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: () => {},
      audio,
    });

    expect(audio.unlocked).toBe(false);
    controller.testTrigger(playAudioEffect());

    expect(audio.unlocked).toBe(true);
    expect(audio.played).toEqual([{ asset: '@audio/flash', volume: 0.5 }]);
  });

  it('playTimeline() plays the cue exactly once, and unlocks the sink', () => {
    const audio = new FakeAudioSink();
    const controller = new EditorRuntimeController({
      runtime: playAudioRuntime(),
      stage: new RecordingStage(),
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: () => {},
      audio,
    });

    controller.playTimeline('e.audio');
    expect(audio.unlocked).toBe(true);
    expect(audio.played).toEqual([{ asset: '@audio/flash', volume: 0.5 }]);
  });

  it('tick() also plays a cue from a playback already running — not only testTrigger/playTimeline', () => {
    const audio = new FakeAudioSink();
    const runtime = playAudioRuntime();
    const controller = new EditorRuntimeController({
      runtime,
      stage: new RecordingStage(),
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: () => {},
      audio,
    });

    // Started directly through the runtime, bypassing testTrigger()/playTimeline() (and their
    // own unlock() calls) entirely — tick()'s own advance()->playCues() path is what delivers
    // this cue, on the first tick after the playback started (its `justFired` frame).
    runtime.startEffect('e.audio', 1000);
    controller.tick(1000);

    expect(audio.played).toEqual([{ asset: '@audio/flash', volume: 0.5 }]);
  });

  it('never throws with no audio sink injected — play_audio remains a harmless no-op', () => {
    const controller = new EditorRuntimeController({
      runtime: playAudioRuntime(),
      stage: new RecordingStage(),
      matcher: unusedMatcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => 1000,
      scheduleTick: () => {},
    });
    expect(() => controller.testTrigger(playAudioEffect())).not.toThrow();
  });
});
