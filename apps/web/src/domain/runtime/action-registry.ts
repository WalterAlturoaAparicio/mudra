/**
 * Action types register; the runtime never switches on them (FR-071, research D8).
 *
 * A descriptor carries four things: a behaviour class the scheduler understands, a typed
 * parameter schema, an optional required capability, and an `update` that returns render
 * commands. The scheduler, the event system, and the renderer know none of the specific
 * types — which is what FR-073 asks for, and what
 * `test/domain/registry-extensibility.test.ts` proves by registering a new action through
 * the production registry and watching it get scheduled.
 *
 * The parameter schema earns its place twice over: it validates the catalog at load
 * (FR-045), which is work that had to happen anyway, and it is the metadata a future
 * editor reads to generate controls without knowing the action (FR-072).
 */

import type { Action, Anchor } from '../effects/types';
import type { SegmentationFrame } from '../editor/segmentation-frame';
import type { LandmarkFrame } from '../landmarks/types';
import type { AudioCue, Diagnostic, Point, RenderCommand } from './frame-output';

/**
 * How the scheduler treats an action.
 *
 * - `instantaneous` — fires once at its `atMs`.
 * - `duration` — active from `atMs` to `atMs + durationMs`, told how far through it is.
 * - `continuous` — active for its window and re-resolved every frame against live state.
 */
export type ActionBehaviour = 'instantaneous' | 'duration' | 'continuous';

/** What kind of value a parameter holds. */
export type ParamKind = 'number' | 'color' | 'enum' | 'asset' | 'anchor' | 'boolean' | 'string';

/** One parameter, described well enough to validate it and to build a control for it. */
export interface ParamSpec {
  readonly name: string;
  readonly kind: ParamKind;
  /** Used when the catalog omits the parameter. */
  readonly defaultValue: number | string | boolean | Anchor;
  /** For `number`: inclusive bounds. */
  readonly min?: number;
  readonly max?: number;
  /** For `enum`: the permitted values. */
  readonly values?: readonly string[];
  /** For `asset`: the required logical prefix, e.g. `@audio/`. */
  readonly assetPrefix?: string;
  /**
   * For `asset`: whether `''` is a permitted value, meaning "none chosen".
   *
   * An optional asset needs a representable "not set" state that survives a save/reload
   * round trip. Without this, the only way to express it would be a sentinel reference that
   * deliberately fails to resolve — a broken reference by construction, which is exactly
   * what FR-038's reporting exists to flag as a problem.
   */
  readonly allowEmpty?: boolean;
  /**
   * Presentational grouping hint for the inspector, e.g. `'Emission'`.
   *
   * Metadata, not behaviour: the runtime never reads it. It exists so a schema-driven
   * inspector can give a twenty-parameter action a legible shape without the inspector
   * learning anything about the specific action (FR-072).
   */
  readonly group?: string;
  /**
   * Show this parameter only while another parameter currently holds one of `values`.
   *
   * Also metadata the runtime ignores — a hidden parameter still validates, still has its
   * default, and is still whatever the catalog said. It is how a mode-bearing action
   * (`person_visibility`) keeps its inspector honest about which fields currently matter,
   * without the inspector containing a branch per action (FR-072).
   */
  readonly visibleWhen?: {
    readonly param: string;
    readonly values: readonly string[];
  };
  /** One line, for a future editor's tooltip. */
  readonly description: string;
}

/** Resolved, validated parameters handed to an action's `update`. */
export type ResolvedParams = Readonly<Record<string, number | string | boolean | Anchor>>;

/**
 * A named bundle of parameter values an author can apply in one click (item 4).
 *
 * **Presets are data, not behaviour.** A preset writes ordinary parameter values through the
 * ordinary edit path; nothing at runtime ever reads which preset a set of values came from,
 * and there is no second code path for "a preset burst" versus "a hand-tuned burst". That is
 * what keeps `particle_burst`'s seven emission patterns one simulation rather than seven
 * renderer branches. A generic inspector renders these for any descriptor that declares them,
 * knowing nothing about the action (FR-072).
 */
export interface ActionPreset {
  /** Author-facing, e.g. `Fountain`. */
  readonly name: string;
  /** One line, for the button's tooltip. */
  readonly description: string;
  /** The parameter values this preset sets. Anything omitted keeps its current value. */
  readonly params: Readonly<Record<string, number | string | boolean | Anchor>>;
}

