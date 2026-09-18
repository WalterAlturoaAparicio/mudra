/**
 * The predefined docking layouts/zones (spec 010 FR-001, FR-002, FR-009; data-model.md
 * "Layout"/"Zone"; research D1).
 *
 * Data, not behaviour — the same shape `panel-sizes.ts`'s `LAYOUT_PRESETS` already is. A new
 * layout, or a new zone within one, is a new entry here, never a restructuring of how docking
 * itself works (FR-009).
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAYOUT_ID,
  LAYOUTS,
  defaultZoneFor,
  zonesOf,
} from '../../src/presentation/editor/layout-catalog';

describe('LAYOUTS', () => {
  it('every layout has at least one zone, with unique ids within that layout', () => {
    for (const layout of Object.values(LAYOUTS)) {
      expect(layout.zones.length).toBeGreaterThan(0);
      const ids = layout.zones.map((zone) => zone.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("defaultZoneFor names only zone ids present in that layout's own zones", () => {
    for (const layout of Object.values(LAYOUTS)) {
      const zoneIds = new Set(layout.zones.map((zone) => zone.id));
      for (const zoneId of Object.values(layout.defaultZoneFor)) {
        expect(zoneIds.has(zoneId)).toBe(true);
      }
    }
  });

  it('DEFAULT_LAYOUT_ID names a real, registered layout', () => {
    expect(LAYOUTS[DEFAULT_LAYOUT_ID]).toBeDefined();
  });

  it("the shipped default layout's zones match today's three regions", () => {
    const zoneIds = zonesOf(DEFAULT_LAYOUT_ID).map((zone) => zone.id);
    expect(new Set(zoneIds)).toEqual(new Set(['left', 'right', 'timeline']));
  });

  it('every one of the editor’s ten registered panels has a default zone in the default layout', () => {
    const panelIds = [
      'project',
      'explorer',
      'assets',
      'effect',
      'trigger',
      'palette',
      'inspector',
      'camera',
      'diagnostics',
      'timeline',
    ];
    for (const panelId of panelIds) {
      expect(defaultZoneFor(DEFAULT_LAYOUT_ID, panelId)).toBeDefined();
    }
  });
});

describe('zonesOf / defaultZoneFor', () => {
  it('zonesOf falls back to the default layout for an unknown layout id', () => {
    expect(zonesOf('nonexistent-layout')).toEqual(zonesOf(DEFAULT_LAYOUT_ID));
  });

  it('defaultZoneFor returns undefined for a panel the layout does not name, rather than throwing', () => {
    expect(defaultZoneFor(DEFAULT_LAYOUT_ID, 'nonexistent-panel')).toBeUndefined();
  });
});
