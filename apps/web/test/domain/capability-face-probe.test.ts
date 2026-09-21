/**
 * `face_landmarks` is probed independently of `person_segmentation` (Spec 011 FR-001–003, 035).
 *
 * Both directions matter: a missing face model must not touch segmentation's availability, and a
 * missing segmentation model must not touch faces'. And probing only *constructs* — it never
 * analyses a frame, so no face data can come from merely probing.
 */

import { describe, expect, it } from 'vitest';

import { Logger } from '../../src/domain/config/logger';
import type { LogFields, LogLevel } from '../../src/domain/config/logger';
import type { FaceDetector } from '../../src/domain/ports/face-detector';
import type { PersonSegmenter } from '../../src/domain/ports/segmenter';
import {
  FACE_LANDMARKS,
  PERSON_SEGMENTATION,
  defaultCapabilities,
  probeCapabilities,
} from '../../src/domain/runtime/capabilities';

const segmenter: PersonSegmenter = { segment: () => null, close: () => {} };

function countingFaceDetector(): { detector: FaceDetector; detectCalls: () => number } {
  let calls = 0;
  return {
    detector: {
      detect: () => {
        calls += 1;
        return null;
      },
      close: () => {},
    },
    detectCalls: () => calls,
  };
}

function capturingLogger(): {
  logger: Logger;
  records: { level: LogLevel; message: string; fields: LogFields }[];
} {
  const records: { level: LogLevel; message: string; fields: LogFields }[] = [];
  return {
    logger: new Logger('debug', (level, message, fields) =>
      records.push({ level, message, fields }),
    ),
    records,
  };
}

const rejectSegmenter = (): Promise<PersonSegmenter> => Promise.reject(new Error('no segmenter'));
const rejectFace = (): Promise<FaceDetector> => Promise.reject(new Error('no face model'));

describe('independent probing', () => {
  it('face resolves while segmentation rejects: face available, segmentation not', async () => {
    const { detector } = countingFaceDetector();
    const result = await probeCapabilities(rejectSegmenter, new Logger('error'), () =>
      Promise.resolve(detector),
    );
    expect(result.capabilities.has(PERSON_SEGMENTATION)).toBe(false);
    expect(result.capabilities.has(FACE_LANDMARKS)).toBe(true);
    expect(result.segmenter).toBeNull();
    expect(result.faceDetector).toBe(detector);
  });

  it('segmentation resolves while face rejects: segmentation exactly as before, face not', async () => {
    const result = await probeCapabilities(
      () => Promise.resolve(segmenter),
      new Logger('error'),
      rejectFace,
    );
    expect(result.capabilities.has(PERSON_SEGMENTATION)).toBe(true);
    expect(result.capabilities.has(FACE_LANDMARKS)).toBe(false);
    expect(result.segmenter).toBe(segmenter);
    expect(result.faceDetector).toBeNull();
  });

  it('both reject: both unavailable, nothing thrown, each failure logged under its own name', async () => {
    const { logger, records } = capturingLogger();
    const result = await probeCapabilities(rejectSegmenter, logger, rejectFace);
    expect(result.capabilities.all()).toEqual([
      { name: FACE_LANDMARKS, available: false },
      { name: PERSON_SEGMENTATION, available: false },
    ]);
    const warned = records.filter((r) => r.level === 'warn').map((r) => r.fields['capability']);
    expect(warned.sort()).toEqual([FACE_LANDMARKS, PERSON_SEGMENTATION].sort());
  });

  it('both resolve: both available', async () => {
    const { detector } = countingFaceDetector();
    const result = await probeCapabilities(
      () => Promise.resolve(segmenter),
      new Logger('error'),
      () => Promise.resolve(detector),
    );
    expect(result.capabilities.has(PERSON_SEGMENTATION)).toBe(true);
    expect(result.capabilities.has(FACE_LANDMARKS)).toBe(true);
  });

  it('a face constructor that rejects leaves segmentation availability identical to no constructor at all', async () => {
    const withoutFace = await probeCapabilities(() => Promise.resolve(segmenter));
    const withFailingFace = await probeCapabilities(
      () => Promise.resolve(segmenter),
      new Logger('error'),
      rejectFace,
    );
    expect(withFailingFace.capabilities.has(PERSON_SEGMENTATION)).toBe(
      withoutFace.capabilities.has(PERSON_SEGMENTATION),
    );
    expect(withFailingFace.segmenter).toBe(withoutFace.segmenter);
  });
});

describe('with no face prober supplied (the public experience and every existing caller)', () => {
  it('reports exactly what it reported before faces existed', async () => {
    const result = await probeCapabilities(() => Promise.resolve(segmenter));
    expect(result.capabilities.all()).toEqual([{ name: PERSON_SEGMENTATION, available: true }]);
    expect(result.capabilities.has(FACE_LANDMARKS)).toBe(false);
    expect(result.faceDetector).toBeNull();
  });

  it('leaves the shipped default registry untouched (still exactly one entry)', () => {
    expect(defaultCapabilities().all()).toEqual([{ name: PERSON_SEGMENTATION, available: false }]);
  });
});

describe('probing only constructs', () => {
  it('never calls detect on the detector it constructs', async () => {
    const { detector, detectCalls } = countingFaceDetector();
    await probeCapabilities(
      () => Promise.resolve(segmenter),
      new Logger('error'),
      () => Promise.resolve(detector),
    );
    expect(detectCalls()).toBe(0);
  });
});
