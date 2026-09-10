/**
 * The persisted shape of capture data, and the only way in and out of it
 * (contracts/capture-storage.md, FR-040).
 *
 * The type graph below is numbers, strings, booleans, and arrays of those. There is no `unknown`,
 * no `any`, no index signature, no `Blob`, no `ImageBitmap`, no `MirroredSurface`, and no
 * `SegmentationFrame` — so a camera frame is not merely forbidden here, it is **unrepresentable**.
 * That is the third and strongest of the three reasons imagery cannot reach the store; the other
 * two are policy (FR-040) and path (this layer only ever receives a `CaptureSample`, never a
 * `LandmarkFrame`), which is why `test/architecture/privacy.test.ts`'s existing
 * persistence-directory scan continues to pass unmodified.
 *
 * `parseStoredSession`/`parseStoredSample` exist because IndexedDB hands back whatever was written,
 * including by an older build. A record that does not match is rejected at read rather than
 * producing a sample Engine cannot load, months later, at import time.
 */

import { HAND_LANDMARK_COUNT } from '../../domain/landmarks/topology';
import type { Handedness, Landmark } from '../../domain/landmarks/types';
import type {
  CaptureHand,
  CaptureSample,
  CaptureSession,
  CaptureSessionStatus,
  RequiredHands,
} from '../../domain/capture/types';

/** Raised when a stored record is not the shape this build understands. */
export class CaptureSchemaError extends Error {
  /** The message names the offending field and record. */
  constructor(message: string) {
    super(message);
    this.name = 'CaptureSchemaError';
  }
}

/** Version of the persisted capture record shape. Bumping it means a migration decision. */
export const CAPTURE_RECORD_VERSION = 1;

/** One landmark, as stored. */
interface StoredLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One hand, as stored. */
interface StoredHand {
  readonly handedness: string;
  readonly confidence: number;
  readonly raw: readonly StoredLandmark[];
  readonly normalized: readonly StoredLandmark[];
}

/** A session record in the `sessions` store. */
export interface StoredSession {
  readonly recordVersion: number;
  readonly id: string;
  readonly contributorLabel: string;
  readonly poseId: string;
  readonly displayName: string | null;
  readonly requiredHands: number;
  readonly status: string;
  readonly startedAt: string;
  readonly sampleCount: number;
  readonly discardedCount: number;
}

/** A sample record in the `samples` store. */
export interface StoredSample {
  readonly recordVersion: number;
  readonly id: string;
  readonly sessionId: string;
  readonly capturedAt: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly countdownStartedAt: string | null;
  readonly countdownSeconds: number;
  readonly countdownEnabled: boolean;
  readonly hands: readonly StoredHand[];
}

// -- writing -------------------------------------------------------------------

/** A session, as it goes into the store. */
export function serializeSession(session: CaptureSession): StoredSession {
  return {
    recordVersion: CAPTURE_RECORD_VERSION,
    id: session.id,
    contributorLabel: session.contributorLabel,
    poseId: session.poseId,
    displayName: session.displayName,
    requiredHands: session.requiredHands,
    status: session.status,
    startedAt: session.startedAt,
    sampleCount: session.sampleCount,
    discardedCount: session.discardedCount,
  };
}

/** A sample, as it goes into the store. Coordinates are copied field by field, never spread. */
export function serializeSample(sample: CaptureSample): StoredSample {
  return {
    recordVersion: CAPTURE_RECORD_VERSION,
    id: sample.id,
    sessionId: sample.sessionId,
    capturedAt: sample.capturedAt,
    frameWidth: sample.frameWidth,
    frameHeight: sample.frameHeight,
    countdownStartedAt: sample.countdownStartedAt,
    countdownSeconds: sample.countdownSeconds,
    countdownEnabled: sample.countdownEnabled,
    hands: sample.hands.map((hand) => ({
      handedness: hand.handedness,
      confidence: hand.confidence,
      // Field-by-field, so nothing an upstream object happened to carry travels along with it.
      raw: hand.raw.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      normalized: hand.normalized.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    })),
  };
}

// -- reading -------------------------------------------------------------------

type Record_ = Record<string, unknown>;

function object(value: unknown, path: string): Record_ {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaptureSchemaError(path + ' must be an object.');
  }
  return value as Record_;
}

