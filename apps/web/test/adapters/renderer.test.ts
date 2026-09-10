/**
 * The renderer consumes the vocabulary, and nothing else.
 *
 * A fixed command list goes in; the expected drawing calls come out of a recording fake
 * context. That shape is the assertion: a renderer that reached back into effect state to
 * decide what to draw could not pass a test whose only input is a list of commands.
 */

import { describe, expect, it } from 'vitest';

import { Canvas2DRenderer } from '../../src/presentation/renderer/canvas2d-renderer';
import type { Renderer2DContext } from '../../src/presentation/renderer/canvas2d-renderer';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';

/** Records every call and every style assignment, in order. */
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
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect(${x},${y},${w},${h})`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(
      `fillRect(${x},${y},${w},${h}) style=${String(this.fillStyle)} alpha=${this.globalAlpha} blend=${this.globalCompositeOperation}`,
    );
  }
  drawImage(_image: unknown, x: number, y: number, w: number, h: number): void {
    this.calls.push(
      `drawImage(${x},${y},${w},${h}) alpha=${this.globalAlpha} blend=${this.globalCompositeOperation}`,
    );
  }
  beginPath(): void {
    this.calls.push('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo(${x},${y})`);
  }
  arc(x: number, y: number, r: number): void {
    this.calls.push(`arc(${x},${y},${r})`);
  }
  fill(): void {
    this.calls.push(`fill() style=${String(this.fillStyle)}`);
  }
  stroke(): void {
    this.calls.push(`stroke() style=${String(this.strokeStyle)} width=${this.lineWidth}`);
  }
}

function render(commands: readonly RenderCommand[], withCamera = true, withPersonMask = false) {
  const context = new RecordingContext();
  const renderer = new Canvas2DRenderer(context);
  if (withCamera) {
    renderer.setCameraImage({} as CanvasImageSource);
  }
  if (withPersonMask) {
    renderer.setPersonMask({} as CanvasImageSource);
  }
  renderer.render(commands);
  return context;
}

describe('the six commands', () => {
  it('clear wipes the whole surface', () => {
    expect(render([{ kind: 'clear' }]).calls).toEqual(['clearRect(0,0,800,600)']);
  });

  it('drawCamera draws the camera image at the given opacity', () => {
    const context = render([{ kind: 'drawCamera', opacity: 0.5 }]);
    expect(context.calls).toEqual([
      'save',
      'drawImage(0,0,800,600) alpha=0.5 blend=source-over',
      'restore',
    ]);
  });

  it('drawCamera draws nothing when there is no camera image yet', () => {
    expect(render([{ kind: 'drawCamera', opacity: 1 }], false).calls).toEqual([]);
  });

  it('fillScreen fills the surface with the colour, alpha, and blend given', () => {
    const context = render([{ kind: 'fillScreen', color: '#FF0000', alpha: 0.4, blend: 'add' }]);
    expect(context.calls).toEqual([
      'save',
      'fillRect(0,0,800,600) style=#FF0000 alpha=0.4 blend=lighter',
      'restore',
    ]);
  });

  it('maps each blend mode to a Canvas2D operation', () => {
    const expected: [
      RenderCommand['kind'] extends never ? never : 'normal' | 'add' | 'multiply' | 'screen',
      string,
    ][] = [
      ['normal', 'source-over'],
      ['add', 'lighter'],
      ['multiply', 'multiply'],
      ['screen', 'screen'],
    ];
    for (const [blend, operation] of expected) {
      const context = render([{ kind: 'fillScreen', color: '#FFF', alpha: 1, blend }]);
      expect(context.calls[1]).toContain('blend=' + operation);
    }
  });

  it('drawCircles opens ONE path for the whole batch', () => {
    const context = render([
      {
        kind: 'drawCircles',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
        radii: [5, 6, 7],
        color: '#00FF00',
        alpha: 0.8,
      },
    ]);

    // The command carries every particle precisely so the renderer can do this. Sixty
    // beginPath/fill pairs would make cost a function of visual density.
    expect(context.calls.filter((call) => call === 'beginPath')).toHaveLength(1);
    expect(context.calls.filter((call) => call.startsWith('fill()'))).toHaveLength(1);
    expect(context.calls).toContain('arc(10,20,5)');
    expect(context.calls).toContain('arc(30,40,6)');
    expect(context.calls).toContain('arc(50,60,7)');
  });

  it('maskedErase issues save / destination-out / drawImage / restore against the mask', () => {
    const context = render([{ kind: 'maskedErase', region: 'person', alpha: 0.6 }], true, true);
    expect(context.calls).toEqual([
      'save',
      'drawImage(0,0,800,600) alpha=0.6 blend=destination-out',
      'restore',
    ]);
  });

  it('maskedErase draws nothing when no mask has been set', () => {
    expect(
      render([{ kind: 'maskedErase', region: 'person', alpha: 1 }], true, false).calls,
    ).toEqual([]);
  });

  it('maskedErase for "background" is a documented no-op (research D8, no shipped action uses it)', () => {
    expect(
      render([{ kind: 'maskedErase', region: 'background', alpha: 1 }], true, true).calls,
    ).toEqual([]);
  });

  it('drawPolyline strokes one path through every point', () => {
    const context = render([
      {
        kind: 'drawPolyline',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 5 },
        ],
        width: 4,
        color: '#0000FF',
        alpha: 1,
      },
    ]);
    expect(context.calls).toEqual([
      'save',
      'beginPath',
      'moveTo(0,0)',
      'lineTo(10,10)',
      'lineTo(20,5)',
      'stroke() style=#0000FF width=4',
      'restore',
    ]);
  });
});

