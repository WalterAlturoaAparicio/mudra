/**
 * Timestamps in Engine's format, not JavaScript's (research D3).
 *
 * Every sample already in `datasets/poses/` carries Python's `datetime.isoformat()` output:
 * `2026-07-24T22:25:22.034556+00:00` — six fractional digits and an explicit `+00:00` offset.
 * JavaScript's `toISOString()` produces `2026-07-24T22:25:22.034Z` instead.
 *
 * Engine's serializer stores the field as an opaque string, so either form would load. Matching the
 * dataset's own convention costs one function and keeps a merged dataset uniform for anything that
 * sorts, parses or diffs it.
 *
 * The three padded zeros are honest rather than invented: browser wall-clock time is
 * millisecond-resolution, so the value says "known to the millisecond" and claims nothing more.
 */

/** Format an instant as Engine writes it: microsecond-padded UTC with an explicit offset. */
export function engineTimestamp(instant: Date): string {
  const iso = instant.toISOString(); // `YYYY-MM-DDTHH:MM:SS.mmmZ`
  return iso.slice(0, -1) + '000+00:00';
}

/** Seconds between two instants, as the schema's `countdown_seconds` expects. */
export function secondsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}