/** Everything an action needs to produce this frame's output. */
export interface ActionContext {
  /** The effect this action belongs to, for diagnostics. */
  readonly effectId: string;
  /** Validated parameters, defaults already applied. */
  readonly params: ResolvedParams;
  /** Milliseconds since the playback started. */
  readonly elapsedMs: number;
  /** How far through this action's own window, in `[0,1]`. `1` for instantaneous. */
  readonly progress: number;
  /** The action's window length; `0` for instantaneous. */
  readonly durationMs: number;
  /**
   * `true` only on the frame this action's offset was crossed.
   *
   * What separates "start a sound" from "keep a sound started": an instantaneous action
   * that re-emitted on every frame of its window would turn a cue into a buzz.
   */
  readonly justFired: boolean;
  /** The live frame, for continuous actions. */
  readonly frame: LandmarkFrame;
  /**
   * This frame's person-segmentation output, when the capability is available; `null`
   * otherwise (constitution v1.7.0, data-model.md). An action declaring
   * `requiresCapability: PERSON_SEGMENTATION` is only ever invoked while this is non-null —
   * the runtime skips it, and reports why, before `update` is ever called (unchanged from
   * Milestone 1's capability-gating mechanism).
   */
  readonly segmentation: SegmentationFrame | null;
  /** Surface size in device pixels. */
  readonly width: number;
  readonly height: number;
  /**
   * The action's anchor, already resolved to a point (FR-060).
   *
   * `null` when it could not be resolved this frame *and* there was no previous position.
   * An action must handle that by producing nothing — never by looking for a hand itself.
   */
  readonly anchor: Point | null;
  /** Resolve a logical asset reference, or `null` when it does not resolve (FR-064). */
  resolveAsset(reference: string): string | null;
  /** A stable per-playback scratch space, for actions with their own state (trails). */
  readonly state: Record<string, unknown>;
}

/** What an action produced this frame. */
export interface ActionOutput {
  readonly commands: readonly RenderCommand[];
  readonly audioCues?: readonly AudioCue[];
  readonly diagnostics?: readonly Omit<Diagnostic, 'effectId' | 'actionType'>[];
}

/** The registration record for one action type. */
export interface ActionDescriptor {
  /** Registry key, as it appears in the catalog. */
  readonly type: string;
  readonly behaviour: ActionBehaviour;
  readonly params: readonly ParamSpec[];
  /** One-click parameter bundles an editor may offer. Purely authoring metadata. */
  readonly presets?: readonly ActionPreset[];
  /**
   * A capability this action needs. When it is unavailable the action is inert **and
   * reported** (FR-077) — never silently skipped, which would look like a broken effect
   * rather than a known absence.
   */
  readonly requiresCapability?: string;
  /** Produce this frame's output. **Never draws** — it returns commands. */
  update(context: ActionContext): ActionOutput;
}

/** Raised when a registry lookup or registration is invalid. */
export class RegistryError extends Error {
  /** The message names the type; there is no code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * A registry of action types.
 *
 * Constructed rather than imported as a singleton, so two sessions — or a test and the
 * application — never share registrations (constitution Principle I).
 */
export class ActionRegistry {
  private readonly descriptors = new Map<string, ActionDescriptor>();

  /** Register an action type. Registering the same key twice is an error, not a silent win. */
  register(descriptor: ActionDescriptor): this {
    if (this.descriptors.has(descriptor.type)) {
      throw new RegistryError('Action type "' + descriptor.type + '" is already registered.');
    }
    this.descriptors.set(descriptor.type, descriptor);
    return this;
  }

  /** Look up a type, or `undefined` when it is not registered. */
  get(type: string): ActionDescriptor | undefined {
    return this.descriptors.get(type);
  }

  /** Look up a type, failing loudly with the effect that referenced it. */
  require(type: string, effectId: string): ActionDescriptor {
    const descriptor = this.descriptors.get(type);
    if (descriptor === undefined) {
      throw new RegistryError(
        'Effect "' +
          effectId +
          '" uses unknown action type "' +
          type +
          '". Registered types: ' +
          this.types().join(', ') +
          '.',
      );
    }
    return descriptor;
  }

  /** Every registered type, sorted, for error messages and the debug panel. */
  types(): readonly string[] {
    return [...this.descriptors.keys()].sort();
  }

  /** Every descriptor, for the registry-completeness test and a future editor. */
  all(): readonly ActionDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Whether an action's declared type is registered. */
  knows(action: Action): boolean {
    return this.descriptors.has(action.type);
  }
}
