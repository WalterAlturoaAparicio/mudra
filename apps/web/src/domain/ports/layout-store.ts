/**
 * Where the editor's own dock-layout panel sizes are persisted (item 11), behind a port.
 *
 * Mirrors `ProjectRepository`'s shape exactly, for the same reason: the concrete
 * implementation touches `indexedDB`, and `test/architecture/privacy.test.ts` restricts that
 * API to `infrastructure/persistence/**` alone. This is UI-chrome state, not authored project
 * content — it is never embedded in a `Project`'s own wire format.
 */

/** The three dimensions the dock layout persists. Plain data — no DOM, no browser type. */
export interface PanelSizes {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly timelineHeight: number;
}

/**
 * The whole of one author's editor chrome state (items 9 and 20).
 *
 * `PanelSizes` is the three resizable dimensions and nothing else, which is what the splitters
 * work in. This adds the rest of what View can change — which panels are hidden, and which
 * layout preset was last applied — as **optional** fields, so a stored record written before
 * they existed still loads, and a caller that only cares about sizes still round-trips.
 */
export interface EditorLayout extends PanelSizes {
  /** Ids of panels the author has closed. Absent means none. A closed panel is removed from its
   *  zone's dock tree entirely (spec 010 correction pass, item 4) — reopening (the View menu)
   *  re-inserts it as a new stacked leaf in its default zone, it does not restore its exact
   *  former position. Field name predates that change (originally "hidden"); kept to avoid
   *  churning an already-persisted key for a purely internal rename. */
  readonly hiddenPanels?: readonly string[];
  /** The layout preset last applied, for the View menu's own checkmark. */
  readonly preset?: string;
  /** The predefined docking layout (`presentation/editor/layout-catalog.ts`) last active.
   *  Absent means the shipped default layout (spec 010 FR-008). Optional for the same reason
   *  `hiddenPanels`/`preset` are: a record written before this field existed still loads. */
  readonly activeLayoutId?: string;
  /** Each zone's dock tree (spec 010 correction pass, item 1) — which panels it holds, how they
   *  are split (stacked/side-by-side) or grouped as tabs. Absent means every zone falls back to
   *  its default arrangement: one stacked leaf per panel that defaults there, in registration
   *  order — never one automatic tab group (spec 010 FR-008, "Docking arrangement"). A tree
   *  naming a zone id, or containing a panel id, the current build does not recognize is
   *  tolerated and sanitized on load (`presentation/editor/dock-tree.ts`'s `sanitize`),
   *  never an error. Replaces the earlier `zoneAssignments`/`PanelPlacement` shape outright —
   *  that shape was only ever produced by this same in-flight feature, never released, so no
   *  migration path is needed for it specifically (contracts/docking-persistence.md). */
  readonly zoneLayouts?: Readonly<Record<string, DockNodeData>>;
  /** Which tab is active in each multi-tab group, keyed by the group's sorted member panel ids
   *  joined with `|`. Optional: a record written before it existed loads with each group on
   *  its first tab. */
  readonly activeTabs?: Readonly<Record<string, string>>;
}

/** One docking zone's tree: either a tab group (a leaf, more than one panel id meaning more than
 *  one tab) or a division of space between child nodes (spec 010 correction pass, item 1). Plain
 *  data, declared here — not in `presentation/editor/dock-tree.ts` — for the same reason
 *  `PanelPlacement` used to be: `test/architecture/layering.test.ts` forbids `domain/**` from
 *  importing `presentation/**`, so the shape this port persists must be defined on this side of
 *  that boundary; `dock-tree.ts` imports the *type* from here, not the other way around. */
export type DockNodeData = DockLeafData | DockSplitData;

/** A tab group: one panel id, or more than one presented as switchable tabs. Never empty while
 *  it exists — an empty leaf simply is not part of the tree (see `dock-tree.ts`'s `removePanel`). */
export interface DockLeafData {
  readonly kind: 'leaf';
  readonly panelIds: readonly string[];
}

/** A division of a zone's space between at least two children, stacked (`column`) or
 *  side-by-side (`row`). */
export interface DockSplitData {
  readonly kind: 'split';
  readonly direction: 'row' | 'column';
  readonly children: readonly DockNodeData[];
  /** Relative weight of each child, same length/order as `children` (workspace UX corrections
   *  pass, FR-042). Absent means an equal share — every split before this field existed, and any
   *  split whose child count has changed since a resize (`dock-tree.ts` drops a stale `sizes`
   *  rather than remapping a now-mismatched-length array). Only an explicit author resize sets
   *  this; it is never required for a `DockSplitData` to be valid. */
  readonly sizes?: readonly number[];
}

/** Persists one author's preferred editor chrome, locally, across sessions. */
export interface LayoutStore {
  /** `null` when nothing has been saved yet — the caller falls back to its own default. */
  load(): Promise<EditorLayout | null>;
  save(layout: EditorLayout): Promise<void>;
}
