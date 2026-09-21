/**
 * `MediaPipeFaceDetector` — the only file allowed to name MediaPipe face symbols (Spec 011
 * FR-011, 022, 022a, 027).
 *
 * `@mediapipe/tasks-vision` is mocked for the factory, and a structural fake landmarker stands in
 * for the class: this is a test of the *wrapping* (guards, options, timestamps), not of
 * MediaPipe's WASM runtime, which cannot run in jsdom. What the model itself returns is verified
 * separately, by a human, against the pinned artifact (Definition of Done).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Logger } from '../../src/domain/config/logger';
import type { LogFields, LogLevel } from '../../src/domain/config/logger';
import { FACE_LANDMARK_COUNT } from '../../src/domain/landmarks/face';
import { DetectorError } from '../../src/domain/ports/detector';

const forVisionTasks = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const createFromOptions = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: (...args: unknown[]) => forVisionTasks(...args) },
  FaceLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
}));

const {
  DEFAULT_FACE_DETECTOR_CONFIG,
  FACE_MODEL_URL,
  MediaPipeFaceDetector,
  createMediaPipeFaceDetector,
} = await import('../../src/infrastructure/detection/mediapipe-face-detector');

type Point = { x: number; y: number; z: number };

function points(count = FACE_LANDMARK_COUNT, offset = 0): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: (i % 100) / 100 + offset, y: 0.5, z: 0 }));
}

const surface = { width: 1280, height: 720, image: {} as unknown, update: () => true };

function capturingLogger() {
  const records: { level: LogLevel; message: string; fields: LogFields }[] = [];
  const logger = new Logger('debug', (level, message, fields) =>
    records.push({ level, message, fields }),
  );
  return { logger, warns: () => records.filter((r) => r.level === 'warn') };
}

/** A landmarker whose result has one readable property; touching any other one throws. */
function fakeLandmarker(faces: () => Point[][]) {
  const timestamps: number[] = [];
  const landmarker = {
    detectForVideo: (_image: unknown, timestampMs: number) => {
      timestamps.push(timestampMs);
      return new Proxy(
        { faceLandmarks: faces() },
        {
          get(target, key) {
            if (key === 'faceLandmarks') {
              return target.faceLandmarks;
            }
            throw new Error('the adapter read result.' + String(key));
          },
        },
      );
    },
    close: vi.fn(),
  };
  return { landmarker, timestamps };
}

beforeEach(() => {
  forVisionTasks.mockReset();
  createFromOptions.mockReset();
});

describe('what leaves the adapter', () => {
  it('is a FaceFrame built from the first face, sized by the surface, and nothing else is read', () => {
    const { landmarker } = fakeLandmarker(() => [
      points(FACE_LANDMARK_COUNT),
      points(FACE_LANDMARK_COUNT, 0.3),
    ]);
    const detector = new MediaPipeFaceDetector(landmarker);

    const frame = detector.detect(surface, 100);

    expect(frame).not.toBeNull();
    expect(frame!.points).toHaveLength(FACE_LANDMARK_COUNT);
    expect(frame!.points[5]).toEqual(points()[5]); // the first face, not the second
    expect(frame!.width).toBe(1280);
    expect(frame!.height).toBe(720);
  });

  it('returns null, without a warning, when the model finds no face', () => {
    const { logger, warns } = capturingLogger();
    const detector = new MediaPipeFaceDetector(fakeLandmarker(() => []).landmarker, logger);
    expect(detector.detect(surface, 1)).toBeNull();
    expect(warns()).toHaveLength(0);
  });
});

describe('the landmark-count guard (FR-011)', () => {
  it('treats a wrong count as no face and warns once per run of failures', () => {
    const { logger, warns } = capturingLogger();
    const { landmarker } = fakeLandmarker(() => [points(FACE_LANDMARK_COUNT - 10)]);
    const detector = new MediaPipeFaceDetector(landmarker, logger);

    expect(detector.detect(surface, 1)).toBeNull();
    expect(detector.detect(surface, 2)).toBeNull();
    expect(detector.detect(surface, 3)).toBeNull();
    expect(warns()).toHaveLength(1);
    expect(warns()[0]!.fields).toMatchObject({
      expected: FACE_LANDMARK_COUNT,
      received: FACE_LANDMARK_COUNT - 10,
    });
  });
});

