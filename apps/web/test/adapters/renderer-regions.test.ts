/**
 * Region compositing in the renderer (items 2 and 3), plus per-particle opacity (item 4).
 *
 * Same shape as `renderer.test.ts`: a fixed command list in, recorded drawing calls out. What
 * these add is the **offscreen buffer** the region commands paint through, because that buffer
 * is the whole reason "everything except the person" is expressible at all: Canvas2D cannot
 * invert a mask, and inverting one by hand would mean reading pixels back (`getImageData`),
 * which `test/architecture/privacy.test.ts` prohibits everywhere. The buffer inverts by
 * compositing — paint, then `destination-out` the mask — and reads nothing.
 *
 * The recorded composite operations are therefore the assertion that matters: `destination-in`
 * clips to the person, `destination-out` clips to everything else.
 */

import { describe, expect, it } from 'vitest';

import { Canvas2DRenderer, fitRect } from '../../src/presentation/renderer/canvas2d-renderer';
import type {
  RegionBuffer,
  RegionBufferContext,
  Renderer2DContext,
} from '../../src/presentation/renderer/canvas2d-renderer';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';

class RecordingContext implements Renderer2DContext {
  readonly calls: string[] = [];
  canvas = { width: 800, height: 600 };
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  lineWidth = 1;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';

