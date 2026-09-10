/**
 * The timeline — a view over one effect's `TimelineEntry[]`, nothing more (FR-013–FR-018,
 * research D5).
 *
 * Every clip's lane is a **derived, presentation-only layout** (greedy interval packing),
 * recomputed on every render from the entries themselves — never stored, never a data-model
 * field, so it cannot drift from the data it is drawn from. Absolute `atMs`/`durationMs`
 * offsets are the only positioning the underlying data ever carries (FR-013); moving or
 * resizing one clip touches only that clip's own entry (FR-015).
 *
 * This view never schedules or advances anything itself — it dispatches intent (`onMove`,
 * `onResize`, …) and the caller decides what, if anything, changes (contracts/
 * editor-runtime-boundary.md).
 *
 * The ruler (item 1) is not a second timing system: it converts milliseconds to pixels with
 * the exact same `msToPx`/`DEFAULT_PX_PER_MS` a clip's own `left` already uses, and its span
 * comes from the effect's own authoritative `timeline.durationMs` — already guaranteed to cover
 * every entry by `domain/editor/project-edits.ts`'s `withTimelineEntries`, so this file never
 * recomputes "the furthest entry end" itself. A ruler tick and a clip positioned at the same
 * `atMs` are therefore pixel-identical by construction, not by convention.
 *
 * Zoom (item 10) is one more number, `this.pxPerMs`, feeding the exact same `msToPx`/
 * `pickTickIntervalMs` the ruler and clips already share — never a second scale. Zooming only
 * ever re-renders from the *same* `entries`/`durationMs` the last `render()` call was given
 * (kept in `lastEntries`/`lastDurationMs`/`lastSelectedIndex`); it recomputes pixel positions,
 * it never touches `atMs`/`durationMs` themselves. Snapping (item 11) reuses the same adaptive
 * grid the ruler ticks already are, at whatever the current zoom is — one grid, drawn once,
 * snapped to and shown from the same numbers.
 */

import type { TimelineEntry } from '../../domain/effects/types';
import type { ActionRegistry } from '../../domain/runtime/action-registry';

/** Device pixels per millisecond of timeline, at the default (unzoomed) scale. */
export const DEFAULT_PX_PER_MS = 0.15;
/** Zoom bounds (item 10) — far enough out to see a long effect at a glance, far enough in for
 *  a single millisecond to be draggable precisely. */
export const MIN_PX_PER_MS = 0.02;
export const MAX_PX_PER_MS = 1.2;
/** Each zoom step multiplies/divides `pxPerMs` by this factor. */
const ZOOM_STEP_FACTOR = 1.5;
/** Minimum clip width, so a 0 ms instantaneous action stays visible and grabbable. */
const MIN_CLIP_WIDTH_PX = 18;
/** A drag within this many pixels of a grid line snaps to it (item 11). */
const SNAP_THRESHOLD_PX = 8;
/**
 * A pointerdown→pointerup with less net movement than this is a click, not a drag (P0.3).
 *
 * `wireMove`/`wireResize` used to call `onMove`/`onResize` from every `pointerup`,
 * unconditionally — including a plain click with zero displacement. That fired a no-op project
 * edit and a synchronous re-render *inside* the pointerup phase, before the browser's own
 * follow-up `click` event had been fully processed against the (now-replaced) clip element —
 * which is what made clicking a clip to select it unreliable. Guarding on real movement means a
 * stationary click never touches the project or the DOM, and selection is left entirely to the
 * `click` listener below.
 */
const DRAG_THRESHOLD_PX = 3;
/** However short an effect is, the ruler always shows at least this much span — so a
 *  brand-new effect (`durationMs: 1`) still renders a legible, navigable ruler. */
const MIN_VISIBLE_MS = 3000;
/** Breathing room past the last tick/clip, so nothing sits flush against the scroll edge. */
const RULER_END_PADDING_PX = 48;
/** A tick's own label needs at least this much horizontal room to stay readable. */
const MIN_TICK_SPACING_PX = 60;
/** Candidate tick intervals, smallest first — adaptive spacing picks the first that clears
 *  `MIN_TICK_SPACING_PX` at the current zoom scale, so the ruler stays readable at any
 *  timeline duration or zoom level (item 10). */
