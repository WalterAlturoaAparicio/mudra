/**
 * The property inspector — generated entirely from a selected action's registered parameter
 * schema (FR-007, FR-008, FR-009, FR-010, research D6).
 *
 * `render()` reads `ActionDescriptor.params` from the **same** `ActionRegistry` instance the
 * runtime uses and maps each `ParamSpec.kind` to one of `inspector-controls.ts`'s seven
 * renderers. Adding a new action type — or a new parameter on an existing one, using an
 * already-supported kind — requires zero changes to this file (SC-002,
 * `test/adapters/inspector.test.ts`). The three schema hints added in this pass (`group`,
 * `visibleWhen`, `allowEmpty`) are read generically here and interpreted by no branch that
 * names an action.
 *
 * **Controls are reconciled, not rebuilt** (item 1/P0). The inspector re-renders after every
 * committed edit, and a colour edit *is* a committed edit — so rebuilding meant destroying
 * the element the author was interacting with, which is what closed the colour picker the
 * instant it was used. When the selection's identity and action type are unchanged, each
 * control is handed the new value through `Control.setValue` and the DOM survives.
 *
 * Every edit is validated through the exact `resolveParams`/`ParamError` the runtime itself
 * uses to load a catalog, **before** it is ever handed to `onParamsChange` — an invalid
 * value is reported inline and never reaches the underlying `Project` (FR-010).
 *
 * `durationMs` (P1.1) is a `TimelineEntry`-level field, not an action param — it never lived
 * in `descriptor.params`, so it is rendered as one additional field ahead of the schema-driven
 * ones and committed through a separate `onDurationChange`, the same `resizeTimelineEntry`
 * the timeline's own resize handle already uses.
 */

import type { Anchor, ParamValue } from '../../domain/effects/types';
import { evaluateActionStatus } from '../../domain/editor/action-status';
import type { ActionStatus } from '../../domain/editor/action-status';
import type { AssetLibraryEntry } from '../../domain/editor/types';
import type { ActionDescriptor, ActionRegistry } from '../../domain/runtime/action-registry';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';
import type { Diagnostic } from '../../domain/runtime/frame-output';
import { ParamError, resolveParams } from '../../domain/runtime/param-schema';
import { renderControl } from './inspector-controls';
import type { Control } from './inspector-controls';

/** The action currently selected on the timeline, if any. */
export interface InspectorSelection {
  readonly actionType: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  /** The entry's own `TimelineEntry.durationMs` — `undefined` means none was set. */
  readonly durationMs?: number;
  /**
   * Which clip this is, so the inspector can tell "the same clip, edited" (reconcile the
   * existing controls) from "a different clip" (build fresh ones). Optional so existing
   * callers and tests that only ever show one selection keep working unchanged.
   */
  readonly effectId?: string;
  readonly entryIndex?: number;
  /** Diagnostics the runtime reported for this action, for the status badge (item 14). */
  readonly diagnostics?: readonly Pick<Diagnostic, 'reason' | 'detail'>[];
}

/**
 * A per-action-type auxiliary preview, supplied by the composition root.
 *
 * The inspector knows only that *some* action types may have one; it never learns which, and
 * contains no branch naming an action. `editor-main.ts` registers the particle preview
 * (item 5) this way, so the preview and the shipped `particle_burst` stay one implementation.
 */
export interface ParamPreview {
  readonly root: HTMLElement;
  update(params: Readonly<Record<string, ParamValue>>, durationMs: number): void;
  destroy(): void;
}

/** Builds a preview for an action type, or returns `null` when that type has none. */
export type ParamPreviewFactory = (actionType: string) => ParamPreview | null;

