/**
 * Building the one-clip effect "Play Selected" plays (item 15).
 *
 * The three playback operations the editor offers are genuinely different questions, and this
 * file exists so the third one stays data rather than a special case in the runtime:
 *
 * - **Play** — start this effect's whole timeline. `EffectRuntime.startEffect(id)`.
 * - **Play Selected** — start *only* the selected clip, from zero. This function builds an
 *   `EffectDefinition` containing that clip alone, rebased to `atMs: 0`, and the runtime
 *   plays it exactly as it plays any other definition.
 * - **Test Trigger** — inject the `PoseEvent` this effect's trigger listens for and let the
 *   runtime decide what fires, conditions and all. Nothing here is involved.
 *
 * Rebasing to zero is the point of "selected": a clip authored to start 900 ms in should
 * preview immediately, not after nine tenths of a second of nothing. Its own `durationMs` is
 * preserved exactly, so what plays is the clip as authored, only earlier.
 */

import type { EffectDefinition } from '../effects/types';

/** How the synthetic definition's id is derived, so a preview is identifiable in diagnostics. */
export const SELECTED_CLIP_ID_SUFFIX = '#clip';

/**
 * An effect containing only `entryIndex`'s clip, rebased to start immediately.
 *
 * @returns `null` when the index names no entry — the caller disables the command rather than
 *   playing something empty.
 */
export function selectedClipEffect(
  effect: EffectDefinition,
  entryIndex: number,
): EffectDefinition | null {
  const entry = effect.timeline.entries[entryIndex];
  if (entry === undefined) {
    return null;
  }
  const rebased = { ...entry, atMs: 0 };
  return {
    ...effect,
    id: effect.id + SELECTED_CLIP_ID_SUFFIX,
    timeline: {
      durationMs: Math.max(1, rebased.durationMs ?? 0),
      entries: [rebased],
    },
  };
}
