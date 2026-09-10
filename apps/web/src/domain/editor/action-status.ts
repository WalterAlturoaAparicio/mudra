/**
 * Why a timeline action would, or would not, produce something when it runs (item 14).
 *
 * Pure, data-driven, and shared: the inspector, the timeline clip, and the project tree all
 * ask this one function, so a clip badged "Missing asset" and an inspector explaining the
 * same thing can never disagree. It reads only what already exists — the registered
 * `ActionDescriptor`, the same `resolveParams` the runtime validates with, the same
 * `CapabilityRegistry` the runtime gates on, the same `AssetResolver` the runtime resolves
 * through — and adds no second source of truth.
 *
 * It contains no branch keyed to a specific action type. Everything it knows, it derives from
 * the descriptor's own parameter schema (`FR-072`), which is what lets a newly registered
 * action get meaningful status with no change to this file.
 */

import type { ParamValue } from '../effects/types';
import type { ActionDescriptor } from '../runtime/action-registry';
import type { CapabilityRegistry } from '../runtime/capabilities';
import type { Diagnostic } from '../runtime/frame-output';
import { ParamError, resolveParams } from '../runtime/param-schema';

/** The states an authored action can be in, worst-first in the order they are reported. */
export type ActionStatusKind =
  /** Fully configured; it will run. */
  | 'ready'
  /** A required choice has not been made yet (an optional-but-empty asset, a zero duration). */
  | 'needs_configuration'
  /** A logical asset reference is set but does not resolve (FR-038, FR-064). */
  | 'missing_asset'
  /** The action needs a capability this environment does not have (FR-077). */
  | 'capability_unavailable'
  /** The parameters do not satisfy the registered schema (FR-045). */
  | 'invalid_configuration'
  /** The runtime reported a failure for this action on a recent frame. */
  | 'runtime_error';

/** One evaluated status. */
export interface ActionStatus {
  readonly kind: ActionStatusKind;
  /** Two or three words, for a badge. */
  readonly label: string;
  /** One sentence saying what is wrong and what would fix it. Empty for `ready`. */
  readonly detail: string;
}

/** Everything the evaluation reads. Nothing here is a browser or DOM type. */
export interface ActionStatusInput {
  readonly actionType: string;
  /** `undefined` when the type is not registered — itself a reportable state. */
  readonly descriptor: ActionDescriptor | undefined;
  readonly params: Readonly<Record<string, ParamValue>>;
  /** The entry's own `TimelineEntry.durationMs`; `undefined` means none was set. */
  readonly durationMs?: number | undefined;
  readonly capabilities: CapabilityRegistry;
  /** The same resolver the runtime uses. Defaults to one that resolves nothing. */
  readonly resolveAsset?: (reference: string) => string | null;
  /** Diagnostics the runtime produced for this action, if any were observed. */
  readonly diagnostics?: readonly Pick<Diagnostic, 'reason' | 'detail'>[];
}

const READY: ActionStatus = { kind: 'ready', label: 'Ready', detail: '' };

/**
 * Evaluate one action's status.
 *
 * Order matters and is deliberate: an unregistered or schema-invalid action is reported
 * before anything else, because every later check would be reading values that may not mean
 * what they appear to. A missing capability outranks a missing asset, because the action
 * would not run even with the asset present.
 */