/** What the inspector needs to exist. */
export interface InspectorOptions {
  readonly document: Document;
  readonly registry: ActionRegistry;
  /** Called with a fully-validated, defaults-applied params record after a committed edit. */
  readonly onParamsChange: (params: Readonly<Record<string, ParamValue>>) => void;
  /** Called with a validated, non-negative duration after a committed edit (P1.1). */
  readonly onDurationChange: (durationMs: number) => void;
  /** Optional auxiliary previews, keyed by action type. */
  readonly createPreview?: ParamPreviewFactory;
}

/** Everything one `render()` needs beyond the selection itself. */
/**
 * Which empty the Inspector is in.
 *
 * "Nothing to edit" had one message, and it was wrong in two of the three states it covered:
 * it told an author to select a clip on a timeline that had none, and it said nothing at all
 * about where an effect comes from. Each empty now names itself, so the panel explains the
 * state the editor is actually in rather than the most common one.
 */
export type InspectorEmptyReason = 'no-effect' | 'effect-has-no-actions' | 'effect-selected';

/** The copy for each empty. Each one points at the surface that ends the state it describes. */
const EMPTY_COPY: Readonly<Record<InspectorEmptyReason, string>> = {
  'no-effect':
    'Nothing is selected. Create an effect with New Effect, or pick one in the project explorer.',
  'effect-has-no-actions':
    'This effect has no actions yet. Add one from the Actions palette, then select it here to edit its properties.',
  'effect-selected':
    'This effect’s own properties live in the Effect and Pose & Trigger panels. Select a clip on the timeline to edit that action instead.',
};

export interface InspectorContext {
  readonly capabilities: CapabilityRegistry;
  /** Which empty to show when `selection` is `null`. Defaults to `no-effect`. */
  readonly emptyReason?: InspectorEmptyReason;
  readonly assetLibrary?: readonly AssetLibraryEntry[];
  /** Whether a live camera is attached — an anchor-following action cannot preview without one. */
  readonly cameraAttached?: boolean;
  /** The same resolver the runtime uses, for the "missing asset" status (item 14). */
  readonly resolveAsset?: (reference: string) => string | null;
}

/** Whether `descriptor`, at its current resolved params, needs a live camera + detected hand
 *  to actually preview (item 7) — `continuous` actions always do; a `duration`/`instantaneous`
 *  one does only if its anchor currently names a hand rather than a fixed screen position. */
function needsLiveCamera(
  descriptor: ActionDescriptor,
  resolved: Readonly<Record<string, ParamValue>>,
): boolean {
  if (descriptor.behaviour === 'continuous') {
    return true;
  }
  return descriptor.params.some((spec) => {
    if (spec.kind !== 'anchor') {
      return false;
    }
    const value = resolved[spec.name] as Anchor | undefined;
    return value !== undefined && value.kind !== 'screen';
  });
}

/** Whether a `visibleWhen`-gated parameter currently applies. */
function isVisible(
  spec: ActionDescriptor['params'][number],
  resolved: Readonly<Record<string, ParamValue>>,
): boolean {
  const gate = spec.visibleWhen;
  if (gate === undefined) {
    return true;
  }
  const value = resolved[gate.param];
  return typeof value === 'string' && gate.values.includes(value);
}

/** The schema-driven property panel. */
export class Inspector {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly registry: ActionRegistry;
  private readonly onParamsChange: (params: Readonly<Record<string, ParamValue>>) => void;
  private readonly onDurationChange: (durationMs: number) => void;
  private readonly createPreview: ParamPreviewFactory | undefined;

  private readonly header: HTMLElement;
  private readonly typeLabel: HTMLElement;
  private readonly statusBadge: HTMLElement;
  private readonly statusDetail: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly cameraNotice: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly fields: HTMLElement;
  private readonly previewSlot: HTMLElement;

  /** Live controls for the currently-shown selection, keyed by parameter name. */
  private controls = new Map<string, Control>();
  /** The wrapper each control's field sits in, so `visibleWhen` can hide it in place. */
  private fieldHosts = new Map<string, HTMLElement>();
  private durationInput: HTMLInputElement | null = null;
  private preview: ParamPreview | null = null;
  private previewType: string | null = null;
  /** Identity of what is currently built, so an unchanged selection reconciles. */
  private builtKey: string | null = null;
  /** The last params the inspector committed or was rendered with, for partial edits. */
  private resolved: Readonly<Record<string, ParamValue>> = {};

