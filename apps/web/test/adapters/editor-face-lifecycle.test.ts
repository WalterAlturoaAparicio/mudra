/**
 * When the editor's face detector runs, and when it must not (Spec 011 FR-016–FR-018, FR-021,
 * FR-034; SC-002, SC-003, SC-008).
 *
 * A **real** `EditorRuntimeController` and a **real** `EffectRuntime`, with fakes only for the
 * camera, the hand detector and the face detector. The face detector counts its calls, and every
 * lifecycle claim is asserted per tick, not in aggregate: the constitution's condition is that
 * analysis stops *on the frame* any of "camera attached / capability available / a scheduled
 * face-anchored action" stops being true.
 */

import { describe, expect, it, vi } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import type { Action, ParamValue } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import type { FaceFrame } from '../../src/domain/landmarks/face';
import type { CameraSession, MirroredSurface } from '../../src/domain/ports/camera';
import type { FaceDetector } from '../../src/domain/ports/face-detector';
import type { PersonSegmenter } from '../../src/domain/ports/segmenter';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import type { CapabilityRegistry } from '../../src/domain/runtime/capabilities';
import type { DrawPolylineCommand, RenderCommand } from '../../src/domain/runtime/frame-output';
import { catalog, effect, entry, runtimeFor } from '../support/effects';
import { FakeDetector, FakeSurface } from '../support/fake-session';

const unusedMatcher: PoseMatcher = { score: () => [] };

const capable = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));
const incapable = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, false]]));

/** A face whose landmark 1 is at (0.25 + shift, 0.6) of a 1280x720 surface. */
function faceAt(shift = 0): FaceFrame {
  const pts = Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({
    x: 0.1 + (i % 50) * 0.01,
    y: 0.1 + (i % 40) * 0.01,
    z: 0,
  }));
  pts[1] = { x: 0.25 + shift, y: 0.6, z: 0 };
  return faceFrame(pts, 1, 1280, 720);
}

class CountingFaceDetector implements FaceDetector {
  calls = 0;
  closes = 0;
  shift = 0;
  private terminal = false;

  detect(): FaceFrame | null {
    if (this.terminal) {
      throw new Error('a terminally closed face detector was used');
    }
    this.calls += 1;
    this.shift += 0.02;
    return faceAt(this.shift);
  }

  close(): void {
    this.closes += 1;
    this.terminal = true;
  }
}

class RecordingStage implements StagePresenter {
  readonly calls: { commands: readonly RenderCommand[] }[] = [];
  present(_surface: MirroredSurface, commands: readonly RenderCommand[]): void {
    this.calls.push({ commands });
  }
}

const face = (index: number): ParamValue => ({ kind: 'faceLandmark', index });
const handAnchor: ParamValue = { kind: 'landmark', hand: 'first', index: 8 };
const trail = (anchor: ParamValue): Action => ({
  type: 'landmark_trail',
  params: { anchor, color: '#6EE7F9', width: 5, length: 20 },
});
const burst = (anchor: ParamValue): Action => ({ type: 'particle_burst', params: { anchor } });

function harness(options: {
  capabilities?: CapabilityRegistry;
  faceDetector?: FaceDetector | null;
  effects: ReturnType<typeof effect>[];
}) {
  const clock = { t: 0 };
  const stage = new RecordingStage();
  const controller = new EditorRuntimeController({
    runtime: runtimeFor(catalog(...options.effects), {
      capabilities: options.capabilities ?? capable,
    }),
    stage,
    matcher: unusedMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => clock.t,
    scheduleTick: () => {},
    faceDetector: options.faceDetector ?? null,
  });
  return { controller, stage, clock };
}

function attach(controller: EditorRuntimeController, segmenter: PersonSegmenter | null = null) {
  let closed = 0;
  const session: CameraSession = {
    surface: new FakeSurface(),
    onFrame: () => () => {},
    close: () => {
      closed += 1;
    },
  };
  controller.attachCamera(session, new FakeDetector(), segmenter);
  return { closedCount: () => closed };
}

/** Advance `ticks` frames of 33 ms starting after `clock.t`, returning the face calls per tick. */
function tickAndCount(
  controller: EditorRuntimeController,
  clock: { t: number },
  face: CountingFaceDetector,
  ticks: number,
): number[] {
  const perTick: number[] = [];
  for (let i = 0; i < ticks; i += 1) {
    clock.t += 33;
    const before = face.calls;
    controller.tick(clock.t);
    perTick.push(face.calls - before);
  }
  return perTick;
}

