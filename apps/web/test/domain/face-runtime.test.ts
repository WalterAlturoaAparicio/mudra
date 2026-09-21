/**
 * The runtime side of face anchors (Spec 011 FR-004, 005, 015b, 016, 017, 029, 034, 035).
 *
 * The invariants under test are about *when a face is requested* and *what happens without one*:
 * the face source is called lazily, at most once per frame, only for a scheduled action with a
 * face anchor and an available capability — and an unavailable capability is inert and reported,
 * never simulated. The existing actions are used unmodified.
 */

import { describe, expect, it } from 'vitest';

import type { Action, ParamValue } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import type { FaceFrame, FaceFrameSource } from '../../src/domain/landmarks/face';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import type {
  DrawCirclesCommand,
  DrawPolylineCommand,
} from '../../src/domain/runtime/frame-output';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';
import { frameOf, spiralHand, translated } from '../support/hands';

const faceAvailable = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));
const faceUnavailable = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, false]]));
const noFaceEntry = new MapCapabilityRegistry(new Map());

/** A 1280x720 face whose landmark 1 is at (0.25 + shiftX, 0.6) and landmark 2 at (0.8, 0.3). */
function face(shiftX = 0): FaceFrame {
  const pts = Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({
    x: 0.1 + (i % 50) * 0.01,
    y: 0.1 + (i % 40) * 0.01,
    z: 0,
  }));
  pts[1] = { x: 0.25 + shiftX, y: 0.6, z: 0 };
  pts[2] = { x: 0.8, y: 0.3, z: 0 };
  return faceFrame(pts, 1, 1280, 720);
}

function countingSource(current: () => FaceFrame | null = () => face()): {
  source: FaceFrameSource;
  calls: () => number;
} {
  let n = 0;
  return {
    source: () => {
      n += 1;
      return current();
    },
    calls: () => n,
  };
}

const trail = (anchor: ParamValue): Action => ({
  type: 'landmark_trail',
  params: { anchor, color: '#6EE7F9', width: 5, length: 20 },
});
const burst = (anchor: ParamValue): Action => ({
  type: 'particle_burst',
  params: { anchor },
});

const hands = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);
/** The same hand a little to the right: a hand trail draws only once its anchor has moved. */
const handsMoved = frameOf(
  [{ handedness: 'right', landmarks: translated(spiralHand(), 0.05, 0) }],
  33,
);

function trailRuntime(anchor: ParamValue, capabilities = faceAvailable) {
  return runtimeFor(
    catalog(
      effect({
        id: 'e.t',
        poseId: 'p',
        durationMs: 4000,
        entries: [entry(0, trail(anchor), 4000)],
      }),
    ),
    { capabilities },
  );
}

describe('landmark_trail and particle_burst, unmodified, with a face anchor (FR-015b)', () => {
  it('a trail follows the face landmark frame after frame', () => {
    const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 });
    let shift = 0;
    const moving: FaceFrameSource = () => {
      shift += 0.02;
      return face(shift);
    };
    runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, moving);
    const output = runtime.advance([], hands, 33, null, moving);
    const line = output.commands.find((c): c is DrawPolylineCommand => c.kind === 'drawPolyline');

    // Two frames: x = (0.25 + 0.02) * 1280, then (0.25 + 0.04) * 1280; y fixed at 0.6 * 720.
    expect(line).toBeDefined();
    expect(line!.points).toHaveLength(2);
    expect(line!.points[0]!.x).toBeCloseTo(345.6, 6);
    expect(line!.points[1]!.x).toBeCloseTo(371.2, 6);
    expect(line!.points.every((p) => Math.abs(p.y - 432) < 1e-9)).toBe(true);
  });

  it('a burst fires with the face available on its single firing frame', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.b',
          poseId: 'p',
          durationMs: 800,
          entries: [entry(0, burst({ kind: 'faceLandmark', index: 2 }), 800)],
        }),
      ),
      { capabilities: faceAvailable },
    );
    const { source, calls } = countingSource();
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);

    expect(calls()).toBe(1); // asked for in the same advance that fires it
    const circles = output.commands.filter(
      (c): c is DrawCirclesCommand => c.kind === 'drawCircles',
    );
    expect(circles.length).toBeGreaterThan(0);
    expect(output.diagnostics).toEqual([]);
  });
});

