/**
 * Which edge of a rectangle a point falls closest to (spec 010 correction pass, item 2).
 *
 * Pure geometry, no DOM: `dock-layout.ts` supplies a hovered leaf's `getBoundingClientRect()`
 * width/height and the pointer's `clientX`/`clientY` relative to that rect's origin. Kept as its
 * own file, rather than inlined into the drag handler, so the edge math is unit-testable with
 * plain numbers and so a zero-area rect (jsdom's default, untouched `getBoundingClientRect()`)
 * has one well-defined answer — `'center'` — instead of dividing by zero or picking arbitrarily.
 *
 * The four edge bands are each a fixed fraction of the shorter dimension, capped so a very wide
 * or very tall target still has a meaningfully-sized centre band rather than the edges meeting in
 * the middle.
 */

/** Where a drop lands relative to the hovered leaf: a new adjacent area, or its tab group. */
export type DropRegion = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** How much of the shorter dimension each edge band claims. */
const EDGE_FRACTION = 0.3;

/**
 * Resolve which region of a `width`×`height` rectangle the point `(x, y)` — already relative to
 * the rectangle's own top-left corner — falls into.
 *
 * A rectangle with no area (either dimension `<= 0`) always resolves to `'center'`: there is no
 * meaningful edge to detect, and treating it as "merge as a tab" is the safer, less surprising
 * default (this is also what makes an un-stubbed jsdom rect behave sensibly in a test).
 */
export function resolveDropRegion(
  size: { width: number; height: number },
  x: number,
  y: number,
): DropRegion {
  const { width, height } = size;
  if (width <= 0 || height <= 0) {
    return 'center';
  }

  const edge = EDGE_FRACTION * Math.min(width, height);
  const nearLeft = x < edge;
  const nearRight = x > width - edge;
  const nearTop = y < edge;
  const nearBottom = y > height - edge;

  if (!nearLeft && !nearRight && !nearTop && !nearBottom) {
    return 'center';
  }

  // Whichever edge the point is proportionally closest to wins, so a corner resolves to the
  // more prominent side rather than always favouring top/bottom or always left/right.
  const distances: readonly [DropRegion, number][] = [
    ['top', y],
    ['bottom', height - y],
    ['left', x],
    ['right', width - x],
  ];
  const candidates = distances.filter(
    ([region]) =>
      (region === 'top' && nearTop) ||
      (region === 'bottom' && nearBottom) ||
      (region === 'left' && nearLeft) ||
      (region === 'right' && nearRight),
  );
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]![0];
}
