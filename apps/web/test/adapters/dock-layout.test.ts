/**
 * The dock layout's resizing and docking contract (items 8–11; spec 010 US2/US3, corrected
 * 2026-09-17): splitters clamp to bounds, "Reset to Default" restores the shipped constant, and
 * every settled size (drag release, reset) is reported via `onSizesChange` — exactly the
 * intent-dispatch shape `Timeline`'s own `onMove`/`onResize` already use, so persistence stays
 * the composition root's job, not this class's (see
 * `infrastructure/persistence/indexeddb-layout-store.ts`).
 *
 * The docking section covers the corrected model: a zone holds a dock **tree**
 * (`dock-tree.ts`), a panel newly registered becomes its own stacked leaf (never an automatic
 * tab group), dragging onto a leaf's edge splits, onto its centre tabs, closing removes a panel
 * from the tree entirely, and whole-panel collapse is generic.
 */

import { describe, expect, it } from 'vitest';

import { DockLayout, MIN_LEAF_SIZE_PX } from '../../src/presentation/editor/dock-layout';
import { DEFAULT_PANEL_SIZES, PANEL_BOUNDS } from '../../src/presentation/editor/panel-sizes';
import type { DockNodeData, PanelSizes } from '../../src/domain/ports/layout-store';

/** Stubs a rectangle for `getBoundingClientRect()`, matching `dragPanelOntoLeaf`'s own stubbing
 *  shape — jsdom's real implementation is all-zero, which is useless for anything geometry-based
 *  (tab-reorder insertion index, resize-handle container size). */