describe('when a face is requested (FR-016, 017, 034)', () => {
  it('is not requested for hand or screen anchors, or for an action with no anchor', () => {
    const { source, calls } = countingSource();
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          durationMs: 1000,
          entries: [
            entry(0, trail({ kind: 'landmark', hand: 'first', index: 8 }), 1000),
            entry(0, burst({ kind: 'screen', x: 0.5, y: 0.5 }), 1000),
            entry(0, { type: 'screen_flash', params: { color: '#FFFFFF' } }),
          ],
        }),
      ),
      { capabilities: faceAvailable },
    );
    const first = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);
    runtime.advance([], hands, 40, null, source);
    expect(calls()).toBe(0);
    expect(first.faceTracking).toBe(false);
  });

  it('is requested at most once per advance however many face anchors are scheduled', () => {
    const { source, calls } = countingSource();
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          durationMs: 1000,
          entries: [
            entry(0, trail({ kind: 'faceLandmark', index: 1 }), 1000),
            entry(0, trail({ kind: 'faceLandmark', index: 2 }), 1000),
            entry(0, burst({ kind: 'faceLandmark', index: 2 }), 1000),
          ],
        }),
      ),
      { capabilities: faceAvailable },
    );
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);
    expect(calls()).toBe(1);
    expect(output.faceTracking).toBe(true);
    runtime.advance([], hands, 33, null, source);
    expect(calls()).toBe(2);
  });

  it('is not requested for a face anchor on an action not scheduled this frame', () => {
    const { source, calls } = countingSource();
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          durationMs: 2000,
          entries: [entry(1000, trail({ kind: 'faceLandmark', index: 1 }), 500)],
        }),
      ),
      { capabilities: faceAvailable },
    );
    const early = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);
    runtime.advance([], hands, 500, null, source);
    expect(calls()).toBe(0);
    expect(early.faceTracking).toBe(false);

    runtime.advance([], hands, 1000, null, source);
    expect(calls()).toBe(1); // the moment it is scheduled
    runtime.advance([], hands, 1600, null, source); // its window is over
    expect(calls()).toBe(1);
  });

  it('is no longer requested once the playback has been dropped', () => {
    const { source, calls } = countingSource();
    const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 });
    runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);
    expect(calls()).toBe(1);
    runtime.reset();
    const after = runtime.advance([], hands, 33, null, source);
    expect(calls()).toBe(1);
    expect(after.faceTracking).toBe(false);
  });

  it('a null source (no camera) leaves the face anchor unresolved and reported, without throwing', () => {
    const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 });
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, null);
    expect(output.commands).toEqual([]);
    expect(output.diagnostics).toEqual([
      {
        effectId: 'e.t',
        actionType: 'landmark_trail',
        reason: 'anchor_unresolved',
        detail: 'face is not in frame',
      },
    ]);
    expect(output.faceTracking).toBe(false);
  });

  it('a source that finds no face reports it, and analysis is still recorded as having run', () => {
    const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 });
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, () => null);
    expect(output.diagnostics[0]?.detail).toBe('face is not in frame');
    expect(output.faceTracking).toBe(true);
  });

  it('with no face argument at all, non-face effects behave as before', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          durationMs: 800,
          entries: [entry(0, trail({ kind: 'landmark', hand: 'first', index: 8 }), 800)],
        }),
      ),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0);
    const output = runtime.advance([], handsMoved, 33);
    expect(output.commands.some((c) => c.kind === 'drawPolyline')).toBe(true);
    expect(output.faceTracking).toBe(false);
  });
});

describe('when face_landmarks is unavailable (FR-004, 005, 035)', () => {
  for (const [label, capabilities] of [
    ['reported unavailable', faceUnavailable],
    ['not registered at all (public experience)', noFaceEntry],
  ] as const) {
    it(`is inert and reported, and never asks for a face — ${label}`, () => {
      const { source, calls } = countingSource();
      const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 }, capabilities);
      const output = runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, source);
      runtime.advance([], hands, 33, null, source);

      expect(output.commands).toEqual([]);
      expect(output.diagnostics).toEqual([
        {
          effectId: 'e.t',
          actionType: 'landmark_trail',
          reason: 'capability_unavailable',
          detail: FACE_LANDMARKS,
        },
      ]);
      expect(calls()).toBe(0);
      expect(output.faceTracking).toBe(false);
    });
  }

  it('lets a hand-anchored sibling keep working', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          durationMs: 1000,
          entries: [
            entry(0, trail({ kind: 'faceLandmark', index: 1 }), 1000),
            entry(0, trail({ kind: 'landmark', hand: 'first', index: 8 }), 1000),
          ],
        }),
      ),
      { capabilities: faceUnavailable },
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0);
    const output = runtime.advance([], handsMoved, 33);
    expect(output.diagnostics.filter((d) => d.reason === 'capability_unavailable')).toHaveLength(1);
    expect(output.commands.some((c) => c.kind === 'drawPolyline')).toBe(true);
  });
});

describe('the runtime does not hand a face back (FR-029, FR-030)', () => {
  it('returns only the documented fields, none of which holds face points', () => {
    const runtime = trailRuntime({ kind: 'faceLandmark', index: 1 });
    runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, () => face());
    const output = runtime.advance([], hands, 33, null, () => face());
    expect(Object.keys(output).sort()).toEqual(
      [
        'activePlaybacks',
        'audioCues',
        'commands',
        'diagnostics',
        'faceAnchors',
        'faceTracking',
        'firstCommands',
        'started',
      ].sort(),
    );
    // `faceAnchors` (dev diagnostics) is the resolved anchor point per action — never the face's
    // points. Its entries carry at most one derived point each.
    for (const trace of output.faceAnchors) {
      expect(Object.keys(trace).sort()).toEqual(
        ['actionType', 'effectId', 'landmarkIndex', 'point', 'resolved'].sort(),
      );
    }
  });
});
