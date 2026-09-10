/**
 * The timeline UI: select, drag-to-move, drag-to-resize, delete, duplicate — each dispatches
 * intent for exactly the clip interacted with, never another (T037, SC-007).
 */

import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '../../src/domain/effects/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import {
  DEFAULT_PX_PER_MS,
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  Timeline,
  clampZoom,
  formatTickLabel,
  msToPx,
  snapToGrid,
} from '../../src/presentation/editor/timeline';

const registry = createActionRegistry();

function entries(): TimelineEntry[] {
  return [
    { atMs: 0, durationMs: 300, action: { type: 'screen_flash', params: {} } },
    { atMs: 500, durationMs: 400, action: { type: 'particle_burst', params: {} } },
  ];
}

/**
 * jsdom does not implement the Pointer Events API (no global `PointerEvent`), so a
 * `MouseEvent` carrying the same `type` and `clientX` is dispatched instead — event
 * listeners match by `type` string, not by constructor, so `timeline.ts`'s
 * `addEventListener('pointerdown', …)` fires identically either way. `pointerId` is attached
 * only because `safeSetPointerCapture` reads it; it is not required to be meaningful here.
 */
function pointer(type: string, clientX: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { clientX, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function buildTimeline(handlers: Partial<ConstructorParameters<typeof Timeline>[0]> = {}) {
  const calls = {
    select: [] as (number | null)[],
    move: [] as [number, number][],
    resize: [] as [number, number][],
    delete: [] as number[],
    duplicate: [] as number[],
  };
  const timeline = new Timeline({
    document,
    registry,
    onSelect: (i) => calls.select.push(i),
    onMove: (i, atMs) => calls.move.push([i, atMs]),
    onResize: (i, durationMs) => calls.resize.push([i, durationMs]),
    onDelete: (i) => calls.delete.push(i),
    onDuplicate: (i) => calls.duplicate.push(i),
    ...handlers,
  });
  return { timeline, calls };
}

describe('selection', () => {
  it('selects the clicked clip', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    clips[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.select).toEqual([1]);
  });

  it('deselects when the empty track area is clicked', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), 0);
    const tracks = timeline.root.querySelector<HTMLElement>('.mudra-editor__timeline-tracks')!;
    tracks.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.select).toEqual([null]);
  });
});

describe('drag-to-move', () => {
  it('reports the new atMs for exactly the dragged clip', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointermove', 160)); // +60px = +400ms at 0.15 px/ms
    clip.dispatchEvent(pointer('pointerup', 160));

    expect(calls.move).toHaveLength(1);
    expect(calls.move[0]![0]).toBe(0);
    expect(calls.move[0]![1]).toBeCloseTo(400, 0);
    expect(calls.resize).toHaveLength(0);
  });

  it('never moves below 0 ms', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;
    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointerup', -10000));
    expect(calls.move[0]![1]).toBe(0);
  });
});

describe('drag-to-resize', () => {
  it('reports the new durationMs for exactly the resized clip, via its handle', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    const handle = clips[1]!.querySelector<HTMLElement>('.mudra-editor__clip-resize-handle')!;

    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointerup', 130)); // +30px = +200ms

    expect(calls.resize).toHaveLength(1);
    expect(calls.resize[0]![0]).toBe(1);
    expect(calls.resize[0]![1]).toBeCloseTo(600, 0);
    expect(calls.move).toHaveLength(0);
  });

  it('an instantaneous action has no resize handle', () => {
    const { timeline } = buildTimeline();
    timeline.render([{ atMs: 0, action: { type: 'play_audio', params: {} } }], null);
    const clip = timeline.root.querySelector<HTMLElement>('.mudra-editor__clip')!;
    expect(clip.querySelector('.mudra-editor__clip-resize-handle')).toBeNull();
  });
});

