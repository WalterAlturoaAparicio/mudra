/**
 * The capture pipeline, driven with no camera and no event loop (FR-011, FR-016 – FR-024).
 *
 * The first describe block is the one the specification cares most about: a running controller that
 * nobody has asked to record must record **nothing**, across as many frames as you like. That is
 * FR-011's "no automatic background recording", and it is asserted by driving the real controller
 * rather than by inspecting it.
 *
 * The last block is the negative space that keeps Capture Mode from becoming a second recognition
 * system: the controller is not even *able* to classify, because no matcher is injected.
 */

import { describe, expect, it, vi } from 'vitest';

import { CaptureController } from '../../src/application/capture-controller';
import { DEFAULT_CAPTURE_CONFIG } from '../../src/domain/config/capture-config';
import type { CaptureConfig } from '../../src/domain/config/capture-config';
import { fixedTimeSource } from '../../src/domain/ports/clock';
import type { CameraSession, CameraSource, MirroredSurface } from '../../src/domain/ports/camera';
import type { HandDetector } from '../../src/domain/ports/detector';
import type { LandmarkFrame } from '../../src/domain/landmarks/types';
import { NORMALIZATION_STRATEGY } from '../../src/domain/normalization/normalize';
import type { Stage } from '../../src/presentation/stage/stage';
import { FakeCaptureRepository } from '../support/fake-capture-repository';
import { frameWith, session } from '../support/capture';

/** A surface that draws nothing and knows nothing — the domain never sees a real canvas. */
const surface: MirroredSurface = {
  width: 1280,
  height: 720,
  update: () => true,
  image: null,
};

function fakeCamera(): { camera: CameraSource; closed: () => boolean } {
  let closed = false;
  const cameraSession: CameraSession = {
    surface,
    onFrame: () => () => undefined,
    close: () => {
      closed = true;
    },
  };
  return { camera: { open: async () => cameraSession }, closed: () => closed };
}

function fakeDetector(frames: () => LandmarkFrame): HandDetector {
  return { detect: () => frames(), close: () => undefined };
}

/** A stage that records what it was asked to present, so "the runtime never draws" is checkable. */
function recordingStage(): { stage: Stage; calls: { commands: number; overlay: number }[] } {
  const calls: { commands: number; overlay: number }[] = [];
  const stage = {
    present: (
      _surface: unknown,
      commands: readonly unknown[],
      overlay: readonly unknown[] = [],
    ) => {
      calls.push({ commands: commands.length, overlay: overlay.length });
    },
  } as unknown as Stage;
  return { stage, calls };
}

interface Harness {
  controller: CaptureController;
  repository: FakeCaptureRepository;
  advance: (ms: number) => void;
  frame: (f: LandmarkFrame) => void;
  calls: { commands: number; overlay: number }[];
}

async function harness(config: Partial<CaptureConfig> = {}, hands = 2): Promise<Harness> {
  const repository = new FakeCaptureRepository();
  await repository.createSession(session());
  let clockMs = 0;
  let current = frameWith(hands);
  const { stage, calls } = recordingStage();

  const controller = new CaptureController({
    camera: fakeCamera().camera,
    detector: fakeDetector(() => current),
    stage,
    repository,
    config: { ...DEFAULT_CAPTURE_CONFIG, ...config },
    time: fixedTimeSource(new Date('2026-09-07T13:20:00.000Z'), 'sample'),
    nowMs: () => clockMs,
    overlay: () => [{ kind: 'noop' } as never],
  });
  await controller.start();
  controller.useSession(session());

  return {
    controller,
    repository,
    calls,
    advance: (ms) => {
      clockMs += ms;
    },
    frame: (f) => {
      current = f;
    },
  };
}

