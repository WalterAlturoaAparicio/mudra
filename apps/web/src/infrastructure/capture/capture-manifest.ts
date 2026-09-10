/**
 * The archive's inert entry point (contracts/capture-archive.md, FR-048).
 *
 * `manifest.json` is **not** part of the pose-sample schema and is invisible to anything reading an
 * individual sample. It answers "what is in this archive?" without walking the tree, and it carries
 * the two things no sample does: the per-session discarded count, and the dataset fingerprint the
 * browser was running against.
 *
 * The fingerprint lives here rather than in a sample deliberately: it describes the *context* of the
 * export, not a property of any one sample.
 */

import type { CaptureSession } from '../../domain/capture/types';
import type { ApplicationVersions } from './pose-sample-serializer';
import { POSE_SAMPLE_SCHEMA_VERSION } from './pose-sample-serializer';
import {
  NORMALIZATION_STRATEGY,
  NORMALIZATION_VERSION,
} from '../../domain/normalization/normalize';

/** The manifest's own version, independent of the sample schema. */
export const CAPTURE_MANIFEST_VERSION = 1;

/** One session's provenance record. Field order is the wire order. */
export interface ManifestSessionRecord {
  readonly session_uuid: string;
  readonly contributor_label: string;
  readonly pose_id: string;
  readonly display_name: string | null;
  readonly required_hands: number;
  readonly started_at: string;
  readonly total_samples: number;
  readonly discarded_samples: number;
}

/** The manifest document. */
export interface CaptureManifest {
  readonly manifest_version: number;
  readonly schema_version: number;
  readonly producer: string;
  readonly export_timestamp: string;
  readonly normalization: { readonly strategy: string; readonly version: string };
  readonly dataset_fingerprint: string | null;
  readonly total_samples: number;
  readonly pose_counts: Readonly<Record<string, number>>;
  readonly sessions: readonly ManifestSessionRecord[];
}

/** What the manifest builder needs. */
export interface BuildManifestInput {
  /** Sessions included in this export, with the sample count actually written for each. */
  readonly sessions: readonly { readonly session: CaptureSession; readonly writtenSamples: number }[];
  readonly versions: ApplicationVersions;
  /** The bundle this build was made against, or `null` when there was none. */
  readonly datasetFingerprint: string | null;
  /** Engine-format instant; injected, never read from the clock here. */
  readonly exportTimestamp: string;
}

/**
 * Build the manifest.
 *
 * `dataset_fingerprint` is `null` rather than invented when the build had no bundle — the same
 * "skip the comparison and say so" handling `bundle-loader.ts` already applies.
 */
export function buildCaptureManifest(input: BuildManifestInput): CaptureManifest {
  const poseCounts: Record<string, number> = {};
  let total = 0;
  for (const { session, writtenSamples } of input.sessions) {
    poseCounts[session.poseId] = (poseCounts[session.poseId] ?? 0) + writtenSamples;
    total += writtenSamples;
  }

  return {
    manifest_version: CAPTURE_MANIFEST_VERSION,
    schema_version: POSE_SAMPLE_SCHEMA_VERSION,
    producer: input.versions.application,
    export_timestamp: input.exportTimestamp,
    normalization: { strategy: NORMALIZATION_STRATEGY, version: NORMALIZATION_VERSION },
    dataset_fingerprint: input.datasetFingerprint,
    total_samples: total,
    // Sorted so the manifest itself is deterministic for a given store.
    pose_counts: Object.fromEntries(Object.entries(poseCounts).sort(([a], [b]) => a.localeCompare(b))),
    sessions: input.sessions.map(({ session, writtenSamples }) => ({
      session_uuid: session.id,
      contributor_label: session.contributorLabel,
      pose_id: session.poseId,
      display_name: session.displayName,
      required_hands: session.requiredHands,
      started_at: session.startedAt,
      total_samples: writtenSamples,
      discarded_samples: session.discardedCount,
    })),
  };
}

/** The manifest as the archive entry holds it. */
export function serializeCaptureManifest(manifest: CaptureManifest): string {
  return JSON.stringify(manifest, null, 2);
}
