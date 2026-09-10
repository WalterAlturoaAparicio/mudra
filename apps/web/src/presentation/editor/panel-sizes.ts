/**
 * Sizing policy for the dock layout's three resizable dimensions (items 8–11).
 *
 * Deliberately just numbers: the default every session starts from, the bounds a drag can
 * never cross, and the clamp itself. Persistence is a separate concern
 * (`domain/ports/layout-store.ts` + `infrastructure/persistence/indexeddb-layout-store.ts`) —
 * this file has no storage dependency and no browser API, so it needs no fake to test.
 */

import type { PanelSizes } from '../../domain/ports/layout-store';

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

/**
 * The layout presets View offers (items 9 and 20).
 *
 * Data, not behaviour: a preset is a set of sizes, applied through the same `applySizes` a
 * drag uses. Adding one is a row here.
 */
export const LAYOUT_PRESETS: Readonly<Record<string, PanelSizes>> = {
  /** The shipped balance — everything visible at a workable size. */
  Default: DEFAULT_PANEL_SIZES,
  /** Panels narrowed and the timeline short, for judging the stage itself. */
  'Wide stage': { leftWidth: 180, rightWidth: 220, timelineHeight: 120 },
  /** A tall timeline, for arranging a dense effect. */
  'Timeline focus': { leftWidth: 200, rightWidth: 300, timelineHeight: 420 },
  /** Wide side panels, for parameter-heavy work. */
  'Inspector focus': { leftWidth: 300, rightWidth: 460, timelineHeight: 160 },
};

/** The preset name a fresh session starts in. */
export const DEFAULT_LAYOUT_PRESET = 'Default';

/** Clamp every dimension of a (possibly partially invalid) sizes object. */
export function clampPanelSizes(sizes: PanelSizes): PanelSizes {
  return {
    leftWidth: clampPanelSize('leftWidth', sizes.leftWidth),
    rightWidth: clampPanelSize('rightWidth', sizes.rightWidth),
    timelineHeight: clampPanelSize('timelineHeight', sizes.timelineHeight),
  };
}
