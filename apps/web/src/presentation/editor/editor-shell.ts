/**
 * Composes the editor's surfaces over one open `Project` (FR-001, FR-033a/b).
 *
 * All authoring goes through `domain/editor/project-edits.ts`'s pure functions; this file
 * only wires DOM events to them and re-renders. It never calls `EffectRuntime` or the
 * renderer directly except through the injected `EditorRuntimeController` — the same boundary
 * `contracts/editor-runtime-boundary.md` requires.
 *
 * **One selection model.** An effect, and optionally one of its clips, is selected; the
 * project explorer, the effect dropdown, the timeline, the effect panel and the inspector are
 * all views of that one pair. Selecting a clip in the tree and selecting it on the timeline
 * are the same operation, and there is nowhere for the two to disagree.
 *
 * **Three playback operations, three meanings** (item 15):
 * - *Play* starts the current effect's whole timeline (`playTimeline`).
 * - *Play Selected* starts only the selected clip, rebased to zero (`playSelectedClip`), and
 *   is disabled — with the reason on its tooltip — when no clip is selected.
 * - *Test Trigger* injects the `PoseEvent` this effect's trigger listens for and lets the
 *   runtime decide what fires, conditions and all. It reports what actually started, so a
 *   cooldown that suppressed the effect is visible rather than looking like a broken button.
 *
 * The shell owns the centre workspace (toolbar + stage) and the timeline, and mounts its
 * panels into whichever slots the composition root supplies — which is what lets those panels
 * be individually shown and hidden from the View menu without this file knowing about layout.
 */

import type {
  EffectDefinition,
  ParamValue,
  TimelineEntry,
  Trigger,
} from '../../domain/effects/types';
import {
  addTimelineEntry,
  createNewEffect,
  duplicateTimelineEntry,
  findEffect,
  moveTimelineEntry,
  removeTimelineEntry,
  renameEffect as renameEffectData,
  resizeTimelineEntry,
  updateActionParams,
  withEffect,
  withTrigger,
} from '../../domain/editor/project-edits';
import { isolatedCatalog } from '../../domain/editor/isolated-catalog';
import { EditHistory } from '../../domain/editor/edit-history';
import { renameProject as renameProjectData } from '../../domain/editor/types';
import type { Project } from '../../domain/editor/types';
import type { ActionRegistry } from '../../domain/runtime/action-registry';
import { resolveParams } from '../../domain/runtime/param-schema';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';
import type { Diagnostic } from '../../domain/runtime/frame-output';
import type { EffectRuntime } from '../../domain/runtime/effect-runtime';
import type { EditorRuntimeController } from '../../application/editor-runtime-controller';
import { EffectPanel } from './effect-panel';
import { iconButton, setButtonEnabled, icon } from './icons';
import { Inspector } from './inspector';
import type { InspectorEmptyReason, ParamPreviewFactory } from './inspector';
import { Palette } from './palette';
import { ProjectTree } from './project-tree';
import { Timeline } from './timeline';
import { PoseTriggerPanel } from './pose-trigger-panel';
import type { PoseOption } from './pose-trigger-panel';

/** Where the shell's own DOM mounts. Every panel slot falls back to `right` when absent. */
export interface EditorShellSlots {
  /** The workspace row: toolbar + stage canvas. */
  readonly center: HTMLElement;
  /** Everything with no slot of its own. */
  readonly right: HTMLElement;
  /** The timeline. */
  readonly timeline: HTMLElement;
  /** The project explorer tree. */
  readonly explorer?: HTMLElement;
  /** The effect-level panel (name, identity, standing). */
  readonly effect?: HTMLElement;
  /** The pose/trigger panel. */
  readonly trigger?: HTMLElement;
  /** The action palette. */
  readonly palette?: HTMLElement;
  /** The property inspector. */
  readonly inspector?: HTMLElement;
}

/** What the shell needs to exist. */
/**
 * A panel a selection can be answered in.
 *
 * Named rather than passed as a panel id so the shell states *what it needs shown* and the
 * composition root decides which registered panel that is — the shell has no idea the dock
 * layout exists, and the layout is only ever asked to reveal, never to hide.
 */
export type EditorSurface = 'inspector' | 'effect' | 'project' | 'assets';

/**
 * The confirmation the shell asks before leaving an effect with unsaved changes (spec 010
 * correction pass, item 6). Structural, like `project-panel.ts`'s `ProjectPrompts` — the real
 * `DialogHost` satisfies it, and a test passes a plain fake with no DOM at all.
 */
export interface EffectSwitchPrompts {
  chooseAction<T extends string>(options: {
    readonly title: string;
    readonly message: string;
    readonly actions: readonly {
      readonly label: string;
      readonly value: T;
      readonly tone?: 'normal' | 'danger';
    }[];
    readonly cancelLabel?: string;
    readonly cancelValue: T;
  }): Promise<T>;
}

