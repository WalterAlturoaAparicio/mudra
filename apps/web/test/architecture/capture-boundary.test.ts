/**
 * Capture Mode and the editor share nothing, and Capture Mode is not in a public build
 * (FR-037, FR-059, FR-061, SC-011; contracts/capture-storage.md, contracts/capture-gating.md).
 *
 * Both claims are easy to state and easy to break by accident — a convenient import from the editor,
 * or a build config edited without noticing the input list. This test is what makes them real.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ROOT, SRC_ROOT, findMatches, readSources } from '../support/source-scan';

const sources = readSources(SRC_ROOT);

/** Capture Mode's own tree, by path. */
const CAPTURE_PATHS = [
  'src/capture-main.ts',
  'src/application/capture-controller.ts',
  'src/application/capture-export.ts',
  'src/domain/capture/',
  'src/domain/config/capture-config.ts',
  'src/domain/ports/capture-repository.ts',
  'src/domain/ports/clock.ts',
  'src/infrastructure/capture/',
  'src/infrastructure/config/capture-config-loader.ts',
  'src/infrastructure/persistence/capture-schema.ts',
  'src/infrastructure/persistence/indexeddb-capture-repository.ts',
  'src/presentation/capture/',
];

/** The editor and project tree, by path. */
const PROJECT_PATHS = [
  'src/editor-main.ts',
  'src/application/editor-runtime-controller.ts',
  'src/domain/editor/',
  'src/presentation/editor/',
  'src/infrastructure/persistence/indexeddb-project-repository.ts',
  'src/infrastructure/persistence/project-schema.ts',
];

const captureSources = sources.filter((file) =>
  CAPTURE_PATHS.some((path) => (path.endsWith('/') ? file.path.startsWith(path) : file.path === path)),
);
const projectSources = sources.filter((file) =>
  PROJECT_PATHS.some((path) => (path.endsWith('/') ? file.path.startsWith(path) : file.path === path)),
);

describe('the two trees exist', () => {
  it('finds capture and project sources to compare', () => {
    // Without this, both isolation assertions below would pass vacuously.
    expect(captureSources.length).toBeGreaterThan(10);
    expect(projectSources.length).toBeGreaterThan(5);
  });
});

describe('capture data never enters the project model (FR-037, FR-061)', () => {
  it('names no Project type anywhere in the capture tree', () => {
    const offenders: string[] = [];
    for (const file of captureSources) {
      offenders.push(
        ...findMatches(
          file,
          /\b(Project|ProjectRepository|ProjectSummary|EffectDefinition|Timeline|ActionRegistry)\b/,
        ),
      );
    }
    expect(offenders, 'Capture Mode knows nothing about projects').toEqual([]);
  });

  it('names no capture type anywhere in the project tree', () => {
    const offenders: string[] = [];
    for (const file of projectSources) {
      offenders.push(
        ...findMatches(file, /\b(CaptureSession|CaptureSample|CaptureRepository|CaptureHand)\b/),
      );
    }
    expect(offenders, 'the editor knows nothing about capture data').toEqual([]);
  });

  it('imports nothing from the other tree, in either direction', () => {
    const crossing: string[] = [];
    for (const file of captureSources) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      crossing.push(
        ...imports
          .filter((specifier) => /\/editor\/|editor-|project-|-project/.test(specifier))
          .map((specifier) => `${file.path} imports ${specifier}`),
      );
    }
    for (const file of projectSources) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      crossing.push(
        ...imports
          .filter((specifier) => /\/capture\/|capture-/.test(specifier))
          .map((specifier) => `${file.path} imports ${specifier}`),
      );
    }
    expect(crossing).toEqual([]);
  });
});

describe('the two stores are separate databases (contracts/capture-storage.md)', () => {
  const captureRepository = readFileSync(
    join(SRC_ROOT, 'infrastructure/persistence/indexeddb-capture-repository.ts'),
    'utf-8',
  );
  const projectRepository = readFileSync(
    join(SRC_ROOT, 'infrastructure/persistence/indexeddb-project-repository.ts'),
    'utf-8',
  );

  it('capture uses mudra-capture and never the editor’s database', () => {
    expect(captureRepository).toMatch(/'mudra-capture'/);
    expect(captureRepository).not.toMatch(/'mudra-editor'/);
  });

  it('the editor uses mudra-editor and never the capture database', () => {
    expect(projectRepository).toMatch(/'mudra-editor'/);
    expect(projectRepository).not.toMatch(/'mudra-capture'/);
  });

  it('keeps browser storage confined to the one permitted directory (FR-039)', () => {
    // The capture store lives *inside* the already-permitted directory, so the permitted-directory
    // list does not grow. Asserted here as well as in privacy.test.ts because it is the whole
    // reason the capture repository is co-located with the project one.
    const users = sources.filter((file) => findMatches(file, /\bindexedDB\b/).length > 0);
    for (const file of users) {
      expect(file.path.startsWith('src/infrastructure/persistence/'), file.path).toBe(true);
    }
    expect(users.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Capture Mode is a separate, gated surface (FR-001, FR-059, SC-011)', () => {
  const viteConfig = readFileSync(join(APP_ROOT, 'vite.config.ts'), 'utf-8');

  it('has its own entry point', () => {
    expect(existsSync(join(APP_ROOT, 'capture.html'))).toBe(true);
    expect(existsSync(join(SRC_ROOT, 'capture-main.ts'))).toBe(true);
  });

  it('gates that entry point on VITE_MUDRA_CAPTURE', () => {
    expect(viteConfig).toMatch(/VITE_MUDRA_CAPTURE/);
    expect(viteConfig).toMatch(/CAPTURE_ENABLED\s*\?\s*\{\s*capture:/);
  });

  it('fails closed — only the literal "1" enables it', () => {
    // A half-set variable (`true`, `yes`, an empty string) must leave Capture Mode out.
    expect(viteConfig).toMatch(/process\.env\['VITE_MUDRA_CAPTURE'\]\s*===\s*'1'/);
  });

  it('is reachable from nothing but its own entry point', () => {
    // If the editor or the default experience imported a capture module, the capture subgraph
    // would ship in a public build and the build-time gate would be worthless.
    const nonCapture = sources.filter(
      (file) => !captureSources.includes(file) && file.path !== 'src/capture-main.ts',
    );
    const offenders: string[] = [];
    for (const file of nonCapture) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      offenders.push(
        ...imports
          .filter((specifier) => /capture/.test(specifier))
          .map((specifier) => `${file.path} imports ${specifier}`),
      );
    }
    expect(offenders, 'no public-build module may reach capture code').toEqual([]);
  });

  it('keeps the capture entry point out of index.html and editor.html', () => {
    for (const page of ['index.html', 'editor.html']) {
      const html = readFileSync(join(APP_ROOT, page), 'utf-8');
      expect(html, page).not.toMatch(/capture/i);
    }
  });
});

describe('the capture surface adds no imagery affordance (FR-052, research D8)', () => {
  it('renders sample review as vector output, never a canvas or an image', () => {
    const review = readSources(join(SRC_ROOT, 'presentation/capture'));
    const offenders: string[] = [];
    for (const file of review) {
      // `createElement('canvas')` in the shell is the Stage's own target and is allowed; what must
      // not exist is an <img>, a blob URL for imagery, or a data: image anywhere in this tree.
      offenders.push(...findMatches(file, /createElement\('img'\)|data:image|toBlob|toDataURL/));
    }
    expect(offenders, 'sample review shows coordinates, never pictures').toEqual([]);
  });
});