describe('a plain click never fires onMove/onResize (P0.3 — click-to-select reliability)', () => {
  it('pointerdown+pointerup at the same position fires neither onMove nor a spurious edit', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointerup', 100));

    expect(calls.move).toHaveLength(0);
  });

  it('a sub-threshold jitter (below DRAG_THRESHOLD_PX) is still treated as a click', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointerup', 101)); // +1px — real click jitter, not a drag
    expect(calls.move).toHaveLength(0);
  });

  it('the click listener still selects the clip when onMove was suppressed', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointerup', 100));
    clip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(calls.move).toHaveLength(0);
    expect(calls.select).toEqual([0]);
  });

  it('the resize handle: a stationary pointerdown+pointerup fires no onResize', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    const handle = clips[1]!.querySelector<HTMLElement>('.mudra-editor__clip-resize-handle')!;

    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointerup', 100));

    expect(calls.resize).toHaveLength(0);
  });

  it('a real drag (above threshold) still fires onMove exactly once', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    clip.dispatchEvent(pointer('pointerdown', 100));
    clip.dispatchEvent(pointer('pointerup', 160)); // +60px, no intermediate pointermove either
    expect(calls.move).toHaveLength(1);
    expect(calls.move[0]![1]).toBeCloseTo(400, 0);
  });
});

describe('delete / duplicate', () => {
  it('deletes exactly the clicked clip, not the drag target', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    clips[0]!
      .querySelector<HTMLElement>('.mudra-editor__clip-delete')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.delete).toEqual([0]);
    expect(calls.select).toHaveLength(0); // stopPropagation — the click never also selects
  });

  it('duplicates exactly the clicked clip', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    clips[1]!
      .querySelector<HTMLElement>('.mudra-editor__clip-duplicate')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.duplicate).toEqual([1]);
  });
});

describe('ten operations leave every untouched clip alone (SC-007)', () => {
  it('each dispatched call names only the clip that was interacted with', () => {
    const { timeline, calls } = buildTimeline();
    const source = [
      ...entries(),
      { atMs: 1000, durationMs: 100, action: { type: 'landmark_trail', params: {} } },
    ];
    timeline.render(source, null);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');

    for (let i = 0; i < 10; i++) {
      const target = clips[i % clips.length]!;
      target.dispatchEvent(pointer('pointerdown', 0));
      target.dispatchEvent(pointer('pointerup', (i + 1) * 10));
    }

    expect(calls.move).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(calls.move[i]![0]).toBe(i % clips.length);
    }
  });
});