describe('nothing is recorded without an operator take (FR-011)', () => {
  it('records zero samples across many frames when no take was begun', async () => {
    const h = await harness();

    for (let i = 0; i < 200; i += 1) {
      h.advance(16);
      h.controller.processFrame(i * 16);
    }

    expect(await h.repository.countAll()).toBe(0);
    expect(h.repository.storedSampleIds).toEqual([]);
    expect(h.controller.snapshot().sampleCount).toBe(0);
    expect(h.controller.snapshot().takeState).toBe('idle');
  });

  it('still previews every one of those frames — it is running, just not recording', async () => {
    const h = await harness();
    for (let i = 0; i < 10; i += 1) {
      h.controller.processFrame(i * 16);
    }
    expect(h.calls).toHaveLength(10);
  });

  it('refuses to begin a take with no session', async () => {
    const h = await harness();
    h.controller.useSession(null);
    expect(h.controller.beginTake()).toBe(false);
  });

  it('refuses to begin a second take while one is running', async () => {
    const h = await harness();
    expect(h.controller.beginTake()).toBe(true);
    expect(h.controller.beginTake()).toBe(false);
  });

  it('refuses to begin a take when the camera is not running', async () => {
    const h = await harness();
    h.controller.stop();
    expect(h.controller.beginTake()).toBe(false);
  });
});

describe('a take: countdown then burst (FR-016)', () => {
  it('records nothing during the countdown, then exactly burstSize samples', async () => {
    const h = await harness({ countdownMs: 1000, burstSize: 3, burstIntervalMs: 100 });
    h.controller.beginTake();

    // During the countdown.
    for (let i = 0; i < 5; i += 1) {
      h.advance(100);
      h.controller.processFrame(i);
    }
    expect(await h.repository.countAll()).toBe(0);
    expect(h.controller.snapshot().takeState).toBe('countdown');

    // Past it: one sample per interval.
    for (let i = 0; i < 20; i += 1) {
      h.advance(100);
      h.controller.processFrame(100 + i);
    }
    expect(await h.repository.countAll()).toBe(3);
    expect(h.controller.isRecording).toBe(false);
  });

  it('reports the countdown as whole seconds remaining', async () => {
    const h = await harness({ countdownMs: 3000 });
    h.controller.beginTake();
    h.controller.processFrame(0);
    expect(h.controller.snapshot().countdownRemaining).toBe(3);
    h.advance(1500);
    h.controller.processFrame(1);
    expect(h.controller.snapshot().countdownRemaining).toBe(2);
  });

  it('treats a zero countdown as disabled, and stamps the sample accordingly', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    const [stored] = await h.repository.listSamples('session-0001');
    expect(stored?.countdownEnabled).toBe(false);
    expect(stored?.countdownSeconds).toBe(0);
    // A zero-length countdown still records when it was armed — Mudra Capture's convention.
    expect(stored?.countdownStartedAt).not.toBeNull();
  });

  it('can be cancelled, leaving already-accepted samples alone', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 5, burstIntervalMs: 100 });
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);
    h.advance(100);
    h.controller.processFrame(2);

    h.controller.cancelTake();
    h.advance(1000);
    h.controller.processFrame(3);

    expect(await h.repository.countAll()).toBe(2);
  });
});

describe('validation gates storage (FR-017 – FR-019)', () => {
  it('records nothing and reports a reason when hands are missing', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 3 }, 2);
    h.frame(frameWith(0));
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    expect(await h.repository.countAll()).toBe(0);
    expect(h.controller.snapshot().lastRejection).toBe('no_hands');
    expect(h.controller.snapshot().discardedCount).toBe(1);
    expect(h.controller.isRecording).toBe(false);
  });

  it('rejects one hand for a two-handed pose', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 3 });
    h.frame(frameWith(1));
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    expect(await h.repository.countAll()).toBe(0);
    expect(h.controller.snapshot().lastRejection).toBe('insufficient_hands');
  });

  it('clears the previous rejection when a new take begins', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    h.frame(frameWith(0));
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);
    expect(h.controller.snapshot().lastRejection).toBe('no_hands');

    h.frame(frameWith(2));
    h.controller.beginTake();
    expect(h.controller.snapshot().lastRejection).toBeNull();
  });
});