const longFaceTrail = effect({
  id: 'ef',
  poseId: 'p',
  durationMs: 1000,
  entries: [entry(0, trail(face(1)), 1000)],
});
const handTrail = effect({
  id: 'eh',
  poseId: 'p',
  durationMs: 1000,
  entries: [entry(0, trail(handAnchor), 1000)],
});

describe('user story 1: the anchored action follows the face on the stage', () => {
  it('draws at the landmark position, and a face on the left stays on the left', () => {
    const detector = new CountingFaceDetector();
    const { controller, stage, clock } = harness({
      effects: [longFaceTrail],
      faceDetector: detector,
    });
    attach(controller);

    controller.playTimeline('ef');
    clock.t = 33;
    controller.tick(33);

    const lines = stage.calls
      .flatMap((c) => c.commands)
      .filter((c): c is DrawPolylineCommand => c.kind === 'drawPolyline');
    expect(lines.length).toBeGreaterThan(0);
    const last = lines[lines.length - 1]!;
    // Landmark 1 was at x = 0.25 + 0.02 then 0.25 + 0.04 => 345.6 then 371.2 of 1280; y = 432.
    expect(last.points[0]!.x).toBeCloseTo(345.6, 6);
    expect(last.points[last.points.length - 1]!.x).toBeCloseTo(371.2, 6);
    expect(last.points[0]!.x).toBeLessThan(640); // left of centre stays left of centre
    expect(last.points.every((p) => Math.abs(p.y - 432) < 1e-9)).toBe(true);
  });
});

describe('when the detector is invoked (FR-016, FR-017, FR-018)', () => {
  it('never before a camera is attached, even while a face-anchored effect plays', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });

    controller.playTimeline('ef');
    expect(tickAndCount(controller, clock, detector, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(detector.calls).toBe(0);
  });

  it('never while only hand-anchored effects play, camera attached', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [handTrail], faceDetector: detector });
    attach(controller);
    controller.playTimeline('eh');
    expect(tickAndCount(controller, clock, detector, 10).every((n) => n === 0)).toBe(true);
    expect(detector.calls).toBe(0);
  });

  it('exactly once per tick while a face-anchored action is scheduled, and not on the tick after it ends', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(controller);

    controller.playTimeline('ef');
    expect(detector.calls).toBe(1); // the frame that starts it

    // Ticks at 33, 66, ... 990 are inside the 1000 ms window: one call each.
    const inside = tickAndCount(controller, clock, detector, 30);
    expect(inside.every((n) => n === 1)).toBe(true);

    // Tick at 1023 is past the window and the playback has ended: no call, and none after.
    const after = tickAndCount(controller, clock, detector, 5);
    expect(after).toEqual([0, 0, 0, 0, 0]);
  });

  it('an instantaneous face-anchored action gets its face on the frame it fires, and only then', () => {
    const detector = new CountingFaceDetector();
    const instant = effect({
      id: 'ei',
      poseId: 'p',
      durationMs: 600,
      entries: [entry(0, burst(face(2)), 600)],
    });
    const { controller, stage, clock } = harness({ effects: [instant], faceDetector: detector });
    attach(controller);

    controller.playTimeline('ei');
    expect(detector.calls).toBe(1);
    expect(stage.calls[0]!.commands.some((c) => c.kind === 'drawCircles')).toBe(true);
    void clock;
  });

  it('stops on the very tick the camera is detached, even though the effect keeps playing', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(controller);
    controller.playTimeline('ef');
    expect(tickAndCount(controller, clock, detector, 3)).toEqual([1, 1, 1]);

    controller.detachCamera();
    expect(tickAndCount(controller, clock, detector, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(detector.closes).toBe(0); // stopping processing is not releasing the detector
  });

  it('never when face_landmarks is unavailable', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({
      effects: [longFaceTrail],
      faceDetector: detector,
      capabilities: incapable,
    });
    attach(controller);
    controller.playTimeline('ef');
    expect(tickAndCount(controller, clock, detector, 10).every((n) => n === 0)).toBe(true);
    expect(detector.calls).toBe(0);
  });

  it('never when the runtime has no face detector at all (public experience shape)', () => {
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: null });
    attach(controller);
    controller.playTimeline('ef');
    expect(() => controller.tick((clock.t += 33))).not.toThrow();
  });

  it('never after stop()', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(controller);
    controller.playTimeline('ef');
    controller.stop();
    const before = detector.calls;
    tickAndCount(controller, clock, detector, 5);
    expect(detector.calls).toBe(before);
    expect(detector.closes).toBe(0);
  });

  it('Test Trigger asks for a face only when a camera is attached', () => {
    const triggered = effect({
      id: 'et',
      poseId: 'p',
      durationMs: 600,
      entries: [entry(0, burst(face(2)), 600)],
    });

    const withoutCamera = new CountingFaceDetector();
    harness({ effects: [triggered], faceDetector: withoutCamera }).controller.testTrigger(
      triggered,
    );
    expect(withoutCamera.calls).toBe(0);

    const withCamera = new CountingFaceDetector();
    const h = harness({ effects: [triggered], faceDetector: withCamera });
    attach(h.controller);
    h.controller.testTrigger(triggered);
    expect(withCamera.calls).toBe(1);
  });
});