export interface EditorShellOptions {
  readonly document: Document;
  readonly layout: EditorShellSlots;
  readonly registry: ActionRegistry;
  readonly runtimeController: EditorRuntimeController;
  /**
   * The same `EffectRuntime` instance `runtimeController` drives. The shell calls only
   * `setCatalog()` on it — supplying data, never scheduling or drawing (contracts/
   * editor-runtime-boundary.md) — so every preview immediately reflects each edit.
   */
  readonly runtime: EffectRuntime;
  /**
   * The canvas `runtimeController`'s `Stage` already draws into. Supplied rather than
   * created here, so the composition root can build `Stage`/`EditorRuntimeController`
   * (which the shell itself depends on) before the shell exists, with no circular
   * construction order.
   */
  readonly stageCanvas: HTMLCanvasElement;
  readonly initialProject: Project;
  readonly poses: readonly PoseOption[];
  /** How many steps of undo/redo each editing context retains (spec 009 FR-075a). Defaults to
   *  50 — every test but this feature's own history-scoping tests can ignore it entirely. */
  readonly historyDepth?: number;
  /**
   * Asked before switching the active effect away from one with unsaved changes (spec 010
   * correction pass, item 6). Omitted — as every existing test omits it — means a context
   * switch with pending edits proceeds exactly as it always has: silently, keeping them. Only a
   * real caller (`editor-main.ts`) supplies this, and only then does a dirty switch pause for an
   * explicit Save/Discard/Cancel.
   */
  readonly dialogs?: EffectSwitchPrompts;
  /** Called after every committed edit, so the composition root can, e.g., enable "Save". */
  readonly onProjectChange?: (project: Project) => void;
  /**
   * Called when the author asks for a live camera (US1 acceptance scenario 6 — performing
   * the real pose). Camera lifecycle itself is the composition root's responsibility, same
   * as `main.ts`'s `Shell.onStart`; the shell only asks.
   */
  readonly onToggleCamera?: () => Promise<void>;
  /** The same resolver the runtime uses, so action status agrees with what will actually run. */
  readonly resolveAsset?: (reference: string) => string | null;
  /** Auxiliary per-action previews, e.g. the particle preview (item 5). */
  readonly createPreview?: ParamPreviewFactory;
  /** Select an asset in the Assets panel, when one is chosen in the project explorer. */
  readonly onSelectAsset?: (reference: string) => void;
  /**
   * Asked to show the surface that answers the current selection (final pass, item 3).
   *
   * A selection with nowhere to inspect it is a dead end: the click works, nothing appears,
   * and nothing explains why. Naming the surface here is what lets a hidden Inspector come
   * back on its own the moment an author selects a clip.
   */
  readonly onRevealSurface?: (surface: EditorSurface) => void;
}

/** Every new timeline entry's starting duration (P1.2) — see `addAction()` for why this is
 *  unconditional, not just for `duration`/`continuous`-behaviour actions. */
const DEFAULT_NEW_ENTRY_DURATION_MS = 500;

/** How long a toolbar status message stays before the next render clears it. */
const STATUS_LINGER = 1;

/**
 * How long the face-tracking indicator stays visible after the last frame on which face analysis
 * ran (Spec 011, D24, FR-019a).
 *
 * An instantaneous face-anchored action legitimately analyses about one frame, and an indicator
 * visible for ~16 ms is not meaningful disclosure. So the *indicator* lingers for this fixed
 * minimum — measured on the frame clock, with no timer — while the *analysis* is never extended:
 * nothing here can request a face. This is a disclosure-perceptibility choice for a text
 * indicator, not a performance figure.
 */
export const FACE_INDICATOR_HOLD_MS = 500;

/** Appended to the camera control's help: when face tracking runs and what happens to it. */
const FACE_HELP =
  'Face tracking runs only while a face-anchored effect needs it; nothing is stored or sent.';

/** The indicator text while analysis ran on the latest frame. */
const FACE_INDICATOR_ON = 'Face tracking on';
/** The indicator text during the post-analysis hold — it must not claim analysis is running. */
const FACE_INDICATOR_FINISHED = 'Face tracking finished';

/** The slice of a controller frame the indicator reads. Carries no face data. */
export interface FaceIndicatorFrame {
  /** The frame clock, in milliseconds. */
  readonly nowMs: number;
  readonly runtime: { readonly faceTracking: boolean };
}

/** `EditorShellOptions.historyDepth`'s default, equal to `editor-main.ts`'s `UNDO_DEPTH`. */
const DEFAULT_HISTORY_DEPTH = 50;

/** The editor's main view. */
export class EditorShell {
  readonly stageCanvas: HTMLCanvasElement;

  private readonly document: Document;
  private readonly registry: ActionRegistry;
  private readonly runtimeController: EditorRuntimeController;
  private readonly runtime: EffectRuntime;
  private readonly onProjectChange: ((project: Project) => void) | undefined;
  private readonly resolveAsset: ((reference: string) => string | null) | undefined;
  private readonly onRevealSurface: ((surface: EditorSurface) => void) | undefined;
  private readonly cameraButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly playSelectedButton: HTMLButtonElement;
  private readonly testTriggerButton: HTMLButtonElement;
  private readonly statusLine: HTMLElement;
  /** Shows that face analysis is running or just ran (Spec 011 FR-019). Hidden by default. */
  private readonly faceIndicator: HTMLElement;
  /** Frame-clock time of the last frame face analysis ran on; `null` until one has. */
  private lastFaceAnalysisAtMs: number | null = null;
  /** The dataset's poses — read by `createEffect()` for a valid default trigger (P0.1), kept
   *  current via `setPoses()`, never written back to (same discipline `PoseTriggerPanel` uses). */
  private poses: readonly PoseOption[];

  private readonly effectSelect: HTMLSelectElement;
  private readonly palette: Palette;
  private readonly inspector: Inspector;
  private readonly timeline: Timeline;
  private readonly poseTriggerPanel: PoseTriggerPanel;
  private readonly effectPanel: EffectPanel;
  private readonly tree: ProjectTree;