describe('a throwing landmarker (FR-022)', () => {
  it('yields null, never throws, warns once per streak, and reports again after a success', () => {
    const { logger, warns } = capturingLogger();
    let mode: 'throw' | 'ok' = 'throw';
    const landmarker = {
      detectForVideo: () => {
        if (mode === 'throw') {
          throw new Error('inference failed');
        }
        return { faceLandmarks: [points()] };
      },
      close: vi.fn(),
    };
    const detector = new MediaPipeFaceDetector(landmarker, logger);

    expect(() => detector.detect(surface, 1)).not.toThrow();
    expect(detector.detect(surface, 2)).toBeNull();
    expect(warns()).toHaveLength(1);

    mode = 'ok';
    expect(detector.detect(surface, 3)).not.toBeNull();

    mode = 'throw';
    expect(detector.detect(surface, 4)).toBeNull();
    expect(warns()).toHaveLength(2); // a new streak is reported again
  });
});

describe('timestamps (FR-022a)', () => {
  it('reach the library strictly increasing whatever the callers supply', () => {
    const { landmarker, timestamps } = fakeLandmarker(() => []);
    const detector = new MediaPipeFaceDetector(landmarker);
    for (const t of [100, 100, 90, 250]) {
      detector.detect(surface, t);
    }
    expect(timestamps).toEqual([100, 101, 102, 250]);
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i]!).toBeGreaterThan(timestamps[i - 1]!);
    }
  });
});

describe('close', () => {
  it('is idempotent, terminal, and closes the landmarker once', () => {
    const { landmarker } = fakeLandmarker(() => [points()]);
    const detector = new MediaPipeFaceDetector(landmarker);
    detector.close();
    detector.close();
    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(detector.detect(surface, 1)).toBeNull();
  });
});

describe('createMediaPipeFaceDetector', () => {
  it('asks the model for landmarks only: one face, video mode, no blendshapes, no matrices', async () => {
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockResolvedValue({ detectForVideo: vi.fn(), close: vi.fn() });

    await createMediaPipeFaceDetector({ wasmPath: '/mediapipe-wasm' });

    const options = createFromOptions.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['runningMode']).toBe('VIDEO');
    expect(options['numFaces']).toBe(1);
    expect(options['outputFaceBlendshapes']).toBe(false);
    expect(options['outputFacialTransformationMatrixes']).toBe(false);
    expect(options['minFaceDetectionConfidence']).toBe(
      DEFAULT_FACE_DETECTOR_CONFIG.minFaceDetectionConfidence,
    );
    expect(options['baseOptions']).toEqual({ modelAssetPath: FACE_MODEL_URL });
  });

  it('rejects with unsupportedBrowser when the WASM fileset cannot load', async () => {
    forVisionTasks.mockRejectedValue(new Error('no WASM support'));
    const error = await createMediaPipeFaceDetector({ wasmPath: '/w' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DetectorError);
    expect((error as DetectorError).reason).toBe('unsupportedBrowser');
  });

  it('rejects with modelUnavailable when the model is absent — the normal default state', async () => {
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockRejectedValue(new Error('404'));
    const error = await createMediaPipeFaceDetector({ wasmPath: '/w' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DetectorError);
    expect((error as DetectorError).reason).toBe('modelUnavailable');
    expect((error as DetectorError).message).toContain(FACE_MODEL_URL);
  });
});

describe('adapter diagnostics (Amendment A FR-038)', () => {
  const build = (faces: () => Point[][]) =>
    new MediaPipeFaceDetector(fakeLandmarker(faces).landmarker as never, capturingLogger().logger);

  it('starts as none-yet and records a found face with its count', () => {
    const detector = build(() => [points()]);
    expect(detector.diagnostics()).toEqual({ outcome: 'none-yet', pointCount: null, atMs: null });
    detector.detect(surface as never, 10);
    expect(detector.diagnostics()).toEqual({
      outcome: 'face',
      pointCount: FACE_LANDMARK_COUNT,
      atMs: 10,
    });
  });

  it('records no-face, and a count mismatch WITH the received count (not as "no face")', () => {
    let faces: Point[][] = [];
    const detector = build(() => faces);
    detector.detect(surface as never, 10);
    expect(detector.diagnostics().outcome).toBe('no-face');
    faces = [points(468)];
    detector.detect(surface as never, 20);
    expect(detector.diagnostics()).toMatchObject({ outcome: 'count-mismatch', pointCount: 468 });
  });

  it('records error, and the status holds only scalars — never points', () => {
    const detector = build(() => {
      throw new Error('boom');
    });
    detector.detect(surface as never, 10);
    const status = detector.diagnostics();
    expect(status.outcome).toBe('error');
    expect(Object.keys(status).sort()).toEqual(['atMs', 'outcome', 'pointCount']);
  });
});
