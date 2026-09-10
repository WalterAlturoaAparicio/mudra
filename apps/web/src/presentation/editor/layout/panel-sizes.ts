/**
 * Sizing policy for the dock layout's three resizable dimensions (items 8–11).
 *
 * Deliberately just numbers: the default every session starts from, the bounds a drag can
 * never cross, and the clamp itself. Persistence is a separate concern
 * (`domain/ports/layout-store.ts` + `infrastructure/persistence/indexeddb-layout-store.ts`) —
 * this file has no storage dependency and no browser API, so it needs no fake to test.
 */

import type { PanelSizes } from '../../../domain/ports/layout-store';

export type { PanelSizes };

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

/** Clamp every dimension of a (possibly partially invalid) sizes object. */
export function clampPanelSizes(sizes: PanelSizes): PanelSizes {
  return {
    leftWidth: clampPanelSize('leftWidth', sizes.leftWidth),
    rightWidth: clampPanelSize('rightWidth', sizes.rightWidth),
    timelineHeight: clampPanelSize('timelineHeight', sizes.timelineHeight),
  };
}
