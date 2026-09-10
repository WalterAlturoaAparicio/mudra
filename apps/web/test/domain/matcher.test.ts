import { describe, expect, it } from 'vitest';

import { defaultLandmarkWeights } from '../../src/domain/config/session-config';
import { NearestNeighbourMatcher, weightedDistance } from '../../src/domain/recognition/matcher';
import { softmaxConfidence } from '../../src/domain/recognition/softmax';
import type {
  ExemplarBundle,
  ExemplarHand,
  LiveHand,
  PoseEntry,
} from '../../src/domain/recognition/types';
import { handLandmarks } from '../../src/domain/landmarks/types';
import type { Handedness } from '../../src/domain/landmarks/types';
import {
  bundleFromFixture,
  readMatcherFixture,
  toHandLandmarks,
} from '../support/fixture-bundle';
import { linearHand, spiralHand } from '../support/hands';

const fixture = readMatcherFixture();
const bundle = bundleFromFixture(fixture);
const weights = { values: fixture.weights };
const matcher = new NearestNeighbourMatcher(bundle, weights);

function relativeError(actual: number, expected: number): number {
  const scale = Math.max(Math.abs(expected), 1e-12);
  return Math.abs(actual - expected) / scale;
}

describe('golden fixtures generated from Engine-derived exemplars (FR-029)', () => {
  it('uses the weights the specification fixes', () => {
    expect(fixture.weights).toEqual([...defaultLandmarkWeights().values]);
  });

  it('covers both matching paths', () => {
    const requirements = new Set(fixture.poses.map((p) => p.required_hands));
    expect(requirements.has(1)).toBe(true);
    expect(requirements.has(2)).toBe(true);
  });

  for (const testCase of fixture.cases) {
    it(`reproduces the reference distances for "${testCase.name}"`, () => {
      const hands: LiveHand[] = testCase.hands.map((hand) => ({
        handedness: hand.handedness,
        landmarks: toHandLandmarks(hand),
      }));
      const scores = matcher.score(
        hands,
        fixture.poses.map((p) => p.pose_id),
      );
      const byPose = new Map(scores.map((s) => [s.poseId, s.distance]));

      expect(new Set(byPose.keys())).toEqual(
        new Set(testCase.candidates.map((c) => c.pose_id)),
      );
      for (const candidate of testCase.candidates) {
        const actual = byPose.get(candidate.pose_id);
        expect(actual).toBeDefined();
        // Relative, not absolute: exemplars are float32 in the browser (research D4), so
        // the last significant figures legitimately differ from a float64 computation.
        expect(relativeError(actual!, candidate.distance)).toBeLessThanOrEqual(
          fixture.tolerance_relative,
        );
      }
    });

    it(`reproduces the reference confidences for "${testCase.name}"`, () => {
      const confidences = softmaxConfidence(
        testCase.candidates.map((c) => c.distance),
        fixture.softmax_temperature,
      );
      testCase.candidates.forEach((candidate, index) => {
        expect(relativeError(confidences[index]!, candidate.confidence)).toBeLessThanOrEqual(
          fixture.tolerance_relative,
        );
      });
    });
  }

  it('ranks each probe under the pose it was recorded as', () => {
    for (const testCase of fixture.cases) {
      const best = [...testCase.candidates].sort((a, b) => a.distance - b.distance)[0];
      expect(best!.pose_id).toBe(testCase.source_pose_id);
    }
  });
});

// --------------------------------------------------------------------------- //
// The rules the fixtures cannot state directly
// --------------------------------------------------------------------------- //

