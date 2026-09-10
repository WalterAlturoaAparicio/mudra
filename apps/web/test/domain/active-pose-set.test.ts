/**
 * FR-024b: the active pose set changes *which candidates are offered*, and nothing else.
 *
 * This is the requirement most likely to be violated by a well-meaning future change —
 * "recognition is hard with seventeen poses, let's lower the floor when the set is large"
 * — so it is asserted directly rather than left to review.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { classify } from '../../src/domain/recognition/classify';
import { NearestNeighbourMatcher } from '../../src/domain/recognition/matcher';
import { bundleFromFixture, readMatcherFixture, toHandLandmarks } from '../support/fixture-bundle';
import { frameOf } from '../support/hands';

const fixture = readMatcherFixture();
const bundle = bundleFromFixture(fixture);
const matcher = new NearestNeighbourMatcher(bundle, { values: fixture.weights });
const recognition = {
  ...DEFAULT_SESSION_CONFIG.recognition,
  softmaxTemperature: fixture.softmax_temperature,
  // Every candidate, so nothing is hidden by the display cut-off.
  topCandidateCount: 20,
};

const ALL = fixture.poses.map((p) => p.pose_id);

/** A one-handed probe, so every one-handed pose stays eligible in every subset. */
const oneHandedCase = fixture.cases.find((c) => c.hands.length === 1)!;

function frameFor(testCase: typeof oneHandedCase) {
  return frameOf(
    testCase.hands.map((hand) => ({
      handedness: hand.handedness,
      landmarks: toHandLandmarks(hand),
    })),
    1000,
  );
}

function outcomeWith(activePoseSet: readonly string[]) {
  return classify(frameFor(oneHandedCase), {
    matcher,
    activePoseSet,
    recognition,
    latencyMs: 12,
  });
}

describe('narrowing the active pose set', () => {
  it('offers fewer candidates', () => {
    const wide = outcomeWith(ALL);
    const narrow = outcomeWith([oneHandedCase.source_pose_id, 'tp']);
    expect(wide.topCandidates.length).toBeGreaterThan(narrow.topCandidates.length);
  });

  it('leaves every surviving candidate its identical raw distance', () => {
    // The distance is the matcher's answer about geometry. The candidate set is a filter
    // applied *before* it. If narrowing changed a distance, the filter would be reaching
    // into the formula.
    const wide = new Map(outcomeWith(ALL).topCandidates.map((c) => [c.poseId, c.distance]));
    const narrow = outcomeWith([oneHandedCase.source_pose_id, 'tp']);
    for (const candidate of narrow.topCandidates) {
      expect(candidate.distance).toBe(wide.get(candidate.poseId));
    }
  });

  it('leaves the relative ranking of a fixed subset unchanged', () => {
    const subset = [oneHandedCase.source_pose_id, 'tp'];
    const wideOrder = outcomeWith(ALL)
      .topCandidates.map((c) => c.poseId)
      .filter((id) => subset.includes(id));
    const narrowOrder = outcomeWith(subset).topCandidates.map((c) => c.poseId);
    expect(narrowOrder).toEqual(wideOrder);
  });

  it('does not touch the thresholds', () => {
    // Stated as an assertion because the temptation is real: the sanctioned way to make
    // the 0.5 floor reachable is a smaller candidate set, never a smaller floor (FR-028).
    const before = { ...recognition };
    outcomeWith([oneHandedCase.source_pose_id]);
    outcomeWith(ALL);
    expect(recognition.confidenceFloor).toBe(before.confidenceFloor);
    expect(recognition.ambiguityMargin).toBe(before.ambiguityMargin);
    expect(recognition.softmaxTemperature).toBe(before.softmaxTemperature);
  });

  it('does raise confidence — a property of softmax, not a change to it (research D11)', () => {
    // Recorded here so the behaviour is documented rather than discovered later: the same
    // geometry reports a higher confidence among fewer candidates, which is precisely why
    // FR-024c requires the active set be shown alongside any confidence.
    const wide = outcomeWith(ALL);
    const narrow = outcomeWith([oneHandedCase.source_pose_id, 'tp']);
    const wideTop = wide.topCandidates[0]!;
    const narrowTop = narrow.topCandidates[0]!;
    expect(narrowTop.poseId).toBe(wideTop.poseId);
    expect(narrowTop.confidence).toBeGreaterThanOrEqual(wideTop.confidence);
  });

  it('recognizes the probe as the pose it was recorded as, at either width', () => {
    for (const set of [ALL, [oneHandedCase.source_pose_id, 'tp']]) {
      const outcome = outcomeWith(set);
      expect(outcome.kind).toBe('recognized');
      if (outcome.kind === 'recognized') {
        expect(outcome.poseId).toBe(oneHandedCase.source_pose_id);
      }
    }
  });
});

describe('an active pose set that excludes what is in frame', () => {
  it('reports "unrecognized" rather than matching something else', () => {
    const twoHandedOnly = fixture.poses.filter((p) => p.required_hands === 2).map((p) => p.pose_id);
    const outcome = classify(frameFor(oneHandedCase), {
      matcher,
      activePoseSet: twoHandedOnly,
      recognition,
      latencyMs: 5,
    });
    expect(outcome.kind).toBe('unrecognized');
    expect(outcome.topCandidates).toHaveLength(0);
  });

  it('names a pose the bundle does not have without failing', () => {
    const outcome = classify(frameFor(oneHandedCase), {
      matcher,
      activePoseSet: [oneHandedCase.source_pose_id, 'a_pose_that_does_not_exist'],
      recognition,
      latencyMs: 5,
    });
    expect(outcome.topCandidates.map((c) => c.poseId)).toEqual([oneHandedCase.source_pose_id]);
  });
});