  private project: Project;
  private capabilities: CapabilityRegistry;
  private selectedEffectId: string | null;
  private selectedEntryIndex: number | null = null;
  /**
   * What the Inspector holds while locked (FR-015 – FR-019, spec 010, data-model.md "Inspector
   * lock"). `entryIndex: null` is itself a meaningful locked state — "this effect, no clip" —
   * so every read of this field must use an explicit ternary, never `??`, or a locked
   * effect-only selection would wrongly fall through to the live `selectedEntryIndex`.
   */
  private lockedSelection: { effectId: string; entryIndex: number | null } | null = null;
  private readonly historyDepth: number;
  private readonly dialogs: EffectSwitchPrompts | undefined;
  /**
   * Undo/redo, scoped to the active editing context (spec 010 correction pass, item 6 — this
   * pass's fix to spec 009's undo/redo). `editingContextId` names which effect (or `null`, no
   * effect selected) `history` belongs to; switching to a *different* effect always starts a
   * fresh `EditHistory` seeded at the project as it stood the moment the switch happens
   * (`beginEditingContext`), so `undo()`/`redo()` are structurally incapable of reaching an edit
   * made in a different context — there is nothing else in `history` to reach. `contextBaseline`
   * is what "Discard" (in the leave-with-unsaved-changes prompt) reverts to; kept as its own
   * field rather than replayed via repeated `history.undo()` so it stays correct even once the
   * bounded history has dropped its oldest entries.
   */
  private history: EditHistory;
  private editingContextId: string | null;
  private contextBaseline: Project;
  private cameraOn = false;
  private projectIsActive = false;
  /** Diagnostics from the most recent runtime frame, keyed `effectId\u0000actionType`. */
  private diagnostics = new Map<string, Pick<Diagnostic, 'reason' | 'detail'>[]>();
  /** Set by a playback command, cleared by the next one — never a growing log. */
  private statusMessage = '';

  constructor(options: EditorShellOptions) {
    this.document = options.document;
    this.registry = options.registry;
    this.runtimeController = options.runtimeController;
    this.runtime = options.runtime;
    this.onProjectChange = options.onProjectChange;
    this.onRevealSurface = options.onRevealSurface;
    this.resolveAsset = options.resolveAsset;
    this.project = options.initialProject;
    this.capabilities = { has: () => false, all: () => [] };
    this.selectedEffectId = this.project.catalog.effects[0]?.id ?? null;
    this.poses = options.poses;
    this.historyDepth = options.historyDepth ?? DEFAULT_HISTORY_DEPTH;
    this.dialogs = options.dialogs;
    this.editingContextId = this.selectedEffectId;
    this.contextBaseline = this.project;
    this.history = new EditHistory(this.project, this.historyDepth);

    const slot = (named: HTMLElement | undefined): HTMLElement => named ?? options.layout.right;

    this.stageCanvas = options.stageCanvas;
    this.stageCanvas.classList.add('mudra-editor__stage');
    options.layout.center.append(this.stageCanvas);

    // ---- Toolbar (item 18): the effect being edited, then the commands that act on it. ----
    const toolbar = this.document.createElement('div');
    toolbar.className = 'mudra-editor__effect-bar';

    const newEffectButton = iconButton({
      document: this.document,
      name: 'add',
      label: 'New Effect',
      description: 'Create an empty effect and select it. Add actions to it from the palette.',
      onClick: () => this.createEffect(),
      className: 'mudra-editor__icon-button--primary',
    });

    this.effectSelect = this.document.createElement('select');
    this.effectSelect.className = 'mudra-editor__input mudra-editor__effect-select';
    this.effectSelect.title = 'The effect being edited.';
    this.effectSelect.setAttribute('aria-label', 'Effect being edited');
    this.effectSelect.addEventListener('change', () => {
      this.selectEffect(this.effectSelect.value || null);
    });

    this.cameraButton = iconButton({
      document: this.document,
      name: 'camera',
      label: 'Camera',
      description: 'Attach the live camera, so a real pose can drive this effect. ' + FACE_HELP,
      onClick: () => {
        void options.onToggleCamera?.();
      },
    });
    this.cameraButton.disabled = options.onToggleCamera === undefined;

    this.faceIndicator = this.document.createElement('span');
    this.faceIndicator.className = 'mudra-editor__face-indicator';
    this.faceIndicator.setAttribute('role', 'status');
    this.faceIndicator.hidden = true;

    this.playButton = iconButton({
      document: this.document,
      name: 'play',
      label: 'Play',
      description: 'Play this effect’s whole timeline from the start.',
      onClick: () => this.play(),
    });

    this.playSelectedButton = iconButton({
      document: this.document,
      name: 'playSelection',
      label: 'Play Selected',
      description: 'Play only the selected clip, from the start.',
      onClick: () => this.playSelected(),
    });

    this.testTriggerButton = iconButton({
      document: this.document,
      name: 'target',
      label: 'Test Trigger',
      description:
        'Simulate this effect’s trigger being recognized, conditions and all. No camera needed.',
      onClick: () => this.testTrigger(),
    });

    toolbar.append(
      newEffectButton,
      this.effectSelect,
      this.separator(),
      this.cameraButton,
      this.faceIndicator,
      this.separator(),
      this.playButton,
      this.playSelectedButton,
      this.testTriggerButton,
    );

    this.statusLine = this.document.createElement('span');
    this.statusLine.className = 'mudra-editor__toolbar-status';
    this.statusLine.setAttribute('role', 'status');
    toolbar.append(this.statusLine);
    options.layout.center.append(toolbar);

    // ---- Panels ----
    this.tree = new ProjectTree({
      document: this.document,
      registry: this.registry,
      onSelectEffect: (effectId) => this.selectEffect(effectId),
      onSelectAction: (effectId, entryIndex) => this.selectAction(effectId, entryIndex),
      onSelectProject: () => this.onRevealSurface?.('project'),
      onSelectAsset: (reference) => {
        options.onSelectAsset?.(reference);
        this.onRevealSurface?.('assets');
      },
    });
    slot(options.layout.explorer).append(this.tree.root);

    this.effectPanel = new EffectPanel({
      document: this.document,
      onRename: (name) => this.renameSelectedEffect(name),
      getEffect: () => this.currentEffect(),
    });
    slot(options.layout.effect).append(this.effectPanel.root);

    this.poseTriggerPanel = new PoseTriggerPanel({
      document: this.document,
      onChange: (trigger) => this.updateTrigger(trigger),
    });
    this.poseTriggerPanel.setPoses(options.poses);
    slot(options.layout.trigger).append(this.poseTriggerPanel.root);

    this.palette = new Palette({
      document: this.document,
      registry: this.registry,
      onAdd: (actionType) => this.addAction(actionType),
    });
    slot(options.layout.palette).append(this.palette.root);

    this.inspector = new Inspector({
      document: this.document,
      registry: this.registry,
      onParamsChange: (params) => this.updateSelectedParams(params),
      onDurationChange: (durationMs) => this.updateSelectedDuration(durationMs),
      onToggleLock: () => (this.inspectorLocked ? this.unlockInspector() : this.lockInspector()),
      ...(options.createPreview === undefined ? {} : { createPreview: options.createPreview }),
    });
    slot(options.layout.inspector).append(this.inspector.root);

    this.timeline = new Timeline({
      document: this.document,
      registry: this.registry,
      onSelect: (index) => {
        this.selectedEntryIndex = index;
        if (index !== null) {
          this.onRevealSurface?.('inspector');
        }
        this.renderAll();
      },
      onMove: (index, atMs) =>
        this.editTimeline((project) =>
          moveTimelineEntry(project, this.requireEffectId(), index, atMs),
        ),
      onResize: (index, durationMs) =>
        this.editTimeline((project) =>
          resizeTimelineEntry(project, this.requireEffectId(), index, durationMs),
        ),
      onDelete: (index) => this.deleteEntry(index),
      onDuplicate: (index) =>
        this.editTimeline((project) =>
          duplicateTimelineEntry(project, this.requireEffectId(), index),
        ),
    });
    options.layout.timeline.append(this.timeline.root);

    this.wireKeyboardDelete();
    this.renderAll();
  }

