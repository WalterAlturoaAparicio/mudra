import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import {
  BundleError,
  exemplarPoints,
  loadExemplarBundle,
  parseBundle,
} from '../../src/infrastructure/exemplars/bundle-loader';

const SUPPORTED = DEFAULT_SESSION_CONFIG.bundle.formatVersion;

/** A minimal but *complete* manifest: two poses, one of each hand requirement. */
function wellFormedManifest(): Record<string, unknown> {
  return {
    format_version: SUPPORTED,
    generated_at: '2026-08-20T00:00:00Z',
    dataset_fingerprint: 'sha256:abc',
    normalization: { strategy: 'translation_scale', version: '1.0' },
    min_samples: 20,
    landmark_count: 21,
    components: 3,
    total_hands: 3,
    catalog_pose_count: 3,
    total_samples: 42,
    poses: [
      {
        pose_id: 'hi',
        display_name: 'Hi',
        required_hands: 1,
        sample_count: 20,
        hand_offset: 0,
        hand_count: 1,
        hands: [{ sample_id: 'sample_000001', handedness: 'right' }],
      },
      {
        pose_id: 'dragon',
        display_name: 'Dragon',
        required_hands: 2,
        sample_count: 21,
        hand_offset: 1,
        hand_count: 2,
        hands: [
          { sample_id: 'sample_000001', handedness: 'left' },
          { sample_id: 'sample_000001', handedness: 'right' },
        ],
      },
    ],
    excluded: [{ pose_id: 'domain_expansion', sample_count: 1, reason: 'below_min_samples' }],
  };
}

function payloadFor(handCount: number): ArrayBuffer {
  const floats = new Float32Array(handCount * 21 * 3);
  for (let i = 0; i < floats.length; i += 1) {
    floats[i] = i / 100;
  }
  return floats.buffer;
}

describe('a well-formed bundle', () => {
  it('parses into pose entries with payload offsets', () => {
    const bundle = parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
    });

    expect(bundle.poses.map((p) => p.poseId)).toEqual(['hi', 'dragon']);
    expect(bundle.totalHands).toBe(3);
    expect(bundle.poses[0]!.hands[0]!.offset).toBe(0);
    expect(bundle.poses[1]!.hands[0]!.offset).toBe(63);
    expect(bundle.poses[1]!.hands[1]!.offset).toBe(126);
  });

  it('exposes 21 landmarks per exemplar hand at the right slice', () => {
    const bundle = parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
    });
    const points = exemplarPoints(bundle, bundle.poses[1]!.hands[1]!);
    expect(points).toHaveLength(21);
    expect(points[0]!.x).toBeCloseTo(1.26, 6);
    expect(points[0]!.y).toBeCloseTo(1.27, 6);
  });

  it('keeps the sample_id two-handed matching depends on (FR-022)', () => {
    const bundle = parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
    });
    expect(bundle.poses[1]!.hands.map((h) => h.sampleId)).toEqual([
      'sample_000001',
      'sample_000001',
    ]);
  });
});

describe('rejections', () => {
  it('rejects an unknown format_version rather than misreading it (FR-083)', () => {
    const manifest = { ...wellFormedManifest(), format_version: 99 };
    expect(() =>
      parseBundle(manifest, payloadFor(3), { supportedFormatVersion: SUPPORTED }),
    ).toThrow(/format_version 99 is not supported/);
  });

  it('rejects a payload whose size disagrees with the manifest', () => {
    expect(() =>
      parseBundle(wellFormedManifest(), payloadFor(2), { supportedFormatVersion: SUPPORTED }),
    ).toThrow(/different exports/);
  });

  it('rejects a pose whose hand_count disagrees with its hands list', () => {
    const manifest = wellFormedManifest();
    (manifest['poses'] as Record<string, unknown>[])[0]!['hand_count'] = 5;
    expect(() =>
      parseBundle(manifest, payloadFor(3), { supportedFormatVersion: SUPPORTED }),
    ).toThrow(/offsets would be wrong/);
  });

  it('rejects a manifest with no excluded section at all (FR-023a)', () => {
    const manifest = wellFormedManifest();
    delete manifest['excluded'];
    expect(() =>
      parseBundle(manifest, payloadFor(3), { supportedFormatVersion: SUPPORTED }),
    ).toThrow(/must never disappear silently/);
  });

  it('rejects a required_hands value outside {1,2}', () => {
    const manifest = wellFormedManifest();
    (manifest['poses'] as Record<string, unknown>[])[0]!['required_hands'] = 3;
    expect(() =>
      parseBundle(manifest, payloadFor(3), { supportedFormatVersion: SUPPORTED }),
    ).toThrow(BundleError);
  });
});

