/**
 * `MediaPipePersonSegmenter` — construction success/failure and `segment()`'s return shape
 * (T052a, C1 remediation).
 *
 * `@mediapipe/tasks-vision` is mocked: this is an adapter test of the *wrapping*, not of
 * MediaPipe's WASM runtime, which cannot run in jsdom. Domain-level tests
 * (`test/domain/capability-segmentation.test.ts`) already cover `probeCapabilities()`'s own
 * success/failure handling against a fake `PersonSegmenter` port implementation — this file
 * is the adapter layer underneath that fake, tested for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const forVisionTasks = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const createFromOptions = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: (...args: unknown[]) => forVisionTasks(...args) },
  ImageSegmenter: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
}));

const { createMediaPipePersonSegmenter } = await import(
  '../../src/infrastructure/segmentation/mediapipe-person-segmenter'
);

function fakeMask(width: number, height: number, value: number) {
  return {
    width,
    height,
    getAsFloat32Array: () => new Float32Array(width * height).fill(value),
    close: vi.fn(),
  };
}

beforeEach(() => {
  forVisionTasks.mockReset();
  createFromOptions.mockReset();
});

describe('createMediaPipePersonSegmenter — success', () => {
  it('resolves to a PersonSegmenter when the model and fileset both load', async () => {
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockResolvedValue({ segmentForVideo: vi.fn(), close: vi.fn() });

    const segmenter = await createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' });
    expect(segmenter).toBeDefined();
    expect(typeof segmenter.segment).toBe('function');
    expect(typeof segmenter.close).toBe('function');
  });
});

describe('createMediaPipePersonSegmenter — failure', () => {
  it('rejects when the WASM fileset cannot load (unsupported browser)', async () => {
    forVisionTasks.mockRejectedValue(new Error('no WASM support'));
    await expect(
      createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' }),
    ).rejects.toThrow('no WASM support');
  });

  it('rejects when the model itself cannot load (fetch failure)', async () => {
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockRejectedValue(new Error('404'));
    await expect(
      createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' }),
    ).rejects.toThrow('404');
  });
});

describe('segment()', () => {
  it('returns a well-shaped SegmentationFrame when a confidence mask is present', async () => {
    // jsdom does not implement a real canvas 2D context (no `canvas` npm package here), so
    // the one call this adapter makes to it — writing the mask via `putImageData` — is
    // stubbed, the same way `test/adapters/renderer.test.ts` fakes `Renderer2DContext`
    // rather than pull in a native canvas dependency for this one path.
    const putImageData = vi.fn();
    const createImageData = vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData,
      createImageData,
    } as unknown as CanvasRenderingContext2D);

    const segmentForVideo = vi.fn().mockReturnValue({
      confidenceMasks: [fakeMask(4, 3, 0.8)],
      close: vi.fn(),
    });
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockResolvedValue({ segmentForVideo, close: vi.fn() });

    const segmenter = await createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' });
    const surface = { width: 4, height: 3, image: {}, update: () => true };
    const frame = segmenter.segment(surface, 1000);

    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(4);
    expect(frame?.height).toBe(3);
    expect(frame?.mask).toBeDefined();
    expect(segmentForVideo).toHaveBeenCalledWith(surface.image, 1000);
    expect(putImageData).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });

  it('returns null when the result carries no confidence mask', async () => {
    const segmentForVideo = vi.fn().mockReturnValue({ confidenceMasks: undefined, close: vi.fn() });
    forVisionTasks.mockResolvedValue({});
    createFromOptions.mockResolvedValue({ segmentForVideo, close: vi.fn() });

    const segmenter = await createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' });
    const surface = { width: 4, height: 3, image: {}, update: () => true };
    expect(segmenter.segment(surface, 1000)).toBeNull();
  });

  it('returns null after close()', async () => {
    const segmentForVideo = vi.fn().mockReturnValue({
      confidenceMasks: [fakeMask(2, 2, 0.5)],
      close: vi.fn(),
    });
    forVisionTasks.mockResolvedValue({});
    const underlyingClose = vi.fn();
    createFromOptions.mockResolvedValue({ segmentForVideo, close: underlyingClose });

    const segmenter = await createMediaPipePersonSegmenter({ wasmPath: '/mediapipe-wasm' });
    segmenter.close();
    expect(underlyingClose).toHaveBeenCalledOnce();

    const surface = { width: 2, height: 2, image: {}, update: () => true };
    expect(segmenter.segment(surface, 1000)).toBeNull();
  });
});
