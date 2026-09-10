/**
 * The cross-language golden-fixture verification the constitution requires (FR-063 – FR-067).
 *
 * Engine is the authority. `scripts/export_web_capture_fixtures.py` writes what Engine's own
 * `PoseSerializer` produces for a set of known inputs; this suite asserts Mudra Web produces the
 * same document — key order included — plus exactly four additive fields and no others.
 *
 * The second assertion in each case is the one that makes "additive and nothing else" a
 * machine-checked rule: strip the four contracted keys from Web's output and Engine's own document
 * must come back, unchanged and in the same order.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { captureHand } from '../../src/domain/capture/types';
import type { CaptureHand, CaptureSample, CaptureSession } from '../../src/domain/capture/types';
import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';
import type { Handedness } from '../../src/domain/landmarks/types';
import {
  sampleNumber,
  serializePoseSample,
  serializePoseSampleJson,
} from '../../src/infrastructure/capture/pose-sample-serializer';
import { APP_ROOT } from '../support/source-scan';
import { structuralMismatch } from '../support/structural-match';

interface FixtureHand {
  handedness: string;
  confidence: number;
  raw: { x: number; y: number; z: number }[];
  normalized: { x: number; y: number; z: number }[];
}

interface FixtureCase {
  name: string;
  description: string;
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
      sampleNumber: string;
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
  engine_document: unknown;
  expected_document: unknown;
}

interface FixtureDocument {
  generator: string;
  schema_version: number;
  landmark_count: number;
  additive_fields: { 'metadata.camera': string[]; 'metadata.capture': string[] };
  cases: FixtureCase[];
}

const fixtures = JSON.parse(
  readFileSync(join(APP_ROOT, 'test/fixtures/pose_sample_cases.json'), 'utf-8'),
) as FixtureDocument;

function toSession(input: FixtureCase['inputs']): CaptureSession {
  return {
    id: input.session.id,
    contributorLabel: input.session.contributorLabel,
    poseId: input.session.poseId,
    displayName: input.session.displayName,
    requiredHands: input.session.requiredHands === 2 ? 2 : 1,
    status: 'active',
    startedAt: input.sample.capturedAt,
    sampleCount: 1,
    discardedCount: 0,
  };
}

function toHand(hand: FixtureHand): CaptureHand {
  return captureHand(
    hand.handedness as Handedness,
    hand.confidence,
    hand.raw,
    hand.normalized,
    HAND_LANDMARK_COUNT,
  );
}

function toSample(input: FixtureCase['inputs']): CaptureSample {
  return {
    id: input.sample.id,
    sessionId: input.session.id,
    capturedAt: input.sample.capturedAt,
    frameWidth: input.sample.frameWidth,
    frameHeight: input.sample.frameHeight,
    countdownStartedAt: input.sample.countdownStartedAt,
    countdownSeconds: input.sample.countdownSeconds,
    countdownEnabled: input.sample.countdownEnabled,
    hands: input.sample.hands.map(toHand),
  };
}

function serializeCase(testCase: FixtureCase): unknown {
  // Round-tripped through JSON so the comparison sees exactly what an archive entry would hold,
  // not an in-memory object that happens to look right.
  return JSON.parse(
    serializePoseSampleJson({
      session: toSession(testCase.inputs),
      sample: toSample(testCase.inputs),
      sampleNumber: testCase.inputs.sample.sampleNumber,
      versions: testCase.inputs.versions,
    }),
  );
}

/** Remove exactly the four contracted additive keys, leaving order otherwise untouched. */
function stripAdditive(document: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(document)) as Record<string, never>;
  const metadata = (copy as unknown as { metadata: Record<string, Record<string, unknown>> })
    .metadata;
  for (const key of fixtures.additive_fields['metadata.camera']) {
    delete metadata['camera']?.[key];
  }
  for (const key of fixtures.additive_fields['metadata.capture']) {
    delete metadata['capture']?.[key];
  }
  return copy;
}

