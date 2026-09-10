/**
 * The pose lifecycle, driven by a fake clock.
 *
 * A fake clock is not a convenience here — it is the only way to assert FR-036 at all.
 * Elapsed wall-clock time is what governs a hold, so a test that stepped frame by frame
 * would pass whether the implementation counted milliseconds or frames.
 */

import { describe, expect, it } from 'vitest';

import { PoseEventEmitter } from '../../src/domain/events/pose-events';
import type { PoseEvent } from '../../src/domain/events/pose-events';
import { IDLE_HOLD, progress, readyToConfirm } from '../../src/domain/events/hold-state';
import type { RecognitionOutcome } from '../../src/domain/recognition/types';

const HOLD_MS = 1000;

function recognized(poseId: string, timestamp: number, confidence = 0.9): RecognitionOutcome {
  return {
    kind: 'recognized',
    poseId,
    confidence,
    topCandidates: [{ poseId, distance: 0.1, confidence }],
    latencyMs: 10,
    frameTimestamp: timestamp,
  };
}

function noHand(timestamp: number): RecognitionOutcome {
  return { kind: 'noHand', topCandidates: [], latencyMs: 10, frameTimestamp: timestamp };
}

function ambiguous(timestamp: number): RecognitionOutcome {
  return { kind: 'ambiguous', topCandidates: [], latencyMs: 10, frameTimestamp: timestamp };
}

function unrecognized(timestamp: number): RecognitionOutcome {
  return { kind: 'unrecognized', topCandidates: [], latencyMs: 10, frameTimestamp: timestamp };
}

/** Feed a scripted sequence of `[outcome, timeMs]` frames and collect every event. */
function run(frames: readonly [RecognitionOutcome, number][]): PoseEvent[] {
  const emitter = new PoseEventEmitter(HOLD_MS);
  const events: PoseEvent[] = [];
  for (const [outcome, time] of frames) {
    events.push(...emitter.advance(outcome, time));
  }
  return events;
}

describe('a single continuous hold', () => {
  it('emits entered, then held, then exactly one confirmed (FR-034)', () => {
    // 90 frames at 30 fps — three seconds, well past the one-second target.
    const frames: [RecognitionOutcome, number][] = [];
    for (let i = 0; i < 90; i += 1) {
      const t = i * (1000 / 30);
      frames.push([recognized('hi', t), t]);
    }
    const events = run(frames);

    expect(events.filter((e) => e.kind === 'entered')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'confirmed')).toHaveLength(1);
    expect(events[0]!.kind).toBe('entered');
    expect(events.filter((e) => e.kind === 'held').length).toBeGreaterThan(50);
  });

  it('confirms on elapsed time, not on frame count (FR-036)', () => {
    // Five frames spanning 1.2 s — far too few to confirm on a frame count, easily enough
    // on the clock. This is the assertion a frame-counting implementation fails.
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 300), 300],
      [recognized('hi', 600), 600],
      [recognized('hi', 900), 900],
      [recognized('hi', 1200), 1200],
    ]);
    const confirmations = events.filter((e) => e.kind === 'confirmed');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.atMs).toBe(1200);
  });

  it('does not confirm before the target elapses', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 500), 500],
      [recognized('hi', 999), 999],
    ]);
    expect(events.some((e) => e.kind === 'confirmed')).toBe(false);
  });

  it('confirms exactly at the target', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 1000), 1000],
    ]);
    expect(events.filter((e) => e.kind === 'confirmed')).toHaveLength(1);
  });

  it('keeps emitting held after confirmation, and never a second confirmed', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 1000), 1000],
      [recognized('hi', 1500), 1500],
      [recognized('hi', 3000), 3000],
      [recognized('hi', 9000), 9000],
    ]);
    expect(events.filter((e) => e.kind === 'confirmed')).toHaveLength(1);
    expect(events.slice(2).every((e) => e.kind === 'held')).toBe(true);
  });
});

