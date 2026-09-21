/**
 * The face-tracking indicator (Spec 011 FR-019, FR-019a, FR-020, SC-003; decision D24).
 *
 * A very short face-anchored action (here a 20 ms burst) analyses only a frame or two; an
 * indicator visible for that long is not disclosure. So the indicator lingers for `FACE_INDICATOR_HOLD_MS` after the last
 * analysis frame — while the analysis itself is never extended. This test drives a **real**
 * controller, runtime and shell, with a call-counting face detector, and asserts both halves:
 * no extra analysis during the hold, and the indicator stays perceptible for the full minimum.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { createProject } from '../../src/domain/editor/types';
import type { EffectDefinition } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import type { FaceFrame } from '../../src/domain/landmarks/face';
import type { CameraSession } from '../../src/domain/ports/camera';
import type { FaceDetector } from '../../src/domain/ports/face-detector';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import { EditorShell, FACE_INDICATOR_HOLD_MS } from '../../src/presentation/editor/editor-shell';
import { FakeDetector, FakeSurface } from '../support/fake-session';

const registry = createActionRegistry();
const unusedMatcher: PoseMatcher = { score: () => [] };
const CAPTURE_LABELS = /\b(record|recording|capture|screenshot|save|download|share)\b/i;

class CountingFaceDetector implements FaceDetector {
  calls = 0;
  detect(): FaceFrame | null {
    this.calls += 1;
    return faceFrame(
      Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({ x: (i % 90) / 100, y: 0.5, z: 0 })),
      1,
      1280,
      720,
    );
  }
  close(): void {}
}

const faceBurstOnce: EffectDefinition = {
  id: 'once',
  name: 'Face burst',
  trigger: { on: 'confirmed', poseId: 'p', conditions: [] },
  // A 20 ms window: scheduled on the frame it starts and on the next tick or two, no longer.
  timeline: {
    durationMs: 600,
    entries: [
      {
        atMs: 0,
        durationMs: 20,
        action: { type: 'particle_burst', params: { anchor: { kind: 'faceLandmark', index: 2 } } },
      },
    ],
  },
};

const faceBurstConfigOnly: EffectDefinition = {
  ...faceBurstOnce,
  id: 'config-only',
  name: 'Never played',
};

function build(effects: EffectDefinition[]) {
  const project = createProject({ version: 1, effects }, 'p1', 'Project', 1000);
  const capabilities = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));
  const runtime = new EffectRuntime({ catalog: project.catalog, registry, capabilities });
  const detector = new CountingFaceDetector();
  const clock = { t: 1000 };
  const stage: StagePresenter = { present: () => {} };
  const controller = new EditorRuntimeController({
    runtime,
    stage,
    matcher: unusedMatcher,
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

  const layout = {
    center: document.createElement('div'),
    right: document.createElement('div'),
    timeline: document.createElement('div'),
  };
  const shell = new EditorShell({
    document,
    layout,
    registry,
    runtimeController: controller,
    runtime,
    stageCanvas: document.createElement('canvas'),
    initialProject: project,
    poses: [],
  });
  // What editor-main.ts does per frame; jsdom tests do not run editor-main.ts.
  controller.addFrameListener((snapshot) => shell.reflectFaceTracking(snapshot));

  const indicator = layout.center.querySelector<HTMLElement>('.mudra-editor__face-indicator')!;
  const tickAt = (t: number) => {
    clock.t = t;
    controller.tick(t);
  };
  return { controller, detector, indicator, tickAt, clock, layout };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the indicator states', () => {
  it('is hidden initially and shows nothing while nothing needs a face', () => {
    const { indicator, tickAt } = build([faceBurstOnce]);
    expect(indicator).not.toBeNull();
    expect(indicator.hidden).toBe(true);
    for (let t = 1016; t < 3000; t += 16) {
      tickAt(t);
    }
    expect(indicator.hidden).toBe(true);
  });

  it('after a very short action: on, then finished for the whole hold with no more analysis, then hidden', () => {
    const { controller, detector, indicator, tickAt, clock } = build([faceBurstOnce]);

    controller.testTrigger(faceBurstOnce); // analyses in this advance (elapsed 0 of a 20 ms window)
    expect(detector.calls).toBe(1);

    // The next tick (16 ms in) is still inside the window: it analyses, and turns the indicator on.
    const lastAnalysis = 1016;
    tickAt(lastAnalysis);
    expect(detector.calls).toBe(2);
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toBe('Face tracking on');

    // From here the window is over. Through the entire hold: visible, "finished" (never "on"),
    // and NOT ONE more analysis.
    for (let t = lastAnalysis + 16; t < lastAnalysis + FACE_INDICATOR_HOLD_MS; t += 16) {
      tickAt(t);
      expect(indicator.hidden).toBe(false);
      expect(indicator.textContent).toBe('Face tracking finished');
      expect(detector.calls).toBe(2);
    }

    // Held for at least the defined minimum, measured from the last analysis frame — then gone.
    tickAt(lastAnalysis + FACE_INDICATOR_HOLD_MS);
    expect(indicator.hidden).toBe(true);
    expect(detector.calls).toBe(2);
    void clock;
  });

  it('a second analysis inside the hold shows "on" again and restarts the hold from that frame, with no timer', () => {
    vi.useFakeTimers();
    const { controller, detector, indicator, tickAt, clock } = build([faceBurstOnce]);
    const timersBefore = vi.getTimerCount();

    controller.testTrigger(faceBurstOnce);
    tickAt(1016); // last analysis of the first burst
    tickAt(1216);
    expect(indicator.textContent).toBe('Face tracking finished');
    const callsBefore = detector.calls;

    clock.t = 1232;
    controller.testTrigger(faceBurstOnce); // analysis again, mid-hold
    expect(detector.calls).toBeGreaterThan(callsBefore);
    tickAt(1248); // inside the new burst's window: analysis, indicator on again
    expect(indicator.textContent).toBe('Face tracking on');

    // The original deadline (1016 + hold) passes; the restarted hold keeps it visible.
    tickAt(1016 + FACE_INDICATOR_HOLD_MS + 8);
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toBe('Face tracking finished');

    tickAt(1248 + FACE_INDICATOR_HOLD_MS);
    expect(indicator.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(timersBefore); // the hold is computed, never scheduled
  });

  it('is never shown merely because a face anchor exists in the project', () => {
    const { detector, indicator, tickAt } = build([faceBurstConfigOnly]);
    for (let t = 1016; t < 10000; t += 100) {
      tickAt(t);
      expect(indicator.hidden).toBe(true);
    }
    expect(detector.calls).toBe(0);
  });
});

describe('the wording (FR-019, FR-020)', () => {
  it('states in the camera help when face tracking runs and that nothing is stored or sent', () => {
    const { layout } = build([faceBurstOnce]);
    const camera = layout.center.querySelector<HTMLElement>('[data-state]')!;
    const help = (camera.title || '') + (camera.getAttribute('aria-description') ?? '');
    expect(help).toMatch(/face tracking runs only while a face-anchored effect needs it/i);
    expect(help).toMatch(/nothing is stored or sent/i);
  });

  it('never uses a word the capture-affordance scan forbids', () => {
    const { controller, indicator, tickAt, layout } = build([faceBurstOnce]);
    const camera = layout.center.querySelector<HTMLElement>('[data-state]')!;
    controller.testTrigger(faceBurstOnce);
    tickAt(1016);
    const on = indicator.textContent ?? '';
    tickAt(1100);
    const finished = indicator.textContent ?? '';
    for (const text of [on, finished, camera.title]) {
      expect(text).not.toMatch(CAPTURE_LABELS);
    }
  });
});
