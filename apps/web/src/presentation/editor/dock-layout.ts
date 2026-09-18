/**
 * A modular, dock-like layout foundation for the editor shell (items 8–11; spec 010 US2/US3,
 * corrected 2026-09-17, then a further workspace UX corrections pass the same day — no text
 * selection while dragging, a trimmed panel-menu popover, tab reordering, split resizing, and
 * panel-/region-level scrolling — see `specs/010-editor-workspace-refinements/spec.md`'s
 * Clarifications for both).
 *
 * Builds one CSS-Grid shell — a menu bar, then left / center / right columns with the center
 * split into a workspace row and a timeline row — and exposes named mount points
 * (`slots.menu/left/center/right/timeline`) that panels are appended into. Adding a future
 * panel is "append into an existing slot," never a rewrite of this file.
 *
 * Resizing is three draggable splitters, each moving one CSS custom property
 * (`--mudra-layout-left-w`/`--right-w`/`--timeline-h`), clamped to `PANEL_BOUNDS` so the
 * layout can never collapse into an unusable state. Each `pointermove` writes the custom
 * property directly and nothing else — no layout read (`getBoundingClientRect`, `offsetWidth`,
 * …) is ever interleaved with it, so there is no read/write cycle for the browser to thrash
 * on, the same reasoning `Timeline`'s own clip-drag relies on. (`EditorRuntimeController` is
 * the one place in the editor a `requestAnimationFrame` loop is allowed to live — see
 * `test/architecture/layering.test.ts` — so this file deliberately does not add a second one.)
 *
 * **Docking (spec 010, US2/US3, corrected)**: a panel is registered into a *zone* — a named
 * docking location within whichever `Layout` (`layout-catalog.ts`) is active. Within a zone, the
 * arrangement is a small **dock tree** (`dock-tree.ts`): a leaf is a tab group (one panel, or
 * several presented as switchable tabs); a split divides space between children, stacked
 * (`column`) or side-by-side (`row`). A panel newly registered with no saved position becomes its
 * *own* stacked leaf — panels sharing a zone are never automatically tabbed together, only by an
 * explicit drag onto another panel's tab/content target, or the keyboard-operable "Move to" menu.
 *
 * Relocation is a real pointer drag: `pointerdown` on a panel's header starts it,
 * `pointermove` resolves the nearest `[data-dock-leaf]` ancestor (a specific tab group) or
 * `[data-dock-zone]` (empty background) via `event.target.closest()` — deliberately identity-based
 * hit-testing, not `elementFromPoint`, so a jsdom-dispatched event resolves exactly like a real
 * one. Which *edge* of a hovered leaf the pointer is over (`drop-region.ts`) does need real
 * geometry (`getBoundingClientRect()` + pointer coordinates) — the one place this file reads
 * layout during a drag — because "top/bottom/left/right/centre" cannot be told apart by identity
 * alone.
 *
 * This class owns no persistence — like `Timeline`'s `onMove`/`onResize`, it only dispatches
 * `onSizesChange`/`onLayoutChange` and lets the composition root decide what to do with it
 * (here: hand it to a `LayoutStore`, `domain/ports/layout-store.ts`). That keeps this file
 * storage-free, which `test/architecture/privacy.test.ts` requires (`indexedDB` is permitted
 * only inside `infrastructure/persistence/**`, and `localStorage` is prohibited everywhere).
 *
 * This is deliberately not a full docking system (floating panels, arbitrary nesting depth beyond
 * what one drag produces) — a small, fixed set of predefined layouts, each with a genuinely
 * subdividable/stackable/tabbable zone, is the scope constitution v1.9.0 authorizes; see
 * `layout-catalog.ts`.
 */

import type { DockNodeData, EditorLayout, PanelSizes } from '../../domain/ports/layout-store';
import {
  appendStacked,
  applyDrop,
  findLeafOf,
  listPanelIds,
  removePanel,
  reorderTab,
  sanitize,
  withSplitSizesAtPath,
} from './dock-tree';
import type { DockNode } from './dock-tree';
import { resolveDropRegion } from './drop-region';
import type { DropRegion } from './drop-region';
import { DEFAULT_LAYOUT_ID, LAYOUTS, defaultZoneFor, zonesOf } from './layout-catalog';
import {
  DEFAULT_LAYOUT_PRESET,
  DEFAULT_PANEL_SIZES,
  LAYOUT_PRESETS,
  clampPanelSize,
} from './panel-sizes';
import { equalSizes, resizeSplitSizes } from './split-resize';
import { icon } from './icons';

/** Floor every leaf's cross-axis extent may shrink to (spec 010 workspace UX corrections pass,
 *  items 4/6, FR-042/FR-045) — enforced both as `.mudra-layout__leaf`'s real CSS `min-height`/
 *  `min-width` (what makes the zone's own `overflow-y: auto` finally activate once combined
 *  panel minimums exceed its space) and as a resize drag's own pixel clamp, so the two agree. */
export const MIN_LEAF_SIZE_PX = 120;

/** A docking zone's id. Kept as `DockRegion` for the callers that already know it as one of
 *  today's three regions — a zone id is layout-defined data now, not a fixed union
 *  (spec 010 FR-001), but this ships one layout whose zones are exactly those three ids. */
export type DockRegion = string;

/** What a panel tells the layout about itself when it registers. */
export interface DockPanel {
  /** Stable id — what a persisted layout and the View menu refer to it by. */
  readonly id: string;
  /** Human-readable name, shown in the View menu and this panel's own docking header. */
  readonly label: string;
  /** Where this panel starts if no docking arrangement or layout default already places it. */
  readonly region: DockRegion;
  /** The panel's own root, appended into a host section the layout owns. */
  readonly element: HTMLElement;
}

/** A registered panel as the View menu sees it — identity, not DOM. `region` is this panel's
 *  *current* zone, which relocation changes; it is not frozen at registration time. */
export interface RegisteredPanel {
  readonly id: string;
  readonly label: string;
  readonly region: DockRegion;
}

/** Named mount points every editor panel appends into. */
export interface DockLayoutSlots {
  /** The top menu bar — File menu, layout controls. */
  readonly menu: HTMLElement;
  /** Project explorer, assets. */
  readonly left: HTMLElement;
  /** The stage/workspace — `EditorShell`'s toolbar + canvas. */
  readonly center: HTMLElement;
  /** Inspector, trigger/palette, camera properties, diagnostics. */
  readonly right: HTMLElement;
  /** The timeline, docked to the bottom of the center column. */
  readonly timeline: HTMLElement;
}