const NICE_TICK_STEPS_MS: readonly number[] = [
  50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000,
];

/** Convert a timeline offset to device pixels — the one place that arithmetic exists.
 *  @param pxPerMs The current zoom scale; defaults to the unzoomed scale for callers (and
 *    existing tests) that don't care about zoom. */
export function msToPx(ms: number, pxPerMs: number = DEFAULT_PX_PER_MS): number {
  return ms * pxPerMs;
}

/** Convert device pixels back to a timeline offset — `msToPx`'s inverse, for drag math. */
export function pxToMs(px: number, pxPerMs: number = DEFAULT_PX_PER_MS): number {
  return px / pxPerMs;
}

/** Clamp a zoom scale to `[MIN_PX_PER_MS, MAX_PX_PER_MS]`. */
export function clampZoom(pxPerMs: number): number {
  return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, pxPerMs));
}

/** The smallest "nice" tick interval that stays readable at the given zoom scale. */
export function pickTickIntervalMs(pxPerMs: number = DEFAULT_PX_PER_MS): number {
  for (const step of NICE_TICK_STEPS_MS) {
    if (msToPx(step, pxPerMs) >= MIN_TICK_SPACING_PX) {
      return step;
    }
  }
  return NICE_TICK_STEPS_MS[NICE_TICK_STEPS_MS.length - 1]!;
}

/** Snap `rawMs` to the nearest adaptive grid line (item 11) when within `SNAP_THRESHOLD_PX` of
 *  it at the given zoom; otherwise returns `rawMs` unchanged. */
export function snapToGrid(
  rawMs: number,
  pxPerMs: number = DEFAULT_PX_PER_MS,
): { readonly value: number; readonly snapped: boolean } {
  const interval = pickTickIntervalMs(pxPerMs);
  const nearest = Math.round(rawMs / interval) * interval;
  const distancePx = Math.abs(msToPx(rawMs - nearest, pxPerMs));
  if (distancePx <= SNAP_THRESHOLD_PX) {
    return { value: nearest, snapped: true };
  }
  return { value: rawMs, snapped: false };
}

/** `"250ms"` below one second, `"1.2s"` at or above it — never more than one decimal. */
export function formatTickLabel(ms: number): string {
  if (ms < 1000) {
    return Math.round(ms) + 'ms';
  }
  const seconds = Math.round(ms / 100) / 10;
  return (Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)) + 's';
}

/** What the timeline needs to exist. */
export interface TimelineOptions {
  readonly document: Document;
  readonly registry: ActionRegistry;
  readonly onSelect: (entryIndex: number | null) => void;
  readonly onMove: (entryIndex: number, atMs: number) => void;
  readonly onResize: (entryIndex: number, durationMs: number) => void;
  readonly onDelete: (entryIndex: number) => void;
  readonly onDuplicate: (entryIndex: number) => void;
}

/**
 * Pointer capture keeps a drag tracking correctly even if the pointer leaves the element —
 * but it is not universally implemented (notably absent from jsdom, which this file's own
 * adapter test runs under), so a missing implementation must not break dragging itself.
 */
function safeSetPointerCapture(element: Element, pointerId: number): void {
  try {
    (element as unknown as { setPointerCapture(id: number): void }).setPointerCapture(pointerId);
  } catch {
    // Dragging still works via ordinary pointermove/pointerup bubbling; capture is an
    // enhancement, not a requirement.
  }
}

/** Assign each entry a presentation-only lane, by greedy interval packing. */
function assignLanes(entries: readonly TimelineEntry[]): readonly number[] {
  const lanes = new Array<number>(entries.length).fill(0);
  const laneEnds: number[] = [];
  const order = entries
    .map((_, index) => index)
    .sort((a, b) => {
      const entryA = entries[a];
      const entryB = entries[b];
      return (entryA?.atMs ?? 0) - (entryB?.atMs ?? 0);
    });
  for (const index of order) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    const start = entry.atMs;
    const end = start + (entry.durationMs ?? 0);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    lanes[index] = lane;
  }
  return lanes;
}

