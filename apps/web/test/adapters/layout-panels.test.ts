/**
 * Panel visibility, presets, and layout persistence (items 9 and 20).
 *
 * The requirement that shapes all of this: *"If a panel is already closed/hidden, View should
 * provide a way to reopen it."* A hidden panel must therefore stay **registered** — visible to
 * the View menu, reopenable, and restored by Reset — rather than being removed from the DOM and
 * forgotten. These assertions are what keep it so.
 */

import { describe, expect, it } from 'vitest';

import type { EditorLayout, PanelSizes } from '../../src/domain/ports/layout-store';
import { DockLayout } from '../../src/presentation/editor/dock-layout';
import {
  DEFAULT_LAYOUT_PRESET,
  DEFAULT_PANEL_SIZES,
  LAYOUT_PRESETS,
  clampPanelSizes,
} from '../../src/presentation/editor/panel-sizes';

function buildLayout(
  options: {
    initialSizes?: PanelSizes;
    initialHiddenPanels?: readonly string[];
    initialPreset?: string;
  } = {},
) {
  const layouts: EditorLayout[] = [];
  const layout = new DockLayout({
    document,
    ...options,
    onLayoutChange: (changed) => layouts.push(changed),
  });
  const register = (id: string, region: 'left' | 'right' | 'timeline' = 'left'): HTMLElement => {
    const element = document.createElement('div');
    element.dataset['test'] = id;
    layout.registerPanel({ id, label: id, region, element });
    return element;
  };
  return { layout, layouts, register };
}

function host(layout: DockLayout, id: string): HTMLElement {
  return layout.root.querySelector<HTMLElement>('[data-panel-id="' + id + '"]')!;
}

describe('registering panels', () => {
  it('mounts each panel into its region, wrapped in a section it can be hidden by', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('inspector', 'right');
    register('timeline', 'timeline');

    expect(layout.slots.left.contains(host(layout, 'assets'))).toBe(true);
    expect(layout.slots.right.contains(host(layout, 'inspector'))).toBe(true);
    expect(layout.slots.timeline.contains(host(layout, 'timeline'))).toBe(true);
  });

  it('lists every registered panel for the View menu', () => {
    const { layout, register } = buildLayout();
    register('assets');
    register('inspector', 'right');

    expect(layout.listPanels().map((panel) => panel.id)).toEqual(['assets', 'inspector']);
  });
});

describe('showing and hiding', () => {
  it('hides a panel without unregistering it, so View can reopen it', () => {
    const { layout, register } = buildLayout();
    register('assets');

    layout.setPanelVisible('assets', false);

    expect(layout.isPanelVisible('assets')).toBe(false);
    expect(host(layout, 'assets').hidden).toBe(true);
    // Still listed — this is the whole point.
    expect(layout.listPanels().map((panel) => panel.id)).toContain('assets');

    layout.setPanelVisible('assets', true);
    expect(host(layout, 'assets').hidden).toBe(false);
  });

  it('toggles, and reports each change for persistence', () => {
    const { layout, layouts, register } = buildLayout();
    register('assets');

    layout.togglePanel('assets');
    layout.togglePanel('assets');

    expect(layouts.map((entry) => entry.hiddenPanels)).toEqual([['assets'], []]);
  });

  it('collapses a region once every panel in it is hidden', () => {
    const { layout, register } = buildLayout();
    register('assets', 'left');
    register('project', 'left');
    expect(layout.root.dataset['leftCollapsed']).toBe('false');

    layout.setPanelVisible('assets', false);
    expect(layout.root.dataset['leftCollapsed']).toBe('false');

    layout.setPanelVisible('project', false);
    expect(layout.root.dataset['leftCollapsed']).toBe('true');
  });

  it('an unknown panel id is inert, not an error', () => {
    const { layout } = buildLayout();
    expect(() => layout.setPanelVisible('nothing', false)).not.toThrow();
    expect(layout.isPanelVisible('nothing')).toBe(false);
  });

  it('starts with the panels a stored layout said were hidden', () => {
    const { layout, register } = buildLayout({ initialHiddenPanels: ['assets'] });
    register('assets');
    register('project');

    expect(layout.isPanelVisible('assets')).toBe(false);
    expect(layout.isPanelVisible('project')).toBe(true);
  });
});

describe('presets', () => {
  it('applies a preset’s sizes and remembers which one is current', () => {
    const { layout } = buildLayout();

    layout.applyPreset('Timeline focus');

    expect(layout.getSizes()).toEqual(LAYOUT_PRESETS['Timeline focus']);
    expect(layout.currentPreset).toBe('Timeline focus');
  });

  it('ignores an unknown preset name rather than clearing the layout', () => {
    const { layout } = buildLayout();
    layout.applyPreset('Nonexistent');
    expect(layout.getSizes()).toEqual(DEFAULT_PANEL_SIZES);
    expect(layout.currentPreset).toBe(DEFAULT_LAYOUT_PRESET);
  });

  it('every shipped preset is within the bounds a drag could reach', () => {
    for (const [name, sizes] of Object.entries(LAYOUT_PRESETS)) {
      expect(clampPanelSizes(sizes), name).toEqual(sizes);
    }
  });
});

describe('persistence', () => {
  it('getLayout carries sizes, hidden panels and the preset as one record', () => {
    const { layout, register } = buildLayout();
    register('assets');
    layout.applyPreset('Wide stage');
    layout.setPanelVisible('assets', false);

    expect(layout.getLayout()).toEqual({
      ...LAYOUT_PRESETS['Wide stage'],
      hiddenPanels: ['assets'],
      preset: 'Wide stage',
    });
  });

  it('restores sizes and preset from a stored record', () => {
    const stored: PanelSizes = { leftWidth: 300, rightWidth: 300, timelineHeight: 260 };
    const { layout } = buildLayout({ initialSizes: stored, initialPreset: 'Wide stage' });

    expect(layout.getSizes()).toEqual(stored);
    expect(layout.currentPreset).toBe('Wide stage');
  });
});
