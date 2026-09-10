/**
 * Recognition value types — exemplars, candidates, and the outcome union.
 *
 * Exemplar coordinates are held in one flat `Float32Array` rather than as 49,000 landmark
 * objects. That is the shape the bundle already has (research D4), so the browser parses
 * nothing at load; each exemplar hand carries an offset into it. `Float32Array` is a
 * language type, not a browser one, so the domain stays free of the DOM.
 */

import type { Handedness, HandLandmarks } from '../landmarks/types';

/** One exemplar hand: where it came from, and where its coordinates live. */
export interface ExemplarHand {
  /**
   * Which recorded sample this hand belongs to.
   *
   * **Required**, and load-bearing: a two-handed pose is matched like-for-like against
   * exemplar hands *from the same original take* (FR-022). Without it, a left hand from
   * one recording could be paired with a right hand from another, and the pair would
   * describe a pose nobody ever made.
   */
  readonly sampleId: string;
  /** The physical hand this exemplar is. */
  readonly handedness: Handedness;
  /** Index of this hand's first float in {@link ExemplarBundle.data}. */
  readonly offset: number;
}

/** A pose the browser can recognize, with its exemplars. */
export interface PoseEntry {
  readonly poseId: string;
  /** Derived from the dataset, never from another application's catalog (research D10). */
  readonly displayName: string;
  /** 1 or 2. Derived from the hand count observed across the pose's samples. */
  readonly requiredHands: number;
  /** How many recorded samples the pose contributed. */
  readonly sampleCount: number;
  readonly hands: readonly ExemplarHand[];
}

/** A catalog pose the bundle deliberately left out, and why (FR-023a). */
export interface ExcludedPose {
  readonly poseId: string;
  readonly sampleCount: number;
  /** Machine-readable reason, e.g. `below_min_samples`. */
  readonly reason: string;
}

/** How the exemplar coordinates were normalized. */
export interface NormalizationStamp {
  readonly strategy: string;
  readonly version: string;
}

/** Everything the browser loaded from the exemplar bundle. */
export interface ExemplarBundle {
  readonly formatVersion: number;
  /** Identity of the source dataset, for staleness detection (FR-082, FR-083). */
  readonly datasetFingerprint: string;
  readonly generatedAt: string;
  readonly normalization: NormalizationStamp;
  /** The eligibility minimum the export applied (FR-085). */
  readonly minSamples: number;
  readonly landmarkCount: number;
  readonly components: number;
  readonly totalHands: number;
  /** Catalog poses the export saw, including excluded ones. */
  readonly catalogPoseCount: number;
  /** Eligible poses, in bundle order. */
  readonly poses: readonly PoseEntry[];
  /** Ineligible catalog poses. Never empty for a dataset that has one (FR-023a). */
  readonly excluded: readonly ExcludedPose[];
  /** `totalHands × landmarkCount × components` floats, hands in {@link poses} order. */
  readonly data: Float32Array;
}

/** A pose scored against the live frame. */
export interface Candidate {
  readonly poseId: string;
  /** Raw weighted squared distance. Lower is better. */
  readonly distance: number;
  /**
   * Softmax confidence across the **eligible candidate set** (FR-025).
   *
   * Meaningful only relative to the active pose set that produced it: 0.7 among four
   * candidates is not the same claim as 0.7 among seventeen (research D11). Anything that
   * shows a confidence must show the set alongside it (FR-024c).
   */
  readonly confidence: number;
}

/** No hand was in frame. Resets stability. */
export interface NoHandDetected {
  readonly kind: 'noHand';
  readonly topCandidates: readonly Candidate[];
  readonly latencyMs: number;
  readonly frameTimestamp: number;
}

/** Hands were present but nothing cleared the confidence floor (FR-026). Resets stability. */
export interface Unrecognized {
  readonly kind: 'unrecognized';
  readonly topCandidates: readonly Candidate[];
  readonly latencyMs: number;
  readonly frameTimestamp: number;
}

/** Two candidates were too close to call (FR-027). Resets stability. */
export interface Ambiguous {
  readonly kind: 'ambiguous';
  readonly topCandidates: readonly Candidate[];
  readonly latencyMs: number;
  readonly frameTimestamp: number;
}

/** Both gates passed. The only outcome that feeds the hold. */
export interface Recognized {
  readonly kind: 'recognized';
  readonly poseId: string;
  readonly confidence: number;
  readonly topCandidates: readonly Candidate[];
  readonly latencyMs: number;
  readonly frameTimestamp: number;
}

/**
 * The complete set of things one frame can mean.
 *
 * A discriminated union rather than a nullable result, so a consumer cannot observe an
 * undefined state or forget that "ambiguous" is different from "nothing there".
 */
export type RecognitionOutcome = NoHandDetected | Unrecognized | Ambiguous | Recognized;

/**
 * One live hand as the matcher sees it: normalized geometry plus which hand it is.
 *
 * Handedness travels *with* the landmarks rather than alongside them, because two-handed
 * matching is like-for-like and a pairing that lost track of which hand was which would
 * still produce a plausible number.
 */
export interface LiveHand {
  readonly handedness: Handedness;
  /** **Normalized** landmarks — the same convention the exemplars are stored in. */
  readonly landmarks: HandLandmarks;
}

/**
 * Matching, behind an interface (constitution Principle III).
 *
 * Nearest-neighbour is this milestone's strategy, not the architecture's commitment: a
 * future classifier replaces this and nothing upstream of it changes.
 */
export interface PoseMatcher {
  /**
   * Score every eligible pose against the frame's hands.
   *
   * @param hands Normalized live hands, in frame order.
   * @param poseIds The candidate set — an eligibility filter and nothing else (FR-024b).
   * @returns Raw distances, unranked and without confidences.
   */
  score(hands: readonly LiveHand[], poseIds: readonly string[]): readonly RawScore[];
}

/** A pose's raw distance, before ranking or softmax. */
export interface RawScore {
  readonly poseId: string;
  readonly distance: number;
}