  private separator(): HTMLElement {
    const rule = this.document.createElement('span');
    rule.className = 'mudra-editor__toolbar-separator';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }

  /**
   * Delete/Backspace deletes the selected clip (item 12) — the same `deleteEntry` path the
   * clip's own `×` button already uses, so a clip too small to show that button (a narrow,
   * zoomed-out instantaneous one) is still deletable.
   *
   * Ignored while focus is inside a text-entry control, and inside any editor popover: a
   * project author typing a pose id, an intensity, an asset reference, or arrowing a colour
   * slider — anywhere Backspace is a normal editing key, or the keystroke plainly belongs to
   * something else — must never have it interpreted as "delete the selected clip" instead.
   */
  private wireKeyboardDelete(): void {
    this.document.addEventListener('keydown', (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (target?.closest('[data-editor-popover]') != null) {
        return;
      }
      if (this.selectedEntryIndex === null) {
        return;
      }
      event.preventDefault();
      this.deleteEntry(this.selectedEntryIndex);
    });
  }

  private deleteEntry(index: number): void {
    this.editTimeline((project) => {
      if (this.selectedEntryIndex === index) {
        this.selectedEntryIndex = null;
      }
      return removeTimelineEntry(project, this.requireEffectId(), index);
    });
  }

  /** The project as currently authored. */
  get currentProject(): Project {
    return this.project;
  }

  /** Which effect is being edited, and which of its clips is selected. */
  get selection(): { readonly effectId: string | null; readonly entryIndex: number | null } {
    return { effectId: this.selectedEffectId, entryIndex: this.selectedEntryIndex };
  }

  /** Whether the Inspector is currently held on a captured selection (FR-015). */
  get inspectorLocked(): boolean {
    return this.lockedSelection !== null;
  }

  /**
   * Hold the Inspector on the current selection — a later selection change elsewhere no longer
   * replaces its content (FR-016). A no-op when nothing is selected: there is nothing to hold.
   */
  lockInspector(): void {
    if (this.selectedEffectId === null) {
      return;
    }
    this.lockedSelection = { effectId: this.selectedEffectId, entryIndex: this.selectedEntryIndex };
    this.renderInspector();
  }

  /** Return to showing whatever is currently selected live (FR-017). */
  unlockInspector(): void {
    this.lockedSelection = null;
    this.renderInspector();
  }

  /** Whether the active editing context has an edit undo could step back to (spec 010
   *  correction pass, item 6 — also what "this effect has unsaved changes" means). */
  get canUndo(): boolean {
    return this.history.state.canUndo;
  }

  /** Whether the active editing context has an undone edit redo could step forward to. */
  get canRedo(): boolean {
    return this.history.state.canRedo;
  }

  /**
   * Step back one edit **within the active editing context only** (spec 010 correction pass,
   * item 6). `this.history` belongs exclusively to `editingContextId` — there is no other
   * context's edit for this call to reach, by construction, not by a check here. A context with
   * nothing to undo makes this a no-op, the same as `EditHistory.undo()` already returning `null`.
   */
  undo(): void {
    const previous = this.history.undo();
    if (previous !== null) {
      this.applyExternalProject(previous);
    }
  }

  /** Step forward one undone edit, within the active editing context only. */
  redo(): void {
    const next = this.history.redo();
    if (next !== null) {
      this.applyExternalProject(next);
    }
  }

  /** Start a fresh editing context — a new bounded undo/redo history seeded at `baseline`, and a
   *  new discard target. Called on construction, on opening a different project, and every time
   *  a context switch (see {@link requestContextSwitch}) actually proceeds. */
  private beginEditingContext(effectId: string | null, baseline: Project): void {
    this.editingContextId = effectId;
    this.contextBaseline = baseline;
    this.history = new EditHistory(baseline, this.historyDepth);
  }