/** The timeline panel. */
export class Timeline {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly registry: ActionRegistry;
  private readonly options: TimelineOptions;
  private readonly scrollArea: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly tracks: HTMLElement;
  private readonly zoomLabel: HTMLElement;

  private pxPerMs = DEFAULT_PX_PER_MS;
  /** What the last `render()` call was given — `setZoom()` replays it at the new scale rather
   *  than asking the caller to re-supply the same data just to change how it's drawn. */
  private lastEntries: readonly TimelineEntry[] = [];
  private lastSelectedIndex: number | null = null;
  private lastDurationMs = 0;

  constructor(options: TimelineOptions) {
    this.document = options.document;
    this.registry = options.registry;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__timeline';

    const header = this.document.createElement('div');
    header.className = 'mudra-editor__timeline-header';
    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Timeline';
    header.append(heading);

    const zoomControls = this.document.createElement('div');
    zoomControls.className = 'mudra-editor__timeline-zoom';
    const zoomOutButton = this.document.createElement('button');
    zoomOutButton.type = 'button';
    zoomOutButton.textContent = '−';
    zoomOutButton.title = 'Zoom out — see more of the timeline at once.';
    zoomOutButton.addEventListener('click', () => this.setZoom(this.pxPerMs / ZOOM_STEP_FACTOR));
    const zoomInButton = this.document.createElement('button');
    zoomInButton.type = 'button';
    zoomInButton.textContent = '+';
    zoomInButton.title = 'Zoom in — space clips out for finer positioning.';
    zoomInButton.addEventListener('click', () => this.setZoom(this.pxPerMs * ZOOM_STEP_FACTOR));
    this.zoomLabel = this.document.createElement('span');
    this.zoomLabel.className = 'mudra-editor__timeline-zoom-label';
    this.updateZoomLabel();
    zoomControls.append(zoomOutButton, this.zoomLabel, zoomInButton);
    header.append(zoomControls);
    this.root.append(header);

    // Ruler and tracks share one scroll container, both sized to the same content width, so
    // they can never scroll independently out of alignment with each other.
    this.scrollArea = this.document.createElement('div');
    this.scrollArea.className = 'mudra-editor__timeline-scroll';
    this.root.append(this.scrollArea);

    this.ruler = this.document.createElement('div');
    this.ruler.className = 'mudra-editor__timeline-ruler';
    this.ruler.title = 'Time, in milliseconds/seconds from the effect’s start.';
    this.scrollArea.append(this.ruler);

    this.tracks = this.document.createElement('div');
    this.tracks.className = 'mudra-editor__timeline-tracks';
    this.tracks.title = 'Drag a clip to move it; drag its right edge to resize it.';
    this.tracks.addEventListener('click', (event) => {
      if (event.target === this.tracks) {
        options.onSelect(null);
      }
    });
    this.scrollArea.append(this.tracks);
  }

  /**
   * Change the zoom scale (item 10), preserving the viewport's current center time rather than
   * jumping — never touches `atMs`/`durationMs` on any entry, only how they're drawn.
   */
  private setZoom(nextPxPerMs: number): void {
    const clamped = clampZoom(nextPxPerMs);
    if (clamped === this.pxPerMs) {
      return;
    }
    const centerPx = this.scrollArea.scrollLeft + this.scrollArea.clientWidth / 2;
    const centerMs = pxToMs(centerPx, this.pxPerMs);

    this.pxPerMs = clamped;
    this.updateZoomLabel();
    this.render(this.lastEntries, this.lastSelectedIndex, this.lastDurationMs);

    this.scrollArea.scrollLeft = Math.max(0, msToPx(centerMs, this.pxPerMs) - this.scrollArea.clientWidth / 2);
  }

  private updateZoomLabel(): void {
    this.zoomLabel.textContent = Math.round((this.pxPerMs / DEFAULT_PX_PER_MS) * 100) + '%';
  }