  constructor(options: InspectorOptions) {
    this.document = options.document;
    this.registry = options.registry;
    this.onParamsChange = options.onParamsChange;
    this.onDurationChange = options.onDurationChange;
    this.createPreview = options.createPreview;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__inspector';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Inspector';
    this.root.append(heading);

    this.header = this.document.createElement('div');
    this.header.className = 'mudra-editor__inspector-header';
    this.typeLabel = this.document.createElement('span');
    this.typeLabel.className = 'mudra-editor__inspector-type';
    this.statusBadge = this.document.createElement('span');
    this.statusBadge.className = 'mudra-editor__status-badge';
    this.header.append(this.typeLabel, this.statusBadge);
    this.root.append(this.header);

    this.statusDetail = this.document.createElement('p');
    this.statusDetail.className = 'mudra-editor__inspector-status-detail';
    this.root.append(this.statusDetail);

    this.notice = this.document.createElement('p');
    this.notice.className = 'mudra-editor__inspector-notice';
    this.root.append(this.notice);

    this.cameraNotice = this.document.createElement('p');
    this.cameraNotice.className = 'mudra-editor__inspector-notice';
    this.root.append(this.cameraNotice);

    this.errorText = this.document.createElement('p');
    this.errorText.className = 'mudra-editor__inspector-error';
    this.root.append(this.errorText);

    this.previewSlot = this.document.createElement('div');
    this.previewSlot.className = 'mudra-editor__inspector-preview';
    this.root.append(this.previewSlot);

    this.fields = this.document.createElement('div');
    this.fields.className = 'mudra-editor__inspector-fields';
    this.root.append(this.fields);

    this.showEmpty();
  }

  /**
   * Render the inspector for the current selection, or an empty state when nothing is
   * selected.
   *
   * Kept backwards-compatible with the positional call shape the existing suite uses
   * (`capabilities, assetLibrary, cameraAttached`); an `InspectorContext` object may be
   * passed instead, which is what the shell now does so it can also supply `resolveAsset`.
   */
  render(
    selection: InspectorSelection | null,
    capabilitiesOrContext: CapabilityRegistry | InspectorContext,
    assetLibrary: readonly AssetLibraryEntry[] = [],
    cameraAttached = false,
  ): void {
    const context: InspectorContext =
      'has' in capabilitiesOrContext
        ? {
            capabilities: capabilitiesOrContext,
            assetLibrary,
            cameraAttached,
          }
        : capabilitiesOrContext;

    this.errorText.textContent = '';
    if (selection === null) {
      this.showEmpty(context.emptyReason ?? 'no-effect');
      return;
    }

    const descriptor = this.registry.get(selection.actionType);
    if (descriptor === undefined) {
      this.showEmpty();
      return;
    }

    let resolved: Readonly<Record<string, ParamValue>>;
    try {
      resolved = resolveParams(descriptor.params, selection.params, descriptor.type);
    } catch {
      resolved = selection.params;
    }
    this.resolved = resolved;

    const status = evaluateActionStatus({
      actionType: selection.actionType,
      descriptor,
      params: selection.params,
      durationMs: selection.durationMs,
      capabilities: context.capabilities,
      ...(context.resolveAsset === undefined ? {} : { resolveAsset: context.resolveAsset }),
      ...(selection.diagnostics === undefined ? {} : { diagnostics: selection.diagnostics }),
    });
    this.renderStatus(descriptor.type, status);

    const unavailable =
      descriptor.requiresCapability !== undefined &&
      !context.capabilities.has(descriptor.requiresCapability);
    this.notice.textContent = unavailable
      ? 'This environment cannot run "' +
        descriptor.type +
        '" (' +
        descriptor.requiresCapability +
        ' is unavailable). It is still fully editable.'
      : '';
    this.notice.hidden = !unavailable;

    const needsCamera = context.cameraAttached !== true && needsLiveCamera(descriptor, resolved);
    this.cameraNotice.textContent = needsCamera
      ? 'This action needs a live camera — and a detected hand — to actually preview. It is ' +
        'still fully editable, and Test Trigger supplies a stand-in hand meanwhile.'
      : '';
    this.cameraNotice.hidden = !needsCamera;

    const key = [
      selection.effectId ?? '',
      String(selection.entryIndex ?? ''),
      selection.actionType,
    ].join('\u0000');
    if (this.builtKey === key) {
      this.reconcile(descriptor, resolved, selection.durationMs, context);
    } else {
      this.build(descriptor, resolved, selection.durationMs, context);
      this.builtKey = key;
    }

    this.updatePreview(descriptor.type, resolved, selection.durationMs ?? 0);
  }