  /**
   * The gate every effect-selection change goes through (spec 010 correction pass, item 6):
   * switching to a *different* effect while the current one has unsaved edits must not silently
   * carry that history into the new context.
   *
   * Selecting the effect already active (`targetEffectId === editingContextId`), or a context
   * with nothing undoable, or — deliberately — no `dialogs` configured at all, all take the
   * synchronous fast path: apply the change immediately and start the new context, exactly the
   * timing every call site had before this feature existed. Only a genuinely dirty context with
   * a real `dialogs` host takes the async Save/Discard/Cancel branch; Cancel leaves everything
   * exactly as it was (`apply` is never called), Discard reverts `this.project` to
   * `contextBaseline` first, and both Save and Discard then proceed with the switch.
   */
  private requestContextSwitch(targetEffectId: string | null, apply: () => void): void {
    if (targetEffectId === this.editingContextId) {
      apply();
      return;
    }
    if (!this.history.state.canUndo || this.dialogs === undefined) {
      apply();
      this.beginEditingContext(targetEffectId, this.project);
      return;
    }

    const effectName = this.currentEffect()?.name ?? 'This effect';
    void this.dialogs
      .chooseAction<'save' | 'discard' | 'cancel'>({
        title: 'Unsaved changes',
        message:
          '"' +
          effectName +
          '" has changes you haven’t left behind yet. Save them and continue, discard ' +
          'them and continue, or stay on this effect?',
        actions: [
          { label: 'Save', value: 'save' },
          { label: 'Discard', value: 'discard', tone: 'danger' },
        ],
        cancelLabel: 'Cancel',
        cancelValue: 'cancel',
      })
      .then((choice) => {
        if (choice === 'cancel') {
          return;
        }
        if (choice === 'discard') {
          this.project = this.contextBaseline;
          this.pushCatalog();
          this.renderAll();
          this.onProjectChange?.(this.project);
        }
        apply();
        this.beginEditingContext(targetEffectId, this.project);
      });
  }

  /** Replace the whole project (Project panel's "load"/"import"). A different project's edit
   *  history is never this one's — always a fresh editing context, never the leave-with-
   *  unsaved-changes prompt (that prompt is about switching effects within one open project). */
  loadProject(project: Project): void {
    this.project = project;
    this.selectedEffectId = project.catalog.effects[0]?.id ?? null;
    this.selectedEntryIndex = null;
    this.diagnostics.clear();
    this.beginEditingContext(this.selectedEffectId, this.project);
    this.pushCatalog();
    this.renderAll();
    this.onProjectChange?.(this.project);
  }

  /**
   * Replace the project with one produced outside an ordinary edit — undo/redo (item 15's
   * sibling feature). Unlike {@link loadProject}, which is "open something else" and resets
   * selection unconditionally, this keeps the current selection when the stepped-to project
   * still has it: undoing a colour tweak should not also lose which clip was selected.
   */
  applyExternalProject(project: Project): void {
    this.project = project;
    const effect =
      this.selectedEffectId === null ? undefined : findEffect(this.project, this.selectedEffectId);
    if (effect === undefined) {
      this.selectedEffectId = project.catalog.effects[0]?.id ?? null;
      this.selectedEntryIndex = null;
    } else if (
      this.selectedEntryIndex !== null &&
      effect.timeline.entries[this.selectedEntryIndex] === undefined
    ) {
      this.selectedEntryIndex = null;
    }
    this.pushCatalog();
    this.renderAll();
    this.onProjectChange?.(this.project);
  }

  /** Replace the project's asset library (the asset-library panel's "add"/"remove"). */
  updateAssetLibrary(library: Project['assetLibrary']): void {
    this.project = { ...this.project, assetLibrary: library };
    this.history.record(this.project);
    this.renderAll();
    this.onProjectChange?.(this.project);
  }

  /** Replace the project's camera-treatment settings (the camera panel's edits). */
  updateCameraTreatment(settings: Project['cameraTreatment']): void {
    this.project = { ...this.project, cameraTreatment: settings };
    this.history.record(this.project);
    this.onProjectChange?.(this.project);
  }

  /**
   * Rename the current project (item 1/P3) — the project panel's name field. `renameProject`
   * (domain, imported as `renameProjectData`) validates and trims; an invalid name throws and
   * `this.project` is left unchanged, so the caller's own `catch` reflects the rejection
   * without this method needing its own duplicate validation.
   *
   * @throws InvalidProjectNameError for an empty/whitespace-only name.
   */
  renameProject(name: string): void {
    this.project = renameProjectData(this.project, name);
    this.history.record(this.project);
    this.onProjectChange?.(this.project);
  }

  /**
   * Rename the selected effect (item 11) — `renameEffect` validates and trims, and never
   * touches the effect's `id`.
   *
   * @throws InvalidEffectNameError for an empty/whitespace-only name.
   */
  renameSelectedEffect(name: string): void {
    if (this.selectedEffectId === null) {
      return;
    }
    // Deliberately *not* routed through `editTimeline`: that would re-render the effect panel
    // mid-commit, and the panel is what called this.
    this.project = renameEffectData(this.project, this.selectedEffectId, name);
    this.history.record(this.project);
    this.pushCatalog();
    this.renderAll();
    this.onProjectChange?.(this.project);
  }

