/**
 * Pure edge-detection geometry for a docking drop (spec 010 correction pass, item 2).
 *
 * Plain numbers, no DOM — the same reasoning `dock-tree.test.ts` documents for the tree
 * operations: the finer-grained thing `dock-layout.ts` needs to get right is easiest to prove
 * correct in isolation, with `dock-layout.test.ts` left to prove the wiring (one stubbed-rect
 * case) rather than every boundary.
 */

import { describe, expect, it } from 'vitest';

import { resolveDropRegion } from '../../src/presentation/editor/drop-region';

const SIZE = { width: 200, height: 100 };

describe('resolveDropRegion', () => {
  it('resolves the dead centre to "center"', () => {
    expect(resolveDropRegion(SIZE, 100, 50)).toBe('center');
  });

  it('resolves near the top edge to "top"', () => {
    expect(resolveDropRegion(SIZE, 100, 5)).toBe('top');
  });

  it('resolves near the bottom edge to "bottom"', () => {
    expect(resolveDropRegion(SIZE, 100, 95)).toBe('bottom');
  });

  it('resolves near the left edge to "left"', () => {
    expect(resolveDropRegion(SIZE, 5, 50)).toBe('left');
  });

  it('resolves near the right edge to "right"', () => {
    expect(resolveDropRegion(SIZE, 195, 50)).toBe('right');
  });

  it('a corner resolves to whichever edge it is proportionally closest to', () => {
    // Near the top-left corner of a wide, short rectangle — closer to the top edge than the
    // left one once the rectangle isn't square.
    expect(resolveDropRegion({ width: 200, height: 100 }, 8, 2)).toBe('top');
  });

  it('a zero-area rect always resolves to "center" (no meaningful edge to detect)', () => {
    expect(resolveDropRegion({ width: 0, height: 0 }, 0, 0)).toBe('center');
    expect(resolveDropRegion({ width: 0, height: 100 }, 50, 50)).toBe('center');
    expect(resolveDropRegion({ width: 100, height: 0 }, 50, 50)).toBe('center');
  });
});