function stubRect(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      top: rect.y,
      left: rect.x,
      width: rect.width,
      height: rect.height,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

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

function buildLayout(
  optionsOrSizes?: PanelSizes | { initialZoneLayouts?: Record<string, DockNodeData> },
) {
  const changes: PanelSizes[] = [];
  const isSizes = optionsOrSizes !== undefined && 'leftWidth' in optionsOrSizes;
  const layout = new DockLayout({
    document,
    ...(isSizes ? { initialSizes: optionsOrSizes as PanelSizes } : {}),
    ...(!isSizes && optionsOrSizes !== undefined
      ? { initialZoneLayouts: optionsOrSizes.initialZoneLayouts }
      : {}),
    onSizesChange: (sizes) => changes.push(sizes),
  });
  const register = (id: string, region: 'left' | 'right' | 'timeline' = 'left'): HTMLElement => {
    const element = document.createElement('div');
    element.dataset['test'] = id;
    layout.registerPanel({ id, label: id, region, element });
    return element;
  };
  // Relocation dispatches real events (pointerdown on a header, pointermove/pointerup
  // elsewhere) that must bubble to `document` the same way they do once `editor-main.ts`
  // mounts `layout.root` into the page — attaching it here is what makes that realistic in a
  // test, not a jsdom-only accommodation the real app skips.
  document.body.append(layout.root);
  return { layout, changes, register };
}

function host(layout: DockLayout, id: string): HTMLElement {
  return layout.root.querySelector<HTMLElement>('[data-panel-id="' + id + '"]')!;
}

function panelHeader(layout: DockLayout, id: string): HTMLElement {
  return layout.root.querySelector<HTMLElement>('[data-panel-header="' + id + '"]')!;
}

/** The tab-group wrapper currently holding `id` — the finer-grained drop target within a zone. */
function leafElement(layout: DockLayout, id: string): HTMLElement {
  return host(layout, id).closest<HTMLElement>('[data-dock-leaf]')!;
}

/**
 * Simulates a relocation drag onto empty zone background — this is the "append as a new stacked
 * leaf" path, never an automatic tab group (spec 010 correction pass, item 3): dispatching
 * directly at the zone's own top-level element (`layout.slots.left`, etc.) never resolves a
 * `[data-dock-leaf]` ancestor, only `[data-dock-zone]`.
 */
function dragPanelToZoneBackground(
  layout: DockLayout,
  panelId: string,
  targetZone: HTMLElement | null,
): void {
  const header = panelHeader(layout, panelId);
  header.dispatchEvent(pointer('pointerdown', 0, 0));
  if (targetZone !== null) {
    targetZone.dispatchEvent(pointer('pointermove', 0, 0));
  }
  (targetZone ?? header).dispatchEvent(pointer('pointerup', 0, 0));
}

/**
 * Simulates dragging `panelId` onto another panel's tab group. jsdom's `getBoundingClientRect()`
 * is all-zero by default, and `resolveDropRegion` treats a zero-area rect as `'center'`
 * (`drop-region.ts`) — so with no stubbing, this always merges as a tab. Passing `rect` stubs a
 * real size, letting a test drive a specific edge instead.
 */
function dragPanelOntoLeaf(
  layout: DockLayout,
  panelId: string,
  targetPanelId: string,
  at: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 },
  rect?: { width: number; height: number },
): void {
  const target = leafElement(layout, targetPanelId);
  if (rect !== undefined) {
    target.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: rect.width,
        height: rect.height,
        right: rect.width,
        bottom: rect.height,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  const header = panelHeader(layout, panelId);
  header.dispatchEvent(pointer('pointerdown', 0, 0));
  target.dispatchEvent(pointer('pointermove', at.clientX, at.clientY));
  target.dispatchEvent(pointer('pointerup', at.clientX, at.clientY));
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

describe('DockLayout — default arrangement never auto-tabs (spec 010 correction pass, item 1/3)', () => {
  it('two panels defaulting to the same zone become independent stacked leaves, not one tab group', () => {
    const { layout, register } = buildLayout();
    register('project', 'right');
    register('inspector', 'right');

    expect(layout.root.querySelector('.mudra-layout__zone-tabs[hidden]')).toBeFalsy();
    // Neither panel is hidden by the other — both are simultaneously on screen, stacked.
    expect(host(layout, 'project').hidden).toBe(false);
    expect(host(layout, 'inspector').hidden).toBe(false);
    expect(leafElement(layout, 'project')).not.toBe(leafElement(layout, 'inspector'));
  });
});

describe('DockLayout — panel relocation (spec 010 US2, FR-003 – FR-006)', () => {
  it('dragging a panel header over a valid zone background and releasing docks it there', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    dragPanelToZoneBackground(layout, 'assets', layout.slots.right);

    expect(layout.slots.right.contains(host(layout, 'assets'))).toBe(true);
    expect(layout.slots.left.contains(host(layout, 'assets'))).toBe(false);
  });

  it("relocating one panel leaves every other zone's geometry (sizes) unchanged", () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    const before = layout.getSizes();

    dragPanelToZoneBackground(layout, 'assets', layout.slots.right);

    expect(layout.getSizes()).toEqual(before);
  });

  it('a zone emptied of every panel still reports not collapsed — it keeps its space (FR-002)', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    expect(layout.root.dataset['leftCollapsed']).toBe('false');

    dragPanelToZoneBackground(layout, 'assets', layout.slots.right);

    // "left" now has zero panels docked into it — still not collapsed (distinct from every
    // panel in it being individually closed via the View menu, which does collapse it).
    expect(layout.root.dataset['leftCollapsed']).toBe('false');
  });

  it('releasing outside any valid zone leaves the panel in its original zone (FR-006, no-op)', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    // The menu slot is chrome, not a dockable zone — releasing there finds no drop target.
    dragPanelToZoneBackground(layout, 'assets', layout.slots.menu);

    expect(layout.slots.left.contains(host(layout, 'assets'))).toBe(true);
  });

  it('releasing over the zone the panel is already docked in (its only panel) is a no-op (Edge Case)', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    const hostBefore = host(layout, 'assets');

    dragPanelToZoneBackground(layout, 'assets', layout.slots.left);

    // Same node, not a re-mount (no re-render that would lose internal panel state).
    expect(host(layout, 'assets')).toBe(hostBefore);
    expect(layout.slots.left.contains(hostBefore)).toBe(true);
  });

  it('dragging a panel over its own tab group is a no-op, not a self-merge', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('project', 'left');
    dragPanelOntoLeaf(layout, 'project', 'assets'); // tab them together first
    const leafBefore = leafElement(layout, 'assets');

    dragPanelOntoLeaf(layout, 'assets', 'project');

    expect(leafElement(layout, 'assets')).toBe(leafBefore);
    expect(leafElement(layout, 'assets').getAttribute('data-dock-leaf')).toBe('assets,project');
  });

  it('an unrecognized zone/panel id in a loaded arrangement is dropped without throwing', () => {
    expect(() => {
      const { register } = buildLayout({
        initialZoneLayouts: {
          'nonexistent-zone': { kind: 'leaf', panelIds: ['assets'] },
          left: { kind: 'leaf', panelIds: ['nonexistent-panel'] },
        },
      });
      register('assets', 'left');
    }).not.toThrow();
  });
});

