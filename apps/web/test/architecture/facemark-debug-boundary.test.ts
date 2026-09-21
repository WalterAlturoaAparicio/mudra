/**
 * The FaceMark / pipeline debug surface is editor-only (Amendment B): the public page and
 * Capture Mode must not import it, and the domain must not reach it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DEBUG_MODULES = ['face-overlay', 'pipeline-section', 'pipeline-telemetry'];
const read = (path: string): string => readFileSync(path, 'utf8');

describe('FaceMark debug surface stays editor-only', () => {
  for (const entry of ['src/main.ts', 'src/capture-main.ts']) {
    it(`${entry} does not import it`, () => {
      const source = read(entry);
      for (const name of DEBUG_MODULES) {
        expect(source, `${entry} imports ${name}`).not.toContain(name);
      }
    });
  }

  it('no domain file imports presentation debug or the application telemetry', () => {
    const face = read('src/domain/runtime/effect-runtime.ts');
    for (const name of DEBUG_MODULES) {
      expect(face).not.toContain(name);
    }
  });

  it('the diagnostics never call the detector: the section and overlay do not name detect()', () => {
    for (const file of ['face-overlay', 'pipeline-section']) {
      expect(read(`src/presentation/debug/${file}.ts`)).not.toMatch(/\.detect\(/);
    }
  });
});
