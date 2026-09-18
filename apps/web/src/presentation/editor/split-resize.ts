/**
 * The pixel math behind resizing the boundary between two directly-adjacent children of a dock
 * split (spec 010 workspace UX corrections pass, item 4 — FR-042).
 *
 * Pure geometry/arithmetic, no DOM — mirrors `drop-region.ts`'s style: `dock-layout.ts` reads a
 * split's container size once, at the start of a resize drag (`pointerdown`), and this module
 * turns a pointer-delta into a new `sizes` array for every later `pointermove`, without any
 * further layout read interleaved into the drag (the same "write, don't re-read" discipline the
 * file's existing three whole-region splitters already follow).
 *
 * A `sizes` array is a set of relative weights, not pixels — `containerSizePx` is what converts
 * between the two so a minimum pixel size can be enforced. Resizing only ever touches the two
 * children sharing the dragged boundary (`index` and `index + 1`); every other child's weight is
 * left exactly as it was.
 */

/**
 * Redistribute weight between `sizes[index]` and `sizes[index + 1]` by `deltaPx` (positive grows
 * `index`, shrinks `index + 1`), clamped so neither child's resulting pixel share — computed
 * against `containerSizePx`, the split's total size along its resize axis — drops below `minPx`.
 *
 * Returns `sizes` unchanged (same values, new array) if `index`/`index + 1` are out of range, or
 * if `containerSizePx` is non-positive (nothing meaningful to redistribute against) — never
 * throws, matching `dock-tree.ts`'s own tolerance for a drag whose target has stopped making
 * sense.
 */
export function resizeSplitSizes(
  sizes: readonly number[],
  index: number,
  deltaPx: number,
  containerSizePx: number,
  minPx: number,
): readonly number[] {
  if (index < 0 || index + 1 >= sizes.length || containerSizePx <= 0) {
    return [...sizes];
  }

  const total = sizes.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return [...sizes];
  }

  const pairWeight = sizes[index]! + sizes[index + 1]!;
  const pairPx = (pairWeight / total) * containerSizePx;
  // The smaller of "the two siblings' own combined space" and "the whole container's floor" —
  // when the pair itself can't fit two minimums, split it evenly rather than clamping to an
  // unsatisfiable minimum on each side.
  const minPairPx = Math.min(minPx, pairPx / 2);

  const currentAPx = (sizes[index]! / total) * containerSizePx;
  const nextAPx = Math.min(Math.max(currentAPx + deltaPx, minPairPx), pairPx - minPairPx);
  const nextBPx = pairPx - nextAPx;

  // Convert the clamped pixel split back to weights in the same units the rest of `sizes` uses
  // (weight-per-container-pixel, held constant from the unaffected entries).
  const unitWeightPerPx = total / containerSizePx;
  const next = [...sizes];
  next[index] = nextAPx * unitWeightPerPx;
  next[index + 1] = nextBPx * unitWeightPerPx;
  return next;
}

/** An equal-share `sizes` array for `count` children — what a split with `sizes` absent behaves
 *  as, made explicit for a resize drag's starting point. */
export function equalSizes(count: number): readonly number[] {
  return Array.from({ length: Math.max(count, 0) }, () => 1);
}