  /**
   * Reflect this frame's face-analysis state in the indicator (Spec 011 FR-019, FR-019a, D24).
   *
   * Three states, derived purely from the frame clock — no timer, so a fresh analysis frame
   * simply restarts the hold:
   * - **on**: analysis ran on this frame;
   * - **finished**: none did, but the last one was less than {@link FACE_INDICATOR_HOLD_MS} ago —
   *   distinct text, so the hold cannot be mistaken for active processing;
   * - **hidden**: otherwise, and always before any analysis has happened.
   *
   * It only *displays*: it never causes or requests analysis, and a face anchor merely existing
   * in the project never shows it.
   */
  reflectFaceTracking(frame: FaceIndicatorFrame): void {
    if (frame.runtime.faceTracking) {
      this.lastFaceAnalysisAtMs = frame.nowMs;
      this.setFaceIndicator('on');
      return;
    }
    const last = this.lastFaceAnalysisAtMs;
    if (last !== null && frame.nowMs - last < FACE_INDICATOR_HOLD_MS) {
      this.setFaceIndicator('finished');
      return;
    }
    this.setFaceIndicator('hidden');
  }

  private setFaceIndicator(state: 'on' | 'finished' | 'hidden'): void {
    this.faceIndicator.hidden = state === 'hidden';
    this.faceIndicator.dataset['state'] = state;
    const text =
      state === 'on' ? FACE_INDICATOR_ON : state === 'finished' ? FACE_INDICATOR_FINISHED : '';
    if (this.faceIndicator.textContent !== text) {
      this.faceIndicator.textContent = text;
    }
  }

  /** Reflect whether the live camera is currently attached. */
  setCameraOn(on: boolean): void {
    this.cameraOn = on;
    // Refreshes the Inspector's "needs a live camera" notice (item 7) immediately, rather than
    // waiting for the next unrelated edit to happen to re-render it.
    this.renderAll();
  }

  /** Reflect capability changes (e.g. segmentation becoming available mid-session). */
  setCapabilities(capabilities: CapabilityRegistry): void {
    this.capabilities = capabilities;
    this.renderAll();
  }

  /** Reflect the dataset's poses (catalog/eligible/active standing). */
  setPoses(poses: readonly PoseOption[]): void {
    this.poses = poses;
    this.poseTriggerPanel.setPoses(poses);
    this.renderAll();
  }

  /** Reflect whether this project is the one the public experience runs (item 19). */
  setProjectIsActive(active: boolean): void {
    this.projectIsActive = active;
    this.renderAll();
  }

  /**
   * Record the diagnostics the runtime produced on a frame, so the inspector and the tree can
   * explain a clip that ran and did nothing (item 14).
   *
   * Replaces rather than accumulates: the question is "what happened last time", not "what has
   * ever happened", and a growing log would keep reporting a problem an author already fixed.
   */
  setRuntimeDiagnostics(diagnostics: readonly Diagnostic[]): void {
    if (diagnostics.length === 0 && this.diagnostics.size === 0) {
      return;
    }
    const next = new Map<string, Pick<Diagnostic, 'reason' | 'detail'>[]>();
    for (const diagnostic of diagnostics) {
      const key = diagnostic.effectId + '\u0000' + diagnostic.actionType;
      const bucket = next.get(key);
      const value = { reason: diagnostic.reason, detail: diagnostic.detail };
      if (bucket === undefined) {
        next.set(key, [value]);
      } else {
        bucket.push(value);
      }
    }
    this.diagnostics = next;
    this.renderInspector();
  }

  /** Make `effectId` the current effect, clearing the clip selection. Gated by
   *  {@link requestContextSwitch} when this actually leaves a dirty editing context (spec 010
   *  correction pass, item 6). */
  selectEffect(effectId: string | null): void {
    this.requestContextSwitch(effectId, () => {
      this.selectedEffectId = effectId;
      this.selectedEntryIndex = null;
      this.pushCatalog(); // re-scope editor-preview isolation to the new selection (FR-027)
      if (effectId !== null) {
        this.onRevealSurface?.('effect');
      }
      this.renderAll();
    });
  }

  /** Select one clip of one effect — what both the tree and the timeline do. Selecting a clip
   *  that belongs to a *different* effect than the active one is itself a context switch, and
   *  gated the same as {@link selectEffect}; selecting another clip of the same effect is not. */
  selectAction(effectId: string, entryIndex: number): void {
    this.requestContextSwitch(effectId, () => {
      this.selectedEffectId = effectId;
      this.selectedEntryIndex = entryIndex;
      this.pushCatalog(); // re-scope editor-preview isolation to the new selection (FR-027)
      this.onRevealSurface?.('inspector');
      this.renderAll();
    });
  }

  private requireEffectId(): string {
    if (this.selectedEffectId === null) {
      throw new Error('No effect is selected.');
    }
    return this.selectedEffectId;
  }

  /**
   * Create a new, **empty** effect and select it (item 6).
   *
   * This is the whole of the "empty container" concept, and deliberately so: an
   * `EffectDefinition` already holds an arbitrary list of timeline actions, so composing
   * `background_wash` + `particle_burst` + `play_audio` + … under one trigger is what the
   * existing model *is*. Introducing an `empty` action type would have added a runtime
   * concept that renders nothing, for no gain — the project data stays exactly what
   * `EffectRuntime` already consumes.
   */
  private createEffect(): void {
    const effect = createNewEffect(this.project, this.poses);
    this.requestContextSwitch(effect.id, () => {
      this.project = withEffect(this.project, effect);
      this.selectedEffectId = effect.id;
      this.selectedEntryIndex = null;
      this.pushCatalog();
      this.renderAll();
      this.onProjectChange?.(this.project);
    });
  }

