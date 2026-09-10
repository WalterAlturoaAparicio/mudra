/**
 * Softmax confidence over negated distances (FR-025).
 *
 * Max-subtracted, which is not a micro-optimization: raw distances here run to several
 * tens, so `exp(-d/T)` on the un-shifted scores underflows to zero for every candidate at
 * a small temperature and the normalization becomes `0/0`. Subtracting the maximum makes
 * the largest term exactly `exp(0) = 1` and leaves the result mathematically identical.
 *
 * **What a confidence means.** Softmax normalizes across the candidate set it is given, so
 * a confidence is only meaningful relative to that set (research D11): 0.7 among four
 * poses is not the same claim as 0.7 among seventeen. This is a property of softmax, not a
 * modification of it — which is exactly why anything that displays a confidence must
 * display the active pose set beside it (FR-024c).
 */

/**
 * Convert distances to confidences summing to 1.
 *
 * @param distances Raw weighted distances; lower is better.
 * @param temperature Softmax temperature. Larger values flatten the distribution.
 * @returns One confidence per input, in input order. Empty in, empty out.
 */
export function softmaxConfidence(
  distances: readonly number[],
  temperature: number,
): readonly number[] {
  if (distances.length === 0) {
    return [];
  }
  if (!(temperature > 0)) {
    throw new RangeError('Softmax temperature must be positive, got ' + temperature + '.');
  }

  const scores = distances.map((distance) => -distance / temperature);
  let max = Number.NEGATIVE_INFINITY;
  for (const score of scores) {
    if (score > max) {
      max = score;
    }
  }

  const exponentials = scores.map((score) => Math.exp(score - max));
  let total = 0;
  for (const value of exponentials) {
    total += value;
  }
  if (total === 0 || !Number.isFinite(total)) {
    // Unreachable after max-subtraction (the largest term is exactly 1), but a silent NaN
    // here would propagate into every gate downstream, so it is spent as a uniform answer.
    return distances.map(() => 1 / distances.length);
  }
  return exponentials.map((value) => value / total);
}
