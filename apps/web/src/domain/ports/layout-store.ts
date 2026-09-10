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
  /** Ids of panels the author has hidden. Absent means none. */
  readonly hiddenPanels?: readonly string[];
  /** The layout preset last applied, for the View menu's own checkmark. */
  readonly preset?: string;
}

/** Persists one author's preferred editor chrome, locally, across sessions. */
export interface LayoutStore {
  /** `null` when nothing has been saved yet — the caller falls back to its own default. */
  load(): Promise<EditorLayout | null>;
  save(layout: EditorLayout): Promise<void>;
}
