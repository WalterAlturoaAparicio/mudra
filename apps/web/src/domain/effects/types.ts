/**
 * What an effect *is*: a data record, loaded from configuration (FR-039).
 *
 * Nothing here is executable. An effect is a trigger and a timeline of parameterized
 * action references, and the runtime resolves those references through a registry. That is
 * what makes "change what a pose does" a configuration change rather than a code change,
 * and what lets an architecture test assert that no pose identifier appears as a literal
 * in runtime source.
 */

import type { Handedness } from '../landmarks/types';

/** Which lifecycle event a trigger responds to. */
export type TriggerEventKind = 'entered' | 'held' | 'confirmed' | 'exited';

/** A condition evaluated against the event and current state (FR-043). */
export type Condition =
  | { readonly type: 'confidenceAtLeast'; readonly value: number }
  | { readonly type: 'cooldown'; readonly ms: number };

/** When an effect starts. */
export interface Trigger {
  readonly on: TriggerEventKind;
  /**
   * The pose. Need not be in the active pose set — an effect for an inactive pose simply
   * never fires, which the debug panel reports rather than treating as an error.
   */
  readonly poseId: string;
  readonly conditions: readonly Condition[];
}

/**
 * Where an action's output goes.
 *
 * Anchors are **data**, resolved centrally against the current frame (FR-058–FR-060). An
 * action never contains its own code to find a hand, so a new anchor kind benefits every
 * existing action without touching one of them.
 */
export type Anchor =
  /** A fixed position in normalized surface coordinates, `[0,1]`. */
  | { readonly kind: 'screen'; readonly x: number; readonly y: number }
  /** The centroid of a hand's landmarks. */
  | { readonly kind: 'handCentroid'; readonly hand: HandSelector }
  /** One landmark of one hand. */
  | { readonly kind: 'landmark'; readonly hand: HandSelector; readonly index: number };

/** Which hand an anchor means. */
export type HandSelector = Handedness | 'any' | 'first';

/** A parameterized reference to a registered action type. */
export interface Action {
  /** Registry key. Unknown types are a load error naming the type and the effect (FR-045). */
  readonly type: string;
  /** Validated against the registered descriptor's schema at load. */
  readonly params: Readonly<Record<string, ParamValue>>;
}

/** The values an action parameter can hold. */
export type ParamValue = number | string | boolean | Anchor;

/** One action, positioned on a timeline. */
export interface TimelineEntry {
  /**
   * **Absolute** offset from the effect's start (FR-046).
   *
   * A chain of relative delays would make moving one action silently reposition every
   * later one — the single operation a timeline editor performs constantly (FR-047).
   */
  readonly atMs: number;
  /** Absent means instantaneous. */
  readonly durationMs?: number;
  readonly action: Action;
}

/** An effect's schedule. */
export interface Timeline {
  /** Total length. Must be at least the largest `atMs + durationMs`. */
  readonly durationMs: number;
  readonly entries: readonly TimelineEntry[];
}

/** One effect, exactly as the catalog describes it. */
export interface EffectDefinition {
  /** Stable identity, unique across the catalog. */
  readonly id: string;
  /** Human-readable name. Never used as an identifier. */
  readonly name: string;
  readonly trigger: Trigger;
  readonly timeline: Timeline;
}

/** The loaded catalog. Order is meaningful: it is the multi-match order (FR-044). */
export interface EffectCatalog {
  readonly version: number;
  readonly effects: readonly EffectDefinition[];
}
