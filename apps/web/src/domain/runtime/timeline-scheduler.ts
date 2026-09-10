/**
 * Decides which timeline entries are active this frame, and how far through each is.
 *
 * **Absolute offsets** (FR-046). An entry is active from its own `atMs` until
 * `atMs + durationMs`, and no entry's position depends on any other's. That is the whole
 * of FR-047: moving one action on a timeline repositions nothing else, which is the
 * operation a timeline editor performs constantly.
 *
 * **Elapsed time, not frames** (FR-049). Everything below is a function of `elapsedMs`, so
 * an effect plays at the right speed on a 15 fps laptop and when frames are dropped.
 *
 * The scheduler knows nothing about specific action types — only their behaviour class —
 * which is what lets a new action be added without editing this file (FR-073).
 */

import type { TimelineEntry } from '../effects/types';
import type { ActionBehaviour } from './action-registry';

/** One entry that should produce output this frame. */
export interface ScheduledEntry {
  /** Index into the timeline's entries, so an anchor memory can be keyed by it. */
  readonly index: number;
  readonly entry: TimelineEntry;
  /** How far through this entry's own window, in `[0,1]`. */
  readonly progress: number;
  /** This entry's window length; `0` for an instantaneous entry. */
  readonly durationMs: number;
  /** `true` on the frame an instantaneous entry fires. */
  readonly justFired: boolean;
}

/** How long an entry occupies the timeline. */
export function entryDurationMs(entry: TimelineEntry, behaviour: ActionBehaviour): number {
  if (behaviour === 'instantaneous') {
    // `screen_flash` is instantaneous in *scheduling* — it fires once at its `atMs` — while
    // its `duration_ms` governs the decay curve it renders over. The distinction FR-048
    // draws between when an action starts and how long its output persists.
    return entry.durationMs ?? 0;
  }
  return entry.durationMs ?? 0;
}

/**
 * Select the entries active in `(previousElapsedMs, elapsedMs]`.
 *
 * @param behaviourOf Maps an entry to its registered behaviour class.
 * @param previousElapsedMs Elapsed time at the previous frame, so an instantaneous entry
 *   fires exactly once even when a frame is late and steps clean over its offset.
 */
export function scheduleEntries(
  entries: readonly TimelineEntry[],
  elapsedMs: number,
  previousElapsedMs: number,
  behaviourOf: (entry: TimelineEntry) => ActionBehaviour,
): readonly ScheduledEntry[] {
  const active: ScheduledEntry[] = [];

  entries.forEach((entry, index) => {
    const behaviour = behaviourOf(entry);
    const duration = entryDurationMs(entry, behaviour);

    if (behaviour === 'instantaneous') {
      // Fires when its offset falls inside this frame's interval. A dropped frame that
      // steps clean over the offset still fires it, rather than losing it silently.
      const fired = previousElapsedMs < entry.atMs && elapsedMs >= entry.atMs;
      // A zero-duration entry is scheduled on that frame and no other. A non-zero duration
      // keeps it scheduled through its window so it can render a decay — the FR-048
      // distinction between *when an action starts* and *how long its output persists*.
      const within = duration > 0 && elapsedMs >= entry.atMs && elapsedMs < entry.atMs + duration;
      if (fired || within) {
        active.push({
          index,
          entry,
          progress: duration === 0 ? 1 : clamp01((elapsedMs - entry.atMs) / duration),
          durationMs: duration,
          justFired: fired,
        });
      }
      return;
    }

    const end = entry.atMs + duration;
    if (elapsedMs < entry.atMs || elapsedMs >= end) {
      return;
    }
    active.push({
      index,
      entry,
      progress: duration === 0 ? 1 : clamp01((elapsedMs - entry.atMs) / duration),
      durationMs: duration,
      justFired: previousElapsedMs < entry.atMs,
    });
  });

  return active;
}

/** Whether a timeline has finished. */
export function timelineComplete(durationMs: number, elapsedMs: number): boolean {
  return elapsedMs >= durationMs;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