/** What the layout needs to exist. */
export interface DockLayoutOptions {
  readonly document: Document;
  /** The sizes to start from — the composition root's already-loaded `LayoutStore` value, or
   *  `DEFAULT_PANEL_SIZES` when nothing was saved yet. Defaults to `DEFAULT_PANEL_SIZES`. */
  readonly initialSizes?: PanelSizes;
  /** Called after every resize (on drag release) and after `resetToDefault()`. */
  readonly onSizesChange?: (sizes: PanelSizes) => void;
  /** Ids of panels a stored layout said were closed. Panels registered later start open. */
  readonly initialHiddenPanels?: readonly string[];
  /** The preset name a stored layout was last in. Names the preset only — it does not
   *  overwrite `initialSizes`, so a hand-dragged layout survives a reload intact. */
  readonly initialPreset?: string;
  /** The predefined docking layout a stored record last had active. An id `layout-catalog.ts`
   *  does not recognize falls back to the default layout (spec 010 FR-008). */
  readonly initialActiveLayoutId?: string;
  /** Each zone's dock tree, as a stored record remembered it. An entry naming a zone this layout
   *  does not have is dropped; a panel id it names that never registers, or that is closed, is
   *  sanitized out the first time that zone renders (contracts/docking-persistence.md). */
  readonly initialZoneLayouts?: Readonly<Record<string, DockNodeData>>;
  /** Called whenever the whole chrome state changes — visibility, preset, or docking, not
   *  drags/resizes. */
  readonly onLayoutChange?: (layout: EditorLayout) => void;
}

/** Marks a zone's own top-level element as a valid relocation drop target. */
const DOCK_ZONE_ATTR = 'data-dock-zone';
/** Marks one tab group's wrapper — the finer-grained drop target `drop-region.ts` reads geometry
 *  against, distinct from the zone-background target above. */
const DOCK_LEAF_ATTR = 'data-dock-leaf';

/** Pointer-drag capture that degrades gracefully where unsupported (jsdom, notably). */
function safeSetPointerCapture(element: Element, pointerId: number): void {
  try {
    (element as unknown as { setPointerCapture(id: number): void }).setPointerCapture(pointerId);
  } catch {
    // Dragging still works via ordinary pointermove/pointerup bubbling.
  }
}

/** A registered panel's full bookkeeping — DOM handles plus identity. */
interface PanelEntry {
  panel: RegisteredPanel;
  /** The section wrapping `header` + `content` — what gets moved between zones. */
  readonly host: HTMLElement;
  readonly header: HTMLElement;
  /** The panel's own root element, exactly `DockPanel.element` — what whole-panel collapse
   *  hides, independent of `header`. */
  readonly content: HTMLElement;
  readonly collapseButton: HTMLButtonElement;
}

/** A leaf's tab-group identity that survives a re-render: its member ids, order-independent, so
 *  the active tab stays chosen even though the wrapper element itself is rebuilt every render. */
function leafKey(panelIds: readonly string[]): string {
  return [...panelIds].sort().join(' ');
}

/** The dock-like panel layout: menu bar + resizable left/center/right + timeline, each of the
 *  three side zones holding a dock tree of stacked/tabbed panels. */
export class DockLayout {
  readonly root: HTMLElement;
  readonly slots: DockLayoutSlots;

  private readonly document: Document;
  private readonly onSizesChange: ((sizes: PanelSizes) => void) | undefined;
  private readonly onLayoutChange: ((layout: EditorLayout) => void) | undefined;
  private sizes: PanelSizes;

  private activeLayoutId: string;
  /** Zone element for each of the active layout's zone ids. Rebuilt if the layout changes;
   *  this ships one layout, so today it is exactly `{ left, right, timeline }`. */
  private readonly zoneElements = new Map<string, HTMLElement>();
  /** Each zone's current dock tree. `undefined`/absent means empty — kept sanitized (against
   *  registered + open panels) as of the zone's own last render. */
  private readonly zoneTrees = new Map<string, DockNode | null>();
  /** Where a persisted record explicitly placed a panel, read once at construction — what lets
   *  `registerPanel` tell "already positioned by a saved arrangement" apart from "new, defaults
   *  to its own stacked leaf" regardless of registration order. */
  private readonly persistedPanelZone = new Map<string, string>();
  /** Which panel is the visible tab of a leaf, keyed by that leaf's member set (`leafKey`) so it
   *  survives the leaf's wrapper element being rebuilt every render. */
  private readonly activeTab = new Map<string, string>();

  /** Registration order is menu order, so the View menu reads the way the editor is built. */
  private readonly panels = new Map<string, PanelEntry>();
  /** Closed panels (spec 010 correction pass, item 4) — removed from their zone's dock tree
   *  entirely, so they consume no layout space; reopening re-inserts them as a new stacked leaf
   *  in their current `panel.region`. Field name kept as `hiddenPanels` in the persisted shape
   *  only (see `domain/ports/layout-store.ts`). */
  private readonly closedPanelIds = new Set<string>();
  /** Whole-panel collapse (item 5) — the panel stays part of the workspace and its header stays
   *  visible; only `content` hides. Session-only, never persisted (data-model.md). */
  private readonly collapsedPanelIds = new Set<string>();
  private preset: string;

  /** Set while a relocation (or tab-reorder) drag is in progress; `null` otherwise. */
  private draggingPanelId: string | null = null;

