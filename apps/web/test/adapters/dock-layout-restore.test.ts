/**
 * Workspace restore invariant (spec 011 dev-gate, item 1/2/3): if a persisted layout says a panel
 * is open, it is mounted and visible after restore — whatever order the panels register in — and
 * the panel-menu popover can never cover the menu bar.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DockLayout } from '../../src/presentation/editor/dock-layout';
import type { EditorLayout } from '../../src/domain/ports/layout-store';

const IDS = ['project', 'explorer', 'inspector', 'effect', 'actions', 'camera', 'diagnostics'];

function build(saved: Partial<EditorLayout>, order: readonly string[]): DockLayout {
  const layout = new DockLayout({
    document,
    ...(saved.hiddenPanels === undefined ? {} : { initialHiddenPanels: saved.hiddenPanels }),
    ...(saved.zoneLayouts === undefined ? {} : { initialZoneLayouts: saved.zoneLayouts }),
    ...(saved.activeTabs === undefined ? {} : { initialActiveTabs: saved.activeTabs }),
  });
  for (const id of order) {
    layout.registerPanel({
      id,
      label: id,
      region: 'right',
      element: document.createElement('div'),
    });
  }
  layout.finishRestore();
  return layout;
}

const SAVED: Partial<EditorLayout> = {
  zoneLayouts: {
    left: {
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'leaf', panelIds: ['project', 'explorer'] },
        { kind: 'leaf', panelIds: ['camera'] },
      ],
    },
    right: { kind: 'leaf', panelIds: ['inspector', 'effect', 'actions'] },
  },
  activeTabs: { 'actions|effect|inspector': 'effect', 'explorer|project': 'explorer' },
  hiddenPanels: ['diagnostics'],
};

function shownIds(layout: DockLayout): string[] {
  return [...layout.root.querySelectorAll<HTMLElement>('[data-panel-id]')]
    .filter((el) => !el.hidden && layout.root.contains(el))
    .map((el) => el.dataset['panelId']!);
}

describe('DockLayout restore invariant', () => {
  it.each([[IDS], [[...IDS].reverse()], [['explorer', 'actions', 'camera', ...IDS]]])(
    'mounts every open panel regardless of registration order (%#)',
    (order) => {
      const layout = build(SAVED, [...new Set(order)]);
      for (const id of IDS.filter((i) => i !== 'diagnostics')) {
        expect(layout.isPanelVisible(id)).toBe(true);
        expect(layout.root.querySelector(`[data-panel-id="${id}"]`), id).not.toBeNull();
      }
      expect(layout.root.querySelector('[data-panel-id="diagnostics"]')).toBeNull();
      // Tab groups survived intact, with their saved active tab.
      const saved = layout.getLayout();
      expect(saved.zoneLayouts?.['right']).toEqual(SAVED.zoneLayouts?.['right']);
      expect(saved.activeTabs).toEqual(SAVED.activeTabs);
      expect(shownIds(layout).sort()).toEqual(['camera', 'effect', 'explorer']);
    },
  );

  it('heals a record that lost tab members: open panels absent from every tree are re-mounted', () => {
    const broken: Partial<EditorLayout> = {
      zoneLayouts: { right: { kind: 'leaf', panelIds: ['inspector'] } },
    };
    const layout = build(broken, IDS);
    for (const id of IDS) {
      expect(layout.root.querySelector(`[data-panel-id="${id}"]`), id).not.toBeNull();
    }
  });

  it('places a panel named in two zones only once, and ignores unknown ids', () => {
    const dup: Partial<EditorLayout> = {
      zoneLayouts: {
        left: { kind: 'leaf', panelIds: ['project', 'ghost'] },
        right: { kind: 'leaf', panelIds: ['project', 'inspector'] },
      },
    };
    const layout = build(dup, ['project', 'inspector']);
    expect(layout.root.querySelectorAll('[data-panel-id="project"]')).toHaveLength(1);
  });
});

describe('panel-menu popover layering', () => {
  const css = readFileSync('src/presentation/editor/editor.css', 'utf8');

  it('is display:none while hidden, so it has no box or pointer surface', () => {
    expect(css).toMatch(
      /\.mudra-layout__panel-menu-popover\[hidden\]\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?display:\s*none/,
    );
  });

  it('the menu bar stacks above panel popovers', () => {
    const rule = /\.mudra-layout__menu\s*\{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/position:\s*relative/);
    const z = Number(/z-index:\s*(\d+)/.exec(rule)![1]);
    const popoverZ = Number(
      /\.mudra-layout__panel-menu-popover\s*\{[^}]*z-index:\s*(\d+)/.exec(css)![1],
    );
    expect(z).toBeGreaterThan(popoverZ);
  });
});
