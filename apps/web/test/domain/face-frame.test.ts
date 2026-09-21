/**
 * `FaceFrame`'s invariants (Spec 011 FR-009, FR-010, FR-013).
 *
 * The point of the value object is that a face which would misanchor an effect cannot exist:
 * wrong point count, a non-finite coordinate, or a surface with no size are rejected at
 * construction, in a plain Node test with no browser, camera or model.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FACE_LANDMARK_COUNT, FaceFrameError, faceFrame } from '../../src/domain/landmarks/face';
import type { FaceFrame } from '../../src/domain/landmarks/face';
import type { FaceDetector } from '../../src/domain/ports/face-detector';
import { APP_ROOT } from '../support/source-scan';

function points(count = FACE_LANDMARK_COUNT) {
  return Array.from({ length: count }, (_, i) => ({ x: i / count, y: 0.5, z: 0 }));
}

describe('faceFrame', () => {
  it('accepts exactly FACE_LANDMARK_COUNT finite points on a real surface', () => {
    const frame = faceFrame(points(), 12, 1280, 720);
    expect(frame.points).toHaveLength(FACE_LANDMARK_COUNT);
    expect(frame.timestampMs).toBe(12);
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
  });

  it('rejects one point too few and one too many', () => {
    expect(() => faceFrame(points(FACE_LANDMARK_COUNT - 1), 0, 10, 10)).toThrow(FaceFrameError);
    expect(() => faceFrame(points(FACE_LANDMARK_COUNT + 1), 0, 10, 10)).toThrow(FaceFrameError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite coordinate (%s)',
    (bad) => {
      const p = points();
      p[3] = { x: bad, y: 0.5, z: 0 };
      expect(() => faceFrame(p, 0, 10, 10)).toThrow(FaceFrameError);
      const q = points();
      q[3] = { x: 0.5, y: 0.5, z: bad };
      expect(() => faceFrame(q, 0, 10, 10)).toThrow(FaceFrameError);
    },
  );

  it('rejects a zero, negative or non-finite surface size and a non-finite timestamp', () => {
    expect(() => faceFrame(points(), 0, 0, 720)).toThrow(FaceFrameError);
    expect(() => faceFrame(points(), 0, 1280, -1)).toThrow(FaceFrameError);
    expect(() => faceFrame(points(), 0, Number.NaN, 720)).toThrow(FaceFrameError);
    expect(() => faceFrame(points(), Number.NaN, 1280, 720)).toThrow(FaceFrameError);
  });

  it('carries no field other than points, timestamp and surface size (geometry only)', () => {
    expect(Object.keys(faceFrame(points(), 0, 10, 10)).sort()).toEqual([
      'height',
      'points',
      'timestampMs',
      'width',
    ]);
  });
});

describe('FaceDetector', () => {
  it('returns a FaceFrame or null, and close() is idempotent', () => {
    let closed = false;
    const frame = faceFrame(points(), 1, 10, 10);
    const detector: FaceDetector = {
      detect: (_surface, timestampMs): FaceFrame | null => (timestampMs > 0 ? frame : null),
      close: () => {
        closed = true; // idempotent: a second call changes nothing
      },
    };
    const surface = { width: 10, height: 10, image: null, update: () => true };
    expect(detector.detect(surface, 0)).toBeNull();
    expect(detector.detect(surface, 1)).toBe(frame);
    expect(() => {
      detector.close();
      detector.close();
    }).not.toThrow();
    expect(closed).toBe(true);
  });
});

describe('FACE_LANDMARK_COUNT is the only home of the count', () => {
  it('face.ts defines the count once and every other use goes through the constant', () => {
    const source = readFileSync(join(APP_ROOT, 'src/domain/landmarks/face.ts'), 'utf-8');
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const literals = stripped.match(new RegExp(`\\b${FACE_LANDMARK_COUNT}\\b`, 'g')) ?? [];
    expect(literals).toHaveLength(1); // the single definition
  });
});
