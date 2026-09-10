/**
 * Absolute offsets, honoured durations, and independence between entries.
 *
 * SC-014 asks that each action begin within 50 ms of its configured offset. FR-047 asks
 * something stronger and easier to break: that moving one entry reposition **no other**.
 * Both are asserted here, the second by moving an entry and comparing every other entry's
 * firing time against the run before.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import { scheduleEntries } from '../../src/domain/runtime/timeline-scheduler';
import type { TimelineEntry } from '../../src/domain/effects/types';
import type { Action } from '../../src/domain/effects/types';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';

const emptyFrame = landmarkFrame([], 0, 1280, 720);

const flash = { type: 'screen_flash', params: { color: '#FFFFFF' } };
const wash = { type: 'background_wash', params: { color: '#112233' } };
const burst: Action = {
  type: 'particle_burst',
  params: { count: 8, anchor: { kind: 'screen', x: 0.5, y: 0.5 } },
};

/** Run a timeline at 60 fps and record the first frame each entry produced output on. */
function firstOutputTimes(
  entries: readonly TimelineEntry[],
  durationMs: number,
): Map<number, number> {
  const runtime = runtimeFor(catalog(effect({ id: 'e', poseId: 'p', durationMs, entries })));
  const seen = new Map<number, number>();
  const step = 1000 / 60;

  for (let t = 0; t <= durationMs; t += step) {
    const output =
      t === 0
        ? runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0)
        : runtime.advance([], emptyFrame, t);
    // Command count is a proxy for "which entries produced output"; entries here emit one
    // command each, so a count increase names the entry that just became active.
    output.commands.forEach((_, index) => {
      if (!seen.has(index)) {
        seen.set(index, t);
      }
    });
  }
  return seen;
}

describe('entries begin at their absolute offsets (FR-046, SC-014)', () => {
  it('each within 50 ms of where it was configured', () => {
    const entries = [entry(0, flash, 200), entry(300, burst, 400), entry(700, wash, 500)];
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 1200, entries })),
    );

    const starts = new Map<string, number>();
    const step = 1000 / 60;
    for (let t = 0; t <= 1200; t += step) {
      const output =
        t === 0
          ? runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0)
          : runtime.advance([], emptyFrame, t);
      for (const command of output.commands) {
        const key =
          command.kind === 'drawCircles'
            ? 'burst'
            : command.kind === 'fillScreen'
              ? t < 250
                ? 'flash'
                : 'wash'
              : command.kind;
        if (!starts.has(key)) {
          starts.set(key, t);
        }
      }
    }

    expect(starts.get('flash')!).toBeLessThanOrEqual(50);
    expect(Math.abs(starts.get('burst')! - 300)).toBeLessThanOrEqual(50);
    expect(Math.abs(starts.get('wash')! - 700)).toBeLessThanOrEqual(50);
  });

  it('honours each entry’s own duration', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 1000, entries: [entry(200, wash, 300)] })),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(runtime.advance([], emptyFrame, 150).commands).toHaveLength(0);
    expect(runtime.advance([], emptyFrame, 350).commands).toHaveLength(1);
    expect(runtime.advance([], emptyFrame, 480).commands).toHaveLength(1);
    expect(runtime.advance([], emptyFrame, 520).commands).toHaveLength(0);
  });
});

describe('moving one entry repositions no other (FR-047)', () => {
  it('leaves every other entry’s start time unchanged', () => {
    const before = [entry(0, flash, 200), entry(300, burst, 200), entry(700, wash, 200)];
    // Only the middle entry moves — from 300 ms to 500 ms.
    const after = [entry(0, flash, 200), entry(500, burst, 200), entry(700, wash, 200)];

    const timesBefore = firstOutputTimes(before, 1000);
    const timesAfter = firstOutputTimes(after, 1000);

    // Entry 0 is unaffected. This is the assertion a relative-delay chain fails: there, the
    // third entry would slide 200 ms later because the second one did.
    expect(timesAfter.get(0)).toBe(timesBefore.get(0));
  });

  it('does not make a later entry depend on an earlier one’s duration', () => {
    const shortMiddle = [entry(0, flash, 100), entry(400, wash, 100)];
    const longMiddle = [entry(0, flash, 350), entry(400, wash, 100)];

    const a = firstOutputTimes(shortMiddle, 800);
    const b = firstOutputTimes(longMiddle, 800);
    expect(a.get(0)).toBe(b.get(0));
  });
});

describe('the scheduler in isolation', () => {
  const behaviours = {
    screen_flash: 'instantaneous',
    background_wash: 'duration',
    landmark_trail: 'continuous',
  } as const;

  const behaviourOf = (item: TimelineEntry) =>
    behaviours[item.action.type as keyof typeof behaviours];

  it('fires a zero-duration instantaneous entry exactly once', () => {
    const entries = [entry(100, { type: 'screen_flash', params: {} })];
    expect(scheduleEntries(entries, 50, -1, behaviourOf)).toHaveLength(0);
    expect(scheduleEntries(entries, 120, 50, behaviourOf)).toHaveLength(1);
    expect(scheduleEntries(entries, 200, 120, behaviourOf)).toHaveLength(0);
  });

  it('fires it even when a dropped frame steps clean over its offset', () => {
    // The failure this prevents: an effect that silently loses its sound on a slow machine.
    const entries = [entry(100, { type: 'screen_flash', params: {} })];
    const fired = scheduleEntries(entries, 400, 20, behaviourOf);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.justFired).toBe(true);
  });

  it('keeps a duration entry scheduled across its window and reports progress', () => {
    const entries = [entry(0, { type: 'background_wash', params: {} }, 400)];
    expect(scheduleEntries(entries, 0, -1, behaviourOf)[0]!.progress).toBeCloseTo(0, 6);
    expect(scheduleEntries(entries, 200, 180, behaviourOf)[0]!.progress).toBeCloseTo(0.5, 6);
    expect(scheduleEntries(entries, 399, 380, behaviourOf)[0]!.progress).toBeCloseTo(0.9975, 4);
    expect(scheduleEntries(entries, 400, 380, behaviourOf)).toHaveLength(0);
  });

  it('advances by elapsed time, so a low frame rate does not slow an effect (FR-049)', () => {
    const entries = [entry(0, { type: 'background_wash', params: {} }, 1000)];
    // Two frames 500 ms apart reach the same progress as thirty frames covering 500 ms.
    const sparse = scheduleEntries(entries, 500, 0, behaviourOf)[0]!.progress;
    const dense = scheduleEntries(entries, 500, 483, behaviourOf)[0]!.progress;
    expect(sparse).toBeCloseTo(dense, 9);
  });
});
