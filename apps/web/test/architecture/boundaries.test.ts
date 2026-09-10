/**
 * FR-098/FR-100: Mudra Web imports nothing from Mudra Engine or Mudra Capture.
 *
 * The rule is easy to state and easy to break by accident, because the sibling
 * applications sit two directories away and a relative import out of `apps/web/` is a
 * short thing to type. This test is what makes the boundary real.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ROOT, SRC_ROOT, findMatches, readSources } from '../support/source-scan';

const sources = readSources(SRC_ROOT);

/**
 * Test sources *except* the architecture guards themselves.
 *
 * The guards must name what they forbid — a test for "no path into another application"
 * has to contain that path pattern to look for it — so scanning them would make the rule
 * impossible to express. Everything else in `test/` is held to the rule.
 */
const tests = readSources(join(APP_ROOT, 'test')).filter(
  (file) => !file.path.startsWith('test/architecture/'),
);

describe('src/**', () => {
  it('imports nothing from a sibling application', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        if (/(^|\/)apps\/(engine|capture|studio)\//.test(specifier)) {
          offenders.push(`${file.path} imports ${specifier}`);
        }
        if (/^\.\.\/\.\.\/\.\./.test(specifier)) {
          // Anything climbing above apps/web/ is outside this application by definition.
          offenders.push(`${file.path} imports ${specifier} — outside apps/web/`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names no path inside another application', () => {
    const offenders: string[] = [];
    for (const file of [...sources, ...tests]) {
      // Deliberately scans the *raw* text, comments included: a hard-coded path to
      // Capture's catalog would be a boundary violation whether or not it was live code.
      offenders.push(
        ...findMatches({ ...file, code: file.raw }, /apps\/(engine|capture|studio)\//),
      );
    }
    expect(offenders, 'Web reads no other application’s files (FR-098)').toEqual([]);
  });

  it('never reads Capture’s pose catalog (research D10)', () => {
    const offenders: string[] = [];
    for (const file of [...sources, ...tests]) {
      offenders.push(...findMatches({ ...file, code: file.raw }, /pose_catalog/));
    }
    // The browser needs each pose's hand requirement, and it exists in Capture's catalog.
    // The design derives it from the dataset instead. This assertion is what keeps the
    // cheaper answer from creeping back in.
    expect(offenders).toEqual([]);
  });

  it('has exactly one copy of the shared hand-landmark model (FR-101)', () => {
    const shared = resolve(APP_ROOT, '../../assets/hand_landmarker.task');
    expect(existsSync(shared)).toBe(true);
    // A committed copy under apps/web/ is what the constitution's shared-asset rule
    // forbids; the dev server streams the repository one and the build emits it.
    expect(existsSync(join(APP_ROOT, 'public/hand_landmarker.task'))).toBe(false);
    expect(existsSync(join(APP_ROOT, 'assets/hand_landmarker.task'))).toBe(false);
  });

  it('loads the model from the shared location, not from a vendored path', () => {
    const viteConfig = readFileSync(join(APP_ROOT, 'vite.config.ts'), 'utf-8');
    // Generalized (v1.7.0) to a list of shared models resolved as `REPO_ROOT/assets/<file>`;
    // the literal filename and the repository-root resolution are still both present.
    expect(viteConfig).toMatch(/hand_landmarker\.task/);
    expect(viteConfig).toMatch(/resolve\(REPO_ROOT,\s*'assets'/);
    expect(viteConfig).toMatch(/REPO_ROOT/);
  });

  it('has exactly one copy of the shared selfie-segmentation model, at the same URL as the segmenter adapter expects', () => {
    // Mirrors the hand_landmarker.task assertions above (FR-101): the model resolves from the
    // repository-level assets/ directory, never a copy vendored under apps/web/, and vite.config.ts
    // serves it at the exact URL `infrastructure/segmentation/mediapipe-person-segmenter.ts`'s
    // `SEGMENTER_MODEL_URL` requests it from — a mismatch here is what a 404 at runtime looks like.
    const shared = resolve(APP_ROOT, '../../assets/selfie_segmenter.tflite');
    expect(existsSync(shared)).toBe(true);
    expect(existsSync(join(APP_ROOT, 'public/selfie_segmenter.tflite'))).toBe(false);
    expect(existsSync(join(APP_ROOT, 'assets/selfie_segmenter.tflite'))).toBe(false);

    const viteConfig = readFileSync(join(APP_ROOT, 'vite.config.ts'), 'utf-8');
    expect(viteConfig).toMatch(/selfie_segmenter\.tflite/);

    const segmenterAdapter = readFileSync(
      join(APP_ROOT, 'src/infrastructure/segmentation/mediapipe-person-segmenter.ts'),
      'utf-8',
    );
    expect(segmenterAdapter).toMatch(/SEGMENTER_MODEL_URL\s*=\s*'\/selfie_segmenter\.tflite'/);
  });
});

describe('the build scripts', () => {
  it('live at the repository level, not inside apps/web/', () => {
    // They run under Python against Engine. Putting them in the TypeScript application
    // would place a Python dependency inside it and blur the boundary this test defends.
    const repoRoot = resolve(APP_ROOT, '../..');
    expect(existsSync(join(repoRoot, 'scripts/export_web_exemplars.py'))).toBe(true);
    expect(existsSync(join(repoRoot, 'scripts/export_web_fixtures.py'))).toBe(true);
    expect(existsSync(join(APP_ROOT, 'scripts'))).toBe(false);
  });

  it('leave no Python inside apps/web/', () => {
    const stray: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.py')) {
          stray.push(full);
        }
      }
    };
    walk(APP_ROOT);
    expect(stray).toEqual([]);
  });
});
