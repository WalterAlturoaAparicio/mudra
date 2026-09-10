/**
 * The domain is framework-free, asserted rather than asserted-in-prose (research D13).
 *
 * "The runtime does not draw" and "the domain does not touch the browser" are sentences in
 * a document until a test fails when they stop being true. These are that test.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SRC_ROOT, findMatches, readSources } from '../support/source-scan';

const domain = readSources(join(SRC_ROOT, 'domain'));
const presentation = readSources(join(SRC_ROOT, 'presentation'));

/** Browser globals and DOM types the domain must not reach for. */
const BROWSER_GLOBALS = [
  'document',
  'window',
  'navigator',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'Image',
  'Audio',
  'AudioContext',
  'MediaStream',
  'requestAnimationFrame',
  'requestVideoFrameCallback',
  'fetch',
  'XMLHttpRequest',
];

/**
 * Canvas drawing calls. Only `presentation/` may contain these.
 *
 * Deliberately the *canvas-specific* names. `fill`, `stroke`, `arc`, `moveTo` are omitted
 * because they collide with ordinary JavaScript (`new Array(n).fill(1)`), and a guard that
 * cried wolf on array initialization would be edited away within a week.
 */
const DRAWING_CALLS = [
  'getContext',
  'fillRect',
  'clearRect',
  'strokeRect',
  'drawImage',
  'putImageData',
  'beginPath',
  'closePath',
  'fillText',
  'strokeText',
  'createLinearGradient',
  'createRadialGradient',
];

describe('src/domain', () => {
  it('has files to check', () => {
    expect(domain.length).toBeGreaterThan(5);
  });

  it('references no browser global', () => {
    const offenders: string[] = [];
    for (const file of domain) {
      for (const name of BROWSER_GLOBALS) {
        offenders.push(...findMatches(file, new RegExp(`\\b${name}\\b`)));
      }
    }
    expect(offenders, 'domain must not touch the browser').toEqual([]);
  });

  it('calls no canvas drawing API — the runtime does not draw (FR-066)', () => {
    const offenders: string[] = [];
    for (const file of domain) {
      for (const name of DRAWING_CALLS) {
        offenders.push(...findMatches(file, new RegExp(`\\.${name}\\s*\\(`)));
      }
    }
    expect(offenders, 'only src/presentation may draw').toEqual([]);
  });

  it('names no MediaPipe symbol', () => {
    const offenders: string[] = [];
    for (const file of domain) {
      offenders.push(...findMatches(file, /@mediapipe|HandLandmarker|FilesetResolver|WasmFileset/));
    }
    expect(offenders, 'the detector is an interface, not a dependency').toEqual([]);
  });

  it('imports no Node built-in either', () => {
    // The domain is not "browser-free"; it is *environment*-free. A `node:fs` import would
    // be just as much a layering break, and would make the code unusable in the browser.
    const offenders: string[] = [];
    for (const file of domain) {
      offenders.push(...findMatches(file, /from\s+'node:/));
    }
    expect(offenders).toEqual([]);
  });

  it('imports only from within the domain', () => {
    const offenders: string[] = [];
    for (const file of domain) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        if (!specifier.startsWith('.')) {
          offenders.push(`${file.path} imports package ${specifier}`);
          continue;
        }
        // A relative import that climbs out of src/domain/ points at another layer.
        const resolved = new URL(specifier, `file:///${file.path}`).pathname;
        if (!resolved.includes('/src/domain/')) {
          offenders.push(`${file.path} imports ${specifier}`);
        }
      }
    }
    expect(offenders, 'dependencies point inward only').toEqual([]);
  });
});

describe('src/presentation', () => {
  it('is where the drawing lives', () => {
    const drawing = presentation.some((file) =>
      DRAWING_CALLS.some((name) => findMatches(file, new RegExp(`\\.${name}\\s*\\(`)).length > 0),
    );
    // The complement of the domain assertion above. Without it, "the domain does not draw"
    // would also pass in an application that never drew anything at all.
    expect(drawing).toBe(true);
  });
});

describe('src/presentation/editor (constitution v1.7.0, contracts/editor-runtime-boundary.md)', () => {
  const editor = readSources(join(SRC_ROOT, 'presentation/editor'));

  it('has files to check', () => {
    expect(editor.length).toBeGreaterThan(0);
  });

  it('calls no canvas drawing API — the editor authors data, it does not draw', () => {
    const offenders: string[] = [];
    for (const file of editor) {
      for (const name of DRAWING_CALLS) {
        offenders.push(...findMatches(file, new RegExp(`\\.${name}\\s*\\(`)));
      }
    }
    expect(offenders, 'only the renderer may draw, even in preview').toEqual([]);
  });

  it('references no CanvasRenderingContext2D member either', () => {
    const CONTEXT_2D_MEMBERS = [
      'globalCompositeOperation',
      'globalAlpha',
      'fillStyle',
      'strokeStyle',
      'lineWidth',
    ];
    const offenders: string[] = [];
    for (const file of editor) {
      for (const name of CONTEXT_2D_MEMBERS) {
        offenders.push(...findMatches(file, new RegExp(`\\.${name}\\b`)));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('owns no independent frame-scheduling loop of its own', () => {
    // EditorRuntimeController (src/application/) is the one place a tick loop is allowed to
    // live for the editor; presentation/editor/** reacts to its snapshots, it does not run
    // requestAnimationFrame/setInterval itself.
    const offenders: string[] = [];
    for (const file of editor) {
      offenders.push(
        ...findMatches(file, /requestAnimationFrame|requestVideoFrameCallback|setInterval/),
      );
    }
    expect(offenders, 'the editor must not schedule its own frames').toEqual([]);
  });
});