  save(): void {
    this.calls.push('save');
  }
  restore(): void {
    this.calls.push('restore');
  }
  clearRect(): void {
    this.calls.push('clearRect');
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect(${x},${y},${w},${h}) style=${String(this.fillStyle)}`);
  }
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void {
    this.calls.push(
      `drawImage(${String((image as { name?: string }).name)},${x},${y},${w},${h}) alpha=${this.globalAlpha} blend=${this.globalCompositeOperation}`,
    );
  }
  beginPath(): void {
    this.calls.push('beginPath');
  }
  moveTo(): void {}
  lineTo(): void {}
  arc(x: number, y: number, r: number): void {
    this.calls.push(`arc(${x},${y},${r}) alpha=${this.globalAlpha}`);
  }
  fill(): void {
    this.calls.push(`fill() style=${String(this.fillStyle)} alpha=${this.globalAlpha}`);
  }
  stroke(): void {}
}

class RecordingBuffer implements RegionBuffer {
  width = 0;
  height = 0;
  readonly calls: string[] = [];
  readonly surface = { name: 'buffer' };

  private readonly context: RegionBufferContext = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    clearRect: () => this.calls.push('clearRect'),
    fillRect: (x, y, w, h) =>
      this.calls.push(`fillRect(${x},${y},${w},${h}) style=${String(this.context.fillStyle)}`),
    drawImage: (image, x, y, w, h) =>
      this.calls.push(
        `drawImage(${String((image as { name?: string }).name)},${x},${y},${w},${h}) blend=${this.context.globalCompositeOperation}`,
      ),
  };

  getBufferContext(): RegionBufferContext {
    return this.context;
  }
  asImageSource(): CanvasImageSource {
    return this.surface as unknown as CanvasImageSource;
  }
}

const MASK = { name: 'mask' } as unknown as CanvasImageSource;
const IMAGE = { name: 'image', naturalWidth: 400, naturalHeight: 300 } as unknown as CanvasImageSource;

function build(options: { mask?: CanvasImageSource | null; withBuffer?: boolean } = {}) {
  const context = new RecordingContext();
  const buffer = new RecordingBuffer();
  const renderer = new Canvas2DRenderer(
    context,
    options.withBuffer === false ? {} : { regionBuffer: buffer },
  );
  renderer.setPersonMask(options.mask === undefined ? MASK : options.mask);
  renderer.setImageProvider((source) => (source === 'blob:image' ? IMAGE : null));
  return { context, buffer, renderer };
}

function render(renderer: Canvas2DRenderer, commands: readonly RenderCommand[]): void {
  renderer.render(commands);
}

describe('fillMaskedRegion', () => {
  it('clips a colour to the PERSON region with destination-in', () => {
    const { renderer, buffer, context } = build();
    render(renderer, [
      { kind: 'fillMaskedRegion', region: 'person', color: '#ff0000', alpha: 0.5 },
    ]);

    expect(buffer.calls).toEqual([
      'clearRect',
      'fillRect(0,0,800,600) style=#ff0000',
      'drawImage(mask,0,0,800,600) blend=destination-in',
    ]);
    expect(context.calls).toContain('drawImage(buffer,0,0,800,600) alpha=0.5 blend=source-over');
  });

  it('clips a colour to the BACKGROUND region with destination-out — the person is untouched', () => {
    const { renderer, buffer } = build();
    render(renderer, [
      { kind: 'fillMaskedRegion', region: 'background', color: '#00ff00', alpha: 1 },
    ]);

    expect(buffer.calls).toContain('drawImage(mask,0,0,800,600) blend=destination-out');
  });

  it('draws nothing at all when there is no mask — never a full-frame fill (FR-046)', () => {
    const { renderer, context, buffer } = build({ mask: null });
    render(renderer, [
      { kind: 'fillMaskedRegion', region: 'background', color: '#00ff00', alpha: 1 },
    ]);

    expect(buffer.calls).toEqual([]);
    expect(context.calls).toEqual([]);
  });

  it('draws nothing when no region buffer was supplied', () => {
    const { renderer, context } = build({ withBuffer: false });
    render(renderer, [{ kind: 'fillMaskedRegion', region: 'person', color: '#fff', alpha: 1 }]);
    expect(context.calls).toEqual([]);
  });
});

describe('drawMaskedImage', () => {
  it('paints the image into the buffer and clips it to the region', () => {
    const { renderer, buffer, context } = build();
    render(renderer, [
      { kind: 'drawMaskedImage', region: 'background', source: 'blob:image', alpha: 1, fit: 'stretch' },
    ]);

    expect(buffer.calls).toEqual([
      'clearRect',
      'drawImage(image,0,0,800,600) blend=source-over',
      'drawImage(mask,0,0,800,600) blend=destination-out',
    ]);
    expect(context.calls).toContain('drawImage(buffer,0,0,800,600) alpha=1 blend=source-over');
  });

  it('draws nothing while the image is still loading', () => {
    const { renderer, buffer, context } = build();
    render(renderer, [
      { kind: 'drawMaskedImage', region: 'person', source: 'blob:not-yet', alpha: 1, fit: 'cover' },
    ]);
    expect(buffer.calls).toEqual([]);
    expect(context.calls).toEqual([]);
  });
});

describe('fit modes', () => {
  it('stretch fills the surface exactly', () => {
    expect(fitRect(IMAGE, 800, 600, 'stretch')).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('cover fills the surface and overflows on one axis', () => {
    const rect = fitRect(IMAGE, 800, 600, 'cover');
    expect(rect.width).toBeGreaterThanOrEqual(800);
    expect(rect.height).toBeGreaterThanOrEqual(600);
  });

  it('contain fits inside the surface and letterboxes', () => {
    const rect = fitRect(IMAGE, 800, 600, 'contain');
    expect(rect.width).toBeLessThanOrEqual(800);
    expect(rect.height).toBeLessThanOrEqual(600);
    expect(rect.x + rect.width / 2).toBeCloseTo(400, 5);
  });
});

describe('maskedErase', () => {
  it('erases the person directly, with no buffer pass — unchanged from before', () => {
    const { renderer, buffer, context } = build();
    render(renderer, [{ kind: 'maskedErase', region: 'person', alpha: 0.75 }]);

    expect(buffer.calls).toEqual([]);
    expect(context.calls).toContain('drawImage(mask,0,0,800,600) alpha=0.75 blend=destination-out');
  });

  it('erases the background through the buffer’s inverted coverage', () => {
    const { renderer, buffer, context } = build();
    render(renderer, [{ kind: 'maskedErase', region: 'background', alpha: 1 }]);

    expect(buffer.calls).toEqual([
      'clearRect',
      'fillRect(0,0,800,600) style=#ffffff',
      'drawImage(mask,0,0,800,600) blend=destination-out',
    ]);
    expect(context.calls).toContain(
      'drawImage(buffer,0,0,800,600) alpha=1 blend=destination-out',
    );
  });
});

describe('per-point opacity in drawCircles (item 4)', () => {
  it('without alphas, one path for the whole batch — unchanged', () => {
    const { renderer, context } = build();
    render(renderer, [
      {
        kind: 'drawCircles',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        radii: [3, 4],
        color: '#fff',
        alpha: 0.5,
      },
    ]);
    expect(context.calls.filter((call) => call === 'beginPath')).toHaveLength(1);
  });

  it('with alphas, each particle is filled at its own opacity — still one command', () => {
    const { renderer, context } = build();
    render(renderer, [
      {
        kind: 'drawCircles',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        radii: [3, 4],
        color: '#fff',
        alpha: 1,
        alphas: [0.25, 1],
      },
    ]);
    expect(context.calls).toContain('fill() style=#fff alpha=0.25');
    expect(context.calls).toContain('fill() style=#fff alpha=1');
  });

  it('skips a particle whose effective opacity is zero', () => {
    const { renderer, context } = build();
    render(renderer, [
      {
        kind: 'drawCircles',
        points: [{ x: 1, y: 1 }],
        radii: [3],
        color: '#fff',
        alpha: 1,
        alphas: [0],
      },
    ]);
    expect(context.calls.filter((call) => call.startsWith('fill('))).toEqual([]);
  });
});
