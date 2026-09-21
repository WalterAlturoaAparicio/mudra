/**
 * The face-model provisioning script's integrity rules (Spec 011 FR-024, FR-025, FR-027).
 *
 * Only the *pure* parts are exercised — hashing and what happens to a downloaded file — because
 * the script's network step must never run in a test, and the model itself is intentionally absent
 * from the development repository. Whether the pinned hash is recorded (`EXPECTED_SHA256` not
 * `null`) is a human completion criterion (Definition of Done), **not** asserted here: the
 * ordinary suite must pass with the model absent and the hash unpinned.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_ORIGIN,
  SOURCE_URL,
  finalize,
  sha256OfFile,
  verifySha256,
} from '../../tools/fetch-face-landmarker.mjs';
import { APP_ROOT } from '../support/source-scan';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'face-model-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const bytes = Buffer.from('not really a model, just distinctive bytes '.repeat(50));
const goodHash = createHash('sha256').update(bytes).digest('hex');

function partFile(content: Buffer = bytes): { part: string; target: string } {
  const target = join(dir, 'face_landmarker.task');
  const part = target + '.part';
  writeFileSync(part, content);
  return { part, target };
}

describe('hashing', () => {
  it('computes the SHA-256 and accepts a matching file', async () => {
    const { part } = partFile();
    expect(await sha256OfFile(part)).toBe(goodHash);
    expect(await verifySha256(part, goodHash)).toBe(true);
    expect(await verifySha256(part, goodHash.toUpperCase())).toBe(true);
  });

  it('rejects one flipped byte and a truncated file', async () => {
    const flipped = Buffer.from(bytes);
    flipped[10] = flipped[10]! ^ 0xff;
    expect(await verifySha256(partFile(flipped).part, goodHash)).toBe(false);
    expect(await verifySha256(partFile(bytes.subarray(0, bytes.length - 1)).part, goodHash)).toBe(
      false,
    );
  });
});

describe('what happens to a downloaded file', () => {
  it('a matching file is installed atomically and no .part remains', async () => {
    const { part, target } = partFile();
    const outcome = await finalize(part, target, goodHash);
    expect(outcome).toEqual({ ok: true, sha256: goodHash });
    expect(existsSync(target)).toBe(true);
    expect(existsSync(part)).toBe(false);
    expect(readFileSync(target).equals(bytes)).toBe(true);
  });

  it('a mismatching file is deleted and nothing is installed', async () => {
    const { part, target } = partFile(Buffer.from('tampered'));
    const outcome = await finalize(part, target, goodHash);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('mismatch');
    expect(existsSync(target)).toBe(false);
    expect(existsSync(part)).toBe(false);
  });

  it('with no pinned hash it installs NOTHING, deletes the part, and reports the computed hash', async () => {
    const { part, target } = partFile();
    const outcome = await finalize(part, target, null);
    expect(outcome).toEqual({ ok: false, reason: 'unpinned', sha256: goodHash });
    expect(existsSync(target)).toBe(false);
    expect(existsSync(part)).toBe(false);
  });
});

describe('the script itself (FR-024, FR-027)', () => {
  const script = readFileSync(join(APP_ROOT, 'tools/fetch-face-landmarker.mjs'), 'utf-8');
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is pinned to one https source on one allowed origin', () => {
    expect(SOURCE_URL.startsWith(ALLOWED_ORIGIN)).toBe(true);
    expect(SOURCE_URL).toMatch(
      /face_landmarker\/face_landmarker\/float16\/1\/face_landmarker\.task$/,
    );
  });

  it('has no argument, environment or local-file source of any kind', () => {
    expect(code).not.toMatch(
      /process\.env|process\.argv\.slice|process\.argv\[[2-9]\]|readFileSync/,
    );
    expect(code).not.toMatch(/--from|--url|--file/);
  });

  it('declares the pinned hash constant (its value is a human completion criterion, not asserted)', () => {
    expect(code).toMatch(/export const EXPECTED_SHA256/);
  });
});
