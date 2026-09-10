/**
 * FR-050/FR-051: overlapping effects neither cancel nor corrupt one another.
 *
 * The failure being prevented is shared state — one playback's elapsed time, anchor
 * memory, or action scratch space leaking into another's. That failure looks like a subtle
 * visual glitch rather than an error, so it is asserted rather than watched for.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { DrawPolylineCommand, FillScreenCommand } from '../../src/domain/runtime/frame-output';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';
import { frameOf, spiralHand, translated } from '../support/hands';

const emptyFrame = landmarkFrame([], 0, 1280, 720);

const flashA = { type: 'screen_flash', params: { color: '#AA0000' } };
const flashB = { type: 'screen_flash', params: { color: '#00BB00' } };

describe('two effects overlapping', () => {
  it('both play, and both complete', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'a', poseId: 'p1', durationMs: 600, entries: [entry(0, flashA, 600)] }),
        effect({ id: 'b', poseId: 'p2', durationMs: 400, entries: [entry(0, flashB, 400)] }),
      ),
    );

    runtime.advance([poseEvent('confirmed', 'p1', 0)], emptyFrame, 0);
    const overlapping = runtime.advance([poseEvent('confirmed', 'p2', 200)], emptyFrame, 200);
    expect(overlapping.activePlaybacks).toBe(2);
    expect(overlapping.commands.map((c) => (c as FillScreenCommand).color)).toEqual([
      '#AA0000',
      '#00BB00',
    ]);

    // b ends at 600 (started at 200, 400 long); a ends at 600 too.
    expect(runtime.advance([], emptyFrame, 500).activePlaybacks).toBe(2);
    expect(runtime.advance([], emptyFrame, 601).activePlaybacks).toBe(0);
  });

  it('advances each by its own elapsed time, not a shared clock', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'a', poseId: 'p1', durationMs: 1000, entries: [entry(0, flashA, 1000)] }),
        effect({ id: 'b', poseId: 'p2', durationMs: 1000, entries: [entry(0, flashB, 1000)] }),
      ),
    );

    runtime.advance([poseEvent('confirmed', 'p1', 0)], emptyFrame, 0);
    runtime.advance([poseEvent('confirmed', 'p2', 500)], emptyFrame, 500);

    // At t=500 the first is halfway (decayed) and the second has just begun (full).
    const output = runtime.advance([], emptyFrame, 500);
    const [first, second] = output.commands as FillScreenCommand[];
    expect(first!.color).toBe('#AA0000');
    expect(second!.color).toBe('#00BB00');
    expect(second!.alpha).toBeGreaterThan(first!.alpha);
  });

  it('lets the shorter one finish without disturbing the longer one', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'long', poseId: 'p1', durationMs: 1000, entries: [entry(0, flashA, 1000)] }),
        effect({ id: 'short', poseId: 'p2', durationMs: 200, entries: [entry(0, flashB, 200)] }),
      ),
    );

    runtime.advance([poseEvent('confirmed', 'p1', 0)], emptyFrame, 0);
    runtime.advance([poseEvent('confirmed', 'p2', 100)], emptyFrame, 100);
    const after = runtime.advance([], emptyFrame, 400);

    expect(after.activePlaybacks).toBe(1);
    expect(after.commands).toHaveLength(1);
    expect((after.commands[0] as FillScreenCommand).color).toBe('#AA0000');
  });
});

describe('the same effect triggered twice', () => {
  it('runs two independent playbacks', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'a', poseId: 'p', durationMs: 800, entries: [entry(0, flashA, 800)] })),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    const second = runtime.advance([poseEvent('confirmed', 'p', 300)], emptyFrame, 300);

    expect(second.activePlaybacks).toBe(2);
    expect(second.commands).toHaveLength(2);
    // Different elapsed times, so different decay — proof they are not sharing state.
    const alphas = (second.commands as FillScreenCommand[]).map((c) => c.alpha);
    expect(alphas[0]).not.toBeCloseTo(alphas[1]!, 6);
  });

  it('gives each playback its own action state', () => {
    // Two trails, started at different times, must not share a point history — a shared
    // one would make the second trail begin with the first's tail already drawn.
    const trail = {
      type: 'landmark_trail',
      params: { anchor: { kind: 'landmark', hand: 'first', index: 8 }, length: 10 },
    };
    const runtime = runtimeFor(
      catalog(effect({ id: 'a', poseId: 'p', durationMs: 1000, entries: [entry(0, trail, 1000)] })),
    );

    const hand = spiralHand();
    let t = 0;
    runtime.advance([poseEvent('confirmed', 'p', 0)], frameOf([{ handedness: 'right', landmarks: hand }], 0), 0);
    for (let i = 1; i <= 5; i += 1) {
      t = i * 40;
      runtime.advance(
        [],
        frameOf([{ handedness: 'right', landmarks: translated(hand, i * 0.01, 0) }], t),
        t,
      );
    }

    const withSecond = runtime.advance(
      [poseEvent('confirmed', 'p', 240)],
      frameOf([{ handedness: 'right', landmarks: translated(hand, 0.06, 0) }], 240),
      240,
    );

    const polylines = withSecond.commands.filter(
      (c): c is DrawPolylineCommand => c.kind === 'drawPolyline',
    );
    // The older playback has a long tail; the new one has too few points to draw at all.
    expect(polylines).toHaveLength(1);
    expect(polylines[0]!.points.length).toBeGreaterThan(2);
  });
});

describe('resources', () => {
  it('releases a playback when its timeline completes (FR-051)', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'a', poseId: 'p', durationMs: 300, entries: [entry(0, flashA, 300)] })),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(runtime.activePlaybacks).toBe(1);
    runtime.advance([], emptyFrame, 301);
    expect(runtime.activePlaybacks).toBe(0);
  });
});