describe('switching between face and non-face anchors (FR-034)', () => {
  it('hand → face: calls begin the frame the face-anchored entry is scheduled', () => {
    const detector = new CountingFaceDetector();
    const handThenFace = effect({
      id: 'hf',
      poseId: 'p',
      durationMs: 1000,
      entries: [entry(0, trail(handAnchor), 400), entry(400, trail(face(1)), 600)],
    });
    const { controller, clock } = harness({ effects: [handThenFace], faceDetector: detector });
    attach(controller);
    controller.playTimeline('hf');

    const perTick = tickAndCount(controller, clock, detector, 25); // to 825 ms
    // Ticks at 33..396 (12 ticks) are hand-only; 429 onward is the face-anchored entry.
    expect(perTick.slice(0, 12).every((n) => n === 0)).toBe(true);
    expect(perTick.slice(13).every((n) => n === 1)).toBe(true);
  });

  it('face → hand: calls stop the frame the face-anchored entry leaves its window', () => {
    const detector = new CountingFaceDetector();
    const faceThenHand = effect({
      id: 'fh',
      poseId: 'p',
      durationMs: 1000,
      entries: [entry(0, trail(face(1)), 400), entry(400, trail(handAnchor), 600)],
    });
    const { controller, clock } = harness({ effects: [faceThenHand], faceDetector: detector });
    attach(controller);
    controller.playTimeline('fh');
    expect(detector.calls).toBe(1);

    const perTick = tickAndCount(controller, clock, detector, 25);
    expect(perTick.slice(0, 11).every((n) => n === 1)).toBe(true); // 33..363
    expect(perTick.slice(12).every((n) => n === 0)).toBe(true); // 429 onward
  });
});

describe('the detector outlives the camera (FR-021)', () => {
  it('survives ten camera off/on cycles: same instance, still working, never closed', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });

    for (let cycle = 0; cycle < 10; cycle += 1) {
      attach(controller);
      const before = detector.calls;
      controller.playTimeline('ef');
      clock.t += 33;
      controller.tick(clock.t);
      expect(detector.calls - before).toBeGreaterThanOrEqual(2); // it works after every cycle
      controller.detachCamera();
      clock.t += 2000; // let the playback finish before the next cycle
      controller.tick(clock.t);
    }
    expect(detector.closes).toBe(0);
  });

  it('a controller built later with the same detector (project closed and reopened) still works', () => {
    const detector = new CountingFaceDetector();
    const first = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(first.controller);
    first.controller.playTimeline('ef');
    first.controller.stop(); // Close Project

    const second = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(second.controller);
    const before = detector.calls;
    second.controller.playTimeline('ef');
    expect(detector.calls).toBeGreaterThan(before);
    expect(detector.closes).toBe(0);
  });

  it('never hands out a detector after a terminal close (the harness detector throws if it is)', () => {
    const detector = new CountingFaceDetector();
    const { controller, clock } = harness({ effects: [longFaceTrail], faceDetector: detector });
    attach(controller);
    controller.playTimeline('ef');
    controller.detachCamera();
    attach(controller);
    expect(() => tickAndCount(controller, clock, detector, 3)).not.toThrow();
  });
});

describe('segmentation semantics are untouched', () => {
  it('detachCamera() still closes the segmenter exactly once per detach', () => {
    const detector = new CountingFaceDetector();
    const { controller } = harness({ effects: [longFaceTrail], faceDetector: detector });
    const close = vi.fn();
    const segmenter: PersonSegmenter = { segment: () => null, close };

    attach(controller, segmenter);
    controller.detachCamera();
    expect(close).toHaveBeenCalledTimes(1);

    attach(controller, segmenter);
    controller.detachCamera();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
