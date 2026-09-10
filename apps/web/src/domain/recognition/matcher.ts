/**
 * Weighted nearest-neighbour matching against the exemplar bundle.
 *
 * Three rules carry the whole of this file, and each exists because getting it wrong
 * fails silently rather than loudly:
 *
 * * **One-handed poses are hand-agnostic** (FR-021). Either live hand may match either
 *   exemplar hand, because a person raising a palm does not care which hand you recorded.
 * * **Two-handed poses are like-for-like, within one sample** (FR-022). Live left against
 *   exemplar left, live right against exemplar right, and only against hands from the same
 *   original take — otherwise a pair describes a pose nobody ever made.
 * * **Two-handed distances combine as the mean, never the sum** (FR-023). A sum puts a
 *   two-handed pose on twice the scale of a one-handed one, so no two-handed pose could
 *   ever out-rank a one-handed one.
 *
 * Distance is the weighted **squared** Euclidean distance, not the rooted one. The square
 * root is monotonic, so ranking is identical and taking it is wasted work on the hot path.
 */

import type { LandmarkWeights } from '../config/session-config';
import type {
  ExemplarBundle,
  ExemplarHand,
  LiveHand,
  PoseEntry,
  PoseMatcher,
  RawScore,
} from './types';

/** Distance between a live hand and one exemplar hand in the bundle's flat payload. */
export function weightedDistance(
  live: LiveHand,
  bundle: ExemplarBundle,
  exemplar: ExemplarHand,
  weights: LandmarkWeights,
): number {
  const { data, components } = bundle;
  const points = live.landmarks.points;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const weight = weights.values[i] ?? 0;
    if (weight === 0) {
      continue;
    }
    const point = points[i]!;
    const base = exemplar.offset + i * components;
    const dx = point.x - (data[base] ?? 0);
    const dy = point.y - (data[base + 1] ?? 0);
    const dz = point.z - (data[base + 2] ?? 0);
    total += weight * (dx * dx + dy * dy + dz * dz);
  }
  return total;
}

/** Group a pose's exemplar hands by the sample they came from, preserving order. */
function bySample(pose: PoseEntry): ExemplarHand[][] {
  const groups = new Map<string, ExemplarHand[]>();
  for (const hand of pose.hands) {
    const existing = groups.get(hand.sampleId);
    if (existing === undefined) {
      groups.set(hand.sampleId, [hand]);
    } else {
      existing.push(hand);
    }
  }
  return [...groups.values()];
}

/** The two ways two live hands can be assigned to two exemplar hands. */
const ORDERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
];

/**
 * Nearest-neighbour matcher over a loaded bundle.
 *
 * Implements {@link PoseMatcher} so the strategy is replaceable (constitution Principle
 * III): nothing upstream names this class.
 */
export class NearestNeighbourMatcher implements PoseMatcher {
  private readonly bundle: ExemplarBundle;
  private readonly weights: LandmarkWeights;
  private readonly poses: Map<string, PoseEntry>;
  private readonly samples: Map<string, ExemplarHand[][]>;

  /** Group exemplars once at construction; the per-frame path only reads. */
  constructor(bundle: ExemplarBundle, weights: LandmarkWeights) {
    this.bundle = bundle;
    this.weights = weights;
    this.poses = new Map(bundle.poses.map((pose) => [pose.poseId, pose]));
    this.samples = new Map(bundle.poses.map((pose) => [pose.poseId, bySample(pose)]));
  }

  /** Every pose the bundle contains, whether or not it is active. */
  get availablePoses(): readonly PoseEntry[] {
    return this.bundle.poses;
  }

  /** Look up a pose's metadata, or `undefined` when the bundle does not have it. */
  poseEntry(poseId: string): PoseEntry | undefined {
    return this.poses.get(poseId);
  }

  /**
   * Score each named pose against the live hands.
   *
   * A pose is skipped — not scored badly — when the frame has fewer hands than it requires
   * (FR-024), because "you are not showing enough hands" is not a weak match, and a large
   * distance would still let it appear in the ranking.
   */
  score(hands: readonly LiveHand[], poseIds: readonly string[]): readonly RawScore[] {
    const scores: RawScore[] = [];
    for (const poseId of poseIds) {
      const pose = this.poses.get(poseId);
      if (pose === undefined || hands.length < pose.requiredHands) {
        continue;
      }
      const distance =
        pose.requiredHands === 1 ? this.oneHanded(hands, pose) : this.twoHanded(hands, pose);
      if (Number.isFinite(distance)) {
        scores.push({ poseId, distance });
      }
    }
    return scores;
  }

  /** Any live hand against any exemplar hand; the best pairing wins (FR-021). */
  private oneHanded(hands: readonly LiveHand[], pose: PoseEntry): number {
    let best = Number.POSITIVE_INFINITY;
    for (const live of hands) {
      for (const exemplar of pose.hands) {
        const distance = weightedDistance(live, this.bundle, exemplar, this.weights);
        if (distance < best) {
          best = distance;
        }
      }
    }
    return best;
  }

  /**
   * Like-for-like within one sample, combined as the mean (FR-022, FR-023).
   *
   * Both assignments of the two live hands are tried, and an assignment is valid only when
   * every live hand meets an exemplar hand of the *same* handedness. A sample recorded
   * with two right hands therefore contributes nothing to a left/right frame — which is
   * correct: it is not that pose as the user is performing it.
   */
  private twoHanded(hands: readonly LiveHand[], pose: PoseEntry): number {
    const live = hands.slice(0, 2);
    if (live.length < 2) {
      return Number.POSITIVE_INFINITY;
    }
    const groups = this.samples.get(pose.poseId) ?? [];

    let best = Number.POSITIVE_INFINITY;
    for (const sampleHands of groups) {
      if (sampleHands.length < 2) {
        continue;
      }
      for (const order of ORDERS) {
        let total = 0;
        let valid = true;
        for (let i = 0; i < live.length; i += 1) {
          const exemplar = sampleHands[order[i]!];
          if (exemplar === undefined || exemplar.handedness !== live[i]!.handedness) {
            valid = false;
            break;
          }
          total += weightedDistance(live[i]!, this.bundle, exemplar, this.weights);
        }
        if (valid) {
          const mean = total / live.length;
          if (mean < best) {
            best = mean;
          }
        }
      }
    }
    return best;
  }
}
