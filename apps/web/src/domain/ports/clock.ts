/**
 * Time and identity, as interfaces (research D10).
 *
 * The domain must be testable with no browser (FR-060), and a serializer that reads the wall clock
 * or mints its own UUIDs cannot be compared against a golden fixture at all — every run would
 * produce a different document. So both sources of non-determinism are injected, and
 * `crypto.randomUUID()` and `new Date()` are constructed only in the composition root.
 *
 * The same discipline `Session` already applies with its injected `now`.
 */

/** Reads the current instant. */
export type Clock = () => Date;

/** Mints a new opaque identifier. Expected to be a UUID v4 in production. */
export type IdFactory = () => string;

/** The two together, as most capture collaborators need both. */
export interface CaptureTimeSource {
  readonly now: Clock;
  readonly newId: IdFactory;
}

/**
 * A fixed-instant, counting-id source for tests and for deterministic export.
 *
 * Exported from the domain rather than from a test helper because the archive writer's determinism
 * requirement (FR-049) makes "run this with the clock held still" a production concern, not only a
 * testing convenience.
 */
export function fixedTimeSource(instant: Date, idPrefix = 'id'): CaptureTimeSource {
  let counter = 0;
  return {
    now: () => new Date(instant.getTime()),
    newId: () => `${idPrefix}-${String(++counter).padStart(4, '0')}`,
  };
}
