/**
 * FaceMark development diagnostics + pipeline telemetry (Spec 011 development gate).
 *
 * The load-bearing claim is that the diagnostics are OBSERVATIONAL: reading the snapshot, opening
 * the overlay, or rendering the panel never causes a face analysis; only a scheduled face-anchored
 * action does. Also: render cadence and per-model inference cadence are reported separately.
 */

import { describe, expect, it } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { PipelineTelemetry } from '../../src/application/pipeline-telemetry';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import type { Action, ParamValue } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import type { FaceFrame } from '../../src/domain/landmarks/face';
import type { CameraSession, MirroredSurface } from '../../src/domain/ports/camera';
import type { FaceDetector } from '../../src/domain/ports/face-detector';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import { PipelineSection } from '../../src/presentation/debug/pipeline-section';
import { faceOverlayCommands } from '../../src/presentation/debug/face-overlay';
import { catalog, effect, entry, runtimeFor } from '../support/effects';
import { FakeDetector, FakeSurface } from '../support/fake-session';

const matcher: PoseMatcher = { score: () => [] };
const capable = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));

function makeFace(): FaceFrame {
  const pts = Array.from({ length: FACE_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  pts[33] = { x: 0.25, y: 0.6, z: 0 };
  return faceFrame(pts, 1, 1280, 720);
}

class CountingFace implements FaceDetector {
  calls = 0;
  detect(): FaceFrame | null {
    this.calls += 1;
    return makeFace();
  }
  close(): void {}
}

class NullStage implements StagePresenter {
  present(_s: MirroredSurface, _c: readonly RenderCommand[]): void {}
}

const face33: ParamValue = { kind: 'faceLandmark', index: 33 };
const trail: Action = {
  type: 'landmark_trail',
  params: { anchor: face33, color: '#6EE7F9', width: 5, length: 20 },
};
const faceEffect = effect({
  id: 'ef',
  poseId: 'p',
  durationMs: 1000,
  entries: [entry(0, trail, 1000)],
});

function setup(withEffect: boolean) {
  const clock = { t: 0 };
  const detector = new CountingFace();
  const controller = new EditorRuntimeController({
    runtime: runtimeFor(catalog(...(withEffect ? [faceEffect] : [])), { capabilities: capable }),
    stage: new NullStage(),
    matcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => clock.t,
    scheduleTick: () => {},
    faceDetector: detector,
  });
  const session: CameraSession = {
    surface: new FakeSurface(),
    onFrame: () => () => {},
    close: () => {},
  };
  controller.attachCamera(session, new FakeDetector(), null);
  return { controller, detector, clock };
}

describe('pipeline telemetry', () => {
  it('reports render cadence and a model cadence independently', () => {
    const t = new PipelineTelemetry();
    for (let i = 0; i <= 60; i += 1) {
      t.recordTick(i * 16.667); // ~60 Hz render
      if (i % 4 === 0) {
        t.recordRun('face', i * 16.667, 8); // ~15 Hz inference
      }
    }
    const snap = t.snapshot(60 * 16.667);
    expect(snap.tickHz).toBeGreaterThan(55);
    expect(snap.face.hz).toBeGreaterThan(13);
    expect(snap.face.hz).toBeLessThan(17);
    expect(snap.face.meanMs).toBeCloseTo(8);
    expect(snap.face.skippedTicks).toBeGreaterThan(40);
    expect(snap.hand.runs).toBe(0);
  });
});

describe('FaceMark observability', () => {
  it('runs no face analysis while no face-anchored action is scheduled, however often observed', () => {
    const { controller, detector, clock } = setup(false);
    for (let i = 0; i < 20; i += 1) {
      clock.t += 33;
      const snap = controller.tick(clock.t);
      expect(snap.face.lastResult).toBe('never');
      expect(snap.face.detectorPresent).toBe(true);
      expect(snap.runtime.faceAnchors).toEqual([]);
    }
    expect(detector.calls).toBe(0);
    void controller.lastFaceAnalysis;
    expect(detector.calls).toBe(0);
  });

  it('reports the resolved landmark, and the model cadence, once a face action runs', () => {
    const { controller, detector, clock } = setup(true);
    controller.playTimeline('ef');
    let snap = controller.tick((clock.t += 33));
    for (let i = 0; i < 10; i += 1) {
      snap = controller.tick((clock.t += 33));
    }
    expect(detector.calls).toBeGreaterThan(0);
    expect(snap.face.lastResult).toBe('detected');
    expect(snap.face.landmarkCount).toBe(FACE_LANDMARK_COUNT);
    const trace = snap.runtime.faceAnchors[0]!;
    expect(trace).toMatchObject({ effectId: 'ef', landmarkIndex: 33, resolved: true });
    expect(trace.point!.x).toBeCloseTo(0.25 * 1280, 6);
    expect(trace.point!.y).toBeCloseTo(0.6 * 720, 6);
    expect(snap.pipeline.face.runs).toBe(detector.calls);
    expect(snap.pipeline.hand.runs).toBeGreaterThan(0); // hand model ran every tick
    expect(controller.lastFaceAnalysis?.frame).not.toBeNull();
  });

  it('clears the face analysis when the camera detaches', () => {
    const { controller, clock } = setup(true);
    controller.playTimeline('ef');
    controller.tick((clock.t += 33));
    expect(controller.lastFaceAnalysis).not.toBeNull();
    controller.detachCamera();
    expect(controller.lastFaceAnalysis).toBeNull();
  });
});

describe('FaceMark overlay and section', () => {
  it('draws a marker exactly at the resolved landmark, and nothing when unresolved', () => {
    const cmds = faceOverlayCommands(null, [
      {
        effectId: 'e',
        actionType: 'a',
        landmarkIndex: 33,
        resolved: true,
        point: { x: 320, y: 432 },
      },
      { effectId: 'e', actionType: 'a', landmarkIndex: 9, resolved: false, point: null },
    ]);
    const circles = cmds.filter((c) => c.kind === 'drawCircles');
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({ points: [{ x: 320, y: 432 }] });
  });

  it('draws the mesh scaled to the surface when a fresh face is given', () => {
    const cmds = faceOverlayCommands(makeFace(), []);
    const mesh = cmds[0] as Extract<RenderCommand, { kind: 'drawCircles' }>;
    expect(mesh.points).toHaveLength(FACE_LANDMARK_COUNT);
    expect(mesh.points[33]).toEqual({ x: 0.25 * 1280, y: 0.6 * 720 });
  });

  it('renders capability, detector and the landmark trace without invoking the detector', () => {
    const { controller, detector, clock } = setup(true);
    const section = new PipelineSection(document, capable);
    controller.playTimeline('ef');
    const snap = controller.tick((clock.t += 33));
    const callsBefore = detector.calls;
    section.update(snap);
    expect(detector.calls).toBe(callsBefore);
    expect(section.root.textContent).toContain('face_landmarks');
    expect(section.root.textContent).toContain('available');
    expect(section.root.textContent).toContain('landmark 33');
  });
});

describe('detector status surfaces a count mismatch (Amendment A risk)', () => {
  it('reports count_mismatch with the received count, not no_face', () => {
    const clock = { t: 0 };
    const detector: FaceDetector = {
      detect: () => null,
      close: () => {},
      diagnostics: () => ({ outcome: 'count-mismatch', pointCount: 468, atMs: 1 }),
    };
    const controller = new EditorRuntimeController({
      runtime: runtimeFor(catalog(faceEffect), { capabilities: capable }),
      stage: new NullStage(),
      matcher,
      config: DEFAULT_SESSION_CONFIG,
      now: () => clock.t,
      scheduleTick: () => {},
      faceDetector: detector,
    });
    const snap = controller.tick((clock.t += 33));
    expect(snap.face).toMatchObject({ lastResult: 'count_mismatch', landmarkCount: 468 });
  });
});
