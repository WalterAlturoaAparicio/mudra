/**
 * Effect isolation during editing — the "editing scope" (FR-024 – FR-029, research D8).
 *
 * While an effect is selected for editing, a live-detected pose belonging to a *different*,
 * unselected effect must not start that effect's playback in the editor (spec 010, User Story
 * 1). The mechanism is this one pure filter: the editor's own `EffectRuntime` instance is
 * handed a catalog containing at most the selected effect, through the exact same
 * `setCatalog()` call site (`EditorShell.pushCatalog()`) that already exists — `EffectRuntime`
 * itself is never modified, and the public-facing default experience's own, separate runtime
 * instance never calls this function at all, which is what makes this feature's isolation
 * scoped to the editor alone by construction rather than by convention.
 */

import type { EffectCatalog } from '../effects/types';

/**
 * The catalog the editor's runtime should see: at most one effect, the one currently selected.
 *
 * @returns a catalog with the named effect, if it exists, or an empty catalog otherwise —
 *   never a throw. An unmatched or absent `selectedEffectId` is exactly the "nothing is being
 *   edited" state, not an error.
 */
export function isolatedCatalog(
  catalog: EffectCatalog,
  selectedEffectId: string | null,
): EffectCatalog {
  const selected = catalog.effects.find((effect) => effect.id === selectedEffectId);
  return {
    version: catalog.version,
    effects: selected === undefined ? [] : [selected],
  };
}