  constructor(options: DockLayoutOptions) {
    this.document = options.document;
    this.onSizesChange = options.onSizesChange;
    this.onLayoutChange = options.onLayoutChange;
    this.sizes = options.initialSizes ?? DEFAULT_PANEL_SIZES;
    this.preset = options.initialPreset ?? DEFAULT_LAYOUT_PRESET;
    this.activeLayoutId =
      options.initialActiveLayoutId !== undefined &&
      LAYOUTS[options.initialActiveLayoutId] !== undefined
        ? options.initialActiveLayoutId
        : DEFAULT_LAYOUT_ID;
    for (const id of options.initialHiddenPanels ?? []) {
      this.closedPanelIds.add(id);
    }

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-layout';

    const menu = this.section('mudra-layout__menu');
    const left = this.section('mudra-layout__left');
    const center = this.section('mudra-layout__center');
    const right = this.section('mudra-layout__right');
    const timeline = this.section('mudra-layout__timeline');
    this.slots = { menu, left, center, right, timeline };

    // The one shipped layout's zone ids are exactly these three slot keys (research D1). A
    // second layout with different zones would extend this map, not restructure it.
    this.zoneElements.set('left', left);
    this.zoneElements.set('right', right);
    this.zoneElements.set('timeline', timeline);
    for (const [zoneId, element] of this.zoneElements) {
      element.setAttribute(DOCK_ZONE_ATTR, zoneId);
    }

    // Seed each valid zone's tree from the stored record, and remember where every panel it
    // names already sits — `registerPanel` consults this so a panel a saved arrangement placed
    // (in a stack, a split, or a tab group) keeps that exact structure, and only a genuinely new
    // panel (named nowhere) falls back to a fresh stacked leaf of its own.
    const validZoneIds = new Set(zonesOf(this.activeLayoutId).map((zone) => zone.id));
    for (const [zoneId, tree] of Object.entries(options.initialZoneLayouts ?? {})) {
      if (!validZoneIds.has(zoneId)) {
        continue;
      }
      this.zoneTrees.set(zoneId, tree);
      for (const panelId of listPanelIds(tree)) {
        this.persistedPanelZone.set(panelId, zoneId);
      }
    }

    const leftSplitter = this.splitter('mudra-layout__splitter--left', 'Resize the left panel');
    const rightSplitter = this.splitter('mudra-layout__splitter--right', 'Resize the right panel');
    const timelineSplitter = this.splitter(
      'mudra-layout__splitter--timeline',
      'Resize the timeline',
    );

    this.root.append(
      menu,
      left,
      leftSplitter,
      center,
      timelineSplitter,
      timeline,
      rightSplitter,
      right,
    );

    this.wireHorizontalSplitter(leftSplitter, 'leftWidth', 1);
    this.wireHorizontalSplitter(rightSplitter, 'rightWidth', -1);
    this.wireVerticalSplitter(timelineSplitter, 'timelineHeight', -1);
    this.wireRelocationDrag();

    const resetButton = this.document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'mudra-layout__reset-button';
    resetButton.textContent = 'Reset Layout';
    resetButton.title =
      'Restore the left/right panel widths and timeline height to their defaults.';
    resetButton.addEventListener('click', () => this.resetToDefault());
    menu.append(resetButton);

    this.applySizes();
    for (const zoneId of this.zoneElements.keys()) {
      this.renderZone(zoneId);
    }
  }

  /** The current panel sizes (device pixels). */
  getSizes(): PanelSizes {
    return this.sizes;
  }

  /** The preset last applied, for the View menu's own checkmark. */
  get currentPreset(): string {
    return this.preset;
  }

  /** The predefined docking layout currently active. */
  get currentLayoutId(): string {
    return this.activeLayoutId;
  }

  /**
   * Switch the active predefined layout (FR-007). An unknown id, or the layout already
   * active, is inert — the same tolerance `applyPreset` already has for size presets.
   *
   * Every panel stays exactly where it is, in whichever zone of the new layout shares that zone
   * id; a panel whose current zone the new layout does not have falls back to its own default
   * zone in the new layout instead (spec Edge Cases).
   */
  applyLayout(layoutId: string): void {
    if (LAYOUTS[layoutId] === undefined || layoutId === this.activeLayoutId) {
      return;
    }
    this.activeLayoutId = layoutId;
    const validZoneIds = new Set(zonesOf(layoutId).map((zone) => zone.id));

    for (const [panelId, entry] of this.panels) {
      if (validZoneIds.has(entry.panel.region)) {
        continue;
      }
      const fallbackZone = defaultZoneFor(layoutId, panelId) ?? entry.panel.region;
      if (!this.closedPanelIds.has(panelId)) {
        this.zoneTrees.set(
          entry.panel.region,
          removePanel(this.zoneTrees.get(entry.panel.region) ?? null, panelId),
        );
        this.zoneTrees.set(
          fallbackZone,
          appendStacked(this.zoneTrees.get(fallbackZone) ?? null, panelId),
        );
      }
      this.panels.set(panelId, { ...entry, panel: { ...entry.panel, region: fallbackZone } });
    }
    for (const zoneId of this.zoneElements.keys()) {
      this.renderZone(zoneId);
    }
    this.onLayoutChange?.(this.getLayout());
  }

  /**
   * Mount `panel` into its resolved zone, wrapped in a host section the layout can hide and
   * relocate.
   *
   * Resolution order: a saved arrangement's placement for this panel, else the active layout's
   * own default for it, else the `region` the caller supplied (today's behaviour, unchanged,
   * for a panel the active layout names no default for). A panel not named anywhere in a saved
   * arrangement becomes its own stacked leaf — never an automatic tab group.
   *
   * The wrapper is what makes hiding non-destructive: the panel's own element is never
   * removed, so a closed panel stays registered, stays listed in View, and comes back
   * exactly as it was.
   */
  registerPanel(panel: DockPanel): HTMLElement {
    const zoneId =
      this.persistedPanelZone.get(panel.id) ??
      defaultZoneFor(this.activeLayoutId, panel.id) ??
      panel.region;

    const host = this.document.createElement('section');
    host.className = 'mudra-editor__panel-section';
    host.dataset['panelId'] = panel.id;

    const closed = this.closedPanelIds.has(panel.id);
    const { header, collapseButton } = this.buildPanelHeader(panel.id, panel.label);
    // The single content-scroll boundary (spec 010 workspace UX corrections pass, item 5,
    // FR-044) — the header stays put (`.mudra-layout__panel-header { flex: 0 0 auto }`) while only
    // this class's own box scrolls, one extra class on the panel's own root, no new wrapper.
    panel.element.classList.add('mudra-editor__panel-content');
    host.append(header, panel.element);

    this.panels.set(panel.id, {
      panel: { id: panel.id, label: panel.label, region: zoneId },
      host,
      header,
      content: panel.element,
      collapseButton,
    });

    if (!closed && !this.persistedPanelZone.has(panel.id)) {
      // Not named anywhere in a saved arrangement — its own stacked leaf (never auto-tabbed).
      this.zoneTrees.set(zoneId, appendStacked(this.zoneTrees.get(zoneId) ?? null, panel.id));
    }

    this.renderZone(zoneId);
    return host;
  }

  /** Every registered panel, closed ones included — that is what makes them reopenable. */
  listPanels(): readonly RegisteredPanel[] {
    return [...this.panels.values()].map((entry) => entry.panel);
  }

  /** Whether `id` names a registered panel that is currently open (not closed). */
  isPanelVisible(id: string): boolean {
    return this.panels.has(id) && !this.closedPanelIds.has(id);
  }

