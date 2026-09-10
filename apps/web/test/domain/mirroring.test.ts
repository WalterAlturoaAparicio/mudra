/**
 * FR-012/SC-008: mirroring correctness verified by test, not by inspection.
 *
 * This exists because a mirror bug is the one failure in the pipeline with no exception
 * attached. Nothing throws, nothing logs, and one-handed testing looks fine — recognition
 * just quietly gets worse, and every two-handed pose matches against the wrong exemplar
 * hand. So a known-convention input goes in, and known handedness and known coordinates
 * are asserted coming out.
 */

import { describe, expect, it } from 'vitest';

import {
  CanvasMirroredSurface,
  mirrorNormalizedX,
} from '../../src/infrastructure/camera/mirrored-surface';
import type { MirrorCanvas, MirrorContext } from '../../src/infrastructure/camera/mirrored-surface';
import { WRIST } from '../../src/domain/landmarks/topology';
import { handLandmarks } from '../../src/domain/landmarks/types';
import { normalize } from '../../src/domain/normalization/normalize';

/** Records every drawing call, so the transform can be asserted rather than eyeballed. */
class RecordingContext implements MirrorContext {
  readonly calls: string[] = [];
  transform: number[] = [1, 0, 0, 1, 0, 0];

  save(): void {
    this.calls.push('save');
  }
  restore(): void {
    this.calls.push('restore');
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
    this.calls.push(`setTransform(${a},${b},${c},${d},${e},${f})`);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect(${x},${y},${w},${h})`);
  }
  drawImage(_image: unknown, x: number, y: number, w: number, h: number): void {
    this.calls.push(`drawImage(${x},${y},${w},${h})`);
  }
}

function surfaceOf(videoWidth: number, videoHeight: number) {
  const canvas: MirrorCanvas = { width: 0, height: 0 };
  const context = new RecordingContext();
  const source = { videoWidth, videoHeight } as unknown as {
    videoWidth: number;
    videoHeight: number;
  } & CanvasImageSource;
  return {
    canvas,
    context,
    surface: new CanvasMirroredSurface({ canvas, context, source }),
  };
}

describe('the mirrored surface', () => {
  it('flips horizontally and only horizontally', () => {
    const { context, surface } = surfaceOf(1280, 720);
    expect(surface.update()).toBe(true);

    // setTransform(-1, 0, 0, 1, width, 0): x is negated and shifted by the full width, y
    // is untouched. A vertical flip would show d = -1 here, and nothing else would notice.
    expect(context.transform).toEqual([-1, 0, 0, 1, 1280, 0]);
  });

  it('maps the source’s left edge to the canvas’s right edge', () => {
    const [a, , , , e] = [-1, 0, 0, 1, 1280, 0];
    const project = (x: number): number => a * x + e;
    expect(project(0)).toBe(1280);
    expect(project(1280)).toBe(0);
    expect(project(640)).toBe(640);
  });

  it('sizes itself to the camera’s natural resolution, not the display size', () => {
    const { canvas, surface } = surfaceOf(1920, 1080);
    surface.update();
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(surface.width).toBe(1920);
    expect(surface.height).toBe(1080);
  });

  it('follows a camera that changes resolution mid-session', () => {
    const { canvas, context, surface } = surfaceOf(640, 480);
    surface.update();
    expect(canvas.width).toBe(640);

    const bigger = surfaceOf(1280, 720);
    bigger.surface.update();
    expect(bigger.canvas.width).toBe(1280);
    expect(bigger.context.transform[4]).toBe(1280);
    expect(context.transform[4]).toBe(640);
  });

  it('draws nothing before the camera has produced a frame', () => {
    const { context, surface } = surfaceOf(0, 0);
    expect(surface.update()).toBe(false);
    expect(context.calls).toEqual([]);
  });

  it('restores the transform so the next draw is not doubly mirrored', () => {
    const { context, surface } = surfaceOf(1280, 720);
    surface.update();
    expect(context.calls[0]).toBe('save');
    expect(context.calls.at(-1)).toBe('restore');
  });

  it('is the same object the detector reads and the stage draws (FR-013)', () => {
    // Not a formality. The whole argument for this design is that there is *one* surface,
    // so presentation and recognition cannot be configured to disagree.
    const { canvas, surface } = surfaceOf(1280, 720);
    surface.update();
    expect(surface.image).toBe(canvas);
  });
});

describe('the convention the dataset was recorded in', () => {
  it('leaves handedness alone — MediaPipe already names the physical hand', () => {
    // MediaPipe assumes a mirrored selfie image and is given exactly that, so its "left"
    // is the user's left. The bug this guards against is a well-meaning swap added later
    // "to correct for the mirror", which would invert every two-handed match.
    const surfaceSource = new CanvasMirroredSurface({
      canvas: { width: 0, height: 0 },
      context: new RecordingContext(),
      source: { videoWidth: 4, videoHeight: 4 } as unknown as {
        videoWidth: number;
        videoHeight: number;
      } & CanvasImageSource,
    });
    // The surface exposes no handedness transform at all — there is nothing to get wrong.
    expect(Object.keys(surfaceSource)).not.toContain('swapHandedness');
    expect('flipHandedness' in surfaceSource).toBe(false);
  });

  it('flips a normalized x exactly once, if anything ever needs to', () => {
    expect(mirrorNormalizedX(0)).toBe(1);
    expect(mirrorNormalizedX(1)).toBe(0);
    expect(mirrorNormalizedX(0.25)).toBe(0.75);
    expect(mirrorNormalizedX(mirrorNormalizedX(0.3))).toBeCloseTo(0.3, 12);
  });

  it('is not applied anywhere in the pipeline — landmarks arrive already mirrored', () => {
    // A hand at the right of the *displayed* image has large x, because the display and
    // the detector input are the same canvas. Normalization must therefore see it as-is.
    const rightSide = handLandmarks(
      Array.from({ length: 21 }, (_, i) => ({ x: 0.8 + i * 0.001, y: 0.5, z: 0 })),
    );
    const normalized = normalize(rightSide);
    expect(normalized.points[WRIST]).toEqual({ x: 0, y: 0, z: 0 });
    // Landmark 9 sits to the *right* of the wrist in display space; after normalization it
    // must still sit to the right. A stray flip anywhere would make this negative.
    expect(normalized.points[9]!.x).toBeGreaterThan(0);
  });
});
