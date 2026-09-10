/**
 * Recognition accuracy on held-out recorded samples, through the shipped pipeline.
 *
 * **This is not SC-002.** SC-002 measures a *person* deliberately forming a pose in front
 * of a camera, and it includes everything this cannot: how the pose looks when someone
 * makes it fresh, lighting, distance, and whether they formed it the way the dataset was
 * recorded. That trial is run by hand (quickstart scenario 12) and reported in the README.
 *
 * What this *is*: a leave-one-out check of the recognition half, run against the real
 * bundle, the real matcher, the real gates, and the real thresholds. It is the guard that
 * notices when a change to the weights, the temperature, or the active pose set quietly
 * makes recognition worse — which is exactly the change nobody would otherwise catch until
 * the next manual trial.
 *
 * Every sample used as a probe is **excluded from its own pose's exemplars**, so a probe is
 * never its own nearest neighbour. Without that, this would measure nothing at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { handLandmarks, handObservation, landmarkFrame } from '../../src/domain/landmarks/types';
import type { HandObservation, Landmark } from '../../src/domain/landmarks/types';
import { classify } from '../../src/domain/recognition/classify';
import { NearestNeighbourMatcher } from '../../src/domain/recognition/matcher';
import type { ExemplarBundle, PoseEntry } from '../../src/domain/recognition/types';
import { parseBundle } from '../../src/infrastructure/exemplars/bundle-loader';

const MANIFEST_PATH = resolve(__dirname, '../../public/exemplars.manifest.json');
const PAYLOAD_PATH = resolve(__dirname, '../../public/exemplars.bin');
const available = existsSync(MANIFEST_PATH) && existsSync(PAYLOAD_PATH);

/** Probes per pose. Enough to be meaningful, few enough to stay fast. */
const PROBES_PER_POSE = 25;

/** The bar this guard holds recognition to on recorded data. */
const MINIMUM_RATE = 0.8;

function loadBundle(): ExemplarBundle {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as unknown;
  const bytes = readFileSync(PAYLOAD_PATH);
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseBundle(manifest, payload, { supportedFormatVersion: 1 });
}

/** Read one exemplar hand's landmarks back out of the flat payload. */
function pointsOf(bundle: ExemplarBundle, offset: number): Landmark[] {
  const points: Landmark[] = [];
  for (let i = 0; i < bundle.landmarkCount; i += 1) {
    const base = offset + i * bundle.components;
    points.push({
      x: bundle.data[base] ?? 0,
      y: bundle.data[base + 1] ?? 0,
      z: bundle.data[base + 2] ?? 0,
    });
  }
  return points;
}

/**
 * A bundle with one sample removed from one pose.
 *
 * The payload is shared, not copied — only the metadata changes — so building 100 of these
 * costs nothing. Offsets stay valid because they point into the same buffer.
 */
function withoutSample(bundle: ExemplarBundle, poseId: string, sampleId: string): ExemplarBundle {
  return {
    ...bundle,
    poses: bundle.poses.map((pose): PoseEntry =>
      pose.poseId === poseId
        ? { ...pose, hands: pose.hands.filter((hand) => hand.sampleId !== sampleId) }
        : pose,
    ),
  };
}

/**
 * The exemplar coordinates are **already normalized**, so a frame built from them must not
 * be normalized again. `classify` normalizes what it is given, and normalizing an
 * already-normalized hand is idempotent — the wrist is already at the origin and the span
 * is already 1 — so feeding them straight through is correct rather than convenient.
 */
function frameFromSample(
  bundle: ExemplarBundle,
  pose: PoseEntry,
  sampleId: string,
): ReturnType<typeof landmarkFrame> {
  const hands: HandObservation[] = pose.hands
    .filter((hand) => hand.sampleId === sampleId)
    .map((hand) =>
      handObservation(hand.handedness, 0.95, handLandmarks(pointsOf(bundle, hand.offset))),
    );
  return landmarkFrame(hands, 0, 1280, 720);
}