describe('staleness', () => {
  it('reports a fingerprint mismatch prominently instead of degrading quietly', () => {
    const warnings: string[] = [];
    parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
      expectedFingerprint: 'sha256:something-else',
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/stale/);
    expect(warnings[0]).toMatch(/export_web_exemplars\.py/);
  });

  it('says nothing when the fingerprints agree', () => {
    const warnings: string[] = [];
    parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
      expectedFingerprint: 'sha256:abc',
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toHaveLength(0);
  });

  it('skips the comparison when the build recorded no fingerprint', () => {
    const warnings: string[] = [];
    parseBundle(wellFormedManifest(), payloadFor(3), {
      supportedFormatVersion: SUPPORTED,
      expectedFingerprint: null,
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toHaveLength(0);
  });
});

describe('loadExemplarBundle', () => {
  it('fetches both files and names the manifest when parsing fails', async () => {
    await expect(
      loadExemplarBundle({
        supportedFormatVersion: SUPPORTED,
        fetchManifest: () => Promise.resolve({ ...wellFormedManifest(), format_version: 7 }),
        fetchPayload: () => Promise.resolve(payloadFor(3)),
      }),
    ).rejects.toThrow(/exemplars\.manifest\.json.*format_version 7/s);
  });
});

// --------------------------------------------------------------------------- //
// The generated bundle itself
// --------------------------------------------------------------------------- //

const MANIFEST_PATH = resolve(__dirname, '../../public/exemplars.manifest.json');
const PAYLOAD_PATH = resolve(__dirname, '../../public/exemplars.bin');
const generated = existsSync(MANIFEST_PATH) && existsSync(PAYLOAD_PATH);

describe.skipIf(!generated)('the generated bundle', () => {
  function loadGenerated() {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as unknown;
    const bytes = readFileSync(PAYLOAD_PATH);
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return parseBundle(manifest, payload, { supportedFormatVersion: SUPPORTED });
  }

  it('parses', () => {
    const bundle = loadGenerated();
    expect(bundle.poses.length).toBeGreaterThan(0);
    expect(bundle.normalization.strategy).toBe('translation_scale');
  });

  it('reports the excluded pose with its reason and count (FR-023a, SC-013)', () => {
    const bundle = loadGenerated();
    const excluded = bundle.excluded.find((e) => e.poseId === 'domain_expansion');
    expect(excluded).toBeDefined();
    expect(excluded!.sampleCount).toBe(1);
    expect(excluded!.reason).toBe('below_min_samples');
    expect(bundle.poses.some((p) => p.poseId === 'domain_expansion')).toBe(false);
  });

  it('accounts for every catalog pose as either eligible or excluded', () => {
    const bundle = loadGenerated();
    expect(bundle.poses.length + bundle.excluded.length).toBe(bundle.catalogPoseCount);
  });

  it('contains at least one one-handed AND one two-handed pose (FR-023c)', () => {
    // A dataset or export change that removed either would leave one whole matching path
    // — hand-agnostic or like-for-like — with nothing to match against, and only this
    // assertion would say so.
    const bundle = loadGenerated();
    const requirements = new Set(bundle.poses.map((p) => p.requiredHands));
    expect(requirements.has(1)).toBe(true);
    expect(requirements.has(2)).toBe(true);
  });

  it('holds every default active pose', () => {
    const bundle = loadGenerated();
    const available = new Set(bundle.poses.map((p) => p.poseId));
    for (const poseId of DEFAULT_SESSION_CONFIG.activePoseSet) {
      expect(available.has(poseId)).toBe(true);
    }
  });

  it('fits inside the 2 MB budget (SC-009)', () => {
    const bytes = readFileSync(PAYLOAD_PATH).byteLength;
    expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});