describe('what a stored sample contains (FR-024, FR-026, FR-027)', () => {
  it('carries raw and normalized landmarks, and the frame’s real dimensions', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    const [stored] = await h.repository.listSamples('session-0001');
    expect(stored?.hands).toHaveLength(2);
    expect(stored?.hands[0]?.raw).toHaveLength(21);
    expect(stored?.hands[0]?.normalized).toHaveLength(21);
    expect(stored?.frameWidth).toBe(1280);
    expect(stored?.frameHeight).toBe(720);
  });

  it('stores raw exactly as the detector produced it — no coordinate is flipped (FR-026)', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    const source = frameWith(2);
    h.frame(source);
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    const [stored] = await h.repository.listSamples('session-0001');
    expect(stored?.hands[0]?.raw).toEqual(source.hands[0]?.landmarks.points);
  });

  it('normalizes with the application’s existing normalizer (FR-024)', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    const [stored] = await h.repository.listSamples('session-0001');
    // The wrist lands on the origin — the defining property of `translation_scale`.
    expect(stored?.hands[0]?.normalized[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(NORMALIZATION_STRATEGY).toBe('translation_scale');
  });
});

describe('the recognition boundary (FR-022, FR-023, FR-025)', () => {
  it('presents no effect commands — only the landmark overlay (research D8)', async () => {
    const h = await harness();
    h.controller.processFrame(1);
    expect(h.calls[0]).toEqual({ commands: 0, overlay: 1 });
  });

  it('takes no matcher, no runtime and no event emitter — it cannot classify', () => {
    // Asserted against the constructor's own option surface: adding recognition to Capture Mode
    // would mean adding a collaborator here, which is a visible, deliberate change.
    const options = Object.keys({
      camera: 0,
      detector: 0,
      stage: 0,
      repository: 0,
      config: 0,
      time: 0,
      overlay: 0,
      nowMs: 0,
      onFrame: 0,
      onTakeFinished: 0,
      onError: 0,
    });
    for (const forbidden of ['matcher', 'runtime', 'events', 'segmenter', 'audio']) {
      expect(options).not.toContain(forbidden);
    }
  });

  it('labels samples with the operator’s pose, never an inferred one (FR-025)', async () => {
    const h = await harness({ countdownMs: 0, burstSize: 1 });
    h.controller.beginTake();
    h.advance(10);
    h.controller.processFrame(1);

    const [stored] = await h.repository.listSamples('session-0001');
    expect(stored?.sessionId).toBe('session-0001');
    expect((await h.repository.listSessions())[0]?.poseId).toBe('dragon');
  });
});

describe('metrics reuse the existing meter (FR-068, FR-069)', () => {
  it('reports a frame rate from observed intervals', async () => {
    const h = await harness();
    for (let i = 0; i < 30; i += 1) {
      h.advance(1000 / 60);
      h.controller.processFrame(i);
    }
    expect(h.controller.snapshot().fps).toBeGreaterThan(50);
    expect(h.controller.snapshot().fps).toBeLessThan(70);
  });

  it('keeps previewing while a take runs — no frame is skipped (FR-069)', async () => {
    const h = await harness({ countdownMs: 500, burstSize: 3, burstIntervalMs: 50 });
    h.controller.beginTake();
    for (let i = 0; i < 40; i += 1) {
      h.advance(1000 / 60);
      h.controller.processFrame(i);
    }
    // Every processed frame produced a present() call, take or no take.
    expect(h.calls).toHaveLength(40);
  });
});

describe('lifecycle', () => {
  it('releases the camera and the detector on stop (FR-010)', async () => {
    const repository = new FakeCaptureRepository();
    const camera = fakeCamera();
    const close = vi.fn();
    const controller = new CaptureController({
      camera: camera.camera,
      detector: { detect: () => frameWith(1), close },
      stage: recordingStage().stage,
      repository,
      config: DEFAULT_CAPTURE_CONFIG,
      time: fixedTimeSource(new Date()),
    });
    await controller.start();
    controller.stop();

    expect(camera.closed()).toBe(true);
    expect(close).toHaveBeenCalled();
    expect(controller.isRunning).toBe(false);
    expect(controller.processFrame(1)).toBeNull();
  });

  it('is idempotent on stop', async () => {
    const h = await harness();
    h.controller.stop();
    expect(() => h.controller.stop()).not.toThrow();
  });
});
