/**
 * A modular, dock-like layout foundation for the editor shell (items 8–11).
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
 * This class owns no persistence — like `Timeline`'s `onMove`/`onResize`, it only dispatches
 * `onSizesChange` and lets the composition root decide what to do with it (here: hand it to a
 * `LayoutStore`, `domain/ports/layout-store.ts`). That keeps this file storage-free, which
 * `test/architecture/privacy.test.ts` requires (`indexedDB` is permitted only inside
 * `infrastructure/persistence/**`, and `localStorage` is prohibited everywhere).
 *
 * This is deliberately not a full docking system (floating panels, arbitrary drag targets) —
 * three fixed regions with resizable bounds is the "clean dock-like layout foundation" the
 * brief asks for when true docking would be disproportionate.
 */

import type { EditorLayout, PanelSizes } from '../../domain/ports/layout-store';
import {
  DEFAULT_LAYOUT_PRESET,
  DEFAULT_PANEL_SIZES,
  LAYOUT_PRESETS,
  clampPanelSize,
} from './panel-sizes';

/** The three regions a panel can be docked into. The center is the stage and takes no panels. */
export type DockRegion = 'left' | 'right' | 'timeline';

/** What a panel tells the layout about itself when it registers. */
export interface DockPanel {
  /** Stable id — what a persisted layout and the View menu refer to it by. */
  readonly id: string;
  /** Human-readable name, shown in the View menu. */
  readonly label: string;
  readonly region: DockRegion;
  /** The panel's own root, appended into a host section the layout owns. */
  readonly element: HTMLElement;
}

/** A registered panel as the View menu sees it — identity, not DOM. */
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
  /** Ids of panels a stored layout said were hidden. Panels registered later start hidden. */
  readonly initialHiddenPanels?: readonly string[];
  /** The preset name a stored layout was last in. Names the preset only — it does not
   *  overwrite `initialSizes`, so a hand-dragged layout survives a reload intact. */
  readonly initialPreset?: string;
  /** Called whenever the whole chrome state changes — visibility or preset, not drags. */
  readonly onLayoutChange?: (layout: EditorLayout) => void;
}

/** The regions that can collapse, in the order the shell lays them out. */
const REGIONS: readonly DockRegion[] = ['left', 'right', 'timeline'];

/** Pointer-drag capture that degrades gracefully where unsupported (jsdom, notably). */
function safeSetPointerCapture(element: Element, pointerId: number): void {
  try {
    (element as unknown as { setPointerCapture(id: number): void }).setPointerCapture(pointerId);
  } catch {
    // Dragging still works via ordinary pointermove/pointerup bubbling.
  }
}

/** The dock-like panel layout: menu bar + resizable left/center/right + timeline. */
export class DockLayout {
  readonly root: HTMLElement;
  readonly slots: DockLayoutSlots;

  private readonly document: Document;
  private readonly onSizesChange: ((sizes: PanelSizes) => void) | undefined;
  private readonly onLayoutChange: ((layout: EditorLayout) => void) | undefined;
  private sizes: PanelSizes;

  /** Registration order is menu order, so the View menu reads the way the editor is built. */
  private readonly panels = new Map<string, { panel: RegisteredPanel; host: HTMLElement }>();
  private readonly hidden = new Set<string>();
  private preset: string;

