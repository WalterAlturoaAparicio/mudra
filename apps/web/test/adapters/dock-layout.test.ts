/**
 * The dock layout's resizing contract (items 8–11): splitters clamp to bounds, "Reset to
 * Default" restores the shipped constant, and every settled size (drag release, reset) is
 * reported via `onSizesChange` — exactly the intent-dispatch shape `Timeline`'s own
 * `onMove`/`onResize` already use, so persistence stays the composition root's job, not this
 * class's (see `infrastructure/persistence/indexeddb-layout-store.ts`).
 */

import { describe, expect, it } from 'vitest';

import { DockLayout } from '../../src/presentation/editor/dock-layout';
import { DEFAULT_PANEL_SIZES, PANEL_BOUNDS } from '../../src/presentation/editor/panel-sizes';
import type { PanelSizes } from '../../src/domain/ports/layout-store';

/** jsdom has no global `PointerEvent`; a `MouseEvent` of the same `type`/coordinates fires the
 * same listeners, exactly as `test/adapters/timeline.test.ts` already relies on. */
function pointer(type: string, clientX: number, clientY: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function splitter(layout: DockLayout, className: string): HTMLElement {
  return layout.root.querySelector<HTMLElement>('.' + className)!;
}

function buildLayout(initialSizes?: PanelSizes) {
  const changes: PanelSizes[] = [];
  const layout = new DockLayout({
    document,
    ...(initialSizes === undefined ? {} : { initialSizes }),
    onSizesChange: (sizes) => changes.push(sizes),
  });
  return { layout, changes };
}

describe('DockLayout — slots', () => {
  it('exposes every named mount point, empty and ready for panels to append into', () => {
    const { layout } = buildLayout();
    expect(layout.root.contains(layout.slots.menu)).toBe(true);
    expect(layout.root.contains(layout.slots.left)).toBe(true);
    expect(layout.root.contains(layout.slots.center)).toBe(true);
    expect(layout.root.contains(layout.slots.right)).toBe(true);
    expect(layout.root.contains(layout.slots.timeline)).toBe(true);
  });

  it('starts at the shipped defaults when no initial sizes are given', () => {
    const { layout } = buildLayout();
    expect(layout.getSizes()).toEqual(DEFAULT_PANEL_SIZES);
  });

  it('starts at the given initial sizes when provided (e.g. loaded from a LayoutStore)', () => {
    const loaded: PanelSizes = { leftWidth: 300, rightWidth: 300, timelineHeight: 260 };
    const { layout } = buildLayout(loaded);
    expect(layout.getSizes()).toEqual(loaded);
  });
});

describe('DockLayout — resizing', () => {
  it('dragging the left splitter right grows the left panel', () => {
    const { layout } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointermove', 160, 0));
    expect(layout.getSizes().leftWidth).toBe(DEFAULT_PANEL_SIZES.leftWidth + 60);
  });

  it('dragging the right splitter right shrinks the right panel', () => {
    const { layout } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--right');
    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointermove', 140, 0));
    expect(layout.getSizes().rightWidth).toBe(DEFAULT_PANEL_SIZES.rightWidth - 40);
  });

  it('dragging the timeline splitter up grows the timeline', () => {
    const { layout } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--timeline');
    handle.dispatchEvent(pointer('pointerdown', 0, 200));
    handle.dispatchEvent(pointer('pointermove', 0, 150));
    expect(layout.getSizes().timelineHeight).toBe(DEFAULT_PANEL_SIZES.timelineHeight + 50);
  });

  it('never resizes past PANEL_BOUNDS, however far the drag goes', () => {
    const { layout } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', 100000, 0));
    expect(layout.getSizes().leftWidth).toBe(PANEL_BOUNDS.leftWidth.max);

    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', -100000, 0));
    expect(layout.getSizes().leftWidth).toBe(PANEL_BOUNDS.leftWidth.min);
  });

  it('ignores pointermove before any pointerdown on that splitter', () => {
    const { layout } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointermove', 500, 0));
    expect(layout.getSizes().leftWidth).toBe(DEFAULT_PANEL_SIZES.leftWidth);
  });

  it('reports the settled size via onSizesChange only on release, not on every pointermove', () => {
    const { layout, changes } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', 20, 0));
    handle.dispatchEvent(pointer('pointermove', 40, 0));
    handle.dispatchEvent(pointer('pointermove', 60, 0));
    expect(changes).toHaveLength(0);

    handle.dispatchEvent(pointer('pointerup', 60, 0));
    expect(changes).toEqual([
      { ...DEFAULT_PANEL_SIZES, leftWidth: DEFAULT_PANEL_SIZES.leftWidth + 60 },
    ]);
  });
});

describe('DockLayout — reset', () => {
  it('resetToDefault restores the shipped constant after a resize, and reports the change', () => {
    const { layout, changes } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', 60, 0));
    handle.dispatchEvent(pointer('pointerup', 60, 0));
    expect(layout.getSizes()).not.toEqual(DEFAULT_PANEL_SIZES);

    layout.resetToDefault();
    expect(layout.getSizes()).toEqual(DEFAULT_PANEL_SIZES);
    expect(changes[changes.length - 1]).toEqual(DEFAULT_PANEL_SIZES);
  });

  it('the reset button in the menu slot also resets and reports the change', () => {
    const { layout, changes } = buildLayout();
    const handle = splitter(layout, 'mudra-layout__splitter--left');
    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', 60, 0));
    handle.dispatchEvent(pointer('pointerup', 60, 0));

    const resetButton = layout.slots.menu.querySelector<HTMLButtonElement>(
      '.mudra-layout__reset-button',
    )!;
    resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(layout.getSizes()).toEqual(DEFAULT_PANEL_SIZES);
    expect(changes[changes.length - 1]).toEqual(DEFAULT_PANEL_SIZES);
  });
});