describe('a broken hold', () => {
  for (const [name, breaker] of [
    ['no hand in frame', noHand],
    ['an ambiguous frame', ambiguous],
    ['an unrecognized frame', unrecognized],
  ] as const) {
    it(`resets on ${name} (FR-032)`, () => {
      const events = run([
        [recognized('hi', 0), 0],
        [recognized('hi', 900), 900],
        [breaker(950), 950],
        [recognized('hi', 1000), 1000],
        [recognized('hi', 1900), 1900],
      ]);
      // The second hold began at 1000 ms, so 1900 is only 0.9 s in — no confirmation.
      expect(events.some((e) => e.kind === 'confirmed')).toBe(false);
      expect(events.filter((e) => e.kind === 'exited')).toHaveLength(1);
      expect(events.filter((e) => e.kind === 'entered')).toHaveLength(2);
    });
  }

  it('confirms again after a genuine break and re-form (quickstart scenario 2)', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 1000), 1000],
      [noHand(1100), 1100],
      [recognized('hi', 1200), 1200],
      [recognized('hi', 2200), 2200],
    ]);
    expect(events.filter((e) => e.kind === 'confirmed')).toHaveLength(2);
  });

  it('pairs every entered with an exited', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [noHand(100), 100],
      [recognized('peace', 200), 200],
      [noHand(300), 300],
      [recognized('tp', 400), 400],
      [noHand(500), 500],
    ]);
    expect(events.filter((e) => e.kind === 'entered').map((e) => e.poseId)).toEqual([
      'hi',
      'peace',
      'tp',
    ]);
    expect(events.filter((e) => e.kind === 'exited').map((e) => e.poseId)).toEqual([
      'hi',
      'peace',
      'tp',
    ]);
  });

  it('emits nothing at all while nothing is held', () => {
    expect(
      run([
        [noHand(0), 0],
        [noHand(100), 100],
        [ambiguous(200), 200],
      ]),
    ).toEqual([]);
  });
});

describe('changing pose mid-hold (FR-033)', () => {
  it('exits the old pose and enters the new one in that order', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 500), 500],
      [recognized('peace', 600), 600],
    ]);
    expect(events.map((e) => `${e.kind}:${e.poseId}`)).toEqual([
      'entered:hi',
      'held:hi',
      'exited:hi',
      'entered:peace',
    ]);
  });

  it('does not let the new pose inherit the old one’s elapsed time', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 900), 900],
      [recognized('peace', 1000), 1000],
      [recognized('peace', 1900), 1900],
    ]);
    expect(events.some((e) => e.kind === 'confirmed')).toBe(false);
  });
});

describe('hold progress (FR-035)', () => {
  it('rises continuously from 0 to 1 across the hold', () => {
    const emitter = new PoseEventEmitter(HOLD_MS);
    emitter.advance(recognized('hi', 0), 0);
    expect(emitter.progressAt(0)).toBe(0);
    expect(emitter.progressAt(250)).toBeCloseTo(0.25, 6);
    expect(emitter.progressAt(500)).toBeCloseTo(0.5, 6);
    expect(emitter.progressAt(999)).toBeCloseTo(0.999, 6);
    expect(emitter.progressAt(1000)).toBe(1);
  });

  it('clamps rather than exceeding 1', () => {
    const emitter = new PoseEventEmitter(HOLD_MS);
    emitter.advance(recognized('hi', 0), 0);
    expect(emitter.progressAt(50_000)).toBe(1);
  });

  it('returns to 0 when the hold breaks', () => {
    const emitter = new PoseEventEmitter(HOLD_MS);
    emitter.advance(recognized('hi', 0), 0);
    emitter.advance(noHand(400), 400);
    expect(emitter.progressAt(400)).toBe(0);
    expect(emitter.hold).toEqual(IDLE_HOLD);
  });

  it('is carried on the events themselves', () => {
    const events = run([
      [recognized('hi', 0), 0],
      [recognized('hi', 500), 500],
      [recognized('hi', 1000), 1000],
    ]);
    expect(events[0]!.progress).toBe(0);
    expect(events[1]!.progress).toBeCloseTo(0.5, 6);
    expect(events[2]!.progress).toBe(1);
  });
});

describe('HoldState functions in isolation', () => {
  it('reports no progress and no readiness when idle', () => {
    expect(progress(IDLE_HOLD, 5000, HOLD_MS)).toBe(0);
    expect(readyToConfirm(IDLE_HOLD, 5000, HOLD_MS)).toBe(false);
  });

  it('refuses to confirm twice', () => {
    const held = { poseId: 'hi', heldSince: 0, confirmedAt: 1000 };
    expect(readyToConfirm(held, 2000, HOLD_MS)).toBe(false);
  });
});

describe('reset', () => {
  it('drops a hold without emitting an event', () => {
    const emitter = new PoseEventEmitter(HOLD_MS);
    emitter.advance(recognized('hi', 0), 0);
    emitter.reset();
    expect(emitter.hold).toEqual(IDLE_HOLD);
    expect(emitter.advance(recognized('hi', 100), 100).map((e) => e.kind)).toEqual(['entered']);
  });
});
