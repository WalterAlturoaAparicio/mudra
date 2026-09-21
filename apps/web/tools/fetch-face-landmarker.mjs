#!/usr/bin/env node
/**
 * Explicit, pinned, integrity-checked provisioning for the shared Face Landmarker model
 * (Spec 011; constitution v1.10.0 Milestone 4, item 2).
 *
 * This is deliberately **stricter** than `fetch-selfie-segmenter.mjs`, which it does not modify:
 *
 * - It is run only by `npm run fetch-face-model`. Nothing — not `dev`, `build`, `test`, an
 *   install hook, or `fetch-models` — runs it. The model is **absent by default**.
 * - It has one hard-coded source and one hard-coded SHA-256. No arguments, no environment
 *   override, no local-file option: an arbitrary source is exactly what the constitution rules
 *   out.
 * - It **fails closed**. While `EXPECTED_SHA256` is `null` it installs nothing and prints the
 *   computed hash (with the URL, status and size) for a human to review and pin — so the first
 *   fetch produces *evidence*, not an unchecked file. A mismatching or partial file is deleted.
 *
 * The model is never fetched at run time by the application: this is a developer/setup step.
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/** The one source. MediaPipe's published Face Landmarker bundle, float16, version path `1`. */
export const SOURCE_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** The only origin a response may be served from, after any redirect. */
export const ALLOWED_ORIGIN = 'https://storage.googleapis.com/';

/**
 * The verified SHA-256 of the artifact at {@link SOURCE_URL}, lowercase hex.
 *
 * `null` means **not yet verified**: the script then installs nothing. Pinning it is a reviewed
 * change made after a human independently confirms the hash (Spec 011 Definition of Done, V2).
 *
 * @type {string | null}
 */
export const EXPECTED_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** `apps/web/tools/` sits three levels below the repository root. */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
export const DEFAULT_TARGET = resolve(REPO_ROOT, 'assets', 'face_landmarker.task');

/** SHA-256 of a file, lowercase hex. */
export async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/** Whether the file at `filePath` has exactly the expected SHA-256. */
export async function verifySha256(filePath, expectedHex) {
  return (await sha256OfFile(filePath)) === expectedHex.toLowerCase();
}

/**
 * Decide the fate of a downloaded `.part` file, and never leave a bad one behind.
 *
 * - no pinned hash  → delete the part, report the computed hash, install nothing;
 * - hash mismatch   → delete the part, install nothing;
 * - hash matches    → atomically rename to the target.
 *
 * @returns {Promise<{ ok: boolean, reason?: 'unpinned' | 'mismatch', sha256: string }>}
 */
export async function finalize(partPath, targetPath, expected = EXPECTED_SHA256) {
  const sha256 = await sha256OfFile(partPath);
  if (expected === null) {
    rmSync(partPath, { force: true });
    return { ok: false, reason: 'unpinned', sha256 };
  }
  if (sha256 !== expected.toLowerCase()) {
    rmSync(partPath, { force: true });
    return { ok: false, reason: 'mismatch', sha256 };
  }
  renameSync(partPath, targetPath);
  return { ok: true, sha256 };
}

async function main() {
  const target = DEFAULT_TARGET;
  const part = target + '.part';

  if (existsSync(target)) {
    const sha256 = await sha256OfFile(target);
    if (EXPECTED_SHA256 === null) {
      console.error(`A file is present at ${target} but no hash is pinned yet.`);
      console.error(
        `Its SHA-256 is ${sha256}. Verify it independently, then pin it in this script.`,
      );
      process.exitCode = 1;
      return;
    }
    if (sha256 === EXPECTED_SHA256.toLowerCase()) {
      console.log(`Already present and verified: ${target}`);
      return;
    }
    rmSync(target, { force: true });
    console.error(`Removed ${target}: its SHA-256 (${sha256}) does not match the pinned value.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  console.log(`Fetching ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  console.log(`HTTP ${response.status} ${response.statusText} from ${response.url}`);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.url.startsWith(ALLOWED_ORIGIN)) {
    throw new Error(
      `Refusing a response served from ${response.url} (expected ${ALLOWED_ORIGIN}).`,
    );
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    const outcome = await finalize(part, target);
    console.log(`SHA-256: ${outcome.sha256}`);
    if (outcome.ok) {
      console.log(`Installed and verified: ${target}`);
      return;
    }
    process.exitCode = 1;
    if (outcome.reason === 'unpinned') {
      console.error(
        'No SHA-256 is pinned yet, so nothing was installed. Verify the hash above independently, ' +
          'then pin it as EXPECTED_SHA256 in tools/fetch-face-landmarker.mjs (a reviewed change).',
      );
    } else {
      console.error('The downloaded file does not match the pinned SHA-256. It was deleted.');
    }
  } finally {
    rmSync(part, { force: true }); // a partial file is never left behind
  }
}

// Run only when executed directly — importing this module (as the test does) has no effect.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1; // unlike the optional segmentation model, a failure here is a failure
  });
}