  /**
   * Open or close a panel (spec 010 correction pass, item 4). Closing removes it from its
   * zone's dock tree outright — it stops consuming layout space, not merely hides in place.
   * Reopening re-inserts it as a new stacked leaf in its current zone (its default zone, unless
   * it was explicitly relocated since).
   *
   * An unknown id and a no-op change are both inert — neither throws, and neither writes a
   * redundant layout record.
   */
  setPanelVisible(id: string, visible: boolean): void {
    const entry = this.panels.get(id);
    if (entry === undefined || this.isPanelVisible(id) === visible) {
      return;
    }
    const zoneId = entry.panel.region;
    // Set directly, ahead of `renderZone`'s own reconciliation — a closed panel's `host` is
    // detached from the DOM entirely (it consumes no layout space at all), but `.hidden` stays
    // an accurate, independently-checkable signal of "not currently shown" either way.
    entry.host.hidden = !visible;
    if (visible) {
      this.closedPanelIds.delete(id);
      this.zoneTrees.set(zoneId, appendStacked(this.zoneTrees.get(zoneId) ?? null, id));
    } else {
      this.closedPanelIds.add(id);
      this.zoneTrees.set(zoneId, removePanel(this.zoneTrees.get(zoneId) ?? null, id));
    }
    this.renderZone(zoneId);
    this.onLayoutChange?.(this.getLayout());
  }

  /** Flip a panel's open/closed state. */
  togglePanel(id: string): void {
    if (this.panels.has(id)) {
      this.setPanelVisible(id, this.closedPanelIds.has(id));
    }
  }

  /**
   * Open a panel that may be closed, and never close one.
   *
   * The editor calls this when a selection needs a surface the author has closed: revealing
   * answers the selection, whereas a toggle here could close the very panel being asked for.
   */
  revealPanel(id: string): void {
    this.setPanelVisible(id, true);
  }

  /** Whether `id` names a panel currently collapsed to its header (spec 010 correction pass,
   *  item 5). Distinct from closed: a collapsed panel is still part of the workspace. */
  isPanelCollapsed(id: string): boolean {
    return this.collapsedPanelIds.has(id);
  }

  /**
   * Collapse or expand a whole panel to a compact, header-only state — a general mechanism every
   * registered panel gets for free, not something each panel implements for itself (spec 010
   * correction pass, item 5). Session-only: never persisted, never removes the panel from its
   * zone or from the View menu.
   */
  setPanelCollapsed(id: string, collapsed: boolean): void {
    const entry = this.panels.get(id);
    if (entry === undefined || this.collapsedPanelIds.has(id) === collapsed) {
      return;
    }
    if (collapsed) {
      this.collapsedPanelIds.add(id);
    } else {
      this.collapsedPanelIds.delete(id);
    }
    entry.content.hidden = collapsed;
    this.updateCollapseButton(entry.collapseButton, collapsed, entry.panel.label);
  }

  /** Flip a panel's collapsed state. */
  togglePanelCollapsed(id: string): void {
    if (this.panels.has(id)) {
      this.setPanelCollapsed(id, !this.collapsedPanelIds.has(id));
    }
  }

  /**
   * Relocate `panelId` into `targetZoneId`.
   *
   * `target === null` appends it as a new stacked leaf at the end of the zone (an empty-
   * background drop, or the keyboard "Move to \<zone\>" command — spec 010 FR-010, never an
   * automatic tab group). `target` naming another panel and a `DropRegion` inserts adjacent to
   * it (`top`/`bottom`/`left`/`right`) or merges into its tab group (`center`).
   *
   * A no-op — not an error — when the panel or zone is unknown, or the drop genuinely changes
   * nothing (already there, in the same position): dragging a panel over its own leaf, or
   * releasing it somewhere invalid, must never re-mount it or lose its own internal state
   * (e.g. an open colour picker).
   */
  relocatePanel(
    panelId: string,
    targetZoneId: string,
    target: { readonly relativeToPanelId: string; readonly region: DropRegion } | null,
  ): void {
    const entry = this.panels.get(panelId);
    if (entry === undefined || !this.zoneElements.has(targetZoneId)) {
      return;
    }
    if (target !== null && target.relativeToPanelId === panelId) {
      return; // Dropped on itself — never a meaningful move.
    }

    const sourceZoneId = entry.panel.region;
    const sameZone = sourceZoneId === targetZoneId;
    const withoutPanel = removePanel(this.zoneTrees.get(sourceZoneId) ?? null, panelId);
    const destBefore = sameZone ? withoutPanel : (this.zoneTrees.get(targetZoneId) ?? null);

    let destAfter: DockNode;
    if (target === null || destBefore === null) {
      destAfter = appendStacked(destBefore, panelId);
    } else {
      destAfter =
        applyDrop(destBefore, target.relativeToPanelId, panelId, target.region) ??
        appendStacked(destBefore, panelId);
    }

    if (
      sameZone &&
      JSON.stringify(destAfter) === JSON.stringify(this.zoneTrees.get(sourceZoneId) ?? null)
    ) {
      return; // Genuinely unchanged — no re-mount, no re-render (Edge Case).
    }

    this.zoneTrees.set(sourceZoneId, sameZone ? destAfter : withoutPanel);
    if (!sameZone) {
      this.zoneTrees.set(targetZoneId, destAfter);
    }
    this.panels.set(panelId, { ...entry, panel: { ...entry.panel, region: targetZoneId } });

    // An author who just moved a panel into a tab group expects to see it, not a sibling that
    // beat it (US3 precedent, kept from the pre-correction behaviour).
    const landedLeaf = findLeafOf(destAfter, panelId);
    if (landedLeaf !== null && landedLeaf.panelIds.length > 1) {
      this.activeTab.set(leafKey(landedLeaf.panelIds), panelId);
    }

    this.renderZone(sourceZoneId);
    if (!sameZone) {
      this.renderZone(targetZoneId);
    }
    this.onLayoutChange?.(this.getLayout());
  }

  /** Apply a named preset's sizes. An unknown name is inert rather than clearing the layout. */
  applyPreset(name: string): void {
    const sizes = LAYOUT_PRESETS[name];
    if (sizes === undefined) {
      return;
    }
    this.preset = name;
    this.sizes = sizes;
    this.applySizes();
    this.onLayoutChange?.(this.getLayout());
  }

