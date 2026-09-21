/**
 * Face data cannot leak (Spec 011 FR-008, 012, 015, 028–032, 037a; constitution v1.10.0 Milestone 4).
 *
 * These are *negative and structural* assertions: each fails if a leak path is introduced, and
 * each guards against passing vacuously by first asserting there is something to scan. The
 * constitution's promises — face tracking is geometry only, transient, never in recognition, never
 * persisted, never in Capture Mode or the public entry point — are only real if a build breaks
 * when they stop being true.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHIPPED_ACTIONS } from '../../src/domain/runtime/actions';
import { APP_ROOT, SRC_ROOT, findMatches, listSources, readSources } from '../support/source-scan';
import type { SourceFile } from '../support/source-scan';

const sources = readSources(SRC_ROOT);

/** Any face identifier: a type, a capability, a port, the model URL. `\b` keeps `interface` out. */
const FACE_TOKEN = /\bFace|face_landmarks|face-detector|faceLandmark|FACE_MODEL_URL/;

const under = (...prefixes: string[]): SourceFile[] =>
  sources.filter((file) =>
    prefixes.some((prefix) =>
      prefix.endsWith('/') ? file.path.startsWith(prefix) : file.path === prefix,
    ),
  );

function offendersIn(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files.flatMap((file) => findMatches(file, pattern));
}

/** Like {@link offendersIn} but over the raw text (comments and strings included). */
function rawOffendersIn(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    file.raw
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line))
      .map(({ line, index }) => `${file.path}:${index + 1} — ${line.trim()}`),
  );
}

describe('recognition never sees a face (FR-028)', () => {
  const recognition = under(
    'src/domain/recognition/',
    'src/domain/events/',
    'src/domain/normalization/',
    'src/application/session.ts',
    'src/application/capture-controller.ts',
    'src/domain/landmarks/types.ts',
  );

  it('has recognition source to scan', () => {
    expect(recognition.length).toBeGreaterThan(8);
  });

  it('names no face type, capability or port', () => {
    expect(offendersIn(recognition, FACE_TOKEN)).toEqual([]);
  });

  it('LandmarkFrame — the only frame the matcher and pose events take — has no face member', () => {
    const source = readFileSync(join(SRC_ROOT, 'domain/landmarks/types.ts'), 'utf-8');
    const body = source.slice(source.indexOf('export interface LandmarkFrame'));
    const block = body.slice(0, body.indexOf('\n}') + 2);
    const members = [...block.matchAll(/^\s+readonly (\w+):/gm)].map((m) => m[1]);
    expect(members).toEqual(['hands', 'timestampMs', 'width', 'height']);
  });
});

describe('an action receives a point, never a face (FR-029, FR-015)', () => {
  it('ActionContext has no face member', () => {
    const source = readFileSync(join(SRC_ROOT, 'domain/runtime/action-registry.ts'), 'utf-8');
    const start = source.indexOf('export interface ActionContext');
    const block = source.slice(start, source.indexOf('\n}', start) + 2);
    expect(block.length).toBeGreaterThan(200);
    // Word-level, so "surface" in a doc comment is not mistaken for a face member.
    expect(block).not.toMatch(/\b[fF]aces?\b|\bFace[A-Z]/);
  });

  it('the shipped actions contain no landmark lookup and name no face type', () => {
    const actions = under('src/domain/runtime/actions/');
    expect(actions.length).toBeGreaterThan(4);
    expect(offendersIn(actions, /\.hands\b|faceLandmark|\bFaceFrame\b|AnchorResolver/)).toEqual([]);
  });

  it('exactly the six actions shipped before this feature are registered — no face action (FR-037a, SC-001)', () => {
    expect(SHIPPED_ACTIONS.map((action) => action.type).sort()).toEqual([
      'background_wash',
      'landmark_trail',
      'particle_burst',
      'person_visibility',
      'play_audio',
      'screen_flash',
    ]);
  });
});

