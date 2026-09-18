/**
 * Pure resize-drag math for a dock split's boundary (spec 010 workspace UX corrections pass,
 * item 4 — FR-042). No DOM; `dock-layout.ts` is the only caller.
 */

import { describe, expect, it } from 'vitest';

import { equalSizes, resizeSplitSizes } from '../../src/presentation/editor/split-resize';

describe('equalSizes', () => {
  it('returns one equal weight per child', () => {
    expect(equalSizes(3)).toEqual([1, 1, 1]);
    expect(equalSizes(0)).toEqual([]);
    expect(equalSizes(-1)).toEqual([]);
  });
});

describe('resizeSplitSizes', () => {
  it('redistributes only the touched pair, leaving other siblings untouched', () => {
    const next = resizeSplitSizes([1, 1, 1], 0, 100, 300, 20);
    expect(next[2]).toBe(1);
    expect(next[0]! + next[1]!).toBeCloseTo(2, 5); // total weight of the touched pair is conserved
  });

  it('a zero delta leaves sizes numerically unchanged', () => {
    const sizes = [1, 1];
    const next = resizeSplitSizes(sizes, 0, 0, 200, 20);
    expect(next[0]).toBeCloseTo(1, 5);
    expect(next[1]).toBeCloseTo(1, 5);
  });

  it('growing one side shrinks its neighbor by the same pixel amount', () => {
    // Two equal children of a 200px container start at 100px each; +40px should land at 140/60.
    const next = resizeSplitSizes([1, 1], 0, 40, 200, 20);
    const total = next[0]! + next[1]!;
    const aPx = (next[0]! / total) * 200;
    const bPx = (next[1]! / total) * 200;
    expect(aPx).toBeCloseTo(140, 5);
    expect(bPx).toBeCloseTo(60, 5);
  });

  it('clamps so neither side drops below the minimum pixel size', () => {
    const next = resizeSplitSizes([1, 1], 0, 1000, 200, 20);
    const total = next[0]! + next[1]!;
    const aPx = (next[0]! / total) * 200;
    const bPx = (next[1]! / total) * 200;
    expect(bPx).toBeCloseTo(20, 5);
    expect(aPx).toBeCloseTo(180, 5);

    const shrunk = resizeSplitSizes([1, 1], 0, -1000, 200, 20);
    const shrunkTotal = shrunk[0]! + shrunk[1]!;
    expect((shrunk[0]! / shrunkTotal) * 200).toBeCloseTo(20, 5);
  });

  it('splits the pair evenly when the minimum cannot fit both sides', () => {
    // A 30px container can't give two 20px minimums to its pair — falls back to an even split.
    const next = resizeSplitSizes([1, 1], 0, 1000, 30, 20);
    const total = next[0]! + next[1]!;
    expect((next[0]! / total) * 30).toBeCloseTo(15, 5);
    expect((next[1]! / total) * 30).toBeCloseTo(15, 5);
  });

  it('returns sizes unchanged for an out-of-range index or non-positive container size', () => {
    expect(resizeSplitSizes([1, 1], 5, 10, 200, 20)).toEqual([1, 1]);
    expect(resizeSplitSizes([1, 1], -1, 10, 200, 20)).toEqual([1, 1]);
    expect(resizeSplitSizes([1, 1], 0, 10, 0, 20)).toEqual([1, 1]);
    expect(resizeSplitSizes([1, 1], 0, 10, -50, 20)).toEqual([1, 1]);
  });
});
