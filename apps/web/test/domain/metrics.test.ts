/**
 * T094b / FR-095: where the three timestamps are taken.
 *
 * The wall-clock *figure* is a measurement and belongs in T100. What belongs in a test is
 * the part that is a property rather than a number: that `t_trigger`, `t_command`, and
 * `t_paint` are captured at the right points in the pipeline, and that the reported
 * interval is `t_paint − t_trigger` rather than something more flattering.
 *
 * A fake clock throughout — a real one would make this a flaky measurement of the test
 * runner rather than an assertion about the code.
 */

import { describe, expect, it } from 'vitest';

import {
  FrameRateMeter,
  SessionMetrics,
  TriggerLatencyTracker,
} from '../../src/application/metrics';

describe('TriggerLatencyTracker', () => {
  it('reports t_paint − t_trigger as the headline figure', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 1000);
    tracker.commanded('e', 1020);
    tracker.drawn('e', 1035);
    const [measurement] = tracker.painted(1048);

    expect(measurement!.effectId).toBe('e');
    expect(measurement!.totalMs).toBe(48);
  });

  it('reports t_command − t_trigger as the runtime-only portion', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 1000);
    tracker.commanded('e', 1020);
    tracker.drawn('e', 1035);
    const [measurement] = tracker.painted(1048);

    expect(measurement!.runtimeMs).toBe(20);
    // The runtime portion is a *part* of the total, never the whole answer — reporting it
    // alone would be the flattering number.
    expect(measurement!.runtimeMs).toBeLessThan(measurement!.totalMs);
  });

  it('completes nothing until the draw call has happened', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 0);
    tracker.commanded('e', 10);
    // An animation frame before the renderer drew is not this playback's paint.
    expect(tracker.painted(20)).toEqual([]);
    expect(tracker.latest).toBeNull();

    tracker.drawn('e', 25);
    expect(tracker.painted(30)).toHaveLength(1);
    expect(tracker.latest!.totalMs).toBe(30);
  });

  it('completes nothing until a command was actually emitted', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 0);
    tracker.drawn('e', 25);
    expect(tracker.painted(30)).toEqual([]);
  });

  it('keeps the FIRST command and the FIRST draw, not the latest', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 0);
    tracker.commanded('e', 10);
    tracker.commanded('e', 200); // a later frame of the same playback
    tracker.drawn('e', 15);
    tracker.drawn('e', 210);
    const [measurement] = tracker.painted(20);

    expect(measurement!.runtimeMs).toBe(10);
    expect(measurement!.totalMs).toBe(20);
  });

  it('tracks concurrent playbacks separately', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('a', 0);
    tracker.triggered('b', 100);
    tracker.commanded('a', 5);
    tracker.commanded('b', 105);
    tracker.drawn('a', 10);
    tracker.drawn('b', 110);

    const finished = tracker.painted(120);
    expect(finished).toHaveLength(2);
    const byId = new Map(finished.map((m) => [m.effectId, m.totalMs]));
    expect(byId.get('a')).toBe(120);
    expect(byId.get('b')).toBe(20);
  });

  it('completes a measurement once and does not repeat it', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 0);
    tracker.commanded('e', 5);
    tracker.drawn('e', 10);
    expect(tracker.painted(15)).toHaveLength(1);
    expect(tracker.painted(20)).toHaveLength(0);
    expect(tracker.history).toHaveLength(1);
  });

  it('forgets everything on reset', () => {
    const tracker = new TriggerLatencyTracker();
    tracker.triggered('e', 0);
    tracker.commanded('e', 5);
    tracker.drawn('e', 10);
    tracker.painted(15);
    tracker.reset();
    expect(tracker.latest).toBeNull();
    expect(tracker.history).toEqual([]);
  });
});

describe('FrameRateMeter', () => {
  it('reports nothing before a second frame arrives', () => {
    const meter = new FrameRateMeter();
    expect(meter.fps).toBe(0);
    meter.tick(0);
    expect(meter.fps).toBe(0);
  });

  it('reports the mean rate over its window', () => {
    const meter = new FrameRateMeter();
    for (let i = 0; i <= 30; i += 1) {
      meter.tick(i * (1000 / 30));
    }
    expect(meter.fps).toBeCloseTo(30, 6);
  });

  it('averages rather than reporting the last interval', () => {
    // One slow frame in thirty should not read as a collapse.
    const meter = new FrameRateMeter();
    let t = 0;
    for (let i = 0; i < 30; i += 1) {
      t += 1000 / 60;
      meter.tick(t);
    }
    t += 500;
    meter.tick(t);
    expect(meter.fps).toBeGreaterThan(30);
    expect(meter.fps).toBeLessThan(60);
  });

  it('forgets everything on reset', () => {
    const meter = new FrameRateMeter();
    meter.tick(0);
    meter.tick(16);
    meter.reset();
    expect(meter.fps).toBe(0);
  });
});

describe('SessionMetrics', () => {
  it('exposes the three figures together', () => {
    const metrics = new SessionMetrics();
    metrics.recordFrame(0, 12);
    metrics.recordFrame(33, 14);

    metrics.triggerLatency.triggered('e', 40);
    metrics.triggerLatency.commanded('e', 50);
    metrics.triggerLatency.drawn('e', 60);
    metrics.triggerLatency.painted(75);

    const snapshot = metrics.snapshot();
    expect(snapshot.fps).toBeGreaterThan(0);
    expect(snapshot.recognitionLatencyMs).toBe(14);
    expect(snapshot.triggerToPaint!.totalMs).toBe(35);
    expect(snapshot.triggerToPaint!.runtimeMs).toBe(10);
  });

  it('reports no trigger-to-paint figure before anything has been triggered', () => {
    expect(new SessionMetrics().snapshot().triggerToPaint).toBeNull();
  });
});
