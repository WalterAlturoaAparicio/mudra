/**
 * Effect isolation during editing is scoped to the editor's own runtime instance only
 * (FR-029, contracts/editor-preview-isolation.md #2).
 *
 * `main.ts`'s `Session` constructs and owns its own, separate `EffectRuntime` instance — this
 * test is what keeps that true. `isolatedCatalog` must never be reachable from `main.ts`'s own
 * source, or from anything under `application/session.ts`: if it were, the public-facing
 * experience's effect matching could start depending on editor selection state, which is
 * precisely the coupling this feature's isolation must not introduce.
 */

import { describe, expect, it } from 'vitest';

import { readSources, SRC_ROOT } from '../support/source-scan';

const sources = readSources(SRC_ROOT);

/** The public-facing default experience's own composition root and session — never the editor's. */
const PUBLIC_PATHS = ['src/main.ts', 'src/application/session.ts'];

const publicSources = sources.filter((file) => PUBLIC_PATHS.includes(file.path));

describe('editor-preview isolation never reaches the public path', () => {
  it('finds the public-path sources to scan', () => {
    // Without this, the assertion below would pass vacuously if a rename moved these files.
    expect(publicSources.length).toBe(PUBLIC_PATHS.length);
  });

  it('main.ts and Session import nothing from isolated-catalog', () => {
    const offenders: string[] = [];
    for (const file of publicSources) {
      const imports = [...file.raw.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      offenders.push(
        ...imports
          .filter((specifier) => /isolated-catalog/.test(specifier))
          .map((specifier) => `${file.path} imports ${specifier}`),
      );
    }
    expect(offenders, 'the public-facing path must never import isolatedCatalog').toEqual([]);
  });

  it('main.ts and Session never reference isolatedCatalog by name', () => {
    const offenders: string[] = [];
    for (const file of publicSources) {
      offenders.push(
        ...readSources(SRC_ROOT)
          .filter((f) => f.path === file.path)
          .flatMap((f) => (/\bisolatedCatalog\b/.test(f.code) ? [f.path] : [])),
      );
    }
    expect(offenders, 'the public-facing path must never call isolatedCatalog').toEqual([]);
  });
});