  /** Drop every live control. Called before rebuilding and when the selection is cleared. */
  private teardown(): void {
    for (const control of this.controls.values()) {
      control.destroy();
    }
    this.controls.clear();
    this.fieldHosts.clear();
    this.durationInput = null;
    this.builtKey = null;
  }

  private build(
    descriptor: ActionDescriptor,
    resolved: Readonly<Record<string, ParamValue>>,
    durationMs: number | undefined,
    context: InspectorContext,
  ): void {
    this.teardown();
    this.fields.replaceChildren();
    this.fields.append(this.renderDurationField(durationMs));
    const presets = this.renderPresets(descriptor);
    if (presets !== null) {
      this.fields.append(presets);
    }

    let group: HTMLElement = this.fields;
    let groupName: string | null = null;
    for (const spec of descriptor.params) {
      if (spec.group !== undefined && spec.group !== groupName) {
        groupName = spec.group;
        group = this.document.createElement('div');
        group.className = 'mudra-editor__field-group';
        const caption = this.document.createElement('h3');
        caption.className = 'mudra-editor__field-group-title';
        caption.textContent = spec.group;
        group.append(caption);
        this.fields.append(group);
      } else if (spec.group === undefined) {
        groupName = null;
        group = this.fields;
      }

      const control = renderControl({
        document: this.document,
        spec,
        value: resolved[spec.name] ?? spec.defaultValue,
        assetLibrary: context.assetLibrary ?? [],
        onChange: (newValue) => {
          this.commit(descriptor.type, { ...this.resolved, [spec.name]: newValue });
        },
      });
      this.controls.set(spec.name, control);
      this.fieldHosts.set(spec.name, control.root);
      control.root.hidden = !isVisible(spec, resolved);
      group.append(control.root);
    }
  }

  private reconcile(
    descriptor: ActionDescriptor,
    resolved: Readonly<Record<string, ParamValue>>,
    durationMs: number | undefined,
    _context: InspectorContext,
  ): void {
    if (this.durationInput !== null && this.document.activeElement !== this.durationInput) {
      this.durationInput.value = String(durationMs ?? 0);
    }
    for (const spec of descriptor.params) {
      this.controls.get(spec.name)?.setValue(resolved[spec.name] ?? spec.defaultValue);
      const host = this.fieldHosts.get(spec.name);
      if (host !== undefined) {
        host.hidden = !isVisible(spec, resolved);
      }
    }
  }

  private renderStatus(actionType: string, status: ActionStatus): void {
    this.typeLabel.textContent = actionType;
    this.statusBadge.textContent = status.label;
    this.statusBadge.dataset['status'] = status.kind;
    this.statusBadge.title = status.detail === '' ? 'This clip is ready to run.' : status.detail;
    this.statusDetail.textContent = status.detail;
    this.statusDetail.hidden = status.detail === '';
    this.header.hidden = false;
  }

