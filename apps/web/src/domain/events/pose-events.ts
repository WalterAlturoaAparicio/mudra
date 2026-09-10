/**
 * Turns a stream of recognition outcomes into pose lifecycle events.
 *
 * The event model is deliberately independent of the effect system (FR-038): it knows
 * nothing about effects, triggers, or rendering, so adding or removing an effect cannot
 * change when an event fires. Effects subscribe to this; this subscribes to nothing.
 *
 * The transition table, stated once:
 *
 * | Previous       | Current outcome                  | Emitted                  |
 * |----------------|----------------------------------|--------------------------|
 * | idle           | recognized(P)                    | `entered(P)`             |
 * | holding P      | recognized(P), not yet at target | `held(P)`                |
 * | holding P      | recognized(P), reached target    | `confirmed(P)` **once**  |
 * | holding P conf | recognized(P) still              | `held(P)` only           |
 * | holding P      | recognized(Q), Q ≠ P             | `exited(P)`, `entered(Q)`|
 * | holding P      | anything else                    | `exited(P)`              |
 */

import type { RecognitionOutcome } from '../recognition/types';
import type { HoldState } from './hold-state';
import { IDLE_HOLD, confirmed, holding, progress, readyToConfirm, released } from './hold-state';

/** What happened to a pose. */
export type PoseEventKind = 'entered' | 'held' | 'confirmed' | 'exited';

/** One thing that happened to one pose at one moment. */
export interface PoseEvent {
  readonly kind: PoseEventKind;
  readonly poseId: string;
  /** The confidence that produced this event; `0` for an `exited` with no match. */
  readonly confidence: number;
  /** When it happened, in milliseconds on the injected clock. */
  readonly atMs: number;
  /** Hold progress at that moment, in `[0,1]`. */
  readonly progress: number;
}

/** Reads the current time. Injected, so tests are deterministic (FR-036). */
export type Clock = () => number;

/**
 * Stateful emitter: feed it one outcome per frame, take the events back.
 *
 * Constructed rather than imported, and holding no module-level state, so two sessions —
 * or two tests — never share a hold (constitution Principle I).
 */
export class PoseEventEmitter {
  private state: HoldState = IDLE_HOLD;
  private lastConfidence = 0;
  private readonly holdDurationMs: number;

  /** @param holdDurationMs Continuous hold required to confirm, from configuration. */
  constructor(holdDurationMs: number) {
    this.holdDurationMs = holdDurationMs;
  }

  /** The current hold, for the progress indicator and the debug panel. */
  get hold(): HoldState {
    return this.state;
  }

  /** Hold progress right now, in `[0,1]`. */
  progressAt(nowMs: number): number {
    return progress(this.state, nowMs, this.holdDurationMs);
  }

  /** Drop any hold in progress without emitting — for a session stopping. */
  reset(): void {
    this.state = IDLE_HOLD;
    this.lastConfidence = 0;
  }

  /**
   * Advance by one frame.
   *
   * @param outcome What the frame meant.
   * @param nowMs Wall-clock time of this frame.
   * @returns Events for this frame, in the order they occurred. Often empty.
   */
  advance(outcome: RecognitionOutcome, nowMs: number): readonly PoseEvent[] {
    if (outcome.kind !== 'recognized') {
      return this.exitIfHolding(nowMs);
    }

    const events: PoseEvent[] = [];
    const previousPose = this.state.poseId;

    if (previousPose !== null && previousPose !== outcome.poseId) {
      // A different pose is a break, not a continuation: the old hold ends before the new
      // one starts, so a confirmation can never be inherited across poses (FR-032).
      events.push(...this.exitIfHolding(nowMs));
    }

    const wasHolding = this.state.poseId === outcome.poseId && this.state.heldSince !== null;
    this.state = holding(this.state, outcome.poseId, nowMs);
    this.lastConfidence = outcome.confidence;

    const at = progress(this.state, nowMs, this.holdDurationMs);
    if (!wasHolding) {
      events.push({
        kind: 'entered',
        poseId: outcome.poseId,
        confidence: outcome.confidence,
        atMs: nowMs,
        progress: at,
      });
      return events;
    }

    if (readyToConfirm(this.state, nowMs, this.holdDurationMs)) {
      this.state = confirmed(this.state, nowMs);
      events.push({
        kind: 'confirmed',
        poseId: outcome.poseId,
        confidence: outcome.confidence,
        atMs: nowMs,
        progress: 1,
      });
      return events;
    }

    events.push({
      kind: 'held',
      poseId: outcome.poseId,
      confidence: outcome.confidence,
      atMs: nowMs,
      progress: at,
    });
    return events;
  }

  private exitIfHolding(nowMs: number): readonly PoseEvent[] {
    const poseId = this.state.poseId;
    if (poseId === null) {
      return [];
    }
    const at = progress(this.state, nowMs, this.holdDurationMs);
    const confidence = this.lastConfidence;
    this.state = released();
    this.lastConfidence = 0;
    return [{ kind: 'exited', poseId, confidence, atMs: nowMs, progress: at }];
  }
}