describe.skipIf(!available)('recognition on held-out recorded samples', () => {
  const bundle = loadBundle();
  const active = DEFAULT_SESSION_CONFIG.activePoseSet;
  const recognition = DEFAULT_SESSION_CONFIG.recognition;

  /** Classify `PROBES_PER_POSE` held-out samples of one pose. */
  function evaluate(poseId: string): { correct: number; total: number; outcomes: string[] } {
    const pose = bundle.poses.find((entry) => entry.poseId === poseId)!;
    const sampleIds = [...new Set(pose.hands.map((hand) => hand.sampleId))];
    // Evenly spaced rather than the first N, so a probe set is not all from one session.
    const stride = Math.max(1, Math.floor(sampleIds.length / PROBES_PER_POSE));
    const probes = sampleIds.filter((_, index) => index % stride === 0).slice(0, PROBES_PER_POSE);

    let correct = 0;
    const outcomes: string[] = [];

    for (const sampleId of probes) {
      const frame = frameFromSample(bundle, pose, sampleId);
      const heldOut = withoutSample(bundle, poseId, sampleId);
      const matcher = new NearestNeighbourMatcher(heldOut, recognition.weights);
      const outcome = classify(frame, {
        matcher,
        activePoseSet: active,
        recognition,
        latencyMs: 0,
      });

      outcomes.push(outcome.kind === 'recognized' ? outcome.poseId : outcome.kind);
      if (outcome.kind === 'recognized' && outcome.poseId === poseId) {
        correct += 1;
      }
    }

    return { correct, total: probes.length, outcomes };
  }

  for (const poseId of DEFAULT_SESSION_CONFIG.activePoseSet) {
    it(`recognizes held-out "${poseId}" samples at or above ${MINIMUM_RATE * 100}%`, () => {
      const { correct, total, outcomes } = evaluate(poseId);
      expect(total).toBeGreaterThan(10);
      const rate = correct / total;
      expect(
        rate,
        `${poseId}: ${correct}/${total}. Outcomes: ${[...new Set(outcomes)].join(', ')}`,
      ).toBeGreaterThanOrEqual(MINIMUM_RATE);
    });
  }

  it('rarely mistakes one active pose for another', () => {
    // A wrong-pose trigger is worse than no trigger: the visitor sees an effect they did
    // not ask for, and nothing explains why. It is not held to zero, because it is not
    // zero — one held-out `tp` sample currently reads as `peace`, which is a finding about
    // the dataset and the active pose set, recorded in the README rather than tuned away
    // (FR-028). The bar is set where a *systematic* confusion would fail it.
    let probes = 0;
    let wrongPose = 0;
    const detail: string[] = [];

    for (const poseId of active) {
      const { outcomes, total } = evaluate(poseId);
      const wrong = outcomes.filter((outcome) => active.includes(outcome) && outcome !== poseId);
      probes += total;
      wrongPose += wrong.length;
      if (wrong.length > 0) {
        detail.push(`${poseId} → ${[...new Set(wrong)].join(', ')} (${wrong.length}/${total})`);
      }
    }

    expect(wrongPose / probes, detail.join('; ')).toBeLessThanOrEqual(0.04);
  });

  it('recognizes recorded samples overall at or above the SC-002 bar', () => {
    // The same 8-in-10 threshold SC-002 sets for the live trial, applied to recorded data.
    // Passing here does **not** mean SC-002 passes — a person forming a pose fresh is a
    // harder input than a sample recorded under the same conditions as the exemplars.
    let probes = 0;
    let correct = 0;
    for (const poseId of active) {
      const result = evaluate(poseId);
      probes += result.total;
      correct += result.correct;
    }
    expect(correct / probes).toBeGreaterThanOrEqual(MINIMUM_RATE);
  });

  it('uses the specification’s thresholds, unmodified (FR-028)', () => {
    // Stated here because this is the file where a failing number would tempt someone to
    // change them. The sanctioned remedies are a more distinct active pose set, or more
    // recorded samples — never a lower floor.
    expect(recognition.confidenceFloor).toBe(0.5);
    expect(recognition.ambiguityMargin).toBe(0.12);
  });
});
