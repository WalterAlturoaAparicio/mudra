/**
 * Pure, immutable edits over a `Project`'s effect catalog (contracts/editor-runtime-boundary.md).
 *
 * Every function here takes a `Project` and returns a **new** one — nothing is mutated in
 * place, matching the immutable-value-object discipline the rest of the domain already
 * follows. This is what `presentation/editor/**` calls to author data; it contains no DOM
 * reference and no drawing call, and is fully testable in Node (FR-003, FR-004).
 *
 * A timeline's own `durationMs` invariant (must be at least as long as its contents —
 * `catalog-loader.ts`'s `parseTimeline` rule) is maintained here on every edit, so the
 * `Project` these functions produce is always immediately loadable by that same loader —
 * the property SC-008 depends on.
 */

import type {
  EffectDefinition,
  ParamValue,
  Timeline,
  TimelineEntry,
  Trigger,
} from '../effects/types';
import type { Project } from './types';

/** Find one effect by id, or `undefined`. */
export function findEffect(project: Project, effectId: string): EffectDefinition | undefined {
  return project.catalog.effects.find((effect) => effect.id === effectId);
}

/**
 * Build a brand-new, empty effect for `project` — a unique, stable id and a valid default
 * trigger, both derived from `project`'s own current contents rather than from a page-load-scoped
 * counter (P0.1b).
 *
 * The id is `effect-N`, `N` one past the highest existing count, stepped past any collision —
 * never a module-level counter that resets on every page load and so has no idea a loaded
 * project already contains `effect-1`. `withEffect`/`replaceEffect` below treats a matching id
 * as an *update*, not a duplicate, so a colliding id would not fail loudly — it would silently
 * overwrite the earlier effect. Deriving the id from the project itself makes that
 * unrepresentable, whichever project happens to be open.
 *
 * @param poses The dataset's known poses (only `poseId` is read), so the effect's trigger names
 *   a real pose immediately — `catalog-loader.ts`'s `parseTrigger` requires a non-empty
 *   `pose_id`, and an effect that starts invalid stays invalid until an author happens to touch
 *   the pose field before ever saving.
 */
export function createNewEffect(
  project: Project,
  poses: readonly { readonly poseId: string }[],
): EffectDefinition {
  const existingIds = new Set(project.catalog.effects.map((effect) => effect.id));
  let suffix = project.catalog.effects.length + 1;
  let id = 'effect-' + suffix;
  while (existingIds.has(id)) {
    suffix += 1;
    id = 'effect-' + suffix;
  }
  return {
    id,
    name: 'New effect',
    trigger: { on: 'confirmed', poseId: poses[0]?.poseId ?? '', conditions: [] },
    timeline: { durationMs: 1, entries: [] },
  };
}

function replaceEffect(project: Project, effect: EffectDefinition): Project {
  const exists = project.catalog.effects.some((entry) => entry.id === effect.id);
  const effects = exists
    ? project.catalog.effects.map((entry) => (entry.id === effect.id ? effect : entry))
    : [...project.catalog.effects, effect];
  // `updatedAtMs` is bumped only by `ProjectRepository.save()` (data-model.md), not by every
  // micro-edit — an author dragging a clip ten times should not imply ten saves.
  return { ...project, catalog: { ...project.catalog, effects } };
}

/** Add a new effect, or replace an existing one with the same id. */
export function withEffect(project: Project, effect: EffectDefinition): Project {
  return replaceEffect(project, effect);
}

/** Raised by {@link renameEffect} when the given name is empty or whitespace-only. */
export class InvalidEffectNameError extends Error {
  constructor() {
    super('An effect name cannot be empty.');
    this.name = 'InvalidEffectNameError';
  }
}

/**
 * Rename one effect (item 11).
 *
 * `name` was always part of `EffectDefinition` — author-facing, and explicitly "never used as
 * an identifier" — but nothing could edit it. This is that edit, and nothing more: `id` is
 * untouched, so every timeline entry, every trigger, and every saved reference to this effect
 * keeps pointing at the same thing. Two effects may therefore share a name; they can never
 * share an id, which `createNewEffect` guarantees on the way in.
 *
 * @throws InvalidEffectNameError when the trimmed name is empty — rejected here, at the one
 *   place that performs the edit, so an empty name can never reach the wire format (where
 *   `catalog-loader.ts`'s `text()` would fail the whole project on reload).
 */