describe('DockLayout — splitting a zone (spec 010 correction pass, item 1/2)', () => {
  it('dropping on the top edge of a leaf stacks a new area above it', () => {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    register('camera', 'right'); // its own stacked leaf, per the no-auto-tab default

    dragPanelOntoLeaf(
      layout,
      'camera',
      'inspector',
      { clientX: 100, clientY: 5 },
      { width: 200, height: 100 },
    );

    const inspectorLeaf = leafElement(layout, 'inspector');
    const cameraLeaf = leafElement(layout, 'camera');
    expect(cameraLeaf).not.toBe(inspectorLeaf);
    // Camera's wrapper now precedes Inspector's as DOM siblings under a shared split parent.
    expect(cameraLeaf.parentElement).toBe(inspectorLeaf.parentElement);
    expect([...cameraLeaf.parentElement!.children].indexOf(cameraLeaf)).toBeLessThan(
      [...inspectorLeaf.parentElement!.children].indexOf(inspectorLeaf),
    );
  });

  it('dropping on the right edge of a leaf places a new area beside it (row split)', () => {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    register('camera', 'right');

    dragPanelOntoLeaf(
      layout,
      'camera',
      'inspector',
      { clientX: 195, clientY: 50 },
      { width: 200, height: 100 },
    );

    const split = leafElement(layout, 'camera').closest('.mudra-layout__split');
    expect(split?.className).toContain('mudra-layout__split--row');
  });

  it('dropping on the centre of a leaf merges into its tab group', () => {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    register('camera', 'right');

    dragPanelOntoLeaf(
      layout,
      'camera',
      'inspector',
      { clientX: 100, clientY: 50 },
      { width: 200, height: 100 },
    );

    expect(leafElement(layout, 'camera')).toBe(leafElement(layout, 'inspector'));
    const strip = leafElement(layout, 'inspector').querySelector('.mudra-layout__zone-tabs');
    expect(strip?.hasAttribute('hidden')).toBe(false);
  });
});

describe('DockLayout — keyboard-operable relocation (FR-010, SC-007)', () => {
  it('relocates a panel with no pointer event at any point, to the identical end state a drag would', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    const relocateButton = layout.root.querySelector<HTMLButtonElement>(
      '[data-relocate-trigger="assets"]',
    )!;
    relocateButton.click();
    const rightOption = layout.root.querySelector<HTMLButtonElement>(
      '[data-relocate-target="right"]',
    )!;
    rightOption.click();

    expect(layout.slots.right.contains(host(layout, 'assets'))).toBe(true);
    expect(layout.slots.left.contains(host(layout, 'assets'))).toBe(false);
  });

  it('offers only the zones the panel is not already in', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    layout.root.querySelector<HTMLButtonElement>('[data-relocate-trigger="assets"]')!.click();
    const offered = [
      ...layout.root.querySelectorAll<HTMLButtonElement>('[data-relocate-target]'),
    ].map((button) => button.dataset['relocateTarget']);

    expect(offered).not.toContain('left');
    expect(offered).toContain('right');
    expect(offered).toContain('timeline');
  });

  it('moving to a zone that already holds a panel stacks it there, never an automatic tab group', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('project', 'right');

    layout.root.querySelector<HTMLButtonElement>('[data-relocate-trigger="assets"]')!.click();
    layout.root.querySelector<HTMLButtonElement>('[data-relocate-target="right"]')!.click();

    expect(leafElement(layout, 'assets')).not.toBe(leafElement(layout, 'project'));
  });
});

