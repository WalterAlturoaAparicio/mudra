/**
 * Persistence for the editor's dock-layout panel sizes (item 11: default + custom layouts).
 *
 * Deliberately small: one persisted "custom" layout (whatever the author last dragged to,
 * written on every splitter release) plus one hardcoded "default" constant, always
 * recoverable via `DockLayout.resetToDefault()`. No named-layout list, no multi-workspace
 * switcher — that would be over-engineering a feature nobody asked for. Dragging a panel *is*
 * customizing the layout; there is nothing more to "save as" here.
 */

/** The three dimensions the dock layout persists. */
export interface PanelSizes {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly timelineHeight: number;
}

/** The layout every session starts from, and what "Reset to Default" restores. */
export const DEFAULT_PANEL_SIZES: PanelSizes = {
  leftWidth: 260,
  rightWidth: 340,
  timelineHeight: 220,
};

/** Bounds a panel dimension may never cross — the layout must never collapse to unusable. */
export const PANEL_BOUNDS: Readonly<Record<keyof PanelSizes, { min: number; max: number }>> = {
  leftWidth: { min: 180, max: 480 },
  rightWidth: { min: 220, max: 520 },
  timelineHeight: { min: 120, max: 480 },
};

/** Clamp one dimension to its bounds. */
export function clampPanelSize(dimension: keyof PanelSizes, value: number): number {
  const { min, max } = PANEL_BOUNDS[dimension];
  if (!Number.isFinite(value)) {
    return DEFAULT_PANEL_SIZES[dimension];
  }
  return Math.min(max, Math.max(min, value));
}

/** The `Storage` surface this file needs — narrowed so a fake is trivial in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'mudra-editor-layout-v1';

/** `localStorage`, or `null` where it is unavailable (private browsing, non-browser tests). */
export function browserLayoutStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Some browsers throw merely on *accessing* localStorage under a restrictive policy.
    return null;
  }
}

/** Read the persisted custom layout, falling back to {@link DEFAULT_PANEL_SIZES} on any gap. */
export function loadPanelSizes(storage: StorageLike | null): PanelSizes {
  if (storage === null) {
    return DEFAULT_PANEL_SIZES;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_PANEL_SIZES;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_PANEL_SIZES;
    }
    const record = parsed as Partial<Record<keyof PanelSizes, unknown>>;
    return {
      leftWidth: clampPanelSize('leftWidth', Number(record.leftWidth)),
      rightWidth: clampPanelSize('rightWidth', Number(record.rightWidth)),
      timelineHeight: clampPanelSize('timelineHeight', Number(record.timelineHeight)),
    };
  } catch {
    return DEFAULT_PANEL_SIZES;
  }
}

/** Persist the current custom layout. Best-effort — a write failure never breaks editing. */
export function savePanelSizes(storage: StorageLike | null, sizes: PanelSizes): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Quota exceeded or storage disabled mid-session — the layout still works, it just
    // won't survive a reload. Not worth surfacing to the author.
  }
}
