/**
 * The predefined docking layouts/zones (spec 010 FR-001–FR-002, FR-009; research D1).
 *
 * Deliberately not a layout engine: a `Layout` is a hand-authored value — a list of zones and
 * which panel defaults into which — applied through the same kind of lookup
 * `panel-sizes.ts`'s `LAYOUT_PRESETS` already is. Adding a layout, or a zone within one, is a
 * new entry here; it is never a restructuring of `DockLayout` itself (FR-009).
 *
 * This iteration ships exactly one layout — today's three-region shape, ported in unchanged —
 * because a small, fixed set does not require more than one member to be a small, fixed set,
 * and shipping exotic topologies nobody asked for is exactly the "mini-IDE" cost this feature
 * was scoped to avoid (spec Assumptions, constitution v1.9.0). A second layout is an addition
 * to `LAYOUTS`, not a rewrite.
 */

/** One named docking location within a `Layout`. Always exists, always occupies its space,
 *  whether or not a panel is currently docked into it (FR-002). */
export interface Zone {
  /** Stable identity within its layout — what a persisted docking arrangement refers to. */
  readonly id: string;
  /** Shown in the keyboard-operable relocation control and any drop-target affordance. */
  readonly label: string;
}

/** A named, predefined arrangement of docking zones for the editor's chrome. */
export interface Layout {
  readonly id: string;
  readonly label: string;
  readonly zones: readonly Zone[];
  /** Where each of the editor's registered panels starts in this layout, before any author
   *  rearranges anything. A panel id absent here has no default zone in this layout. */
  readonly defaultZoneFor: Readonly<Record<string, string>>;
}

const STANDARD_ZONES: readonly Zone[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'timeline', label: 'Timeline' },
];

/** Today's three-region shape, unchanged, as the first named layout (research D1). */
const STANDARD_LAYOUT: Layout = {
  id: 'standard',
  label: 'Standard',
  zones: STANDARD_ZONES,
  defaultZoneFor: {
    project: 'left',
    explorer: 'left',
    assets: 'left',
    effect: 'right',
    trigger: 'right',
    palette: 'right',
    inspector: 'right',
    camera: 'right',
    diagnostics: 'right',
    timeline: 'timeline',
  },
};

/** The small, fixed set of predefined layouts (FR-001). Extending it is a new entry here. */
export const LAYOUTS: Readonly<Record<string, Layout>> = {
  standard: STANDARD_LAYOUT,
};

/** The layout a fresh session starts in, and what an unrecognized stored id falls back to. */
export const DEFAULT_LAYOUT_ID = 'standard';

/** A layout's zones, falling back to the default layout for an id `LAYOUTS` does not have —
 *  the same tolerance a future removed/renamed layout needs (spec Edge Cases). */
export function zonesOf(layoutId: string): readonly Zone[] {
  return (LAYOUTS[layoutId] ?? LAYOUTS[DEFAULT_LAYOUT_ID]!).zones;
}

/** Where `panelId` starts in `layoutId`, or `undefined` if that layout names no default for it. */
export function defaultZoneFor(layoutId: string, panelId: string): string | undefined {
  const layout = LAYOUTS[layoutId] ?? LAYOUTS[DEFAULT_LAYOUT_ID]!;
  return layout.defaultZoneFor[panelId];
}