describe('DockLayout — tab groups (spec 010 US3, corrected: only by explicit action)', () => {
  function tabStrip(panelIdInGroup: string, layout: DockLayout): HTMLElement {
    return leafElement(layout, panelIdInGroup).querySelector<HTMLElement>(
      '.mudra-layout__zone-tabs',
    )!;
  }

  it('dragging one panel onto another’s centre produces two tabs, one visible', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('inspector', 'right');

    dragPanelOntoLeaf(layout, 'inspector', 'assets');

    const strip = tabStrip('assets', layout);
    expect(strip.hidden).toBe(false);
    const tabs = [...strip.querySelectorAll<HTMLElement>('[data-zone-tab]')];
    expect(tabs.map((tab) => tab.dataset['zoneTab'])).toEqual(['assets', 'inspector']);

    // The just-relocated panel becomes the visible tab.
    expect(host(layout, 'inspector').hidden).toBe(false);
    expect(host(layout, 'assets').hidden).toBe(true);
  });

  it('clicking the inactive tab swaps visibility with no change to the zone size', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('inspector', 'right');
    dragPanelOntoLeaf(layout, 'inspector', 'assets');
    const sizesBefore = layout.getSizes();

    const strip = tabStrip('assets', layout);
    strip.querySelector<HTMLElement>('[data-zone-tab="assets"]')!.click();

    expect(host(layout, 'assets').hidden).toBe(false);
    expect(host(layout, 'inspector').hidden).toBe(true);
    expect(layout.getSizes()).toEqual(sizesBefore);
  });

  it('closing one tab of a two-tab group removes only that panel, leaving a plain single-panel leaf', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('inspector', 'right');
    dragPanelOntoLeaf(layout, 'inspector', 'assets');

    const strip = tabStrip('assets', layout);
    strip.querySelector<HTMLElement>('.mudra-layout__zone-tab-close')!.click();

    expect(layout.isPanelVisible('assets')).toBe(false);
    expect(layout.isPanelVisible('inspector')).toBe(true);
    expect(leafElement(layout, 'inspector').querySelector('.mudra-layout__zone-tabs')).toBeNull();
  });

  it('dragging one of two tabs out to a different zone restores standalone presentation for both', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('inspector', 'right');
    dragPanelOntoLeaf(layout, 'inspector', 'assets');

    // Move "assets" back out — its former group now holds only "inspector" again.
    dragPanelToZoneBackground(layout, 'assets', layout.slots.right);

    expect(leafElement(layout, 'inspector').querySelector('.mudra-layout__zone-tabs')).toBeNull();
    expect(host(layout, 'inspector').hidden).toBe(false);
    expect(host(layout, 'assets').hidden).toBe(false);
  });
});

describe('DockLayout — closing and reopening panels (spec 010 correction pass, item 4)', () => {
  it('closing a panel removes it from the DOM entirely — it consumes no layout space', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    layout.setPanelVisible('assets', false);

    expect(layout.root.contains(host(layout, 'assets'))).toBe(false);
    expect(layout.listPanels().map((panel) => panel.id)).toContain('assets'); // still reopenable
  });

  it('reopening a closed panel returns it to its zone as a new stacked leaf', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('project', 'left');
    layout.setPanelVisible('assets', false);

    layout.setPanelVisible('assets', true);

    expect(layout.root.contains(host(layout, 'assets'))).toBe(true);
    expect(host(layout, 'assets').hidden).toBe(false);
    expect(host(layout, 'project').hidden).toBe(false); // reopening never displaces a sibling
  });

  it('closing the only panel of a leaf that is itself half of a split collapses that split away', () => {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    register('camera', 'right');
    dragPanelOntoLeaf(
      layout,
      'camera',
      'inspector',
      { clientX: 100, clientY: 5 },
      { width: 200, height: 100 },
    );

    layout.setPanelVisible('camera', false);

    expect(layout.slots.right.querySelector('.mudra-layout__split')).toBeNull();
    expect(host(layout, 'inspector').hidden).toBe(false);
  });
});

