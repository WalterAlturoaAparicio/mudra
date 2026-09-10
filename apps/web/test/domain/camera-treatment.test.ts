/**
 * Camera treatment never touches the imagery detection receives (T065, FR-051).
 *
 * `applyCameraTreatment` is parameterized over its context/canvas — no real DOM needed — so
 * this runs in Node and proves the guarantee structurally: the function reads `source` and
 * writes only to the **separate** canvas it is given; it is never handed, and could not
 * mutate, the `MirroredSurface`/`LandmarkFrame` detection already consumed this frame.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CAMERA_TREATMENT } from '../../src/domain/editor/types';
import type { CameraTreatmentSettings } from '../../src/domain/editor/types';
import {
  applyCameraTreatment,
  isIdentityTreatment,
} from '../../src/presentation/stage/camera-treatment';
import type {
  TreatmentCanvas,
  TreatmentContext,
} from '../../src/presentation/stage/camera-treatment';

/** A distinct marker object, standing in for the real `<canvas>` `Stage`'s wrapper draws into —
 *  never the wrapper (`canvas`) itself, which is the P0.2 regression this file guards against. */
const DRAWABLE_MARKER = { marker: 'the-real-offscreen-canvas' } as unknown as CanvasImageSource;

function fakeCanvas(): { canvas: TreatmentCanvas; drawCalls: unknown[][]; filters: string[] } {
  const drawCalls: unknown[][] = [];
  const filters: string[] = [];
  let width = 0;
  let height = 0;
  const context: TreatmentContext = {
    get filter() {
      return filters[filters.length - 1] ?? 'none';
    },
    set filter(value: string) {
      filters.push(value);
    },
    drawImage: (...args) => {
      drawCalls.push(args);
    },
    clearRect: () => {},
  };
  const canvas: TreatmentCanvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
    },
    getTreatmentContext: () => context,
    asImageSource: () => DRAWABLE_MARKER,
  };
  return { canvas, drawCalls, filters };
}

describe('isIdentityTreatment', () => {
  it('is true for the default settings', () => {
    expect(isIdentityTreatment(DEFAULT_CAMERA_TREATMENT)).toBe(true);
  });

  it('is false when any adjustment differs from the identity', () => {
    expect(isIdentityTreatment({ ...DEFAULT_CAMERA_TREATMENT, brightness: 0.2 })).toBe(false);
    expect(isIdentityTreatment({ ...DEFAULT_CAMERA_TREATMENT, zoom: 2 })).toBe(false);
    expect(
      isIdentityTreatment({ ...DEFAULT_CAMERA_TREATMENT, crop: { x: 0, y: 0, w: 1, h: 1 } }),
    ).toBe(false);
  });
});

describe('applyCameraTreatment', () => {
  it('returns the source unchanged for the identity transform — no offscreen work at all', () => {
    const { canvas, drawCalls } = fakeCanvas();
    const source = { marker: 'source' } as unknown as CanvasImageSource;
    const result = applyCameraTreatment(source, DEFAULT_CAMERA_TREATMENT, canvas, 640, 480);
    expect(result).toBe(source);
    expect(drawCalls).toHaveLength(0);
  });

  it('draws into the separate canvas, never mutating the source object', () => {
    const { canvas, drawCalls } = fakeCanvas();
    const source = { marker: 'source' } as unknown as CanvasImageSource;
    const before = JSON.stringify(source);

    const settings: CameraTreatmentSettings = { ...DEFAULT_CAMERA_TREATMENT, brightness: 0.3 };
    const result = applyCameraTreatment(source, settings, canvas, 640, 480);

    expect(JSON.stringify(source)).toBe(before); // untouched
    expect(result).not.toBe(source); // a different image is returned for display
    expect(drawCalls).toHaveLength(1);
  });

  it('P0.2 regression: with a real source and a non-identity treatment, returns the drawable — never the TreatmentCanvas wrapper itself', () => {
    // `canvas` (the fake's `TreatmentCanvas`) is a plain object satisfying the interface, the
    // same shape `Stage`'s own wrapper is — not a CanvasImageSource. Before the fix,
    // `applyCameraTreatment` cast and returned that wrapper directly; `drawImage` cannot draw
    // it, which is exactly the reported TypeError. `asImageSource()` is the one honest escape
    // hatch to the real drawable.
    const { canvas } = fakeCanvas();
    const source = { marker: 'source' } as unknown as CanvasImageSource;
    const settings: CameraTreatmentSettings = { ...DEFAULT_CAMERA_TREATMENT, brightness: 0.3 };
    const result = applyCameraTreatment(source, settings, canvas, 640, 480);
    expect(result).toBe(DRAWABLE_MARKER);
    expect(result).not.toBe(canvas);
  });

  it('applies a brightness/contrast/saturation filter string, never a camera-device request', () => {
    const { canvas, filters } = fakeCanvas();
    const settings: CameraTreatmentSettings = {
      ...DEFAULT_CAMERA_TREATMENT,
      brightness: 0.5,
      contrast: -0.2,
      saturation: 0.1,
    };
    applyCameraTreatment({} as CanvasImageSource, settings, canvas, 100, 100);
    expect(filters[0]).toContain('brightness(1.5)');
    expect(filters[0]).toContain('contrast(0.8');
    expect(filters[0]).toContain('saturate(1.1)');
  });

  it('returns null unchanged for a non-identity treatment when no source is available yet — never reaches drawImage with an invalid source', () => {
    const { canvas, drawCalls } = fakeCanvas();
    const settings: CameraTreatmentSettings = { ...DEFAULT_CAMERA_TREATMENT, brightness: 0.3 };
    const result = applyCameraTreatment(null, settings, canvas, 640, 480);
    expect(result).toBeNull();
    expect(drawCalls).toHaveLength(0);
  });

  it('crops via a source rectangle, computed from the settings, not the device', () => {
    const { canvas, drawCalls } = fakeCanvas();
    const settings: CameraTreatmentSettings = {
      ...DEFAULT_CAMERA_TREATMENT,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    };
    applyCameraTreatment({} as CanvasImageSource, settings, canvas, 400, 200);
    const [, sx, sy, sw, sh] = drawCalls[0]!;
    expect(sx).toBe(100); // 0.25 * 400
    expect(sy).toBe(50); // 0.25 * 200
    expect(sw).toBe(200); // 0.5 * 400
    expect(sh).toBe(100); // 0.5 * 200
  });
});
