import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIDDLE_FINGER_MCP, WRIST } from '../../src/domain/landmarks/topology';
import { handLandmarks } from '../../src/domain/landmarks/types';
import {
  NORMALIZATION_STRATEGY,
  NORMALIZATION_VERSION,
  normalize,
} from '../../src/domain/normalization/normalize';
import { linearHand, spiralHand, translated } from '../support/hands';

interface FixturePoint {
  x: number;
  y: number;
  z: number;
}

interface Fixture {
  strategy: string;
  version: string;
  origin_index: number;
  scale_index: number;
  tolerance: number;
  cases: { name: string; raw: FixturePoint[]; normalized: FixturePoint[] }[];
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/normalization_cases.json'), 'utf-8'),
) as Fixture;

describe('golden fixtures generated from Engine (FR-019)', () => {
  it('agrees with Engine on the convention itself', () => {
    expect(fixture.strategy).toBe(NORMALIZATION_STRATEGY);
    expect(fixture.version).toBe(NORMALIZATION_VERSION);
    expect(fixture.origin_index).toBe(WRIST);
    expect(fixture.scale_index).toBe(MIDDLE_FINGER_MCP);
  });

  it('covers the cases worth covering', () => {
    const names = fixture.cases.map((c) => c.name);
    expect(names).toContain('degenerate_span');
    expect(names).toContain('tiny_span');
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  for (const testCase of fixture.cases) {
    it(`reproduces Engine's output for "${testCase.name}" within ${fixture.tolerance}`, () => {
      const actual = normalize(handLandmarks(testCase.raw));
      expect(actual.points).toHaveLength(testCase.normalized.length);

      testCase.normalized.forEach((expected, index) => {
        const point = actual.points[index];
        expect(point).toBeDefined();
        // Absolute, not relative: JavaScript numbers *are* IEEE-754 doubles, so agreement
        // here should be at machine precision and a relative tolerance would let a real
        // divergence hide near zero — where the wrist always sits.
        expect(Math.abs(point!.x - expected.x)).toBeLessThanOrEqual(fixture.tolerance);
        expect(Math.abs(point!.y - expected.y)).toBeLessThanOrEqual(fixture.tolerance);
        expect(Math.abs(point!.z - expected.z)).toBeLessThanOrEqual(fixture.tolerance);
      });
    });
  }
});

describe('properties the fixtures do not state directly', () => {
  it('places the wrist exactly at the origin', () => {
    const normalized = normalize(spiralHand());
    expect(normalized.points[WRIST]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is translation invariant — the same shape moved is the same normalized hand', () => {
    const here = normalize(spiralHand());
    const there = normalize(translated(spiralHand(), 0.21, -0.13));
    here.points.forEach((point, index) => {
      const moved = there.points[index];
      expect(Math.abs(point.x - moved!.x)).toBeLessThan(1e-12);
      expect(Math.abs(point.y - moved!.y)).toBeLessThan(1e-12);
      expect(Math.abs(point.z - moved!.z)).toBeLessThan(1e-12);
    });
  });

  it('is scale invariant — the same shape nearer is the same normalized hand', () => {
    const near = normalize(linearHand(0, 1));
    const far = normalize(linearHand(0, 2.5));
    near.points.forEach((point, index) => {
      const scaled = far.points[index];
      expect(Math.abs(point.x - scaled!.x)).toBeLessThan(1e-12);
      expect(Math.abs(point.y - scaled!.y)).toBeLessThan(1e-12);
      expect(Math.abs(point.z - scaled!.z)).toBeLessThan(1e-12);
    });
  });

  it('does not mutate its input', () => {
    const hand = spiralHand();
    const before = JSON.stringify(hand.points);
    normalize(hand);
    expect(JSON.stringify(hand.points)).toBe(before);
  });
});