  /**
   * Redraw the ruler and every clip from the current entries. Cheap enough to call on every
   * edit.
   *
   * @param durationMs The effect's own authoritative timeline duration
   *   (`EffectDefinition.timeline.durationMs`) — the ruler's span and end-of-effect marker.
   *   Defaults to `0` (no marker, minimum ruler span) for callers with no effect selected.
   */
  render(entries: readonly TimelineEntry[], selectedIndex: number | null, durationMs = 0): void {
    this.lastEntries = entries;
    this.lastSelectedIndex = selectedIndex;
    this.lastDurationMs = durationMs;

    this.tracks.replaceChildren();
    this.ruler.replaceChildren();

    const lanes = assignLanes(entries);
    const laneCount = Math.max(1, ...lanes.map((lane) => lane + 1));
    this.tracks.style.setProperty('--mudra-editor-lanes', String(laneCount));

    const contentDurationMs = Math.max(durationMs, MIN_VISIBLE_MS);
    const contentWidthPx = msToPx(contentDurationMs, this.pxPerMs) + RULER_END_PADDING_PX;
    this.ruler.style.width = contentWidthPx + 'px';
    this.tracks.style.width = contentWidthPx + 'px';

    this.renderRuler(contentDurationMs, durationMs);

    entries.forEach((entry, index) => {
      const clip = this.renderClip(entry, index, lanes[index] ?? 0, index === selectedIndex);
      this.tracks.append(clip);
    });
  }

  private renderRuler(contentDurationMs: number, effectDurationMs: number): void {
    const tickIntervalMs = pickTickIntervalMs(this.pxPerMs);
    for (let atMs = 0; atMs <= contentDurationMs; atMs += tickIntervalMs) {
      const tick = this.document.createElement('div');
      tick.className = 'mudra-editor__ruler-tick';
      tick.style.left = msToPx(atMs, this.pxPerMs) + 'px';
      const label = this.document.createElement('span');
      label.textContent = formatTickLabel(atMs);
      tick.append(label);
      this.ruler.append(tick);
    }
    if (effectDurationMs > 0) {
      const marker = this.document.createElement('div');
      marker.className = 'mudra-editor__ruler-duration-marker';
      marker.style.left = msToPx(effectDurationMs, this.pxPerMs) + 'px';
      marker.title = 'Effect duration: ' + formatTickLabel(effectDurationMs);
      this.ruler.append(marker);
    }
  }

