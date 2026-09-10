/**
 * Emit the archive that `scripts/export_web_capture_fixtures.py` verifies (FR-050, SC-010).
 *
 * This is the cross-language check running in the *writing* direction. The Web suite produces a real
 * archive from the Engine-generated fixture cases; Python's standard `zipfile` then opens it,
 * validates every CRC, checks the entry layout and the fixed timestamps, and loads every sample
 * through Engine's own `PoseSerializer`.
 *
 * A writer testing its own output with its own reader would prove only that it is self-consistent,
 * which is exactly the failure mode the constitution's golden-fixture rule exists to prevent.
 *
 * The archive is **deterministic** — a fixed clock and fixed ids — so it is committed as a fixture
 * and does not churn in git. If this file's bytes change, something about the writer changed, and
 * that is a diff worth reading.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCaptureExport } from '../../src/application/capture-export';
import { captureHand } from '../../src/domain/capture/types';
import type { CaptureHand, CaptureSample, CaptureSession } from '../../src/domain/capture/types';
import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';
import type { Handedness } from '../../src/domain/landmarks/types';
import { fixedTimeSource } from '../../src/domain/ports/clock';
import { FakeCaptureRepository } from '../support/fake-capture-repository';
import { APP_ROOT } from '../support/source-scan';

/** Where the Python verifier looks for it. */
const ARCHIVE_PATH = join(APP_ROOT, 'test/fixtures/archive-sample.zip');

interface FixtureHand {
  handedness: string;
  confidence: number;
  raw: { x: number; y: number; z: number }[];
  normalized: { x: number; y: number; z: number }[];
}

interface FixtureCase {
  name: string;
  inputs: {
    session: {
      id: string;
      contributorLabel: string;
      poseId: string;
      displayName: string | null;
      requiredHands: number;
    };
    sample: {
      id: string;
      capturedAt: string;
      frameWidth: number;
      frameHeight: number;
      countdownStartedAt: string | null;
      countdownSeconds: number;
      countdownEnabled: boolean;
      hands: FixtureHand[];
    };
    versions: { application: string; mediapipe: string };
  };
}

const fixtures = JSON.parse(
  readFileSync(join(APP_ROOT, 'test/fixtures/pose_sample_cases.json'), 'utf-8'),
) as { cases: FixtureCase[] };

function toHand(hand: FixtureHand): CaptureHand {
  return captureHand(
    hand.handedness as Handedness,
    hand.confidence,
    hand.raw,
    hand.normalized,
    HAND_LANDMARK_COUNT,
  );
}

/** Build a store holding every fixture case, so the archive exercises every shape at once. */
async function populatedStore(): Promise<FakeCaptureRepository> {
  const repository = new FakeCaptureRepository();
  for (const testCase of fixtures.cases) {
    const input = testCase.inputs;
    const session: CaptureSession = {
      id: input.session.id,
      contributorLabel: input.session.contributorLabel,
      poseId: input.session.poseId,
      displayName: input.session.displayName,
      requiredHands: input.session.requiredHands === 2 ? 2 : 1,
      status: 'closed',
      startedAt: input.sample.capturedAt,
      sampleCount: 0,
      discardedCount: 2,
    };
    await repository.createSession(session);
    const sample: CaptureSample = {
      id: input.sample.id,
      sessionId: session.id,
      capturedAt: input.sample.capturedAt,
      frameWidth: input.sample.frameWidth,
      frameHeight: input.sample.frameHeight,
      countdownStartedAt: input.sample.countdownStartedAt,
      countdownSeconds: input.sample.countdownSeconds,
      countdownEnabled: input.sample.countdownEnabled,
      hands: input.sample.hands.map(toHand),
    };
    await repository.appendSample(sample);
  }
  return repository;
}

describe('the archive artifact Python verifies', () => {
  it('is emitted deterministically for the cross-language check', async () => {
    const repository = await populatedStore();
    const options = {
      repository,
      versions: { application: 'mudra-web/0.1.0', mediapipe: '0.10.35' },
      datasetFingerprint: 'fixture-fingerprint',
      // Fixed clock: the archive must be byte-identical run to run, or it would churn in git and
      // SC-009 would be untestable here.
      now: fixedTimeSource(new Date('2026-09-07T14:11:03.204Z')).now,
    };

    const first = await buildCaptureExport(options);
    const second = await buildCaptureExport(options);
    expect(first.bytes).toEqual(second.bytes);

    writeFileSync(ARCHIVE_PATH, first.bytes);

    expect(first.totalSamples).toBe(fixtures.cases.length);
    expect(first.sessionCount).toBe(fixtures.cases.length);
  });

  it('contains a manifest first and every sample under datasets/poses/', async () => {
    const bytes = readFileSync(ARCHIVE_PATH);
    const text = new TextDecoder().decode(bytes);
    expect(text.indexOf('manifest.json')).toBeLessThan(text.indexOf('datasets/poses'));
    expect(text).toContain('"dataset_fingerprint": "fixture-fingerprint"');
    // The manifest carries the discarded count no sample does (FR-048).
    expect(text).toContain('"discarded_samples": 2');
  });

  it('holds no imagery of any kind (FR-052)', () => {
    const text = new TextDecoder().decode(readFileSync(ARCHIVE_PATH));
    for (const forbidden of ['data:image', 'image/png', 'image/jpeg', 'base64,']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
