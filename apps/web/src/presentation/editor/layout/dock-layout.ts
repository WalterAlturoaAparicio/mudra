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
 * `LayoutStore`). That keeps this file storage-free, which `test/architecture/privacy.test.ts`
 * requires (`indexedDB` is permitted only inside `infrastructure/persistence/**`, and
 * `localStorage` is prohibited everywhere).
 *
 * This is deliberately not a full docking system (floating panels, arbitrary drag targets) —
 * three fixed regions with resizable bounds is the "clean dock-like layout foundation" the
 * brief asks for when true docking would be disproportionate.
 */

import type { PanelSizes } from '../../../domain/ports/layout-store';
import { DEFAULT_PANEL_SIZES, clampPanelSize } from './panel-sizes';

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
}

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
  private sizes: PanelSizes;

  constructor(options: DockLayoutOptions) {
    this.document = options.document;
    this.onSizesChange = options.onSizesChange;
    this.sizes = options.initialSizes ?? DEFAULT_PANEL_SIZES;

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
    resetButton.title = 'Restore the left/right panel widths and timeline height to their defaults.';
    resetButton.addEventListener('click', () => this.resetToDefault());
    menu.append(resetButton);

    this.applySizes();
  }

  /** The current panel sizes (device pixels). */
  getSizes(): PanelSizes {
    return this.sizes;
  }

  /** Restore the shipped default sizes and report the change. */
  resetToDefault(): void {
    this.sizes = DEFAULT_PANEL_SIZES;
    this.applySizes();
    this.onSizesChange?.(this.sizes);
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
  private wireVerticalSplitter(handle: HTMLElement, dimension: 'timelineHeight', sign: 1 | -1): void {
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
      startPos = axisValue(event as PointerEvent);
      startSize = this.sizes[dimension];
      safeSetPointerCapture(handle, (event as PointerEvent).pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const delta = axisValue(event as PointerEvent) - startPos;
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