  /** The whole chrome state as one persistable record. */
  getLayout(): EditorLayout {
    const zoneLayouts: Record<string, DockNodeData> = {};
    for (const [zoneId, tree] of this.zoneTrees) {
      if (tree !== null) {
        zoneLayouts[zoneId] = tree;
      }
    }
    return {
      ...this.sizes,
      hiddenPanels: [...this.panels.keys()].filter((id) => this.closedPanelIds.has(id)),
      preset: this.preset,
      activeLayoutId: this.activeLayoutId,
      zoneLayouts,
    };
  }

  /** Restore the shipped default sizes, and reopen every closed panel. Docking structure is
   *  otherwise untouched — "Reset Layout" is about sizes and visibility, the same as before this
   *  feature; a docking reset is a separate, not-yet-offered action (spec Out of Scope). */
  resetToDefault(): void {
    this.sizes = DEFAULT_PANEL_SIZES;
    this.preset = DEFAULT_LAYOUT_PRESET;
    for (const id of [...this.closedPanelIds]) {
      const entry = this.panels.get(id);
      if (entry === undefined) {
        continue;
      }
      this.closedPanelIds.delete(id);
      this.zoneTrees.set(
        entry.panel.region,
        appendStacked(this.zoneTrees.get(entry.panel.region) ?? null, id),
      );
    }
    for (const zoneId of this.zoneElements.keys()) {
      this.renderZone(zoneId);
    }
    this.applySizes();
    this.onSizesChange?.(this.sizes);
    this.onLayoutChange?.(this.getLayout());
  }

  /**
   * Rebuild one zone's DOM from its dock tree.
   *
   * Sanitizes against currently-registered, open panels first (a persisted tree naming an
   * unregistered or closed panel id is tolerated, silently dropped — contracts/
   * docking-persistence.md) and caches the sanitized result back onto `zoneTrees`, so every
   * later mutation works from the clean shape. Chrome wrappers (split containers, tab strips)
   * are rebuilt freely on every call; panel `host` elements are always *moved* via `.append()`,
   * never recreated, so a panel's own internal DOM/state survives every relocation.
   */
  private renderZone(zoneId: string): void {
    const container = this.zoneElements.get(zoneId);
    if (container === undefined) {
      return;
    }
    const known = new Set([...this.panels.keys()].filter((id) => !this.closedPanelIds.has(id)));
    const sanitized = sanitize(this.zoneTrees.get(zoneId) ?? null, known);
    this.zoneTrees.set(zoneId, sanitized);

    container.replaceChildren();
    if (sanitized !== null) {
      container.append(this.renderNode(sanitized, zoneId));
    }

    // Collapsed means "every panel *assigned* to this zone is closed" — a zone with nothing
    // assigned to it at all (every panel relocated elsewhere) is not collapsed (FR-002); those
    // are different states even though both currently render nothing.
    const inZone = [...this.panels.values()].filter((entry) => entry.panel.region === zoneId);
    const collapsed =
      inZone.length > 0 && inZone.every((entry) => this.closedPanelIds.has(entry.panel.id));
    this.root.dataset[zoneId + 'Collapsed'] = collapsed ? 'true' : 'false';
  }

