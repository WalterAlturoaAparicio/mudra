/**
 * The 21-landmark invariant and hand-skeleton topology (T012).
 *
 * `HandLandmarks` is the shape every later stage — normalization, matching, drawing —
 * trusts without re-checking. If a short or long point list slipped past construction, the
 * failure would surface far downstream (a wrong distance, a misdrawn connector) with no
 * trace back to where the count went wrong. This file asserts the boundary throws instead,
 * and that the fixed skeleton `HAND_CONNECTIONS` draws only names points that exist.
 */

import { describe, expect, it } from 'vitest';

import {
  HAND_CONNECTIONS,
  FINGERTIPS,
  HAND_LANDMARK_COUNT,
  LandmarkIndex,
  MIDDLE_FINGER_MCP,
  WRIST,
} from '../../src/domain/landmarks/topology';
import {
  LandmarkError,
  handLandmarks,
  handObservation,
  landmarkFrame,
} from '../../src/domain/landmarks/types';

function points(count: number): { x: number; y: number; z: number }[] {
  return Array.from({ length: count }, (_, i) => ({ x: i / 21, y: i / 21, z: 0 }));
}

describe('the 21-landmark invariant', () => {
  it('accepts exactly 21 points', () => {
    const landmarks = handLandmarks(points(HAND_LANDMARK_COUNT));
    expect(landmarks.points).toHaveLength(21);
  });

  it('rejects fewer than 21 points', () => {
    expect(() => handLandmarks(points(20))).toThrow(LandmarkError);
  });

  it('rejects more than 21 points', () => {
    expect(() => handLandmarks(points(22))).toThrow(LandmarkError);
  });

  it('rejects zero points rather than treating an empty hand as valid', () => {
    expect(() => handLandmarks([])).toThrow(LandmarkError);
  });

  it('names the actual and expected counts in the error, not just that one was wrong', () => {
    expect(() => handLandmarks(points(5))).toThrow(/21.*5|5.*21/);
  });
});

describe('handedness confidence', () => {
  it('accepts the boundary values 0 and 1', () => {
    const landmarks = handLandmarks(points(HAND_LANDMARK_COUNT));
    expect(handObservation('left', 0, landmarks).confidence).toBe(0);
    expect(handObservation('right', 1, landmarks).confidence).toBe(1);
  });

  it('rejects a confidence outside [0,1]', () => {
    const landmarks = handLandmarks(points(HAND_LANDMARK_COUNT));
    expect(() => handObservation('left', -0.01, landmarks)).toThrow(LandmarkError);
    expect(() => handObservation('left', 1.01, landmarks)).toThrow(LandmarkError);
  });

  it('rejects a non-finite confidence', () => {
    const landmarks = handLandmarks(points(HAND_LANDMARK_COUNT));
    expect(() => handObservation('left', Number.NaN, landmarks)).toThrow(LandmarkError);
    expect(() => handObservation('left', Number.POSITIVE_INFINITY, landmarks)).toThrow(
      LandmarkError,
    );
  });
});

describe('a LandmarkFrame is emitted for every frame, hands or not (FR-015)', () => {
  it('accepts zero hands as a valid, meaningful frame', () => {
    const frame = landmarkFrame([], 1000, 1280, 720);
    expect(frame.hands).toHaveLength(0);
  });

  it('carries one hand through unchanged', () => {
    const landmarks = handLandmarks(points(HAND_LANDMARK_COUNT));
    const hand = handObservation('right', 0.9, landmarks);
    const frame = landmarkFrame([hand], 1000, 1280, 720);
    expect(frame.hands).toEqual([hand]);
  });
});

describe('hand skeleton topology edge validity', () => {
  it('names exactly 21 unique landmark indices, covering 0..20', () => {
    const indices = Object.values(LandmarkIndex);
    expect(new Set(indices).size).toBe(HAND_LANDMARK_COUNT);
    expect([...indices].sort((a, b) => a - b)).toEqual(
      Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) => i),
    );
  });

  it('every connection references two valid, distinct landmark indices', () => {
    for (const [start, end] of HAND_CONNECTIONS) {
      expect(Number.isInteger(start)).toBe(true);
      expect(Number.isInteger(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(HAND_LANDMARK_COUNT);
      expect(end).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThan(HAND_LANDMARK_COUNT);
      expect(start).not.toBe(end);
    }
  });

  it('has no duplicate connection, in either direction', () => {
    const seen = new Set<string>();
    for (const [start, end] of HAND_CONNECTIONS) {
      const key = [start, end].sort((a, b) => a - b).join('-');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('reaches every landmark from the wrist through some path of connections', () => {
    const adjacency = new Map<number, number[]>();
    for (const [start, end] of HAND_CONNECTIONS) {
      (adjacency.get(start) ?? adjacency.set(start, []).get(start)!).push(end);
      (adjacency.get(end) ?? adjacency.set(end, []).get(end)!).push(start);
    }
    const visited = new Set<number>([WRIST]);
    const queue = [WRIST];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    expect(visited.size).toBe(HAND_LANDMARK_COUNT);
  });

  it('every fingertip is a valid, distinct landmark index', () => {
    expect(new Set(FINGERTIPS).size).toBe(FINGERTIPS.length);
    for (const tip of FINGERTIPS) {
      expect(tip).toBeGreaterThanOrEqual(0);
      expect(tip).toBeLessThan(HAND_LANDMARK_COUNT);
    }
  });

  it('the normalization origin and scale reference are the wrist and middle-MCP', () => {
    expect(WRIST).toBe(LandmarkIndex.WRIST);
    expect(MIDDLE_FINGER_MCP).toBe(LandmarkIndex.MIDDLE_MCP);
    expect(WRIST).not.toBe(MIDDLE_FINGER_MCP);
  });
});
