/**
 * Anchors resolve centrally, and the unresolvable case behaves as documented (FR-061).
 *
 * The documented behaviour is specific and worth stating twice: **hold the last resolved
 * position; if there never was one, skip the action for that frame and report it.** Holding
 * is what stops a trail from snapping to the origin when a hand blinks out for two frames;
 * reporting is what stops "nothing happened" from being indistinguishable from a bug.
 */

import { describe, expect, it } from 'vitest';

import { AnchorResolver, anchorKey } from '../../src/domain/effects/anchor-resolver';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';
import { frameOf, spiralHand } from '../support/hands';

const withRight = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);
const withLeft = frameOf([{ handedness: 'left', landmarks: spiralHand(0.4) }], 0);
const empty = landmarkFrame([], 0, 1280, 720);

describe('screen anchors', () => {
  it('are normalized coordinates scaled to the surface, so a resize keeps them placed', () => {
    const resolver = new AnchorResolver();
    const small = landmarkFrame([], 0, 640, 480);
    const large = landmarkFrame([], 0, 1920, 1080);
    const anchor = { kind: 'screen', x: 0.25, y: 0.75 } as const;

    expect(resolver.resolve('a', anchor, small).point).toEqual({ x: 160, y: 360 });
    expect(resolver.resolve('a', anchor, large).point).toEqual({ x: 480, y: 810 });
  });

  it('resolve even with no hand in frame', () => {
    const resolver = new AnchorResolver();
    const result = resolver.resolve('a', { kind: 'screen', x: 0.5, y: 0.5 }, empty);
    expect(result.point).toEqual({ x: 640, y: 360 });
    expect(result.stale).toBe(false);
  });
});

describe('hand-centroid anchors', () => {
  it('sit inside the hand’s bounding box', () => {
    const resolver = new AnchorResolver();
    const result = resolver.resolve('a', { kind: 'handCentroid', hand: 'first' }, withRight);
    expect(result.point).not.toBeNull();

    const xs = withRight.hands[0]!.landmarks.points.map((p) => p.x * withRight.width);
    const ys = withRight.hands[0]!.landmarks.points.map((p) => p.y * withRight.height);
    expect(result.point!.x).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(result.point!.x).toBeLessThanOrEqual(Math.max(...xs));
    expect(result.point!.y).toBeGreaterThanOrEqual(Math.min(...ys));
    expect(result.point!.y).toBeLessThanOrEqual(Math.max(...ys));
  });

  it('select by handedness when asked for a specific hand', () => {
    const resolver = new AnchorResolver();
    expect(
      resolver.resolve('a', { kind: 'handCentroid', hand: 'left' }, withLeft).point,
    ).not.toBeNull();
    expect(
      resolver.resolve('b', { kind: 'handCentroid', hand: 'left' }, withRight).unresolvedDetail,
    ).toMatch(/hand "left" is not in frame/);
  });
});

describe('landmark anchors', () => {
  it('resolve to that landmark, scaled to the surface', () => {
    const resolver = new AnchorResolver();
    const result = resolver.resolve('a', { kind: 'landmark', hand: 'first', index: 8 }, withRight);
    const landmark = withRight.hands[0]!.landmarks.points[8]!;
    expect(result.point).toEqual({
      x: landmark.x * withRight.width,
      y: landmark.y * withRight.height,
    });
  });

  it('report an index that does not exist rather than returning a wrong point', () => {
    const resolver = new AnchorResolver();
    const result = resolver.resolve('a', { kind: 'landmark', hand: 'first', index: 99 }, withRight);
    expect(result.point).toBeNull();
    expect(result.unresolvedDetail).toMatch(/landmark 99/);
  });
});

describe('the unresolvable case (FR-061)', () => {
  it('holds the last resolved position when the hand leaves frame', () => {
    const resolver = new AnchorResolver();
    const anchor = { kind: 'handCentroid', hand: 'first' } as const;

    const first = resolver.resolve('a', anchor, withRight);
    expect(first.stale).toBe(false);

    const gone = resolver.resolve('a', anchor, empty);
    expect(gone.point).toEqual(first.point);
    expect(gone.stale).toBe(true);
  });

  it('reports it when there is no position to hold', () => {
    const resolver = new AnchorResolver();
    const result = resolver.resolve('a', { kind: 'handCentroid', hand: 'first' }, empty);
    expect(result.point).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.unresolvedDetail).toBeDefined();
  });

  it('keeps separate memories per key, so two anchors never share a position', () => {
    const resolver = new AnchorResolver();
    resolver.resolve(anchorKey(0, 'anchor'), { kind: 'handCentroid', hand: 'right' }, withRight);
    const other = resolver.resolve(
      anchorKey(1, 'anchor'),
      { kind: 'handCentroid', hand: 'left' },
      empty,
    );
    expect(other.point).toBeNull();
  });

  it('forgets everything on clear, so a re-trigger starts clean', () => {
    const resolver = new AnchorResolver();
    const anchor = { kind: 'handCentroid', hand: 'first' } as const;
    resolver.resolve('a', anchor, withRight);
    resolver.clear();
    expect(resolver.resolve('a', anchor, empty).point).toBeNull();
  });
});

describe('through the runtime', () => {
  it('skips the action and reports the reason when the anchor never resolved', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.burst',
          poseId: 'p',
          durationMs: 400,
          entries: [
            entry(
              0,
              {
                type: 'particle_burst',
                params: { count: 5, anchor: { kind: 'handCentroid', hand: 'left' } },
              },
              400,
            ),
          ],
        }),
      ),
    );

    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], empty, 0);
    expect(output.commands).toEqual([]);
    expect(output.diagnostics).toEqual([
      {
        effectId: 'e.burst',
        actionType: 'particle_burst',
        reason: 'anchor_unresolved',
        detail: 'hand "left" is not in frame',
      },
    ]);
  });

  it('carries on with the held position once the hand has been seen', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.burst',
          poseId: 'p',
          durationMs: 400,
          entries: [
            entry(
              0,
              {
                type: 'particle_burst',
                params: { count: 5, anchor: { kind: 'handCentroid', hand: 'right' } },
              },
              400,
            ),
          ],
        }),
      ),
    );

    const seen = runtime.advance([poseEvent('confirmed', 'p', 0)], withRight, 0);
    expect(seen.commands).toHaveLength(1);

    const lost = runtime.advance([], empty, 100);
    expect(lost.commands).toHaveLength(1);
    expect(lost.diagnostics).toEqual([]);
  });
});
