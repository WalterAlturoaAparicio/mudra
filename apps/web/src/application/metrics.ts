/**
 * Performance measured, not assumed (FR-093).
 *
 * Three things are measured, and the third needs its boundaries stated because it is the
 * one that cannot be measured exactly:
 *
 * * **Frame rate** — a rolling mean over recent frames, so a single slow frame does not
 *   read as a collapse and a slow minute does not hide behind a fast second.
 * * **Recognition latency** — capture to outcome (FR-094).
 * * **Trigger to first paint** (FR-095, SC-005) — three timestamps:
 *   - `t_trigger`: the pose event that satisfied a trigger was emitted.
 *   - `t_command`: the runtime first emitted a non-empty command list for that playback.
 *   - `t_paint`: the first `requestAnimationFrame` callback that ran *after* the renderer
 *     issued that playback's first draw call.
 *
 * `t_paint` is a **proxy and is reported as one**. The browser exposes no per-element paint
 * timestamp, so the first animation frame after the draw call is the smallest practical
 * measurement available without a paint-timing API. `apps/web/README.md` says the same, so
 * nobody reads the number as more than it is.
 */

/** A rolling window of recent frame intervals. */
export class FrameRateMeter {
  private readonly intervals: number[] = [];
  private readonly window: number;
  private lastFrameMs: number | null = null;

  /** @param window How many intervals to average over. */
  constructor(window = 60) {
    this.window = window;
  }

  /** Record a frame at `nowMs`. */
  tick(nowMs: number): void {
    if (this.lastFrameMs !== null) {
      const interval = nowMs - this.lastFrameMs;
      if (interval > 0) {
        this.intervals.push(interval);
        while (this.intervals.length > this.window) {
          this.intervals.shift();
        }
      }
    }
    this.lastFrameMs = nowMs;
  }

  /** Frames per second over the window, or `0` before enough frames have arrived. */
  get fps(): number {
    if (this.intervals.length === 0) {
      return 0;
    }
    const total = this.intervals.reduce((sum, value) => sum + value, 0);
    return (this.intervals.length / total) * 1000;
  }

  /** Forget everything — for a session restarting. */
  reset(): void {
    this.intervals.length = 0;
    this.lastFrameMs = null;
  }
}

/** One completed trigger-to-paint measurement. */
export interface TriggerToPaint {
  readonly effectId: string;
  /** `t_paint − t_trigger`, the figure measured against the 200 ms budget. */
  readonly totalMs: number;
  /** `t_command − t_trigger`, the runtime-only portion. */
  readonly runtimeMs: number;
}

interface PendingTrigger {
  readonly effectId: string;
  readonly triggerMs: number;
  commandMs: number | null;
  drawnMs: number | null;
}

/**
 * Tracks the three timestamps per triggered playback.
 *
 * Kept separate from the session so the boundaries are testable with a fake clock and no
 * browser — the wall-clock figure itself is a measurement, but *where the boundaries are*
 * is a property, and properties belong in tests (T094b).
 */
export class TriggerLatencyTracker {
  private readonly pending = new Map<string, PendingTrigger>();
  private readonly completed: TriggerToPaint[] = [];
  private readonly historyLimit: number;

  /** @param historyLimit How many completed measurements to retain. */
  constructor(historyLimit = 20) {
    this.historyLimit = historyLimit;
  }

  /** (a) A pose event satisfied a trigger and a playback began. */
  triggered(effectId: string, atMs: number): void {
    this.pending.set(effectId, {
      effectId,
      triggerMs: atMs,
      commandMs: null,
      drawnMs: null,
    });
  }

  /** (b) The runtime first emitted a non-empty command list for that playback. */
  commanded(effectId: string, atMs: number): void {
    const entry = this.pending.get(effectId);
    if (entry !== undefined && entry.commandMs === null) {
      entry.commandMs = atMs;
    }
  }

  /** The renderer has issued that playback's first draw call. */
  drawn(effectId: string, atMs: number): void {
    const entry = this.pending.get(effectId);
    if (entry !== undefined && entry.drawnMs === null) {
      entry.drawnMs = atMs;
    }
  }

  /**
   * (c) An animation frame ran; complete any measurement whose draw call preceded it.
   *
   * Called from a `requestAnimationFrame` callback scheduled *after* the draw, which is
   * the proxy for paint described in this module's header.
   */
  painted(atMs: number): readonly TriggerToPaint[] {
    const finished: TriggerToPaint[] = [];
    for (const [effectId, entry] of [...this.pending]) {
      if (entry.drawnMs === null || entry.commandMs === null) {
        continue;
      }
      const measurement: TriggerToPaint = {
        effectId,
        totalMs: atMs - entry.triggerMs,
        runtimeMs: entry.commandMs - entry.triggerMs,
      };
      finished.push(measurement);
      this.completed.push(measurement);
      this.pending.delete(effectId);
    }
    while (this.completed.length > this.historyLimit) {
      this.completed.shift();
    }
    return finished;
  }

  /** The most recent completed measurement, or `null`. */
  get latest(): TriggerToPaint | null {
    return this.completed[this.completed.length - 1] ?? null;
  }

  /** Every retained measurement, oldest first. */
  get history(): readonly TriggerToPaint[] {
    return this.completed;
  }

  /** Forget everything — for a session restarting. */
  reset(): void {
    this.pending.clear();
    this.completed.length = 0;
  }
}

/** Everything the debug panel displays about performance. */
export interface PerformanceSnapshot {
  readonly fps: number;
  /** Capture-to-outcome latency of the most recent frame, in milliseconds. */
  readonly recognitionLatencyMs: number;
  readonly triggerToPaint: TriggerToPaint | null;
}

/** Frame rate, recognition latency, and trigger-to-paint, in one place. */
export class SessionMetrics {
  private readonly frameRate = new FrameRateMeter();
  private readonly triggers = new TriggerLatencyTracker();
  private lastRecognitionLatencyMs = 0;

  /** Record a processed frame and its recognition latency. */
  recordFrame(nowMs: number, recognitionLatencyMs: number): void {
    this.frameRate.tick(nowMs);
    this.lastRecognitionLatencyMs = recognitionLatencyMs;
  }

  /** The trigger-to-paint tracker, for the session to drive. */
  get triggerLatency(): TriggerLatencyTracker {
    return this.triggers;
  }

  /** What the debug panel shows. */
  snapshot(): PerformanceSnapshot {
    return {
      fps: this.frameRate.fps,
      recognitionLatencyMs: this.lastRecognitionLatencyMs,
      triggerToPaint: this.triggers.latest,
    };
  }

  /** Forget everything — for a session restarting. */
  reset(): void {
    this.frameRate.reset();
    this.triggers.reset();
    this.lastRecognitionLatencyMs = 0;
  }
}