describe('time ruler (item 1)', () => {
  it('renders a tick at 0 and at least one more within a short duration', () => {
    const { timeline } = buildTimeline();
    timeline.render([], null, 1000);
    const ticks = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__ruler-tick');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]!.style.left).toBe('0px');
  });

  it('a tick and a clip at the same atMs land at the exact same pixel — the alignment guarantee', () => {
    const { timeline } = buildTimeline();
    const atMs = 500;
    timeline.render(
      [{ atMs, durationMs: 200, action: { type: 'screen_flash', params: {} } }],
      null,
      2000,
    );
    const clip = timeline.root.querySelector<HTMLElement>('.mudra-editor__clip')!;
    // atMs (500) is not necessarily itself a rendered tick offset unless it's a multiple of
    // the interval — assert against the shared `msToPx` conversion directly instead, which is
    // the actual guarantee: both draw from the same arithmetic.
    expect(clip.style.left).toBe(msToPx(atMs) + 'px');
  });

  it('spaces consecutive ticks at least MIN_TICK_SPACING_PX apart, however long the effect is', () => {
    const { timeline } = buildTimeline();
    timeline.render([], null, 120000);
    const lefts = [...timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__ruler-tick')]
      .map((tick) => Number.parseFloat(tick.style.left))
      .sort((a, b) => a - b);
    expect(lefts.length).toBeGreaterThan(2);
    for (let i = 1; i < lefts.length; i++) {
      expect(lefts[i]! - lefts[i - 1]!).toBeGreaterThanOrEqual(60);
    }
  });

  it('a longer effect renders proportionally more ticks than a short one, at the same spacing', () => {
    const { timeline } = buildTimeline();
    timeline.render([], null, 500);
    const shortTickCount = timeline.root.querySelectorAll('.mudra-editor__ruler-tick').length;

    timeline.render([], null, 50000);
    const longTickCount = timeline.root.querySelectorAll('.mudra-editor__ruler-tick').length;

    expect(longTickCount).toBeGreaterThan(shortTickCount);
  });

  it('shows an end-of-effect marker at durationMs when a duration is given, not at all when it is 0', () => {
    const { timeline } = buildTimeline();
    timeline.render([], null, 800);
    const marker = timeline.root.querySelector<HTMLElement>('.mudra-editor__ruler-duration-marker');
    expect(marker).not.toBeNull();
    expect(marker!.style.left).toBe(msToPx(800) + 'px');

    timeline.render([], null, 0);
    expect(timeline.root.querySelector('.mudra-editor__ruler-duration-marker')).toBeNull();
  });

  it('the ruler and the tracks always span the same content width, so they scroll together', () => {
    const { timeline } = buildTimeline();
    timeline.render([], null, 5000);
    const ruler = timeline.root.querySelector<HTMLElement>('.mudra-editor__timeline-ruler')!;
    const tracks = timeline.root.querySelector<HTMLElement>('.mudra-editor__timeline-tracks')!;
    expect(ruler.style.width).toBe(tracks.style.width);
  });

  it('formatTickLabel reads in ms below one second and in s (max one decimal) at/above it', () => {
    expect(formatTickLabel(0)).toBe('0ms');
    expect(formatTickLabel(250)).toBe('250ms');
    expect(formatTickLabel(999)).toBe('999ms');
    expect(formatTickLabel(1000)).toBe('1s');
    expect(formatTickLabel(1200)).toBe('1.2s');
    expect(formatTickLabel(2000)).toBe('2s');
  });
});

describe('hover feedback (item 9)', () => {
  it('every clip carries a title summarizing type, start/end, duration, and selection', () => {
    const { timeline } = buildTimeline();
    timeline.render(entries(), 0);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');

    expect(clips[0]!.title).toBe('screen_flash · 0ms–300ms (300ms) · selected');
    expect(clips[1]!.title).toBe('particle_burst · 500ms–900ms (400ms)');
  });

  it('hover is distinguishable from selection via distinct CSS classes', () => {
    const { timeline } = buildTimeline();
    timeline.render(entries(), 0);
    const clips = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip');
    // Hover itself is a CSS :hover state (no JS/class toggle needed) — what this proves is
    // that selection and the future snap indicator use their own distinct classes, so a CSS
    // :hover rule can never collide with "is this the selected clip".
    expect(clips[0]!.classList.contains('is-selected')).toBe(true);
    expect(clips[1]!.classList.contains('is-selected')).toBe(false);
  });
});

describe('zoom (item 10) — pixels change, atMs/durationMs never do', () => {
  function zoomButtons(timeline: Timeline): { out: HTMLButtonElement; in: HTMLButtonElement } {
    const buttons = timeline.root.querySelectorAll<HTMLButtonElement>(
      '.mudra-editor__timeline-zoom button',
    );
    return { out: buttons[0]!, in: buttons[1]! };
  }

  it('zooming in scales clip pixel position proportionally, without touching the source data', () => {
    const { timeline } = buildTimeline();
    const source = entries();
    const before = JSON.parse(JSON.stringify(source));
    timeline.render(source, null);

    const clipBefore = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[1]!;
    expect(clipBefore.style.left).toBe(msToPx(500, DEFAULT_PX_PER_MS) + 'px');

    zoomButtons(timeline).in.click();

    const clipAfter = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[1]!;
    const expectedPxPerMs = DEFAULT_PX_PER_MS * 1.5;
    expect(clipAfter.style.left).toBe(msToPx(500, expectedPxPerMs) + 'px');

    // The actual data is untouched — zooming only changes how it's drawn (item 10's core rule).
    expect(source).toEqual(before);
  });

  it('zooming out scales down, and the zoom label reflects the current scale', () => {
    const { timeline } = buildTimeline();
    timeline.render(entries(), null);
    const label = timeline.root.querySelector<HTMLElement>('.mudra-editor__timeline-zoom-label')!;
    expect(label.textContent).toBe('100%');

    zoomButtons(timeline).out.click();
    expect(label.textContent).toBe(Math.round((1 / 1.5) * 100) + '%');
  });

  it('clampZoom enforces sensible min/max bounds (item 10)', () => {
    expect(clampZoom(0.0001)).toBe(MIN_PX_PER_MS);
    expect(clampZoom(100)).toBe(MAX_PX_PER_MS);
    expect(clampZoom(DEFAULT_PX_PER_MS)).toBe(DEFAULT_PX_PER_MS);
  });

  it('repeated zoom-in never exceeds MAX_PX_PER_MS', () => {
    const { timeline } = buildTimeline();
    timeline.render(entries(), null);
    const { in: zoomIn } = zoomButtons(timeline);
    for (let i = 0; i < 30; i++) {
      zoomIn.click();
    }
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[1]!;
    expect(clip.style.left).toBe(msToPx(500, MAX_PX_PER_MS) + 'px');
  });
});

describe('snapping (item 11) — reuses the ruler’s own adaptive grid', () => {
  it('snapToGrid snaps a value within the pixel threshold of a grid line', () => {
    // At the default scale the adaptive interval is 500ms (pickTickIntervalMs's own rule).
    const near = snapToGrid(510, DEFAULT_PX_PER_MS);
    expect(near.snapped).toBe(true);
    expect(near.value).toBe(500);
  });

  it('snapToGrid leaves a value far from any grid line unchanged', () => {
    const far = snapToGrid(350, DEFAULT_PX_PER_MS);
    expect(far.snapped).toBe(false);
    expect(far.value).toBe(350);
  });

  it('dragging a clip near a grid line snaps onMove’s reported atMs to it', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!; // atMs=0

    // +510ms of drag, close enough to the 500ms grid line to snap.
    const deltaPx = msToPx(510, DEFAULT_PX_PER_MS);
    clip.dispatchEvent(pointer('pointerdown', 0));
    clip.dispatchEvent(pointer('pointermove', deltaPx));
    clip.dispatchEvent(pointer('pointerup', deltaPx));

    expect(calls.move).toHaveLength(1);
    expect(calls.move[0]![1]).toBe(500);
  });

  it('dragging a clip far from any grid line reports the raw, unsnapped atMs', () => {
    const { timeline, calls } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!; // atMs=0

    const deltaPx = msToPx(350, DEFAULT_PX_PER_MS);
    clip.dispatchEvent(pointer('pointerdown', 0));
    clip.dispatchEvent(pointer('pointermove', deltaPx));
    clip.dispatchEvent(pointer('pointerup', deltaPx));

    expect(calls.move).toHaveLength(1);
    expect(calls.move[0]![1]).toBeCloseTo(350, 0);
  });

  it('shows a visual snap indicator (is-snapped) while a drag is within the snap threshold', () => {
    const { timeline } = buildTimeline();
    timeline.render(entries(), null);
    const clip = timeline.root.querySelectorAll<HTMLElement>('.mudra-editor__clip')[0]!;

    const deltaPx = msToPx(510, DEFAULT_PX_PER_MS);
    clip.dispatchEvent(pointer('pointerdown', 0));
    clip.dispatchEvent(pointer('pointermove', deltaPx));
    expect(clip.classList.contains('is-snapped')).toBe(true);

    clip.dispatchEvent(pointer('pointerup', deltaPx));
    expect(clip.classList.contains('is-snapped')).toBe(false); // cleared once the drag ends
  });
});