describe('the fixture file itself', () => {
  it('exists, is Engine-generated, and covers the required cases (FR-064, FR-065)', () => {
    expect(fixtures.generator).toBe('scripts/export_web_capture_fixtures.py');
    expect(fixtures.schema_version).toBe(1);
    expect(fixtures.landmark_count).toBe(HAND_LANDMARK_COUNT);
    const names = fixtures.cases.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'one_hand',
        'two_hands',
        'countdown_disabled',
        'absent_optional_fields',
        'numeric_stress',
        'degenerate_span',
      ]),
    );
  });

  it('names exactly the four additive fields this feature authorizes (FR-031)', () => {
    expect(fixtures.additive_fields['metadata.camera']).toEqual(['mirrored_preview']);
    expect(fixtures.additive_fields['metadata.capture']).toEqual([
      'countdown_enabled',
      'session_uuid',
      'contributor_label',
    ]);
  });
});

describe.each(fixtures.cases.map((c) => [c.name, c] as const))('case %s', (_name, testCase) => {
  const actual = serializeCase(testCase);

  it('matches Engine’s document structurally, key order included (FR-066)', () => {
    const mismatch = structuralMismatch(testCase.expected_document, actual);
    expect(mismatch, mismatch ?? undefined).toBeNull();
  });

  it('is additive and nothing else — stripping the four keys gives Engine’s own document', () => {
    const mismatch = structuralMismatch(testCase.engine_document, stripAdditive(actual));
    expect(mismatch, mismatch ?? undefined).toBeNull();
  });

  it('writes schema_version 1 and never a Web-specific variant (FR-029)', () => {
    expect((actual as { schema_version: number }).schema_version).toBe(1);
  });

  it('omits position and lens_facing, which a browser cannot determine (FR-032)', () => {
    const camera = (actual as { metadata: { camera: Record<string, unknown> } }).metadata.camera;
    expect(Object.keys(camera)).toEqual(['index', 'width', 'height', 'mirrored_preview']);
  });
});

describe('the comparator itself', () => {
  // A comparison that cannot fail proves nothing, so these assert it does fail — and says where.
  const base = fixtures.cases[0]!;

  it('catches a renamed key', () => {
    const mutated = JSON.parse(JSON.stringify(base.expected_document)) as Record<string, unknown>;
    mutated['pose_identifier'] = mutated['pose_id'];
    delete mutated['pose_id'];
    expect(structuralMismatch(base.expected_document, mutated)).toMatch(/key set differs/);
  });

  it('catches reordered keys even when the key set is identical', () => {
    const original = base.expected_document as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(original).reverse()) {
      reordered[key] = original[key];
    }
    expect(structuralMismatch(original, reordered)).toMatch(/key order differs/);
  });

  it('catches a changed number, and names the path', () => {
    const mutated = JSON.parse(JSON.stringify(base.expected_document)) as {
      hands: { raw: { x: number }[] }[];
    };
    mutated.hands[0]!.raw[3]!.x += 1e-12;
    expect(structuralMismatch(base.expected_document, mutated)).toMatch(
      /\$\.hands\[0\]\.raw\[3\]\.x/,
    );
  });

  it('does not require byte equality, only value equality (research D9)', () => {
    // `1e-7` and `0.0000001` are the same double written two ways. Text differs; value does not.
    expect(structuralMismatch({ z: 1e-7 }, JSON.parse('{"z":0.0000001}'))).toBeNull();
  });
});

describe('serialized output', () => {
  it('uses the two-space indentation Engine writes to disk', () => {
    const json = serializePoseSampleJson({
      session: toSession(fixtures.cases[0]!.inputs),
      sample: toSample(fixtures.cases[0]!.inputs),
      sampleNumber: 'sample_000001',
      versions: fixtures.cases[0]!.inputs.versions,
    });
    expect(json).toContain('\n  "pose_id":');
  });

  it('numbers samples the way the archive layout does (FR-047)', () => {
    expect(sampleNumber(1)).toBe('sample_000001');
    expect(sampleNumber(42)).toBe('sample_000042');
    expect(sampleNumber(123456)).toBe('sample_123456');
  });

  it('is a pure function of its input', () => {
    const input = {
      session: toSession(fixtures.cases[0]!.inputs),
      sample: toSample(fixtures.cases[0]!.inputs),
      sampleNumber: 'sample_000001',
      versions: fixtures.cases[0]!.inputs.versions,
    };
    expect(serializePoseSample(input)).toEqual(serializePoseSample(input));
  });
});
