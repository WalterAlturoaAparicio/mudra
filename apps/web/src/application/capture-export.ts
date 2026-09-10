/**
 * Turning the capture store into one Engine-consumable archive (FR-046 – FR-052b).
 *
 * The single most important property of this module is what it does **not** do: it reads the
 * repository and writes an archive, and it never deletes, alters, or marks anything. Export is
 * repeatable and non-mutating (FR-052a) — which is why the repository port has no `markExported`
 * for this code to call even if someone wanted it to.
 *
 * Numbering is assigned **here** rather than at capture time, because `sample_NNNNNN` is a property
 * of the archive: two sessions for one pose produce one unbroken sequence, and that is only
 * knowable once the export set is known (FR-047).
 */

import { engineTimestamp } from '../domain/capture/engine-timestamp';
import type { CaptureSample, CaptureSession } from '../domain/capture/types';
import type { Clock } from '../domain/ports/clock';
import type { CaptureRepository } from '../domain/ports/capture-repository';
import {
  buildCaptureManifest,
  serializeCaptureManifest,
} from '../infrastructure/capture/capture-manifest';
import type { ApplicationVersions } from '../infrastructure/capture/pose-sample-serializer';
import {
  sampleNumber,
  serializePoseSampleJson,
} from '../infrastructure/capture/pose-sample-serializer';
import type { ZipEntry } from '../infrastructure/capture/zip-writer';
import { buildZipArchive, utf8 } from '../infrastructure/capture/zip-writer';

/** Where the archive's sample tree lives, matching Engine's own dataset layout. */
const POSES_ROOT = 'datasets/poses';

/** The manifest is always the first entry (contracts/capture-archive.md). */
const MANIFEST_NAME = 'manifest.json';

/** What building an export needs. */
export interface CaptureExportOptions {
  readonly repository: CaptureRepository;
  readonly versions: ApplicationVersions;
  /** The bundle this build was made against, or `null`. */
  readonly datasetFingerprint: string | null;
  /** Injected so an export can be produced with the clock held still (SC-009). */
  readonly now: Clock;
}

/** The finished artifact, plus what it contains. */
export interface CaptureExport {
  /** The archive bytes. */
  readonly bytes: Uint8Array;
  /** Suggested download name; carries the export date. */
  readonly fileName: string;
  readonly totalSamples: number;
  readonly poseCounts: Readonly<Record<string, number>>;
  readonly sessionCount: number;
}

/** Raised when there is nothing to export. */
export class NothingToExportError extends Error {
  constructor() {
    super('There are no captured samples to export yet.');
    this.name = 'NothingToExportError';
  }
}

function poseDirectory(poseId: string): string {
  return `${POSES_ROOT}/${poseId}`;
}

/**
 * Read the whole store and build the archive.
 *
 * Sessions are grouped by pose and ordered by start instant so numbering is stable for a given
 * store: the same content always produces the same entry names, which is half of why two exports
 * are byte-identical when the clock is held still.
 */
export async function buildCaptureExport(options: CaptureExportOptions): Promise<CaptureExport> {
  const { repository, versions, datasetFingerprint, now } = options;

  const sessions = [...(await repository.listSessions())].sort((a, b) =>
    a.startedAt === b.startedAt ? a.id.localeCompare(b.id) : a.startedAt.localeCompare(b.startedAt),
  );

  const included: { session: CaptureSession; writtenSamples: number }[] = [];
  const sampleEntries: ZipEntry[] = [];
  /** Next `sample_NNNNNN` per pose — continuous across every session for that pose (FR-047). */
  const nextNumber = new Map<string, number>();

  for (const session of sessions) {
    const samples: readonly CaptureSample[] = await repository.listSamples(session.id);
    if (samples.length === 0) {
      // A session that recorded nothing contributes no directory and no manifest record: an
      // orphan `session_uuid` should never reach the dataset. Mudra Capture takes the same view.
      continue;
    }
    for (const sample of samples) {
      const position = nextNumber.get(session.poseId) ?? 1;
      nextNumber.set(session.poseId, position + 1);
      const number = sampleNumber(position);
      sampleEntries.push({
        name: `${poseDirectory(session.poseId)}/${number}.json`,
        bytes: utf8(
          serializePoseSampleJson({ session, sample, sampleNumber: number, versions }),
        ),
      });
    }
    included.push({ session, writtenSamples: samples.length });
  }

  if (sampleEntries.length === 0) {
    throw new NothingToExportError();
  }

  const exportedAt = now();
  const manifest = buildCaptureManifest({
    sessions: included,
    versions,
    datasetFingerprint,
    exportTimestamp: engineTimestamp(exportedAt),
  });

  // Manifest first, then sample entries sorted by full entry name (FR-049).
  sampleEntries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const bytes = buildZipArchive([
    { name: MANIFEST_NAME, bytes: utf8(serializeCaptureManifest(manifest)) },
    ...sampleEntries,
  ]);

  return {
    bytes,
    fileName: `mudra-web-capture-${exportedAt.toISOString().slice(0, 10)}.zip`,
    totalSamples: manifest.total_samples,
    poseCounts: manifest.pose_counts,
    sessionCount: included.length,
  };
}
