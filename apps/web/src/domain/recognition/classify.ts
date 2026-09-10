/**
 * Turns one frame's hands into a {@link RecognitionOutcome}.
 *
 * The eligibility filter, the ranking, and the two gates live here — and nowhere else, so
 * there is one place to read to know what "recognized" means.
 *
 * **The active pose set is a candidate-set filter and nothing more** (FR-024b). It decides
 * *which* poses are offered to the matcher. It touches no threshold, no weight, and no
 * formula, and `test/domain/active-pose-set.test.ts` asserts exactly that: for a fixed
 * subset of candidates, narrowing the set never changes their relative ranking.
 */

import type { LandmarkWeights } from '../config/session-config';
import type { RecognitionConfig } from '../config/session-config';
import type { LandmarkFrame } from '../landmarks/types';
import { normalize } from '../normalization/normalize';
import { softmaxConfidence } from './softmax';
import type { Candidate, LiveHand, PoseMatcher, RecognitionOutcome } from './types';

/** Everything classification needs beyond the frame itself. */
export interface ClassifyOptions {
  readonly matcher: PoseMatcher;
  /** The candidate set. A filter on *which* poses are offered — never on how they score. */
  readonly activePoseSet: readonly string[];
  readonly recognition: RecognitionConfig;
  /** Milliseconds since the frame was captured, for the latency figure (FR-094). */
  readonly latencyMs: number;
}

/** Normalize a frame's hands into the convention the exemplars are stored in. */
export function toLiveHands(frame: LandmarkFrame): readonly LiveHand[] {
  return frame.hands.map((hand) => ({
    handedness: hand.handedness,
    landmarks: normalize(hand.landmarks),
  }));
}

/** Rank candidates by distance, ties broken by pose id so the order is deterministic. */
function rank(
  scores: readonly { poseId: string; distance: number }[],
  temperature: number,
): readonly Candidate[] {
  const sorted = [...scores].sort((a, b) =>
    a.distance === b.distance ? a.poseId.localeCompare(b.poseId) : a.distance - b.distance,
  );
  // Confidence is filled in only once every distance is known: softmax normalizes across
  // the set and cannot be computed one candidate at a time.
  const confidences = softmaxConfidence(
    sorted.map((score) => score.distance),
    temperature,
  );
  return sorted.map((score, index) => ({
    poseId: score.poseId,
    distance: score.distance,
    confidence: confidences[index] ?? 0,
  }));
}

/**
 * Classify one frame.
 *
 * Returns a discriminated union rather than a nullable pose, so a caller cannot forget
 * that "ambiguous" and "nothing in frame" are different situations that happen to both
 * mean "do not confirm".
 */
export function classify(frame: LandmarkFrame, options: ClassifyOptions): RecognitionOutcome {
  const { matcher, activePoseSet, recognition, latencyMs } = options;
  const frameTimestamp = frame.timestampMs;

  if (frame.hands.length === 0) {
    return { kind: 'noHand', topCandidates: [], latencyMs, frameTimestamp };
  }

  const hands = toLiveHands(frame);
  const scores = matcher.score(hands, activePoseSet);
  const ranked = rank(scores, recognition.softmaxTemperature);
  const topCandidates = ranked.slice(0, recognition.topCandidateCount);

  const top = ranked[0];
  if (top === undefined) {
    // Hands were present, but no active pose was eligible for them — a one-handed frame
    // with only two-handed poses active, say. That is "not recognized", not "no hand".
    return { kind: 'unrecognized', topCandidates, latencyMs, frameTimestamp };
  }

  if (top.confidence < recognition.confidenceFloor) {
    return { kind: 'unrecognized', topCandidates, latencyMs, frameTimestamp };
  }

  const second = ranked[1];
  if (second !== undefined && top.confidence - second.confidence < recognition.ambiguityMargin) {
    return { kind: 'ambiguous', topCandidates, latencyMs, frameTimestamp };
  }

  return {
    kind: 'recognized',
    poseId: top.poseId,
    confidence: top.confidence,
    topCandidates,
    latencyMs,
    frameTimestamp,
  };
}

/** Re-exported so callers configure weights from one place (Principle V). */
export type { LandmarkWeights };