  private addAction(actionType: string): void {
    if (this.selectedEffectId === null) {
      this.createEffect();
    }
    const effectId = this.requireEffectId();
    const descriptor = this.registry.require(actionType, effectId);
    const params: Readonly<Record<string, ParamValue>> = resolveParams(
      descriptor.params,
      {},
      actionType,
    );
    // New clips start at the timeline's beginning; the author repositions by dragging. Every
    // new entry gets a non-zero default duration (P1.2) — including `instantaneous`-behaviour
    // ones: `screen_flash`'s own `update()` uses `durationMs` as its fade/decay window despite
    // firing once, and `progress` is forced to `1` (so `decay = 1 - progress = 0`) whenever
    // `durationMs` is `0`/absent, which is why an `instantaneous` action added with no duration
    // used to render at zero alpha — correctly scheduled, invisibly rendered. Harmless for
    // `play_audio`, the only other `instantaneous` action: its `update()` reads only
    // `justFired`, never `durationMs`/`progress`.
    const entry: TimelineEntry = {
      atMs: 0,
      durationMs: DEFAULT_NEW_ENTRY_DURATION_MS,
      action: { type: actionType, params },
    };
    const effect = findEffect(this.project, effectId);
    const newIndex = effect?.timeline.entries.length ?? 0;
    this.editTimeline((project) => addTimelineEntry(project, effectId, entry));
    // Select what was just added: an author who clicks an action expects to configure it.
    this.selectedEntryIndex = newIndex;
    this.renderAll();
  }

  private updateSelectedParams(params: Readonly<Record<string, ParamValue>>): void {
    if (this.selectedEffectId === null || this.selectedEntryIndex === null) {
      return;
    }
    this.editTimeline((project) =>
      updateActionParams(project, this.requireEffectId(), this.selectedEntryIndex!, params),
    );
  }

  /** The inspector's duration field (P1.1) — the same `resizeTimelineEntry` the timeline's own
   *  resize handle already uses, so an instantaneous entry with no handle is still editable. */
  private updateSelectedDuration(durationMs: number): void {
    if (this.selectedEffectId === null || this.selectedEntryIndex === null) {
      return;
    }
    this.editTimeline((project) =>
      resizeTimelineEntry(project, this.requireEffectId(), this.selectedEntryIndex!, durationMs),
    );
  }

  private updateTrigger(trigger: Trigger): void {
    if (this.selectedEffectId === null) {
      return;
    }
    this.editTimeline((project) => withTrigger(project, this.requireEffectId(), trigger));
  }

  private editTimeline(edit: (project: Project) => Project): void {
    this.project = edit(this.project);
    this.history.record(this.project); // into the active editing context only (spec 010, item 6)
    this.pushCatalog();
    this.renderAll();
    this.onProjectChange?.(this.project);
  }

  /**
   * Feeds the runtime the catalog it should actually match live poses against — at most the
   * effect currently selected for editing, never the whole project (FR-024 – FR-027, research
   * D8). Called after every edit, and after every selection change: a selection change alone,
   * with no edit, must re-scope isolation immediately.
   */
  private pushCatalog(): void {
    this.runtime.setCatalog(isolatedCatalog(this.project.catalog, this.selectedEffectId));
  }

  /** Test Trigger (item 15) — inject the event, then report what the runtime actually did. */
  private testTrigger(): void {
    const effect = this.currentEffect();
    if (effect === undefined) {
      return;
    }
    const result = this.runtimeController.testTrigger(effect);
    // Every Test Trigger message opens with what was *simulated*, because that is what
    // distinguishes it from Play: it injects a recognition event and lets the runtime decide.
    // Play never mentions a pose, and Test Trigger always does, even when nothing started.
    const pose = this.poses.find((candidate) => candidate.poseId === effect.trigger.poseId);
    const poseName = pose?.displayName ?? effect.trigger.poseId ?? '(no pose)';
    const simulated = 'Simulated ' + poseName + ' ' + effect.trigger.on;

    if (result.startedEffectIds.length === 0) {
      this.setStatus(
        simulated +
          ' — nothing started: a condition on this effect (a cooldown, or a minimum ' +
          'confidence) rejected it.',
        'warning',
      );
      return;
    }
    const names = result.startedEffectIds.map((id) => findEffect(this.project, id)?.name ?? id);
    const started = 'started ' + names.map((name) => '"' + name + '"').join(', ');
    // Authoring against a pose outside the active set is legitimate; not being told is not.
    // The effect really did start here — the active set gates recognition, not scheduling.
    const inactive = pose !== undefined && !pose.active;
    this.setStatus(
      inactive
        ? simulated +
            ' — ' +
            started +
            '. "' +
            poseName +
            '" is not in the active pose set, so a visitor could not trigger it.'
        : simulated + ' — ' + started + '.',
      inactive ? 'warning' : 'ok',
    );
  }

  /** Play (item 15) — the whole timeline, no trigger evaluation. */
  private play(): void {
    const effect = this.currentEffect();
    if (effect === undefined) {
      return;
    }
    this.runtimeController.playTimeline(effect.id);
    this.setStatus(
      'Playing the whole timeline of "' + effect.name + '" — conditions not evaluated.',
      'ok',
    );
  }

  /** Play Selected (item 15) — only the selected clip, rebased to zero. */
  private playSelected(): void {
    const effect = this.currentEffect();
    if (effect === undefined || this.selectedEntryIndex === null) {
      return;
    }
    const played = this.runtimeController.playSelectedClip(effect, this.selectedEntryIndex);
    const entry = effect.timeline.entries[this.selectedEntryIndex];
    this.setStatus(
      played && entry !== undefined
        ? 'Playing the selected "' + entry.action.type + '" clip alone, from zero.'
        : 'That clip no longer exists.',
      played ? 'ok' : 'warning',
    );
  }

  private setStatus(message: string, tone: 'ok' | 'warning'): void {
    this.statusMessage = message;
    this.statusLine.textContent = message;
    this.statusLine.dataset['tone'] = tone;
  }

  private currentEffect(): EffectDefinition | undefined {
    return this.selectedEffectId === null
      ? undefined
      : findEffect(this.project, this.selectedEffectId);
  }