/** Build a one-pose bundle from explicit hands, so a rule can be isolated. */
function bundleOf(
  poses: {
    poseId: string;
    requiredHands: number;
    hands: { sampleId: string; handedness: Handedness; points: readonly { x: number; y: number; z: number }[] }[];
  }[],
): ExemplarBundle {
  const floatsPerHand = 63;
  const totalHands = poses.reduce((n, p) => n + p.hands.length, 0);
  const data = new Float32Array(totalHands * floatsPerHand);
  let index = 0;
  const entries: PoseEntry[] = poses.map((pose) => {
    const hands: ExemplarHand[] = pose.hands.map((hand) => {
      const offset = index * floatsPerHand;
      hand.points.forEach((p, i) => {
        data[offset + i * 3] = p.x;
        data[offset + i * 3 + 1] = p.y;
        data[offset + i * 3 + 2] = p.z;
      });
      index += 1;
      return { sampleId: hand.sampleId, handedness: hand.handedness, offset };
    });
    return {
      poseId: pose.poseId,
      displayName: pose.poseId,
      requiredHands: pose.requiredHands,
      sampleCount: new Set(pose.hands.map((h) => h.sampleId)).size,
      hands,
    };
  });
  return {
    formatVersion: 1,
    datasetFingerprint: 'sha256:synthetic',
    generatedAt: '2026-08-20T00:00:00Z',
    normalization: { strategy: 'translation_scale', version: '1.0' },
    minSamples: 20,
    landmarkCount: 21,
    components: 3,
    totalHands,
    catalogPoseCount: poses.length,
    poses: entries,
    excluded: [],
    data,
  };
}

const A = spiralHand(0).points;
const B = spiralHand(1.7).points;

describe('one-handed matching is hand-agnostic (FR-021)', () => {
  const oneHanded = bundleOf([
    { poseId: 'wave', requiredHands: 1, hands: [{ sampleId: 's1', handedness: 'right', points: A }] },
  ]);
  const m = new NearestNeighbourMatcher(oneHanded, defaultLandmarkWeights());

  it('matches a live left hand against a right-hand exemplar', () => {
    const left = m.score([{ handedness: 'left', landmarks: handLandmarks([...A]) }], ['wave']);
    const right = m.score([{ handedness: 'right', landmarks: handLandmarks([...A]) }], ['wave']);
    expect(left).toHaveLength(1);
    expect(left[0]!.distance).toBeCloseTo(0, 9);
    expect(left[0]!.distance).toBe(right[0]!.distance);
  });

  it('takes the best of two live hands', () => {
    const scores = m.score(
      [
        { handedness: 'left', landmarks: handLandmarks([...B]) },
        { handedness: 'right', landmarks: handLandmarks([...A]) },
      ],
      ['wave'],
    );
    expect(scores[0]!.distance).toBeCloseTo(0, 9);
  });
});

describe('two-handed matching is like-for-like within one sample (FR-022)', () => {
  const twoHanded = bundleOf([
    {
      poseId: 'clasp',
      requiredHands: 2,
      hands: [
        { sampleId: 's1', handedness: 'left', points: A },
        { sampleId: 's1', handedness: 'right', points: B },
      ],
    },
  ]);
  const m = new NearestNeighbourMatcher(twoHanded, defaultLandmarkWeights());

  it('pairs each live hand with the exemplar hand of the same handedness', () => {
    const scores = m.score(
      [
        { handedness: 'left', landmarks: handLandmarks([...A]) },
        { handedness: 'right', landmarks: handLandmarks([...B]) },
      ],
      ['clasp'],
    );
    expect(scores[0]!.distance).toBeCloseTo(0, 9);
  });

  it('does not pair a live left hand with a right exemplar even when the shape matches', () => {
    // Same two shapes, swapped onto the wrong hands. A matcher that ignored handedness
    // would report a perfect match here — which is the silent failure FR-022 exists for.
    const scores = m.score(
      [
        { handedness: 'left', landmarks: handLandmarks([...B]) },
        { handedness: 'right', landmarks: handLandmarks([...A]) },
      ],
      ['clasp'],
    );
    expect(scores[0]!.distance).toBeGreaterThan(0.1);
  });

  it('never pairs hands from different samples', () => {
    // Each sample holds only *one* usable hand of each pose; a cross-sample pairing would
    // find a perfect match, a same-sample one cannot.
    const split = bundleOf([
      {
        poseId: 'clasp',
        requiredHands: 2,
        hands: [
          { sampleId: 's1', handedness: 'left', points: A },
          { sampleId: 's1', handedness: 'right', points: A },
          { sampleId: 's2', handedness: 'left', points: B },
          { sampleId: 's2', handedness: 'right', points: B },
        ],
      },
    ]);
    const matcherSplit = new NearestNeighbourMatcher(split, defaultLandmarkWeights());
    const scores = matcherSplit.score(
      [
        { handedness: 'left', landmarks: handLandmarks([...A]) },
        { handedness: 'right', landmarks: handLandmarks([...B]) },
      ],
      ['clasp'],
    );
    // Best possible same-sample answer is "one hand perfect, one hand wrong", halved.
    const wrong = weightedDistance(
      { handedness: 'right', landmarks: handLandmarks([...B]) },
      split,
      split.poses[0]!.hands[1]!,
      defaultLandmarkWeights(),
    );
    expect(scores[0]!.distance).toBeCloseTo(wrong / 2, 6);
    expect(scores[0]!.distance).toBeGreaterThan(0);
  });

  it('is skipped entirely when only one hand is in frame (FR-024)', () => {
    const scores = m.score([{ handedness: 'left', landmarks: handLandmarks([...A]) }], ['clasp']);
    expect(scores).toHaveLength(0);
  });
});