describe('DockLayout — whole-panel collapse (spec 010 correction pass, item 5)', () => {
  it('collapses any registered panel’s content while its header stays visible and it stays docked', () => {
    const { layout, register } = buildLayout();
    const content = register('diagnostics', 'right');

    expect(layout.isPanelCollapsed('diagnostics')).toBe(false);
    layout.togglePanelCollapsed('diagnostics');

    expect(layout.isPanelCollapsed('diagnostics')).toBe(true);
    expect(content.hidden).toBe(true);
    expect(panelHeader(layout, 'diagnostics').hidden).toBe(false);
    expect(layout.root.contains(host(layout, 'diagnostics'))).toBe(true);
    expect(layout.listPanels().map((panel) => panel.id)).toContain('diagnostics');

    layout.togglePanelCollapsed('diagnostics');
    expect(content.hidden).toBe(false);
  });

  it('is independent of closing — collapsing never removes a panel from the View menu or its zone', () => {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    layout.setPanelCollapsed('inspector', true);
    expect(layout.isPanelVisible('inspector')).toBe(true);
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

  it('reopens every closed panel', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    layout.setPanelVisible('assets', false);

    layout.resetToDefault();

    expect(layout.isPanelVisible('assets')).toBe(true);
  });
});

describe('DockLayout — panel-menu popover trimmed (spec 010 workspace UX corrections pass, item 2)', () => {
  it('offers only "Move to <zone>" options — Close and Collapse already have their own header buttons', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    layout.root.querySelector<HTMLButtonElement>('[data-relocate-trigger="assets"]')!.click();
    const popover = layout.root.querySelector<HTMLElement>('.mudra-layout__panel-menu-popover')!;
    const options = [
      ...popover.querySelectorAll<HTMLButtonElement>('.mudra-layout__panel-menu-option'),
    ];

    expect(options.every((option) => option.dataset['relocateTarget'] !== undefined)).toBe(true);
    expect(options.some((option) => option.textContent === 'Close')).toBe(false);
    expect(options.some((option) => option.textContent === 'Collapse')).toBe(false);
    expect(options.some((option) => option.textContent === 'Expand')).toBe(false);
  });

  it('the dedicated header close/collapse buttons remain fully functional on their own', () => {
    const { layout, register } = buildLayout();
    const content = register('assets', 'left');

    panelHeader(layout, 'assets')
      .querySelector<HTMLButtonElement>('.mudra-layout__panel-collapse')!
      .click();
    expect(content.hidden).toBe(true);

    panelHeader(layout, 'assets')
      .querySelector<HTMLButtonElement>('.mudra-layout__panel-close')!
      .click();
    expect(layout.isPanelVisible('assets')).toBe(false);
  });
});

describe('DockLayout — no text selection while dragging (spec 010 workspace UX corrections pass, FR-041)', () => {
  it('toggles a drag-scoped class on the layout root for exactly the duration of a header drag', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');

    expect(layout.root.classList.contains('mudra-layout--dragging')).toBe(false);
    panelHeader(layout, 'assets').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(layout.root.classList.contains('mudra-layout--dragging')).toBe(true);

    layout.slots.right.dispatchEvent(pointer('pointermove', 0, 0));
    layout.slots.right.dispatchEvent(pointer('pointerup', 0, 0));
    expect(layout.root.classList.contains('mudra-layout--dragging')).toBe(false);
  });

  it('a press on a header button never starts a drag (no dragging class, control still works)', () => {
    const { layout, register } = buildLayout();
    const content = register('assets', 'left');
    const collapseButton = panelHeader(layout, 'assets').querySelector<HTMLButtonElement>(
      '.mudra-layout__panel-collapse',
    )!;

    collapseButton.dispatchEvent(pointer('pointerdown', 0, 0));
    expect(layout.root.classList.contains('mudra-layout--dragging')).toBe(false);

    collapseButton.click();
    expect(content.hidden).toBe(true);
  });
});

