/**
 * Reading application source as text, for the architecture suite.
 *
 * The architecture tests make claims about what the code *does not contain*, which is a
 * claim no runtime test can make: a layering violation on a rarely-taken branch still
 * violates the layering. So they read the source.
 *
 * Comments and string literals are stripped before scanning. Several files deliberately
 * *name* the APIs they must never call — contracts/privacy.md lists them precisely so a
 * future contributor knows why — and a scanner that could not tell a prohibition from a
 * call would make documenting the rule impossible.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Absolute path to `apps/web/`. */
export const APP_ROOT = resolve(__dirname, '../..');

/** Absolute path to `apps/web/src/`. */
export const SRC_ROOT = join(APP_ROOT, 'src');

/** One source file, in both raw and comment-stripped form. */
export interface SourceFile {
  /** Path relative to `apps/web/`, with forward slashes. */
  readonly path: string;
  /** The file exactly as written. */
  readonly raw: string;
  /** The file with comments and string/template literals blanked out. */
  readonly code: string;
}

/** Recursively list `.ts` files under `root`. */
export function listSources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts')) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Blank out comments and string literals, preserving offsets.
 *
 * A small hand-rolled scanner rather than a parser: it only has to be conservative in one
 * direction. Anything it wrongly treats as code can only cause a *false failure*, which a
 * human sees, never a false pass, which nobody does.
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;

  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }

    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }

    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n) {
        const c = source[j]!;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      // Keep the quotes so `'x'` stays distinguishable from an identifier.
      out.push(ch + blank(source.slice(i + 1, Math.max(j - 1, i + 1))) + (source[j - 1] ?? ch));
      i = j;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join('');
}

/** Load every `.ts` file under `root`, comment- and string-stripped. */
export function readSources(root: string): SourceFile[] {
  return listSources(root).map((full) => {
    const raw = readFileSync(full, 'utf-8');
    return {
      path: relative(APP_ROOT, full).split(sep).join('/'),
      raw,
      code: stripCommentsAndStrings(raw),
    };
  });
}

/** Every line of `file.code` containing `pattern`, as `path:line — text`. */
export function findMatches(file: SourceFile, pattern: RegExp): string[] {
  const lines = file.code.split('\n');
  const rawLines = file.raw.split('\n');
  const hits: string[] = [];
  lines.forEach((line, index) => {
    const probe = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    if (probe.test(line)) {
      hits.push(`${file.path}:${index + 1} — ${(rawLines[index] ?? '').trim()}`);
    }
  });
  return hits;
}