  constructor(options: DockLayoutOptions) {
    this.document = options.document;
    this.onSizesChange = options.onSizesChange;
    this.onLayoutChange = options.onLayoutChange;
    this.sizes = options.initialSizes ?? DEFAULT_PANEL_SIZES;
    this.preset = options.initialPreset ?? DEFAULT_LAYOUT_PRESET;
    for (const id of options.initialHiddenPanels ?? []) {
      this.hidden.add(id);
    }

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-layout';

    const menu = this.section('mudra-layout__menu');
    const left = this.section('mudra-layout__left');
    const center = this.section('mudra-layout__center');
    const right = this.section('mudra-layout__right');
    const timeline = this.section('mudra-layout__timeline');
    this.slots = { menu, left, center, right, timeline };

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

    const resetButton = this.document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'mudra-layout__reset-button';
    resetButton.textContent = 'Reset Layout';
    resetButton.title =
      'Restore the left/right panel widths and timeline height to their defaults.';
    resetButton.addEventListener('click', () => this.resetToDefault());
    menu.append(resetButton);

    this.applySizes();
    for (const region of REGIONS) {
      this.updateRegion(region);
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

  /**
   * Mount `panel` into its region, wrapped in a host section the layout can hide.
   *
   * The wrapper is what makes hiding non-destructive: the panel's own element is never
   * removed, so a hidden panel stays registered, stays listed in View, and comes back
   * exactly as it was.
   */
  registerPanel(panel: DockPanel): HTMLElement {
    const host = this.document.createElement('section');
    host.className = 'mudra-layout__panel';
    host.dataset['panelId'] = panel.id;
    host.append(panel.element);
    host.hidden = this.hidden.has(panel.id);

    this.slots[panel.region].append(host);
    this.panels.set(panel.id, {
      panel: { id: panel.id, label: panel.label, region: panel.region },
      host,
    });
    this.updateRegion(panel.region);
    return host;
  }

  /** Every registered panel, hidden ones included — that is what makes them reopenable. */
  listPanels(): readonly RegisteredPanel[] {
    return [...this.panels.values()].map((entry) => entry.panel);
  }

  /** Whether `id` names a registered panel that is currently showing. */
  isPanelVisible(id: string): boolean {
    return this.panels.has(id) && !this.hidden.has(id);
  }

  /**
   * Show or hide a panel. An unknown id and a no-op change are both inert — neither throws,
   * and neither writes a redundant layout record.
   */
  setPanelVisible(id: string, visible: boolean): void {
    const entry = this.panels.get(id);
    if (entry === undefined || this.isPanelVisible(id) === visible) {
      return;
    }
    if (visible) {
      this.hidden.delete(id);
    } else {
      this.hidden.add(id);
    }
    entry.host.hidden = !visible;
    this.updateRegion(entry.panel.region);
    this.onLayoutChange?.(this.getLayout());
  }

  /** Flip a panel's visibility. */
  togglePanel(id: string): void {
    if (this.panels.has(id)) {
      this.setPanelVisible(id, this.hidden.has(id));
    }
  }

  /**
   * Show a panel that may be hidden, and never hide one.
   *
   * The editor calls this when a selection needs a surface the author has closed: revealing
   * answers the selection, whereas a toggle here could close the very panel being asked for.
   */
  revealPanel(id: string): void {
    this.setPanelVisible(id, true);
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
    return {
      ...this.sizes,
      hiddenPanels: [...this.panels.keys()].filter((id) => this.hidden.has(id)),
      preset: this.preset,
    };
  }

  /** Restore the shipped default sizes, show every panel again, and report the change. */
  resetToDefault(): void {
    this.sizes = DEFAULT_PANEL_SIZES;
    this.preset = DEFAULT_LAYOUT_PRESET;
    this.hidden.clear();
    for (const entry of this.panels.values()) {
      entry.host.hidden = false;
    }
    for (const region of REGIONS) {
      this.updateRegion(region);
    }
    this.applySizes();
    this.onSizesChange?.(this.sizes);
    this.onLayoutChange?.(this.getLayout());
  }

  /**
   * Mark a region collapsed once every panel in it is hidden.
   *
   * A region with nothing in it yet is *not* collapsed: the editor registers panels after
   * constructing the layout, and a shell that flashed collapsed on the way up would be a
   * worse lie than an empty column.
   */
  private updateRegion(region: DockRegion): void {
    const inRegion = [...this.panels.values()].filter((entry) => entry.panel.region === region);
    const collapsed =
      inRegion.length > 0 && inRegion.every((entry) => this.hidden.has(entry.panel.id));
    this.root.dataset[region + 'Collapsed'] = collapsed ? 'true' : 'false';
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
