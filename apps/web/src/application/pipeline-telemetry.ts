/**
 * Per-model inference telemetry (Spec 011 development gate, performance baseline).
 *
 * Distinguishes **render cadence** (how often the editor ticks) from **inference cadence** (how
 * often each model actually ran): a model that runs at 15 Hz says nothing about the frame rate.
 * Purely observational — it is fed durations by the controller around calls the pipeline was
 * already making, and it never triggers, schedules or throttles anything.
 *
 * Framework-free and clock-free: every method is handed the timestamps it needs.
 */

/** The models that can process a camera frame. */
export type StageName = 'hand' | 'segmentation' | 'face';

/** One stage's figures, over a trailing window. */
export interface StageSnapshot {
  /** Total runs since the last reset. */
  readonly runs: number;
  /** Duration of the most recent run, ms; `null` if it never ran. */
  readonly lastMs: number | null;
  /** Mean duration over the trailing window, ms; `null` if no runs in it. */
  readonly meanMs: number | null;
  /** Slowest run in the trailing window, ms; `null` if no runs in it. */
  readonly maxMs: number | null;
  /** Runs per second over the trailing window (inference cadence). */
  readonly hz: number;
  /** Ticks since the last reset on which this stage did not run. */
  readonly skippedTicks: number;
  /** Age of the most recent run at snapshot time, ms; `null` if it never ran. */
  readonly lastRunAgeMs: number | null;
}

/** The whole pipeline's figures. */
export interface PipelineSnapshot {
  /** Editor tick cadence (render), Hz over the trailing window. */
  readonly tickHz: number;
  readonly hand: StageSnapshot;
  readonly segmentation: StageSnapshot;
  readonly face: StageSnapshot;
}

interface Sample {
  readonly atMs: number;
  readonly durationMs: number;
}

const WINDOW_MS = 2000;

class StageMeter {
  private samples: Sample[] = [];
  private runs = 0;
  private last: Sample | null = null;

  record(atMs: number, durationMs: number): void {
    const sample = { atMs, durationMs };
    this.samples.push(sample);
    this.last = sample;
    this.runs += 1;
  }

  reset(): void {
    this.samples = [];
    this.runs = 0;
    this.last = null;
  }

  snapshot(nowMs: number, ticks: number): StageSnapshot {
    this.samples = this.samples.filter((sample) => nowMs - sample.atMs <= WINDOW_MS);
    const n = this.samples.length;
    const total = this.samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    const spanMs = n > 1 ? this.samples[n - 1]!.atMs - this.samples[0]!.atMs : 0;
    return {
      runs: this.runs,
      lastMs: this.last?.durationMs ?? null,
      meanMs: n === 0 ? null : total / n,
      maxMs: n === 0 ? null : Math.max(...this.samples.map((sample) => sample.durationMs)),
      hz: spanMs > 0 ? ((n - 1) / spanMs) * 1000 : 0,
      skippedTicks: Math.max(0, ticks - this.runs),
      lastRunAgeMs: this.last === null ? null : nowMs - this.last.atMs,
    };
  }
}

/** Collects the stage meters and the tick cadence. */
export class PipelineTelemetry {
  private readonly meters: Record<StageName, StageMeter> = {
    hand: new StageMeter(),
    segmentation: new StageMeter(),
    face: new StageMeter(),
  };
  private tickTimes: number[] = [];
  private ticks = 0;

  /** Note one editor tick at `nowMs` (the render cadence). */
  recordTick(nowMs: number): void {
    this.ticks += 1;
    this.tickTimes.push(nowMs);
  }

  /** Note that `stage` ran at `atMs` and took `durationMs`. */
  recordRun(stage: StageName, atMs: number, durationMs: number): void {
    this.meters[stage].record(atMs, durationMs);
  }

  /** Forget everything — a camera attach/detach starts a fresh measurement. */
  reset(): void {
    for (const meter of Object.values(this.meters)) {
      meter.reset();
    }
    this.tickTimes = [];
    this.ticks = 0;
  }

  /** The figures as of `nowMs`. */
  snapshot(nowMs: number): PipelineSnapshot {
    this.tickTimes = this.tickTimes.filter((t) => nowMs - t <= WINDOW_MS);
    const n = this.tickTimes.length;
    const span = n > 1 ? this.tickTimes[n - 1]! - this.tickTimes[0]! : 0;
    return {
      tickHz: span > 0 ? ((n - 1) / span) * 1000 : 0,
      hand: this.meters.hand.snapshot(nowMs, this.ticks),
      segmentation: this.meters.segmentation.snapshot(nowMs, this.ticks),
      face: this.meters.face.snapshot(nowMs, this.ticks),
    };
  }
}