function str(raw: Record_, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new CaptureSchemaError(path + '.' + key + ' must be a string.');
  }
  return value;
}

function nullableStr(raw: Record_, key: string, path: string): string | null {
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new CaptureSchemaError(path + '.' + key + ' must be a string or null.');
  }
  return value;
}

function num(raw: Record_, key: string, path: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CaptureSchemaError(path + '.' + key + ' must be a finite number.');
  }
  return value;
}

function bool(raw: Record_, key: string, path: string): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') {
    throw new CaptureSchemaError(path + '.' + key + ' must be a boolean.');
  }
  return value;
}

function handedness(value: string, path: string): Handedness {
  if (value === 'left' || value === 'right' || value === 'unknown') {
    return value;
  }
  throw new CaptureSchemaError(path + '.handedness is not a known value: ' + JSON.stringify(value));
}

function points(value: unknown, path: string): Landmark[] {
  if (!Array.isArray(value)) {
    throw new CaptureSchemaError(path + ' must be an array of landmarks.');
  }
  if (value.length !== HAND_LANDMARK_COUNT) {
    throw new CaptureSchemaError(
      path + ' must hold exactly ' + HAND_LANDMARK_COUNT + ' landmarks, got ' + value.length + '.',
    );
  }
  return (value as unknown[]).map((entry, index) => {
    const point = object(entry, path + '[' + index + ']');
    return {
      x: num(point, 'x', path + '[' + index + ']'),
      y: num(point, 'y', path + '[' + index + ']'),
      z: num(point, 'z', path + '[' + index + ']'),
    };
  });
}

function parseHand(value: unknown, path: string): CaptureHand {
  const raw = object(value, path);
  return {
    handedness: handedness(str(raw, 'handedness', path), path),
    confidence: num(raw, 'confidence', path),
    raw: points(raw['raw'], path + '.raw'),
    normalized: points(raw['normalized'], path + '.normalized'),
  };
}

/** Rebuild a session from a stored record. @throws {CaptureSchemaError} */
export function parseStoredSession(value: unknown): CaptureSession {
  const raw = object(value, 'capture session');
  const requiredHands = num(raw, 'requiredHands', 'capture session');
  if (requiredHands !== 1 && requiredHands !== 2) {
    throw new CaptureSchemaError('capture session.requiredHands must be 1 or 2.');
  }
  const status = str(raw, 'status', 'capture session');
  if (status !== 'active' && status !== 'closed') {
    throw new CaptureSchemaError('capture session.status must be "active" or "closed".');
  }
  return {
    id: str(raw, 'id', 'capture session'),
    contributorLabel: str(raw, 'contributorLabel', 'capture session'),
    poseId: str(raw, 'poseId', 'capture session'),
    displayName: nullableStr(raw, 'displayName', 'capture session'),
    requiredHands: requiredHands as RequiredHands,
    status: status as CaptureSessionStatus,
    startedAt: str(raw, 'startedAt', 'capture session'),
    sampleCount: num(raw, 'sampleCount', 'capture session'),
    discardedCount: num(raw, 'discardedCount', 'capture session'),
  };
}

/** Rebuild a sample from a stored record. @throws {CaptureSchemaError} */
export function parseStoredSample(value: unknown): CaptureSample {
  const raw = object(value, 'capture sample');
  const hands = raw['hands'];
  if (!Array.isArray(hands) || hands.length === 0) {
    throw new CaptureSchemaError('capture sample.hands must be a non-empty array.');
  }
  return {
    id: str(raw, 'id', 'capture sample'),
    sessionId: str(raw, 'sessionId', 'capture sample'),
    capturedAt: str(raw, 'capturedAt', 'capture sample'),
    frameWidth: num(raw, 'frameWidth', 'capture sample'),
    frameHeight: num(raw, 'frameHeight', 'capture sample'),
    countdownStartedAt: nullableStr(raw, 'countdownStartedAt', 'capture sample'),
    countdownSeconds: num(raw, 'countdownSeconds', 'capture sample'),
    countdownEnabled: bool(raw, 'countdownEnabled', 'capture sample'),
    hands: (hands as unknown[]).map((hand, index) =>
      parseHand(hand, 'capture sample.hands[' + index + ']'),
    ),
  };
}