  private updatePreview(
    actionType: string,
    resolved: Readonly<Record<string, ParamValue>>,
    durationMs: number,
  ): void {
    if (this.previewType !== actionType) {
      this.preview?.destroy();
      this.preview = this.createPreview?.(actionType) ?? null;
      this.previewType = actionType;
      this.previewSlot.replaceChildren(...(this.preview === null ? [] : [this.preview.root]));
    }
    this.previewSlot.hidden = this.preview === null;
    this.preview?.update(resolved, durationMs);
  }

  /**
   * One button per registered preset, for any descriptor that declares them (item 4).
   *
   * A preset writes ordinary parameter values through the ordinary `commit` path — so it is
   * undoable by editing, saveable like anything else, and produces data indistinguishable from
   * hand-tuned data. The inspector reads `descriptor.presets` generically and names no action.
   *
   * @returns `null` for a descriptor with no presets, so nothing is rendered for one.
   */
  private renderPresets(descriptor: ActionDescriptor): HTMLElement | null {
    const presets = descriptor.presets ?? [];
    if (presets.length === 0) {
      return null;
    }
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__preset-row';
    const caption = this.document.createElement('span');
    caption.className = 'mudra-editor__field-label';
    caption.textContent = 'Presets';
    row.append(caption);
    for (const preset of presets) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.textContent = preset.name;
      button.title = preset.description;
      button.dataset['preset'] = preset.name;
      button.addEventListener('click', () => {
        this.commit(descriptor.type, { ...this.resolved, ...preset.params });
      });
      row.append(button);
    }
    return row;
  }

  /** The one entry-level field every action shares — never a `descriptor.params` entry
   *  (`TimelineEntry.durationMs` is a timeline concept, not an action one) — committed through
   *  `onDurationChange`, the inspector's counterpart to the timeline's own resize handle. */
  private renderDurationField(durationMs: number | undefined): HTMLElement {
    const wrapper = this.document.createElement('label');
    wrapper.className = 'mudra-editor__field';
    const caption = this.document.createElement('span');
    caption.className = 'mudra-editor__field-label';
    caption.textContent = 'duration (ms)';
    caption.title =
      'How long this clip occupies the timeline. Some actions — screen_flash, for one — use ' +
      'this to shape their own fade/decay, not only continuous ones.';
    const input = this.document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '10';
    input.className = 'mudra-editor__input';
    input.value = String(durationMs ?? 0);
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        this.errorText.textContent = 'duration (ms) must be a non-negative number.';
        return;
      }
      this.errorText.textContent = '';
      this.onDurationChange(Math.round(parsed));
    });
    wrapper.append(caption, input);
    this.durationInput = input;
    return wrapper;
  }

  private commit(actionType: string, candidate: Readonly<Record<string, ParamValue>>): void {
    const descriptor = this.registry.require(actionType, '(inspector)');
    try {
      const validated = resolveParams(descriptor.params, candidate, actionType);
      this.errorText.textContent = '';
      this.resolved = validated;
      this.onParamsChange(validated);
    } catch (error) {
      this.errorText.textContent = error instanceof ParamError ? error.message : String(error);
    }
  }

  private showEmpty(reason: InspectorEmptyReason = 'no-effect'): void {
    this.teardown();
    this.header.hidden = true;
    this.statusDetail.hidden = true;
    this.notice.hidden = true;
    this.cameraNotice.hidden = true;
    this.errorText.textContent = '';
    this.preview?.destroy();
    this.preview = null;
    this.previewType = null;
    this.previewSlot.replaceChildren();
    this.previewSlot.hidden = true;
    this.fields.replaceChildren();
    const empty = this.document.createElement('p');
    empty.className = 'mudra-editor__inspector-empty';
    empty.dataset['reason'] = reason;
    empty.textContent = EMPTY_COPY[reason];
    this.fields.append(empty);
  }
}