export function evaluateActionStatus(input: ActionStatusInput): ActionStatus {
  const descriptor = input.descriptor;
  if (descriptor === undefined) {
    return {
      kind: 'invalid_configuration',
      label: 'Unknown action',
      detail:
        'No action type "' +
        input.actionType +
        '" is registered, so this clip cannot run. It was probably authored by a newer build.',
    };
  }

  let resolved: Readonly<Record<string, ParamValue>>;
  try {
    resolved = resolveParams(descriptor.params, input.params, input.actionType);
  } catch (error) {
    return {
      kind: 'invalid_configuration',
      label: 'Invalid settings',
      detail: error instanceof ParamError ? error.message : String(error),
    };
  }

  const capability = descriptor.requiresCapability;
  if (capability !== undefined && !input.capabilities.has(capability)) {
    return {
      kind: 'capability_unavailable',
      label: 'Unavailable here',
      detail:
        'This environment cannot run "' +
        descriptor.type +
        '": the "' +
        capability +
        '" capability is unavailable. The clip stays fully editable and will run wherever the ' +
        'capability is present.',
    };
  }

  const runtimeError = (input.diagnostics ?? []).find(
    (diagnostic) => diagnostic.reason === 'capability_unavailable',
  );
  if (runtimeError !== undefined) {
    return {
      kind: 'runtime_error',
      label: 'Did not run',
      detail:
        'The last time this clip ran, it reported: ' +
        runtimeError.reason +
        ' (' +
        runtimeError.detail +
        ').',
    };
  }

  const resolveAsset = input.resolveAsset ?? (() => null);
  for (const spec of descriptor.params) {
    if (spec.kind !== 'asset') {
      continue;
    }
    const raw = resolved[spec.name];
    const reference = typeof raw === 'string' ? raw : '';
    if (reference === '') {
      if (spec.allowEmpty === true) {
        continue; // "none" is a legitimate choice for this parameter
      }
      return {
        kind: 'needs_configuration',
        label: 'Needs an asset',
        detail: 'Choose an asset for "' + spec.name + '" — nothing is selected yet.',
      };
    }
    if (resolveAsset(reference) === null) {
      return {
        kind: 'missing_asset',
        label: 'Missing asset',
        detail:
          '"' +
          reference +
          '" does not resolve to anything in this project. Add it to the asset library, or ' +
          'point "' +
          spec.name +
          '" at an asset that exists.',
      };
    }
  }

  const unresolvedAsset = (input.diagnostics ?? []).find(
    (diagnostic) => diagnostic.reason === 'asset_unresolved',
  );
  if (unresolvedAsset !== undefined) {
    return {
      kind: 'missing_asset',
      label: 'Missing asset',
      detail: 'The last run could not resolve "' + unresolvedAsset.detail + '".',
    };
  }

  // A zero-length clip of a duration- or continuous-behaviour action is scheduled and then
  // never active for a single frame — visually identical to a broken action, and one of the
  // easiest states to reach by dragging a resize handle to the left.
  if (descriptor.behaviour !== 'instantaneous' && (input.durationMs ?? 0) <= 0) {
    return {
      kind: 'needs_configuration',
      label: 'No duration',
      detail:
        'This clip is zero milliseconds long, so it is never active. Give it a duration in ' +
        'the Inspector, or drag its right edge on the timeline.',
    };
  }

  const unresolvedAnchor = (input.diagnostics ?? []).find(
    (diagnostic) => diagnostic.reason === 'anchor_unresolved',
  );
  if (unresolvedAnchor !== undefined) {
    return {
      kind: 'needs_configuration',
      label: 'No anchor yet',
      detail:
        'The anchor did not resolve on the last run (' +
        unresolvedAnchor.detail +
        '). A hand-anchored clip needs a hand in frame — the preview supplies a stand-in hand ' +
        'when no camera is attached.',
    };
  }

  return READY;
}

/** Whether a status means the action would currently produce nothing. */
export function isBlocking(status: ActionStatus): boolean {
  return status.kind !== 'ready';
}

/**
 * The worst status among an effect's actions — what a project-tree row for the whole effect
 * shows. `ready` only when every action is.
 */
export function worstStatus(statuses: readonly ActionStatus[]): ActionStatus {
  const order: readonly ActionStatusKind[] = [
    'invalid_configuration',
    'runtime_error',
    'capability_unavailable',
    'missing_asset',
    'needs_configuration',
    'ready',
  ];
  for (const kind of order) {
    const found = statuses.find((status) => status.kind === kind);
    if (found !== undefined) {
      return found;
    }
  }
  return READY;
}