describe('two-handed distances combine as the mean, not the sum (FR-023)', () => {
  const bundleTwo = bundleOf([
    {
      poseId: 'clasp',
      requiredHands: 2,
      hands: [
        { sampleId: 's1', handedness: 'left', points: A },
        { sampleId: 's1', handedness: 'right', points: A },
      ],
    },
  ]);
  const m = new NearestNeighbourMatcher(bundleTwo, defaultLandmarkWeights());

  it('reports the average of the two per-hand distances', () => {
    const live: LiveHand[] = [
      { handedness: 'left', landmarks: handLandmarks([...A]) },
      { handedness: 'right', landmarks: handLandmarks([...B]) },
    ];
    const perHand = [
      weightedDistance(live[0]!, bundleTwo, bundleTwo.poses[0]!.hands[0]!, defaultLandmarkWeights()),
      weightedDistance(live[1]!, bundleTwo, bundleTwo.poses[0]!.hands[1]!, defaultLandmarkWeights()),
    ];
    const scores = m.score(live, ['clasp']);
    const mean = (perHand[0]! + perHand[1]!) / 2;

    expect(scores[0]!.distance).toBeCloseTo(mean, 6);
    // The distinction that matters: it must not be the sum, or a two-handed pose would sit
    // on twice the scale of a one-handed one and could never out-rank it.
    expect(scores[0]!.distance).not.toBeCloseTo(perHand[0]! + perHand[1]!, 6);
  });
});

describe('the distance itself', () => {
  it('weights the wrist least and the fingertips most', () => {
    const flat = linearHand().points;
    const single = bundleOf([
      { poseId: 'x', requiredHands: 1, hands: [{ sampleId: 's', handedness: 'right', points: flat }] },
    ]);
    const w = defaultLandmarkWeights();

    const nudge = (index: number) => {
      const points = flat.map((p, i) => (i === index ? { ...p, x: p.x + 1 } : p));
      return weightedDistance(
        { handedness: 'right', landmarks: handLandmarks(points) },
        single,
        single.poses[0]!.hands[0]!,
        w,
      );
    };

    expect(nudge(0)).toBeCloseTo(0.5, 5); // wrist
    expect(nudge(1)).toBeCloseTo(1.0, 5); // an ordinary joint
    expect(nudge(4)).toBeCloseTo(2.0, 5); // a fingertip
  });

  it('is zero for an identical hand', () => {
    const single = bundleOf([
      { poseId: 'x', requiredHands: 1, hands: [{ sampleId: 's', handedness: 'right', points: A }] },
    ]);
    expect(
      weightedDistance(
        { handedness: 'right', landmarks: handLandmarks([...A]) },
        single,
        single.poses[0]!.hands[0]!,
        defaultLandmarkWeights(),
      ),
    ).toBeCloseTo(0, 9);
  });
});