describe('commands that produce nothing', () => {
  it('skips a fully transparent fill', () => {
    expect(
      render([{ kind: 'fillScreen', color: '#FFF', alpha: 0, blend: 'normal' }]).calls,
    ).toEqual([]);
  });

  it('skips an empty circle batch', () => {
    expect(
      render([{ kind: 'drawCircles', points: [], radii: [], color: '#FFF', alpha: 1 }]).calls,
    ).toEqual([]);
  });

  it('skips a polyline with fewer than two points', () => {
    expect(
      render([
        { kind: 'drawPolyline', points: [{ x: 1, y: 1 }], width: 2, color: '#FFF', alpha: 1 },
      ]).calls,
    ).toEqual([]);
  });
});

describe('a full frame', () => {
  it('executes commands in the order given', () => {
    const context = render([
      { kind: 'clear' },
      { kind: 'drawCamera', opacity: 1 },
      { kind: 'fillScreen', color: '#FFFFFF', alpha: 0.3, blend: 'add' },
      {
        kind: 'drawCircles',
        points: [{ x: 1, y: 2 }],
        radii: [3],
        color: '#FF0',
        alpha: 1,
      },
    ]);

    const ordered = context.calls.filter(
      (call) => !call.startsWith('save') && !call.startsWith('restore'),
    );
    expect(ordered[0]).toContain('clearRect');
    expect(ordered[1]).toContain('drawImage');
    expect(ordered[2]).toContain('fillRect');
    expect(ordered.slice(3).join(' ')).toContain('arc');
  });

  it('leaves the context balanced — every save has a restore', () => {
    const context = render([
      { kind: 'drawCamera', opacity: 1 },
      { kind: 'fillScreen', color: '#FFF', alpha: 0.5, blend: 'screen' },
      { kind: 'drawCircles', points: [{ x: 0, y: 0 }], radii: [2], color: '#FFF', alpha: 1 },
      {
        kind: 'drawPolyline',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        width: 1,
        color: '#FFF',
        alpha: 1,
      },
    ]);
    expect(context.calls.filter((c) => c === 'save')).toHaveLength(4);
    expect(context.calls.filter((c) => c === 'restore')).toHaveLength(4);
  });

  it('draws the same picture for the same command list', () => {
    const commands: RenderCommand[] = [
      { kind: 'clear' },
      { kind: 'fillScreen', color: '#123456', alpha: 0.7, blend: 'multiply' },
    ];
    expect(render(commands).calls).toEqual(render(commands).calls);
  });
});