  private renderAll(): void {
    this.effectSelect.replaceChildren();
    for (const effect of this.project.catalog.effects) {
      const option = this.document.createElement('option');
      option.value = effect.id;
      option.textContent = effect.name;
      this.effectSelect.append(option);
    }
    this.effectSelect.value = this.selectedEffectId ?? '';

    const effect = this.currentEffect();
    const hasEffect = effect !== undefined;
    const hasClip = hasEffect && this.selectedEntryIndex !== null;

    setButtonEnabled(
      this.playButton,
      hasEffect,
      'No effect is selected.',
      'Play — play this effect’s whole timeline from the start.',
    );
    setButtonEnabled(
      this.playSelectedButton,
      hasClip,
      'Select a clip on the timeline (or in the project explorer) to play just that clip.',
      'Play Selected — play only the selected clip, from the start.',
    );
    setButtonEnabled(
      this.testTriggerButton,
      hasEffect,
      'No effect is selected.',
      'Test Trigger — simulate this effect’s trigger being recognized, conditions and all.',
    );
    this.cameraButton.replaceChildren(icon(this.document, this.cameraOn ? 'cameraOff' : 'camera'));
    this.cameraButton.setAttribute(
      'aria-label',
      this.cameraOn ? 'Turn Camera Off' : 'Turn Camera On',
    );
    this.cameraButton.title = this.cameraOn
      ? 'Turn Camera Off — detach the live camera. Previews keep working without it. ' + FACE_HELP
      : 'Turn Camera On — attach the live camera, so a real pose can drive this effect. ' +
        FACE_HELP;
    this.cameraButton.dataset['state'] = this.cameraOn ? 'on' : 'off';

    // A status message survives exactly as long as its own render pass: the next command
    // replaces it, and an unrelated edit leaves it alone.
    if (this.statusMessage !== '' && this.statusLine.textContent !== this.statusMessage) {
      this.statusLine.textContent = this.statusMessage;
    }
    void STATUS_LINGER;

    this.palette.render(this.capabilities);
    this.timeline.render(
      effect?.timeline.entries ?? [],
      this.selectedEntryIndex,
      effect?.timeline.durationMs ?? 0,
      {
        registry: this.registry,
        capabilities: this.capabilities,
        ...(this.resolveAsset === undefined ? {} : { resolveAsset: this.resolveAsset }),
      },
    );
    if (effect !== undefined) {
      this.poseTriggerPanel.render(effect.trigger);
    }

    this.effectPanel.render({
      effect,
      poses: this.poses,
      projectIsActive: this.projectIsActive,
      actionCount: effect?.timeline.entries.length ?? 0,
    });

    this.tree.render({
      project: this.project,
      capabilities: this.capabilities,
      poses: this.poses,
      selectedEffectId: this.selectedEffectId,
      selectedEntryIndex: this.selectedEntryIndex,
      ...(this.resolveAsset === undefined ? {} : { resolveAsset: this.resolveAsset }),
      projectIsActive: this.projectIsActive,
    });

    this.renderInspector();
  }

  private renderInspector(): void {
    // A locked target that stopped resolving (its effect or entry no longer exists — an edit,
    // an undo/redo, or a project switch) auto-unlocks rather than showing stale/wrong content
    // (FR-018, FR-019). This runs on every render, so it needs no separate call site.
    if (this.lockedSelection !== null) {
      const lockedEffect = findEffect(this.project, this.lockedSelection.effectId);
      const stillResolves =
        lockedEffect !== undefined &&
        (this.lockedSelection.entryIndex === null ||
          lockedEffect.timeline.entries[this.lockedSelection.entryIndex] !== undefined);
      if (!stillResolves) {
        this.lockedSelection = null;
      }
    }

    const locked = this.lockedSelection;
    const effectiveEffectId = locked !== null ? locked.effectId : this.selectedEffectId;
    const effectiveEntryIndex = locked !== null ? locked.entryIndex : this.selectedEntryIndex;

    const effect =
      effectiveEffectId === null ? undefined : findEffect(this.project, effectiveEffectId);
    const selectedEntry =
      effect !== undefined && effectiveEntryIndex !== null
        ? effect.timeline.entries[effectiveEntryIndex]
        : undefined;
    if (selectedEntry === undefined || effect === undefined) {
      // Which empty this is, named rather than guessed — the three states need three answers.
      const emptyReason: InspectorEmptyReason =
        effect === undefined
          ? 'no-effect'
          : effect.timeline.entries.length === 0
            ? 'effect-has-no-actions'
            : 'effect-selected';
      this.inspector.render(null, {
        capabilities: this.capabilities,
        emptyReason,
        assetLibrary: this.project.assetLibrary.entries,
        cameraAttached: this.runtimeController.hasCamera,
        locked: this.inspectorLocked,
        ...(this.resolveAsset === undefined ? {} : { resolveAsset: this.resolveAsset }),
      });
      return;
    }
    const diagnostics =
      this.diagnostics.get(effect.id + '\u0000' + selectedEntry.action.type) ?? [];
    this.inspector.render(
      {
        actionType: selectedEntry.action.type,
        params: selectedEntry.action.params,
        effectId: effect.id,
        entryIndex: effectiveEntryIndex ?? 0,
        diagnostics,
        ...(selectedEntry.durationMs === undefined ? {} : { durationMs: selectedEntry.durationMs }),
      },
      {
        capabilities: this.capabilities,
        assetLibrary: this.project.assetLibrary.entries,
        cameraAttached: this.runtimeController.hasCamera,
        locked: this.inspectorLocked,
        ...(this.resolveAsset === undefined ? {} : { resolveAsset: this.resolveAsset }),
      },
    );
  }
}