describe('DockLayout — tab reorder (spec 010 workspace UX corrections pass, FR-043)', () => {
  function tabStrip(panelIdInGroup: string, layout: DockLayout): HTMLElement {
    return leafElement(layout, panelIdInGroup).querySelector<HTMLElement>(
      '.mudra-layout__zone-tabs',
    )!;
  }

  /** Forms a three-panel tab group ['a', 'b', 'c'] by dragging b then c onto a's centre. */
  function buildThreeTabGroup(): { layout: DockLayout } {
    const { layout, register } = buildLayout();
    register('a', 'right');
    register('b', 'right');
    register('c', 'right');
    dragPanelOntoLeaf(layout, 'b', 'a');
    dragPanelOntoLeaf(layout, 'c', 'a');
    return { layout };
  }

  function stubTabRects(strip: HTMLElement, widthEach = 80): void {
    [...strip.querySelectorAll<HTMLElement>('[data-zone-tab]')].forEach((tab, index) => {
      stubRect(tab, { x: index * widthEach, y: 0, width: widthEach, height: 24 });
    });
  }

  it('forms the group in arrival order by default', () => {
    const { layout } = buildThreeTabGroup();
    const tabs = [...tabStrip('a', layout).querySelectorAll<HTMLElement>('[data-zone-tab]')];
    expect(tabs.map((tab) => tab.dataset['zoneTab'])).toEqual(['a', 'b', 'c']);
  });

  it('dragging a tab within its own strip previews and then applies the reorder', () => {
    const { layout } = buildThreeTabGroup();
    const strip = tabStrip('a', layout);
    stubTabRects(strip);

    const tabC = strip.querySelector<HTMLElement>('[data-zone-tab="c"]')!;
    tabC.dispatchEvent(pointer('pointerdown', 250, 12));
    strip.dispatchEvent(pointer('pointermove', 10, 12)); // inside "a"'s left half → insert before it

    const tabA = strip.querySelector<HTMLElement>('[data-zone-tab="a"]')!;
    expect(tabA.getAttribute('data-tab-insert-before')).toBe('true');

    strip.dispatchEvent(pointer('pointerup', 10, 12));

    const after = [...tabStrip('c', layout).querySelectorAll<HTMLElement>('[data-zone-tab]')];
    expect(after.map((tab) => tab.dataset['zoneTab'])).toEqual(['c', 'a', 'b']);
    // The marker is cleared once the drag ends.
    expect(
      tabStrip('c', layout)
        .querySelector('[data-zone-tab="a"]')!
        .hasAttribute('data-tab-insert-before'),
    ).toBe(false);
  });

  it('reordering persists through getLayout()', () => {
    const { layout } = buildThreeTabGroup();
    const strip = tabStrip('a', layout);
    stubTabRects(strip);
    strip
      .querySelector<HTMLElement>('[data-zone-tab="c"]')!
      .dispatchEvent(pointer('pointerdown', 250, 12));
    strip.dispatchEvent(pointer('pointermove', 10, 12));
    strip.dispatchEvent(pointer('pointerup', 10, 12));

    const tree = layout.getLayout().zoneLayouts?.['right'] as {
      kind: string;
      panelIds?: readonly string[];
    };
    expect(tree.kind).toBe('leaf');
    expect(tree.panelIds).toEqual(['c', 'a', 'b']);
  });

  it('dragging a tab past the last one previews an "insert after" marker on it', () => {
    const { layout } = buildThreeTabGroup();
    const strip = tabStrip('a', layout);
    stubTabRects(strip);

    strip
      .querySelector<HTMLElement>('[data-zone-tab="a"]')!
      .dispatchEvent(pointer('pointerdown', 10, 12));
    strip.dispatchEvent(pointer('pointermove', 1000, 12)); // far past both remaining tabs

    const tabC = strip.querySelector<HTMLElement>('[data-zone-tab="c"]')!;
    expect(tabC.getAttribute('data-tab-insert-after')).toBe('true');

    strip.dispatchEvent(pointer('pointerup', 1000, 12));
    const after = [...tabStrip('b', layout).querySelectorAll<HTMLElement>('[data-zone-tab]')];
    expect(after.map((tab) => tab.dataset['zoneTab'])).toEqual(['b', 'c', 'a']);
  });

  it('dragging a tab out of the strip onto a different zone undocks it instead of reordering', () => {
    const { layout } = buildThreeTabGroup();
    const strip = tabStrip('a', layout);
    stubTabRects(strip);

    strip
      .querySelector<HTMLElement>('[data-zone-tab="c"]')!
      .dispatchEvent(pointer('pointerdown', 250, 12));
    // Leaves the strip entirely, over a different zone's empty background.
    layout.slots.left.dispatchEvent(pointer('pointermove', 0, 0));
    layout.slots.left.dispatchEvent(pointer('pointerup', 0, 0));

    expect(layout.slots.left.contains(host(layout, 'c'))).toBe(true);
    const remaining = [...tabStrip('a', layout).querySelectorAll<HTMLElement>('[data-zone-tab]')];
    expect(remaining.map((tab) => tab.dataset['zoneTab'])).toEqual(['a', 'b']);
  });

  it('a press on a tab’s own close button never starts a drag or a reorder', () => {
    const { layout } = buildThreeTabGroup();
    const strip = tabStrip('a', layout);
    const closeButton = strip
      .querySelector<HTMLElement>('[data-zone-tab="b"]')!
      .querySelector<HTMLButtonElement>('.mudra-layout__zone-tab-close')!;

    closeButton.dispatchEvent(pointer('pointerdown', 0, 0));
    expect(layout.root.classList.contains('mudra-layout--dragging')).toBe(false);

    closeButton.click();
    expect(layout.isPanelVisible('b')).toBe(false);
  });
});

