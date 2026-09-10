/**
 * The third behaviour class: an action re-resolved against live state every frame.
 *
 * A trail is the honest test of it. If continuous actions were secretly duration actions
 * with a recorded path, a trail would still *look* fine on the frame it started and would
 * stop following the hand immediately after — so the assertions below are about successive
 * frames, not about one.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { DrawPolylineCommand } from '../../src/domain/runtime/frame-output';
import { landmarkTrailAction } from '../../src/domain/runtime/actions/landmark-trail';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';
import { frameOf, spiralHand, translated } from '../support/hands';

const trail = {
  type: 'landmark_trail',
  params: {
    anchor: { kind: 'landmark', hand: 'first', index: 8 },
    color: '#6EE7F9',
    width: 5,
    length: 20,
  },
};

const hand = spiralHand();

/** Advance a trail across `steps` frames with the hand drifting right each time. */
function runTrail(steps: number, length = 20) {
  const runtime = runtimeFor(
    catalog(
      effect({
        id: 'e.trail',
        poseId: 'p',
        durationMs: 4000,
        entries: [entry(0, { ...trail, params: { ...trail.params, length } }, 4000)],
      }),
    ),
  );

  const polylines: DrawPolylineCommand[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i * 33;
    const frame = frameOf([{ handedness: 'right', landmarks: translated(hand, i * 0.02, 0) }], t);
    const output =
      i === 0
        ? runtime.advance([poseEvent('confirmed', 'p', 0)], frame, 0)
        : runtime.advance([], frame, t);
    const line = output.commands.find(
      (c): c is DrawPolylineCommand => c.kind === 'drawPolyline',
    );
    if (line !== undefined) {
      polylines.push(line);
    }
  }
  return polylines;
}

describe('landmark_trail', () => {
  it('is registered as continuous', () => {
    expect(landmarkTrailAction.behaviour).toBe('continuous');
  });

  it('draws nothing from a single frame — a trail needs a history', () => {
    expect(runTrail(1)).toHaveLength(0);
  });

  it('grows as frames arrive', () => {
    const lines = runTrail(6);
    expect(lines.length).toBeGreaterThan(0);
    const lengths = lines.map((line) => line.points.length);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1]!);
    }
  });

  it('tracks the moving landmark rather than replaying a fixed path', () => {
    const lines = runTrail(8);
    const last = lines[lines.length - 1]!;
    const head = last.points[last.points.length - 1]!;
    const tail = last.points[0]!;
    // The hand drifts right, so the newest point must be to the right of the oldest.
    expect(head.x).toBeGreaterThan(tail.x);
  });

  it('honours its configured length, discarding the oldest points', () => {
    const lines = runTrail(30, 6);
    const last = lines[lines.length - 1]!;
    expect(last.points.length).toBeLessThanOrEqual(6);
  });

  it('does not record a duplicate point for a stationary hand', () => {
    // Without this, a still hand fills the whole history with one position and the trail
    // disappears the instant it moves again.
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 4000, entries: [entry(0, trail, 4000)] })),
    );
    const still = frameOf([{ handedness: 'right', landmarks: hand }], 0);
    runtime.advance([poseEvent('confirmed', 'p', 0)], still, 0);
    for (let i = 1; i < 10; i += 1) {
      runtime.advance([], frameOf([{ handedness: 'right', landmarks: hand }], i * 33), i * 33);
    }
    const output = runtime.advance(
      [],
      frameOf([{ handedness: 'right', landmarks: translated(hand, 0.1, 0) }], 400),
      400,
    );
    const line = output.commands.find((c): c is DrawPolylineCommand => c.kind === 'drawPolyline')!;
    expect(line.points).toHaveLength(2);
  });

  it('stops when the hand leaves and nothing was ever resolved', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 2000, entries: [entry(0, trail, 2000)] })),
    );
    const output = runtime.advance(
      [poseEvent('confirmed', 'p', 0)],
      landmarkFrame([], 0, 1280, 720),
      0,
    );
    expect(output.commands).toEqual([]);
    expect(output.diagnostics[0]!.reason).toBe('anchor_unresolved');
  });
});