export function renameEffect(project: Project, effectId: string, name: string): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined) {
    return project;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidEffectNameError();
  }
  return replaceEffect(project, { ...effect, name: trimmed });
}

/** Remove an effect by id. Removing an unknown id is a no-op. */
export function withoutEffect(project: Project, effectId: string): Project {
  return {
    ...project,
    catalog: {
      ...project.catalog,
      effects: project.catalog.effects.filter((entry) => entry.id !== effectId),
    },
  };
}

/** The shortest valid `durationMs` for a set of entries — never shorter than its contents. */
function minimalDuration(entries: readonly TimelineEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.atMs + (entry.durationMs ?? 0)), 0);
}

/**
 * Replace an effect's timeline entries, extending `durationMs` to at least cover them.
 *
 * An author's edit never has to separately "remember" to lengthen the timeline — the
 * invariant `parseTimeline` enforces at load is maintained continuously, not checked once
 * at the end.
 */
export function withTimelineEntries(
  project: Project,
  effectId: string,
  entries: readonly TimelineEntry[],
): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined) {
    return project;
  }
  const durationMs = Math.max(effect.timeline.durationMs, minimalDuration(entries), 1);
  const timeline: Timeline = { durationMs, entries };
  return replaceEffect(project, { ...effect, timeline });
}

/** Append a new timeline entry (the palette's "add action" — FR-005). */
export function addTimelineEntry(
  project: Project,
  effectId: string,
  entry: TimelineEntry,
): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined) {
    return project;
  }
  return withTimelineEntries(project, effectId, [...effect.timeline.entries, entry]);
}

/** Move one entry to a new start offset (drag-to-move). Every other entry is untouched. */
export function moveTimelineEntry(
  project: Project,
  effectId: string,
  entryIndex: number,
  atMs: number,
): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined || atMs < 0) {
    return project;
  }
  const entries = effect.timeline.entries.map((entry, index) =>
    index === entryIndex ? { ...entry, atMs } : entry,
  );
  return withTimelineEntries(project, effectId, entries);
}

/** Resize one entry's duration (edge-drag-to-resize). Every other entry is untouched. */
export function resizeTimelineEntry(
  project: Project,
  effectId: string,
  entryIndex: number,
  durationMs: number,
): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined || durationMs < 0) {
    return project;
  }
  const entries = effect.timeline.entries.map((entry, index) =>
    index === entryIndex ? { ...entry, durationMs } : entry,
  );
  return withTimelineEntries(project, effectId, entries);
}

/** Remove one entry. */
export function removeTimelineEntry(
  project: Project,
  effectId: string,
  entryIndex: number,
): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined) {
    return project;
  }
  const entries = effect.timeline.entries.filter((_, index) => index !== entryIndex);
  return withTimelineEntries(project, effectId, entries);
}

/** Duplicate one entry, placed immediately after the original in the list. */
export function duplicateTimelineEntry(
  project: Project,
  effectId: string,
  entryIndex: number,
): Project {
  const effect = findEffect(project, effectId);
  const source = effect?.timeline.entries[entryIndex];
  if (effect === undefined || source === undefined) {
    return project;
  }
  const entries = [
    ...effect.timeline.entries.slice(0, entryIndex + 1),
    { ...source },
    ...effect.timeline.entries.slice(entryIndex + 1),
  ];
  return withTimelineEntries(project, effectId, entries);
}

/** Replace one entry's action parameters wholesale (the inspector's edits). */
export function updateActionParams(
  project: Project,
  effectId: string,
  entryIndex: number,
  params: Readonly<Record<string, ParamValue>>,
): Project {
  const effect = findEffect(project, effectId);
  const source = effect?.timeline.entries[entryIndex];
  if (effect === undefined || source === undefined) {
    return project;
  }
  const entries = effect.timeline.entries.map((entry, index) =>
    index === entryIndex ? { ...entry, action: { ...entry.action, params } } : entry,
  );
  return withTimelineEntries(project, effectId, entries);
}

/** Replace one effect's trigger (the pose/trigger panel's edits). */
export function withTrigger(project: Project, effectId: string, trigger: Trigger): Project {
  const effect = findEffect(project, effectId);
  if (effect === undefined) {
    return project;
  }
  return replaceEffect(project, { ...effect, trigger });
}