  /**
   * Render one dock-tree node: a split's children side by side or stacked, or a leaf's tab
   * strip (only when it holds more than one panel — FR-014) plus whichever member is active.
   *
   * `zoneId` + `path` (this node's own list of child indices from the zone's root, `[]` for the
   * root itself) is a split's only identity — it has none of its own — so a resize handle built
   * for one (`buildResizeHandle`) can find its way back to the right node in `zoneTrees` at
   * `pointerup`, via `withSplitSizesAtPath` (spec 010 workspace UX corrections pass, item 4,
   * FR-042).
   */
  private renderNode(node: DockNode, zoneId: string, path: readonly number[] = []): HTMLElement {
    if (node.kind === 'split') {
      const wrapper = this.document.createElement('div');
      wrapper.className = 'mudra-layout__split mudra-layout__split--' + node.direction;
      const sizes = node.sizes;
      const childElements = node.children.map((child, index) => {
        const element = this.renderNode(child, zoneId, [...path, index]);
        if (sizes !== undefined) {
          element.style.flex = String(sizes[index] ?? 1) + ' 1 0';
        }
        return element;
      });
      childElements.forEach((element, index) => {
        wrapper.append(element);
        if (index < childElements.length - 1) {
          wrapper.append(
            this.buildResizeHandle(
              zoneId,
              path,
              node,
              index,
              wrapper,
              element,
              childElements[index + 1]!,
            ),
          );
        }
      });
      return wrapper;
    }

    const wrapper = this.document.createElement('div');
    wrapper.className = 'mudra-layout__leaf';
    wrapper.setAttribute(DOCK_LEAF_ATTR, node.panelIds.join(','));

    let active = this.activeTab.get(leafKey(node.panelIds));
    if (active === undefined || !node.panelIds.includes(active)) {
      active = node.panelIds[0]!;
      this.activeTab.set(leafKey(node.panelIds), active);
    }

    if (node.panelIds.length > 1) {
      const strip = this.document.createElement('div');
      strip.className = 'mudra-layout__zone-tabs';
      strip.setAttribute('role', 'tablist');
      for (const panelId of node.panelIds) {
        const entry = this.panels.get(panelId);
        if (entry === undefined) {
          continue;
        }
        const isActive = panelId === active;
        const tab = this.document.createElement('button');
        tab.type = 'button';
        tab.className = 'mudra-layout__zone-tab';
        tab.dataset['zoneTab'] = panelId;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        const label = this.document.createElement('span');
        label.textContent = entry.panel.label;
        tab.append(label);
        tab.addEventListener('click', () => {
          this.activeTab.set(leafKey(node.panelIds), panelId);
          this.renderZone(entry.panel.region);
        });
        // Also the drag origin for reordering within this strip, or dragging out to undock
        // (spec 010 workspace UX corrections pass, item 3, FR-043) — the same `draggingPanelId`
        // machinery `buildPanelHeader` starts; `wireRelocationDrag` is what tells the two apart,
        // by where the pointer ends up, never by how the drag began.
        tab.addEventListener('pointerdown', (event) => {
          if ((event.target as HTMLElement).closest('.mudra-layout__zone-tab-close')) {
            return;
          }
          event.preventDefault();
          this.beginDrag(panelId);
        });

        const close = this.document.createElement('button');
        close.type = 'button';
        close.className = 'mudra-layout__zone-tab-close';
        close.setAttribute('aria-label', 'Close ' + entry.panel.label);
        close.title = 'Close ' + entry.panel.label + ' (reopen it from the View menu).';
        close.append(icon(this.document, 'close', 12));
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          this.setPanelVisible(panelId, false);
        });
        tab.append(close);

        strip.append(tab);
      }
      wrapper.append(strip);
    }

    for (const panelId of node.panelIds) {
      const entry = this.panels.get(panelId);
      if (entry === undefined) {
        continue;
      }
      entry.host.hidden = panelId !== active;
      wrapper.append(entry.host);
    }
    return wrapper;
  }

  /**
   * A resize handle for the boundary between `beforeEl`/`afterEl` — `node.children[index]` and
   * `[index + 1]` — within one split (spec 010 workspace UX corrections pass, item 4, FR-042).
   * Mirrors `wireSplitter`'s own pattern: one `getBoundingClientRect()` read on `pointerdown`
   * only (never interleaved into `pointermove`), live visual feedback written directly via
   * `style.flex` on every move, and the settled `sizes` committed — via `withSplitSizesAtPath` at
   * this handle's own `path` — only on release.
   */
  private buildResizeHandle(
    zoneId: string,
    path: readonly number[],
    node: Extract<DockNode, { kind: 'split' }>,
    index: number,
    container: HTMLElement,
    beforeEl: HTMLElement,
    afterEl: HTMLElement,
  ): HTMLElement {
    const handle = this.document.createElement('div');
    handle.className = 'mudra-layout__resize-handle mudra-layout__resize-handle--' + node.direction;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', node.direction === 'row' ? 'vertical' : 'horizontal');
    handle.title = 'Resize.';

    let dragging = false;
    let startPos = 0;
    let containerSizePx = 0;
    let startSizes: readonly number[] = [];
    let pendingSizes: readonly number[] | null = null;

    const axisValue = (event: PointerEvent): number =>
      node.direction === 'row' ? event.clientX : event.clientY;

    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      pendingSizes = null;
      startPos = axisValue(event);
      startSizes = node.sizes ?? equalSizes(node.children.length);
      const rect = container.getBoundingClientRect();
      containerSizePx = node.direction === 'row' ? rect.width : rect.height;
      safeSetPointerCapture(handle, event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const delta = axisValue(event) - startPos;
      const next = resizeSplitSizes(startSizes, index, delta, containerSizePx, MIN_LEAF_SIZE_PX);
      pendingSizes = next;
      beforeEl.style.flex = String(next[index]) + ' 1 0';
      afterEl.style.flex = String(next[index + 1]) + ' 1 0';
    });
    const end = (): void => {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (pendingSizes !== null) {
        const tree = this.zoneTrees.get(zoneId) ?? null;
        if (tree !== null) {
          this.zoneTrees.set(zoneId, withSplitSizesAtPath(tree, path, pendingSizes));
          this.onLayoutChange?.(this.getLayout());
        }
      }
      pendingSizes = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    return handle;
  }

  /** Reorder `panelId` to `toIndex` within its own tab group (spec 010 workspace UX corrections
   *  pass, item 3, FR-043) — `wireRelocationDrag`'s `end()` is the only caller, once a drag ends
   *  inside the panel's own tab strip rather than over a docking target. An unknown panel, or one
   *  that has stopped being part of a leaf its zone's tree still recognizes, is a no-op. */
  private reorderPanelTab(panelId: string, toIndex: number): void {
    const entry = this.panels.get(panelId);
    if (entry === undefined) {
      return;
    }
    const zoneId = entry.panel.region;
    const tree = this.zoneTrees.get(zoneId) ?? null;
    if (tree === null) {
      return;
    }
    const reordered = reorderTab(tree, panelId, toIndex);
    if (reordered === null) {
      return;
    }
    this.zoneTrees.set(zoneId, reordered);
    this.renderZone(zoneId);
    this.onLayoutChange?.(this.getLayout());
  }

  private section(className: string): HTMLElement {
    const element = this.document.createElement('div');
    element.className = className;
    return element;
  }

  private splitter(className: string, label: string): HTMLElement {
    const element = this.document.createElement('div');
    element.className = 'mudra-layout__splitter ' + className;
    element.title = label;
    element.setAttribute('role', 'separator');
    return element;
  }

  private applySizes(): void {
    this.root.style.setProperty('--mudra-layout-left-w', this.sizes.leftWidth + 'px');
    this.root.style.setProperty('--mudra-layout-right-w', this.sizes.rightWidth + 'px');
    this.root.style.setProperty('--mudra-layout-timeline-h', this.sizes.timelineHeight + 'px');
  }

  /**
   * The per-panel docking header: a drag handle carrying the panel's label (the primary way to
   * relocate a panel — spec 010 correction pass, item 2), a collapse toggle, a close button, and
   * a "⋮" menu hosting the keyboard-operable relocation command (FR-010), its one non-duplicated
   * purpose since Close/Collapse already have their own dedicated buttons right here (workspace
   * UX corrections pass) — deliberately not a standalone, always-visible "Relocate" affordance
   * competing with the drag handle for attention.
   */
  private buildPanelHeader(
    panelId: string,
    label: string,
  ): { header: HTMLElement; collapseButton: HTMLButtonElement } {
    const header = this.document.createElement('div');
    header.className = 'mudra-layout__panel-header';
    header.dataset['panelHeader'] = panelId;
    header.title = 'Drag to move the ' + label + ' panel.';
    header.addEventListener('pointerdown', (event) => {
      // Not one of this header's own buttons/popover — those have their own click handling, and
      // a press there must never also start a drag.
      if ((event.target as Node) !== header && (event.target as HTMLElement).closest('button')) {
        return;
      }
      // Stop the native text-selection gesture at its origin (FR-041, workspace UX corrections
      // pass) — the `mudra-layout--dragging` class `beginDrag` toggles is the cleanup half, this
      // is the "never let it start" half. Safe to call unconditionally here: the guard above
      // already excluded every header button, so a click on one is never affected.
      event.preventDefault();
      // Deliberately no `setPointerCapture` here, unlike the splitters: capturing would
      // redirect every subsequent pointer event's `target` to `header` regardless of what is
      // really under the cursor, which is exactly the information `wireRelocationDrag`'s
      // hit-testing needs real `event.target`/`closest()` resolution to read.
      this.beginDrag(panelId);
    });

    const labelSpan = this.document.createElement('span');
    labelSpan.className = 'mudra-layout__panel-header-label';
    labelSpan.textContent = label;
    header.append(labelSpan);

    const collapseButton = this.document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'mudra-layout__panel-collapse';
    collapseButton.dataset['collapseTrigger'] = panelId;
    collapseButton.addEventListener('click', () => this.togglePanelCollapsed(panelId));
    this.updateCollapseButton(collapseButton, false, label);
    header.append(collapseButton);

    const closeButton = this.document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'mudra-layout__panel-close';
    closeButton.dataset['closeTrigger'] = panelId;
    closeButton.setAttribute('aria-label', 'Close ' + label);
    closeButton.title = 'Close ' + label + ' (reopen it from the View menu).';
    closeButton.append(icon(this.document, 'close', 14));
    closeButton.addEventListener('click', () => this.setPanelVisible(panelId, false));
    header.append(closeButton);

    const { menuButton, popover } = this.buildPanelMenu(panelId, label);
    header.append(menuButton, popover);

    return { header, collapseButton };
  }

  /** Icon and accessible name for a panel's collapse toggle (spec 010 correction pass, item 5),
   *  the whole-panel analogue of `Inspector`'s per-section one. */
  private updateCollapseButton(button: HTMLButtonElement, collapsed: boolean, label: string): void {
    button.replaceChildren(icon(this.document, collapsed ? 'chevronRight' : 'chevronDown', 14));
    button.setAttribute('aria-expanded', String(!collapsed));
    const text = (collapsed ? 'Expand ' : 'Collapse ') + label;
    button.setAttribute('aria-label', text);
    button.title = text;
  }

  /**
   * The "⋮" menu: the keyboard-operable relocation command (FR-010 — "Move to \<zone\>", always a
   * fresh stacked leaf there, never an automatic tab group).
   *
   * Workspace UX corrections pass: this used to also duplicate Close and Collapse/Expand, but
   * both already have their own dedicated, always-visible header buttons right next to this
   * trigger (`buildPanelHeader`'s `collapseButton`/`closeButton`) — offering them a second time
   * here was redundant chrome, not distinct functionality, so this menu is trimmed to its one
   * non-duplicated purpose. Nothing FR-010/FR-021/FR-030 requires is lost.
   */
  private buildPanelMenu(
    panelId: string,
    label: string,
  ): { menuButton: HTMLButtonElement; popover: HTMLElement } {
    const menuButton = this.document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'mudra-layout__panel-menu-trigger';
    menuButton.dataset['relocateTrigger'] = panelId;
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Move ' + label + ' to…');
    menuButton.title = 'Move ' + label + ' to a different zone.';
    menuButton.append(icon(this.document, 'panelMenu', 14));

    const popover = this.document.createElement('div');
    popover.className = 'mudra-layout__panel-menu-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'menu');

    const closePopover = (): void => {
      popover.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
    };
    const option = (
      text: string,
      onSelect: () => void,
      relocateTargetZoneId?: string,
    ): HTMLButtonElement => {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'mudra-layout__panel-menu-option';
      button.setAttribute('role', 'menuitem');
      if (relocateTargetZoneId !== undefined) {
        // Kept as its own attribute (distinct from the option's visible text) so a test — and a
        // future automated agent — can target "move to this zone" specifically (FR-010).
        button.dataset['relocateTarget'] = relocateTargetZoneId;
      }
      button.textContent = text;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect();
        closePopover();
      });
      return button;
    };
    const rebuildOptions = (): void => {
      popover.replaceChildren();
      const currentZoneId = this.panels.get(panelId)?.panel.region;
      for (const zone of zonesOf(this.activeLayoutId)) {
        if (zone.id === currentZoneId) {
          continue; // FR-005's rule, for the keyboard path: not a target it is already at.
        }
        popover.append(
          option(
            'Move to ' + zone.label,
            () => {
              this.relocatePanel(panelId, zone.id, null);
            },
            zone.id,
          ),
        );
      }
    };

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = popover.hidden;
      // One popover open at a time: closing every other panel's first is simplest and matches
      // the menu bar's own "opening one closes the last" discipline.
      this.document
        .querySelectorAll<HTMLElement>('.mudra-layout__panel-menu-popover')
        .forEach((element) => {
          element.hidden = true;
        });
      this.document
        .querySelectorAll<HTMLButtonElement>('.mudra-layout__panel-menu-trigger')
        .forEach((button) => button.setAttribute('aria-expanded', 'false'));
      if (opening) {
        rebuildOptions();
        popover.hidden = false;
        menuButton.setAttribute('aria-expanded', 'true');
      }
    });
    this.document.addEventListener('pointerdown', (event) => {
      if (!popover.hidden && !menuButton.parentElement?.contains(event.target as Node)) {
        closePopover();
      }
    });

    return { menuButton, popover };
  }

  /** Start a relocation-or-reorder drag from either a panel's header or one of its tabs (spec 010
   *  workspace UX corrections pass, FR-041/FR-043) — the one place `draggingPanelId` is set, so
   *  the drag-scoped `user-select: none` (FR-041) and the drag's own teardown in
   *  `wireRelocationDrag`'s `end()` always pair up. */
  private beginDrag(panelId: string): void {
    this.draggingPanelId = panelId;
    this.root.classList.add('mudra-layout--dragging');
  }

  /**
   * Relocation-and-reorder drag: `pointerdown` on a panel's header or one of its tabs begins it
   * (`beginDrag`); `pointermove` resolves the element directly under the pointer's nearest
   * `[data-dock-leaf]` ancestor (a specific tab group — highlighted with the edge/centre
   * `drop-region.ts` resolves from real geometry) or, failing that, its nearest `[data-dock-zone]`
   * ancestor (empty background); `pointerup` docks the panel there via `relocatePanel`, or leaves
   * it exactly where it was if the pointer was never over a valid target (FR-006).
   *
   * Hovering the dragged panel's *own* tab group is the one case that used to be a pure no-op
   * (Edge Case — dropping a panel back onto the exact group it started in must never un-tab it as
   * a side effect) and now has a second meaning: hovering that group's own tab strip specifically
   * previews a **reorder** within it (spec 010 workspace UX corrections pass, item 3, FR-043).
   * The two stay unambiguous because they're mutually exclusive branches of this same handler,
   * selected purely by where the pointer physically is — reorder only while inside the strip of
   * the panel's own group; anywhere else in its own group (e.g. its content) is still the
   * original untouched no-op; anywhere outside its own group is an ordinary relocation/undock.
   */
  private wireRelocationDrag(): void {
    let currentZoneId: string | null = null;
    let currentLeafElement: HTMLElement | null = null;
    let currentRegion: DropRegion | null = null;

    let reorderToIndex: number | null = null;
    let reorderMarkerElement: HTMLElement | null = null;
    let reorderMarkerAttr: 'data-tab-insert-before' | 'data-tab-insert-after' | null = null;

    const clearHighlight = (): void => {
      if (currentZoneId !== null) {
        this.zoneElement(currentZoneId).removeAttribute('data-drop-target');
      }
      if (currentLeafElement !== null) {
        currentLeafElement.removeAttribute('data-drop-target');
        currentLeafElement.removeAttribute('data-drop-position');
      }
      currentZoneId = null;
      currentLeafElement = null;
      currentRegion = null;
    };

    const clearReorderPreview = (): void => {
      if (reorderMarkerElement !== null && reorderMarkerAttr !== null) {
        reorderMarkerElement.removeAttribute(reorderMarkerAttr);
      }
      reorderToIndex = null;
      reorderMarkerElement = null;
      reorderMarkerAttr = null;
    };

    this.document.addEventListener('pointermove', (event) => {
      if (this.draggingPanelId === null) {
        return;
      }
      const target = event.target as Element | null;
      const zoneElement = target?.closest<HTMLElement>('[' + DOCK_ZONE_ATTR + ']') ?? null;
      const zoneId = zoneElement?.getAttribute(DOCK_ZONE_ATTR) ?? null;
      const leafElement = target?.closest<HTMLElement>('[' + DOCK_LEAF_ATTR + ']') ?? null;
      const leafIsOwnGroup =
        leafElement !== null &&
        (leafElement.getAttribute(DOCK_LEAF_ATTR) ?? '').split(',').includes(this.draggingPanelId);

      if (leafIsOwnGroup) {
        clearHighlight();
        const strip = leafElement.querySelector<HTMLElement>('.mudra-layout__zone-tabs');
        const overStrip = strip !== null && target?.closest('.mudra-layout__zone-tabs') === strip;
        if (!overStrip) {
          clearReorderPreview();
          return;
        }
        const tabs = [...strip.querySelectorAll<HTMLElement>('[data-zone-tab]')].filter(
          (tab) => tab.dataset['zoneTab'] !== this.draggingPanelId,
        );
        const pointerX = event.clientX;
        let toIndex = tabs.length;
        for (let i = 0; i < tabs.length; i += 1) {
          const rect = tabs[i]!.getBoundingClientRect();
          if (pointerX < rect.left + rect.width / 2) {
            toIndex = i;
            break;
          }
        }
        if (toIndex === reorderToIndex) {
          return;
        }
        clearReorderPreview();
        reorderToIndex = toIndex;
        if (tabs.length === 0) {
          return; // A tab strip only renders for >1 panel, so this can't happen in practice —
          // tolerated rather than assumed, matching this file's usual no-throw discipline.
        }
        reorderMarkerElement = toIndex < tabs.length ? tabs[toIndex]! : tabs[tabs.length - 1]!;
        reorderMarkerAttr =
          toIndex < tabs.length ? 'data-tab-insert-before' : 'data-tab-insert-after';
        reorderMarkerElement.setAttribute(reorderMarkerAttr, 'true');
        return;
      }
      clearReorderPreview();

      if (leafElement !== null && zoneId !== null) {
        const rect = leafElement.getBoundingClientRect();
        const region = resolveDropRegion(
          { width: rect.width, height: rect.height },
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
        if (leafElement === currentLeafElement && region === currentRegion) {
          return;
        }
        clearHighlight();
        currentZoneId = zoneId;
        currentLeafElement = leafElement;
        currentRegion = region;
        leafElement.setAttribute('data-drop-target', 'true');
        leafElement.setAttribute('data-drop-position', region);
        return;
      }

      if (zoneId === currentZoneId && currentLeafElement === null) {
        return;
      }
      clearHighlight();
      if (zoneId !== null) {
        zoneElement!.setAttribute('data-drop-target', 'true');
        currentZoneId = zoneId;
      }
    });

    const end = (): void => {
      if (this.draggingPanelId === null) {
        return;
      }
      const panelId = this.draggingPanelId;
      const zoneId = currentZoneId;
      const leafElement = currentLeafElement;
      const region = currentRegion;
      const reorderIndex = reorderToIndex;
      this.draggingPanelId = null;
      this.root.classList.remove('mudra-layout--dragging');
      clearHighlight();
      clearReorderPreview();

      if (reorderIndex !== null) {
        this.reorderPanelTab(panelId, reorderIndex);
        return;
      }
      if (zoneId === null) {
        return; // Never over a valid target — no-op (FR-006).
      }
      if (leafElement !== null && region !== null) {
        const relativeToPanelId = (leafElement.getAttribute(DOCK_LEAF_ATTR) ?? '').split(',')[0]!;
        this.relocatePanel(panelId, zoneId, { relativeToPanelId, region });
      } else {
        this.relocatePanel(panelId, zoneId, null);
      }
    };
    this.document.addEventListener('pointerup', end);
    this.document.addEventListener('pointercancel', end);
  }

  private zoneElement(zoneId: string): HTMLElement {
    return this.zoneElements.get(zoneId) ?? this.slots.left;
  }

  /** @param sign +1 when dragging right grows the dimension, -1 when dragging right shrinks it. */
  private wireHorizontalSplitter(
    handle: HTMLElement,
    dimension: 'leftWidth' | 'rightWidth',
    sign: 1 | -1,
  ): void {
    this.wireSplitter(handle, dimension, sign, (event) => event.clientX);
  }

  /** @param sign +1 when dragging down grows the dimension, -1 when dragging down shrinks it. */
  private wireVerticalSplitter(
    handle: HTMLElement,
    dimension: 'timelineHeight',
    sign: 1 | -1,
  ): void {
    this.wireSplitter(handle, dimension, sign, (event) => event.clientY);
  }

  private wireSplitter(
    handle: HTMLElement,
    dimension: keyof PanelSizes,
    sign: 1 | -1,
    axisValue: (event: PointerEvent) => number,
  ): void {
    let dragging = false;
    let startPos = 0;
    let startSize = 0;

    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      startPos = axisValue(event);
      startSize = this.sizes[dimension];
      safeSetPointerCapture(handle, event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const delta = axisValue(event) - startPos;
      const next = clampPanelSize(dimension, startSize + sign * delta);
      this.sizes = { ...this.sizes, [dimension]: next };
      this.applySizes();
    });
    const end = (): void => {
      if (!dragging) {
        return;
      }
      dragging = false;
      this.onSizesChange?.(this.sizes);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
