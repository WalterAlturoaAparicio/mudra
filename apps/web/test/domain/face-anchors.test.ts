/**
 * Face-landmark anchors resolve through the one central resolver (Spec 011 FR-014, 015, 015c, 036).
 *
 * The fixture is deliberately asymmetric so a horizontal *or* vertical flip changes the answer:
 * landmark 1 sits left of and below landmark 2. The expected pixels are stated, not computed
 * from the code under test.
 */

import { describe, expect, it } from 'vitest';

import { AnchorResolver } from '../../src/domain/effects/anchor-resolver';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import { frameOf, spiralHand } from '../support/hands';

/** 1280x720 face whose landmarks 1 and 2 are known; every other landmark is distinct. */
function asymmetricFace() {
  const pts = Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({
    x: 0.05 + (i % 90) * 0.01,
    y: 0.05 + (i % 70) * 0.01,
    z: 0,
  }));
  pts[1] = { x: 0.25, y: 0.6, z: 0 };
  pts[2] = { x: 0.8, y: 0.3, z: 0 };
  return faceFrame(pts, 100, 1280, 720);
}

const noHands = landmarkFrame([], 0, 1280, 720);

describe('a face landmark anchor', () => {
  it('resolves to the landmark scaled by the face surface size, without any flip', () => {
    const resolver = new AnchorResolver();
    const face = asymmetricFace();

    const one = resolver.resolve('a', { kind: 'faceLandmark', index: 1 }, noHands, face);
    const two = resolver.resolve('b', { kind: 'faceLandmark', index: 2 }, noHands, face);

    expect(one.point).toEqual({ x: 320, y: 432 });
    expect(two.point).toEqual({ x: 1024, y: 216 });
    // A horizontal flip would reverse this; a vertical flip would reverse the next.
    expect(one.point!.x).toBeLessThan(two.point!.x);
    expect(one.point!.y).toBeGreaterThan(two.point!.y);
    expect(one.stale).toBe(false);
  });

  it('is independent of the hand frame it is given', () => {
    const face = asymmetricFace();
    const withHand = frameOf([{ handedness: 'left', landmarks: spiralHand(3) }], 0);
    const a = new AnchorResolver().resolve('k', { kind: 'faceLandmark', index: 1 }, noHands, face);
    const b = new AnchorResolver().resolve('k', { kind: 'faceLandmark', index: 1 }, withHand, face);
    expect(a.point).toEqual(b.point);
  });

  it('with no face this frame holds the last resolved position', () => {
    const resolver = new AnchorResolver();
    resolver.resolve('k', { kind: 'faceLandmark', index: 1 }, noHands, asymmetricFace());
    const lost = resolver.resolve('k', { kind: 'faceLandmark', index: 1 }, noHands, null);
    expect(lost.point).toEqual({ x: 320, y: 432 });
    expect(lost.stale).toBe(true);
  });

  it('with no face and never resolved, has no point and says why', () => {
    const missing = new AnchorResolver().resolve('k', { kind: 'faceLandmark', index: 1 }, noHands);
    expect(missing.point).toBeNull();
    expect(missing.unresolvedDetail).toBe('face is not in frame');
  });

  it('an index the detected face lacks resolves to no point — never clamped, wrapped or remapped', () => {
    const face = asymmetricFace();
    for (const index of [FACE_LANDMARK_COUNT, FACE_LANDMARK_COUNT + 1, 100000]) {
      const result = new AnchorResolver().resolve(
        'k',
        { kind: 'faceLandmark', index },
        noHands,
        face,
      );
      expect(result.point).toBeNull();
      expect(result.unresolvedDetail).toBe('face landmark ' + index + ' does not exist');
    }
  });

  it('keeps separate memories for separate anchors', () => {
    const resolver = new AnchorResolver();
    const face = asymmetricFace();
    resolver.resolve('one', { kind: 'faceLandmark', index: 1 }, noHands, face);
    resolver.resolve('two', { kind: 'faceLandmark', index: 2 }, noHands, face);
    expect(
      resolver.resolve('one', { kind: 'faceLandmark', index: 1 }, noHands, null).point,
    ).toEqual({ x: 320, y: 432 });
    expect(
      resolver.resolve('two', { kind: 'faceLandmark', index: 2 }, noHands, null).point,
    ).toEqual({ x: 1024, y: 216 });
  });

  it('leaves screen anchors unchanged (the face argument is ignored)', () => {
    const point = new AnchorResolver().resolve(
      'k',
      { kind: 'screen', x: 0.5, y: 0.25 },
      noHands,
      asymmetricFace(),
    ).point;
    expect(point).toEqual({ x: 640, y: 180 });
  });
});
