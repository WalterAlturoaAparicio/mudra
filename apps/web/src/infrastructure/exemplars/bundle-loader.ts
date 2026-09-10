/**
 * Reads the build-time exemplar bundle: a JSON manifest plus a `Float32Array` payload.
 *
 * The manifest describes the payload's layout, so the payload itself has no header and
 * needs no parsing — it becomes a typed array directly (research D4). Two things are
 * checked before any of it is trusted:
 *
 * * **`format_version`** — an unknown version is rejected outright rather than misread
 *   into plausible-looking nonsense (FR-083).
 * * **`dataset_fingerprint`** — compared against the fingerprint recorded when the
 *   application was built. A mismatch means the bundle and the build disagree about which
 *   dataset they came from, which degrades recognition silently, so it is reported
 *   prominently instead (FR-082/FR-083).
 */

import type {
  ExcludedPose,
  ExemplarBundle,
  ExemplarHand,
  PoseEntry,
} from '../../domain/recognition/types';
import type { Handedness } from '../../domain/landmarks/types';

/** Default location of the bundle manifest. */
export const BUNDLE_MANIFEST_URL = '/exemplars.manifest.json';

/** Default location of the bundle payload. */
export const BUNDLE_PAYLOAD_URL = '/exemplars.bin';

/** Raised when the bundle is missing, unreadable, or not the shape it claims to be. */
export class BundleError extends Error {
  /** The message says which file and which field; there is no code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

/** Fetches the manifest document. Injected so the loader is testable without a network. */
export type ManifestFetcher = (url: string) => Promise<unknown>;

/** Fetches the payload bytes. Injected for the same reason. */
export type PayloadFetcher = (url: string) => Promise<ArrayBuffer>;

/** What {@link loadExemplarBundle} needs to do its job. */
export interface LoadBundleOptions {
  readonly manifestUrl?: string;
  readonly payloadUrl?: string;
  readonly fetchManifest?: ManifestFetcher;
  readonly fetchPayload?: PayloadFetcher;
  /**
   * The `dataset_fingerprint` this build was made against, or `null` when the build had
   * no bundle to record one from. `null` skips the comparison and says so; it never
   * silently passes a mismatch.
   */
  readonly expectedFingerprint?: string | null;
  /** Bundle format this build understands. */
  readonly supportedFormatVersion: number;
  /** Where a staleness warning goes. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

const defaultFetchManifest: ManifestFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new BundleError(
      'Could not read ' + url + ': HTTP ' + response.status + ' ' + response.statusText + '.',
    );
  }
  return (await response.json()) as unknown;
};

const defaultFetchPayload: PayloadFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new BundleError(
      'Could not read ' + url + ': HTTP ' + response.status + ' ' + response.statusText + '.',
    );
  }
  return response.arrayBuffer();
};

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BundleError('manifest ' + path + ' must be an object.');
  }
  return value as Json;
}

function integer(raw: Json, key: string, path: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BundleError(
      'manifest ' + path + '.' + key + ' must be an integer, got ' + JSON.stringify(value) + '.',
    );
  }
  return value;
}

function text(raw: Json, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BundleError(
      'manifest ' +
        path +
        '.' +
        key +
        ' must be a non-empty string, got ' +
        JSON.stringify(value) +
        '.',
    );
  }
  return value;
}

function array(raw: Json, key: string, path: string): unknown[] {
  const value = raw[key];
  if (!Array.isArray(value)) {
    throw new BundleError('manifest ' + path + '.' + key + ' must be an array.');
  }
  return value as unknown[];
}

function handedness(value: string, where: string): Handedness {
  if (value === 'left' || value === 'right' || value === 'unknown') {
    return value;
  }
  throw new BundleError(
    'manifest ' + where + ': unknown handedness ' + JSON.stringify(value) + '.',
  );
}

function parsePose(raw: unknown, index: number, floatsPerHand: number): PoseEntry {
  const path = 'poses[' + index + ']';
  const pose = object(raw, path);
  const poseId = text(pose, 'pose_id', path);
  const handOffset = integer(pose, 'hand_offset', path);
  const handCount = integer(pose, 'hand_count', path);
  const requiredHands = integer(pose, 'required_hands', path);
  if (requiredHands !== 1 && requiredHands !== 2) {
    throw new BundleError(
      'manifest ' + path + '.required_hands must be 1 or 2, got ' + requiredHands + '.',
    );
  }

  const handsRaw = array(pose, 'hands', path);
  if (handsRaw.length !== handCount) {
    throw new BundleError(
      'manifest ' +
        path +
        ' claims ' +
        handCount +
        ' hands but lists ' +
        handsRaw.length +
        ' — offsets would be wrong.',
    );
  }

  const hands: ExemplarHand[] = handsRaw.map((entry, handIndex) => {
    const handPath = path + '.hands[' + handIndex + ']';
    const hand = object(entry, handPath);
    return {
      sampleId: text(hand, 'sample_id', handPath),
      handedness: handedness(text(hand, 'handedness', handPath), handPath),
      offset: (handOffset + handIndex) * floatsPerHand,
    };
  });

  return {
    poseId,
    displayName: text(pose, 'display_name', path),
    requiredHands,
    sampleCount: integer(pose, 'sample_count', path),
    hands,
  };
}

function parseExcluded(raw: unknown, index: number): ExcludedPose {
  const path = 'excluded[' + index + ']';
  const entry = object(raw, path);
  return {
    poseId: text(entry, 'pose_id', path),
    sampleCount: integer(entry, 'sample_count', path),
    reason: text(entry, 'reason', path),
  };
}

/**
 * Parse a manifest document and payload bytes into an {@link ExemplarBundle}.
 *
 * Separated from fetching so the whole of the validation is exercisable in Node with a
 * literal object and a `Float32Array` — no server, no browser.
 */
export function parseBundle(
  manifestDocument: unknown,
  payload: ArrayBuffer,
  options: Pick<LoadBundleOptions, 'expectedFingerprint' | 'supportedFormatVersion' | 'warn'>,
): ExemplarBundle {
  const manifest = object(manifestDocument, 'root');

  const formatVersion = integer(manifest, 'format_version', 'root');
  if (formatVersion !== options.supportedFormatVersion) {
    throw new BundleError(
      'Exemplar bundle format_version ' +
        formatVersion +
        ' is not supported; this build reads version ' +
        options.supportedFormatVersion +
        '. Re-run scripts/export_web_exemplars.py.',
    );
  }

  const datasetFingerprint = text(manifest, 'dataset_fingerprint', 'root');
  const landmarkCount = integer(manifest, 'landmark_count', 'root');
  const components = integer(manifest, 'components', 'root');
  const totalHands = integer(manifest, 'total_hands', 'root');
  const floatsPerHand = landmarkCount * components;

  const expectedBytes = totalHands * floatsPerHand * Float32Array.BYTES_PER_ELEMENT;
  if (payload.byteLength !== expectedBytes) {
    throw new BundleError(
      'Exemplar payload is ' +
        payload.byteLength +
        ' bytes but the manifest describes ' +
        expectedBytes +
        '. The two files are from different exports.',
    );
  }

  const poses = array(manifest, 'poses', 'root').map((entry, index) =>
    parsePose(entry, index, floatsPerHand),
  );
  // Mandatory, not optional (FR-023a): its *absence* is a manifest error, because a
  // manifest with no excluded section cannot be distinguished from one that dropped a
  // pose silently.
  if (!Array.isArray(manifest['excluded'])) {
    throw new BundleError(
      'manifest is missing the mandatory "excluded" section — a pose must never disappear silently.',
    );
  }
  const excluded = array(manifest, 'excluded', 'root').map(parseExcluded);

  const listedHands = poses.reduce((total, pose) => total + pose.hands.length, 0);
  if (listedHands !== totalHands) {
    throw new BundleError(
      'manifest lists ' + listedHands + ' hands but claims total_hands ' + totalHands + '.',
    );
  }

  const expected = options.expectedFingerprint;
  if (expected !== undefined && expected !== null && expected !== datasetFingerprint) {
    const warn = options.warn ?? ((message: string) => console.warn(message));
    warn(
      'Exemplar bundle is stale: it was built from dataset ' +
        datasetFingerprint +
        ' but this application was built against ' +
        expected +
        '. Recognition will not reflect the current dataset. ' +
        'Re-run scripts/export_web_exemplars.py and rebuild.',
    );
  }

  return {
    formatVersion,
    datasetFingerprint,
    generatedAt: text(manifest, 'generated_at', 'root'),
    normalization: {
      strategy: text(
        object(manifest['normalization'], 'normalization'),
        'strategy',
        'normalization',
      ),
      version: text(object(manifest['normalization'], 'normalization'), 'version', 'normalization'),
    },
    minSamples: integer(manifest, 'min_samples', 'root'),
    landmarkCount,
    components,
    totalHands,
    catalogPoseCount: integer(manifest, 'catalog_pose_count', 'root'),
    poses,
    excluded,
    data: new Float32Array(payload),
  };
}

/** Fetch and parse the exemplar bundle. */
export async function loadExemplarBundle(options: LoadBundleOptions): Promise<ExemplarBundle> {
  const manifestUrl = options.manifestUrl ?? BUNDLE_MANIFEST_URL;
  const payloadUrl = options.payloadUrl ?? BUNDLE_PAYLOAD_URL;
  const fetchManifest = options.fetchManifest ?? defaultFetchManifest;
  const fetchPayload = options.fetchPayload ?? defaultFetchPayload;

  const [manifest, payload] = await Promise.all([
    fetchManifest(manifestUrl),
    fetchPayload(payloadUrl),
  ]);

  const parseOptions: Pick<
    LoadBundleOptions,
    'expectedFingerprint' | 'supportedFormatVersion' | 'warn'
  > = {
    supportedFormatVersion: options.supportedFormatVersion,
    ...(options.expectedFingerprint === undefined
      ? {}
      : { expectedFingerprint: options.expectedFingerprint }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  };

  try {
    return parseBundle(manifest, payload, parseOptions);
  } catch (error) {
    if (error instanceof BundleError) {
      throw new BundleError(manifestUrl + ': ' + error.message);
    }
    throw error;
  }
}

/** Landmark coordinates of one exemplar hand, as `[x,y,z]` triples. */
export function exemplarPoints(
  bundle: ExemplarBundle,
  hand: ExemplarHand,
): readonly { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < bundle.landmarkCount; i += 1) {
    const base = hand.offset + i * bundle.components;
    points.push({
      x: bundle.data[base] ?? 0,
      y: bundle.data[base + 1] ?? 0,
      z: bundle.data[base + 2] ?? 0,
    });
  }
  return points;
}