describe('face data is never persisted or exported (FR-030)', () => {
  const persistence = under(
    'src/infrastructure/persistence/',
    'src/infrastructure/effects/catalog-loader.ts',
    'src/domain/editor/types.ts',
  );

  it('has persistence source to scan', () => {
    expect(persistence.length).toBeGreaterThan(5);
  });

  it('names no face frame, detector, capability or model', () => {
    // `faceLandmark` is the one permitted name in the catalog loader: it is the *authored anchor
    // kind*, an integer the author chose, not face data.
    const offenders = offendersIn(persistence, FACE_TOKEN).filter(
      (hit) => !/faceLandmark/.test(hit) || /FaceFrame|FaceDetector/.test(hit),
    );
    expect(offenders).toEqual([]);
  });

  it('the pose-sample export path has no face notion at all', () => {
    const capture = under('src/infrastructure/capture/');
    expect(capture.length).toBeGreaterThan(2);
    expect(offendersIn(capture, FACE_TOKEN)).toEqual([]);
  });
});

describe('Capture Mode has no face capability (FR-018, FR-031)', () => {
  const capture = under(
    'src/capture-main.ts',
    'src/application/capture-controller.ts',
    'src/application/capture-export.ts',
    'src/domain/capture/',
    'src/domain/config/capture-config.ts',
    'src/domain/ports/capture-repository.ts',
    'src/infrastructure/capture/',
    'src/infrastructure/config/capture-config-loader.ts',
    'src/infrastructure/persistence/capture-schema.ts',
    'src/infrastructure/persistence/indexeddb-capture-repository.ts',
    'src/presentation/capture/',
  );

  it('has capture source to scan', () => {
    expect(capture.length).toBeGreaterThan(10);
  });

  it('names no face type, capability, port, adapter or model URL — not even in a comment', () => {
    expect(
      rawOffendersIn(capture, /\bFace|face_landmarks|face-detector|faceLandmark|FACE_MODEL_URL/),
    ).toEqual([]);
  });

  it('never imports the face adapter', () => {
    expect(rawOffendersIn(capture, /mediapipe-face-detector/)).toEqual([]);
  });
});

describe('the public experience has no face tracking (FR-008, FR-032)', () => {
  const publicEntry = under('src/main.ts', 'src/application/session.ts');

  it('main.ts and Session import no face module and construct no face detector', () => {
    expect(publicEntry).toHaveLength(2);
    expect(
      rawOffendersIn(publicEntry, /mediapipe-face-detector|face-detector|createMediaPipeFace/),
    ).toEqual([]);
  });

  it('the shipped default catalog contains no face anchor', () => {
    const catalog = readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8');
    expect(catalog.length).toBeGreaterThan(50);
    expect(catalog).not.toMatch(/faceLandmark/);
  });
});

describe('MediaPipe face symbols end at the adapter (FR-011, FR-012)', () => {
  const ADAPTER = 'src/infrastructure/detection/mediapipe-face-detector.ts';

  it('apart from comments, FaceLandmarker appears in no file except the adapter', () => {
    expect(sources.some((file) => file.path === ADAPTER)).toBe(true);
    const offenders = offendersIn(
      sources.filter((file) => file.path !== ADAPTER),
      /\bFaceLandmarker\b/,
    );
    expect(offenders).toEqual([]);
  });

  it('no domain file imports @mediapipe (checked on the raw import, which the code scan blanks)', () => {
    const domain = sources.filter((file) => file.path.startsWith('src/domain/'));
    expect(domain.length).toBeGreaterThan(20);
    expect(rawOffendersIn(domain, /from\s+'@mediapipe/)).toEqual([]);
  });

  it('the adapter fetches nothing and names no external origin', () => {
    const adapter = sources.filter((file) => file.path === ADAPTER);
    expect(adapter).toHaveLength(1);
    expect(offendersIn(adapter, /\bfetch\s*\(|XMLHttpRequest|WebSocket/)).toEqual([]);
    expect(rawOffendersIn(adapter, /https?:\/\//)).toEqual([]);
  });

  it('nothing outside infrastructure/detection imports the face adapter except the composition root', () => {
    const importers = sources
      .filter((file) => /mediapipe-face-detector/.test(file.raw))
      .map((file) => file.path);
    expect(importers.sort()).toEqual(['src/editor-main.ts']);
  });
});

describe('there is something to scan', () => {
  it('finds the source tree', () => {
    expect(listSources(SRC_ROOT).length).toBeGreaterThan(80);
  });
});