  private renderClip(
    entry: TimelineEntry,
    index: number,
    lane: number,
    selected: boolean,
  ): HTMLElement {
    const descriptor = this.registry.get(entry.action.type);
    const behaviour = descriptor?.behaviour ?? 'instantaneous';
    const startMs = entry.atMs;
    const durationMs = entry.durationMs ?? 0;

    const clip = this.document.createElement('div');
    clip.className = 'mudra-editor__clip mudra-editor__clip--' + behaviour;
    clip.classList.toggle('is-selected', selected);
    clip.dataset['behaviour'] = behaviour;
    clip.style.left = msToPx(startMs, this.pxPerMs) + 'px';
    clip.style.width = Math.max(MIN_CLIP_WIDTH_PX, msToPx(durationMs, this.pxPerMs)) + 'px';
    clip.style.top = lane * 40 + 'px';
    // The hover summary (item 9) — type, start/end/duration, selection — since a small `×`
    // button and a colour difference alone were judged not obvious enough.
    clip.title =
      entry.action.type +
      ' · ' +
      formatTickLabel(startMs) +
      '–' +
      formatTickLabel(startMs + durationMs) +
      ' (' +
      formatTickLabel(durationMs) +
      ')' +
      (selected ? ' · selected' : '');

    const label = this.document.createElement('span');
    label.className = 'mudra-editor__clip-label';
    label.textContent = entry.action.type;
    clip.append(label);

    const duplicateButton = this.document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'mudra-editor__clip-duplicate';
    duplicateButton.textContent = '⧉';
    duplicateButton.title = 'Duplicate';
    duplicateButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.options.onDuplicate(index);
    });
    clip.append(duplicateButton);

    const deleteButton = this.document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mudra-editor__clip-delete';
    deleteButton.textContent = '×';
    deleteButton.title = 'Delete';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.options.onDelete(index);
    });
    clip.append(deleteButton);

    clip.addEventListener('click', (event) => {
      event.stopPropagation();
      this.options.onSelect(index);
    });

    this.wireMove(clip, index, entry.atMs);
    if (behaviour !== 'instantaneous') {
      const handle = this.document.createElement('div');
      handle.className = 'mudra-editor__clip-resize-handle';
      clip.append(handle);
      this.wireResize(handle, clip, index, entry.durationMs ?? 0);
    }

    return clip;
  }

  private wireMove(clip: HTMLElement, index: number, originalAtMs: number): void {
    let startX = 0;
    let dragging = false;
    let moved = false;

    clip.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('button, .mudra-editor__clip-resize-handle')) {
        return;
      }
      dragging = true;
      moved = false;
      startX = event.clientX;
      safeSetPointerCapture(clip, event.pointerId);
    });
    clip.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const deltaPx = event.clientX - startX;
      if (Math.abs(deltaPx) >= DRAG_THRESHOLD_PX) {
        moved = true;
      }
      const raw = Math.max(0, originalAtMs + pxToMs(deltaPx, this.pxPerMs));
      const { value, snapped } = snapToGrid(raw, this.pxPerMs);
      clip.style.left = msToPx(value, this.pxPerMs) + 'px';
      clip.classList.toggle('is-snapped', snapped);
    });
    const commit = (event: PointerEvent): void => {
      if (!dragging) {
        return;
      }
      dragging = false;
      clip.classList.remove('is-snapped');
      const deltaPx = event.clientX - startX;
      // `moved` already covers a real drag's intermediate `pointermove`s; this covers the net
      // displacement between down and up too, so a drag with no observed intermediate move
      // (a very short one, or a synthetic dispatch with no `pointermove` at all) is still
      // correctly told apart from a genuine stationary click.
      if (!moved && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) {
        // A plain click: leave `clip.style.left` as the browser last painted it (unchanged)
        // and let the `click` listener own selection — no project edit, no re-render.
        return;
      }
      const raw = Math.max(0, originalAtMs + pxToMs(deltaPx, this.pxPerMs));
      const { value } = snapToGrid(raw, this.pxPerMs);
      this.options.onMove(index, Math.round(value));
    };
    clip.addEventListener('pointerup', commit);
    clip.addEventListener('pointercancel', commit);
  }

  private wireResize(
    handle: HTMLElement,
    clip: HTMLElement,
    index: number,
    originalDurationMs: number,
  ): void {
    let startX = 0;
    let dragging = false;
    let moved = false;

    handle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      dragging = true;
      moved = false;
      startX = event.clientX;
      safeSetPointerCapture(handle, event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const deltaPx = event.clientX - startX;
      if (Math.abs(deltaPx) >= DRAG_THRESHOLD_PX) {
        moved = true;
      }
      const raw = Math.max(0, originalDurationMs + pxToMs(deltaPx, this.pxPerMs));
      const { value, snapped } = snapToGrid(raw, this.pxPerMs);
      clip.style.width = Math.max(MIN_CLIP_WIDTH_PX, msToPx(value, this.pxPerMs)) + 'px';
      clip.classList.toggle('is-snapped', snapped);
    });
    const commit = (event: PointerEvent): void => {
      if (!dragging) {
        return;
      }
      dragging = false;
      event.stopPropagation();
      clip.classList.remove('is-snapped');
      const deltaPx = event.clientX - startX;
      if (!moved && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) {
        return;
      }
      const raw = Math.max(0, originalDurationMs + pxToMs(deltaPx, this.pxPerMs));
      const { value } = snapToGrid(raw, this.pxPerMs);
      this.options.onResize(index, Math.round(value));
    };
    handle.addEventListener('pointerup', commit);
    handle.addEventListener('pointercancel', commit);
  }
}