describe('DockLayout — split resizing (spec 010 workspace UX corrections pass, FR-042)', () => {
  function buildRowSplit(): { layout: DockLayout } {
    const { layout, register } = buildLayout();
    register('inspector', 'right');
    register('camera', 'right');
    dragPanelOntoLeaf(
      layout,
      'camera',
      'inspector',
      { clientX: 195, clientY: 50 },
      { width: 200, height: 100 },
    );
    return { layout };
  }

  function resizeHandleAndContainer(layout: DockLayout): {
    handle: HTMLElement;
    container: HTMLElement;
  } {
    const handle = layout.slots.right.querySelector<HTMLElement>('.mudra-layout__resize-handle')!;
    const container = handle.parentElement as HTMLElement;
    stubRect(container, { x: 0, y: 0, width: 300, height: 200 });
    return { handle, container };
  }

  it('renders a resize handle between two directly-adjacent split children, with the right orientation', () => {
    const { layout } = buildRowSplit();
    const handle = layout.slots.right.querySelector<HTMLElement>('.mudra-layout__resize-handle')!;
    expect(handle.classList.contains('mudra-layout__resize-handle--row')).toBe(true);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('dragging the handle updates only the two adjacent children’s sizes, and persists it', () => {
    const { layout } = buildRowSplit();
    const { handle } = resizeHandleAndContainer(layout);

    handle.dispatchEvent(pointer('pointerdown', 150, 0));
    handle.dispatchEvent(pointer('pointermove', 190, 0));
    handle.dispatchEvent(pointer('pointerup', 190, 0));

    const tree = layout.getLayout().zoneLayouts?.['right'] as {
      kind: string;
      children?: readonly unknown[];
      sizes?: readonly number[];
    };
    expect(tree.kind).toBe('split');
    expect(tree.children).toHaveLength(2);
    expect(tree.sizes).toBeDefined();
    expect(tree.sizes![0]).not.toBeCloseTo(tree.sizes![1]!, 5);
  });

  it('does not commit a size change without a pointerup (a move alone is only a live preview)', () => {
    const { layout } = buildRowSplit();
    const { handle } = resizeHandleAndContainer(layout);

    handle.dispatchEvent(pointer('pointerdown', 150, 0));
    handle.dispatchEvent(pointer('pointermove', 190, 0));

    expect(layout.getLayout().zoneLayouts?.['right']).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'leaf', panelIds: ['inspector'] },
        { kind: 'leaf', panelIds: ['camera'] },
      ],
    });
  });

  it('clamps so neither side drops below the minimum usable size, however far the drag goes', () => {
    const { layout } = buildRowSplit();
    const { handle } = resizeHandleAndContainer(layout);

    handle.dispatchEvent(pointer('pointerdown', 0, 0));
    handle.dispatchEvent(pointer('pointermove', 100000, 0));
    handle.dispatchEvent(pointer('pointerup', 100000, 0));

    const tree = layout.getLayout().zoneLayouts?.['right'] as { sizes?: readonly number[] };
    const sizes = tree.sizes!;
    const total = sizes[0]! + sizes[1]!;
    const secondSharePx = (sizes[1]! / total) * 300;
    expect(secondSharePx).toBeCloseTo(MIN_LEAF_SIZE_PX, 5);
  });

  it('never corrupts the dock-node structure — resizing keeps the same two children, reordered by nothing', () => {
    const { layout } = buildRowSplit();
    const { handle } = resizeHandleAndContainer(layout);

    handle.dispatchEvent(pointer('pointerdown', 150, 0));
    handle.dispatchEvent(pointer('pointermove', 170, 0));
    handle.dispatchEvent(pointer('pointerup', 170, 0));

    const tree = layout.getLayout().zoneLayouts?.['right'] as {
      children?: readonly { kind: string; panelIds?: readonly string[] }[];
    };
    expect(tree.children?.map((child) => child.panelIds)).toEqual([['inspector'], ['camera']]);
  });
});
