/**
 * The quality gate before storage (FR-017, FR-018).
 *
 * These are Mudra Capture's rules, ported. The test names them the same way its Dart suite does, so
 * a future divergence between the two applications is visible as a diff rather than as a dataset
 * that quietly contains samples one of them would have rejected.
 */

import { describe, expect, it } from 'vitest';

import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import { explainRejection, validateFrame } from '../../src/domain/capture/validation';
import { frameWith, points } from '../support/capture';

describe('validateFrame', () => {
  it('accepts a one-handed pose given one hand', () => {
    expect(validateFrame(frameWith(1), 1)).toEqual({ accepted: true });
  });

  it('accepts a two-handed pose given two hands', () => {
    expect(validateFrame(frameWith(2), 2)).toEqual({ accepted: true });
  });

  it('accepts a one-handed pose given two hands', () => {
    // More hands than required is not a rejection: the pose is still performable.
    expect(validateFrame(frameWith(2), 1)).toEqual({ accepted: true });
  });

  it('rejects an empty frame as no_hands', () => {
    const empty = landmarkFrame([], 1000, 1280, 720);
    expect(validateFrame(empty, 1)).toEqual({ accepted: false, reason: 'no_hands' });
  });

  it('rejects one hand for a two-handed pose as insufficient_hands', () => {
    expect(validateFrame(frameWith(1), 2)).toEqual({
      accepted: false,
      reason: 'insufficient_hands',
    });
  });

  it('rejects a short hand as wrong_landmark_count', () => {
    // `handLandmarks` normally enforces 21, so this frame is built past it deliberately —
    // the validator must not assume an upstream guarantee it cannot see.
    const short = landmarkFrame(
      [{ handedness: 'right', confidence: 0.9, landmarks: { points: points().slice(0, 20) } }],
      1000,
      1280,
      720,
    );
    expect(validateFrame(short, 1)).toEqual({ accepted: false, reason: 'wrong_landmark_count' });
  });

  it('rejects a non-finite coordinate', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const corrupted = points();
      corrupted[7] = { x: bad, y: 0.5, z: 0 };
      const frame = landmarkFrame(
        [{ handedness: 'right', confidence: 0.9, landmarks: { points: corrupted } }],
        1000,
        1280,
        720,
      );
      expect(validateFrame(frame, 1)).toEqual({
        accepted: false,
        reason: 'non_finite_coordinates',
      });
    }
  });

  it('checks every hand, not only the first', () => {
    const good = frameWith(1).hands[0]!;
    const corrupted = points();
    corrupted[0] = { x: Number.NaN, y: 0, z: 0 };
    const frame = landmarkFrame(
      [good, { handedness: 'left', confidence: 0.9, landmarks: { points: corrupted } }],
      1000,
      1280,
      720,
    );
    expect(validateFrame(frame, 2)).toEqual({ accepted: false, reason: 'non_finite_coordinates' });
  });

  it('never judges whether the pose was the correct one (FR-025)', () => {
    // Any well-formed hand passes for any pose. Recognition is not this module's job — and
    // Capture Mode does none at all.
    expect(validateFrame(frameWith(1, 99), 1)).toEqual({ accepted: true });
    expect(validateFrame(frameWith(1, 500), 1)).toEqual({ accepted: true });
  });

  it('uses the engine’s landmark count, not a local literal', () => {
    expect(HAND_LANDMARK_COUNT).toBe(21);
  });
});

describe('explainRejection', () => {
  it('gives the operator a reason and a next step, never a raw error (FR-019, FR-071)', () => {
    expect(explainRejection('no_hands', 1)).toMatch(/No hands/);
    expect(explainRejection('insufficient_hands', 2)).toMatch(/needs 2 hands/);
    expect(explainRejection('wrong_landmark_count', 1)).toMatch(/partly detected/);
    expect(explainRejection('non_finite_coordinates', 1)).toMatch(/unusable reading/);
  });

  it('says nothing was recorded, in every case', () => {
    // The operator's first question after a failed take is always "did that save something?".
    for (const reason of [
      'no_hands',
      'insufficient_hands',
      'wrong_landmark_count',
      'non_finite_coordinates',
    ] as const) {
      expect(explainRejection(reason, 2)).toMatch(/nothing was recorded/i);
    }
  });
});
