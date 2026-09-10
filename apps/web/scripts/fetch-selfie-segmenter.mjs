#!/usr/bin/env node
/**
 * Fetch-once-if-missing bootstrap for the shared Person Segmentation model
 * (constitution v1.7.0, research D7).
 *
 * Mirrors `apps/engine/config/models.py`'s `DetectionConfig.model_url` pattern for
 * `assets/hand_landmarker.task`: a repository-level shared binary asset, fetched once from
 * MediaPipe's public model store if not already present, never committed, never vendored
 * into `apps/web/`.
 *
 * Running this script is optional. Its absence — no network access, or simply never run —
 * is not an error: `probeCapabilities()` reports `person_segmentation` as unavailable and
 * every segmentation-dependent action is inert and reported, exactly as the capability-gating
 * contract requires (contracts/capability-segmentation.md).
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** `apps/web/scripts/` sits three levels below the repository root. */
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
const TARGET = resolve(REPO_ROOT, 'assets', 'selfie_segmenter.tflite');

/** Same model family (MediaPipe Tasks Vision), same versioning convention Engine already uses. */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

async function main() {
  if (existsSync(TARGET)) {
    console.log(`Already present: ${TARGET}`);
    return;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  console.log(`Fetching ${MODEL_URL}`);
  console.log(`       → ${TARGET}`);

  const response = await fetch(MODEL_URL);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(TARGET));
  console.log('Done.');
}

main().catch((error) => {
  console.error(
    'Could not fetch the selfie-segmentation model. This is not fatal — Person Segmentation ' +
      'will report as unavailable, and every segmentation-dependent action will be inert and ' +
      'reported rather than failing the build. Fetch manually or retry later.',
  );
  console.error(error);
  // Exit 0, deliberately: an optional asset's absence must not fail a dev/build script that
  // nothing else in the pipeline requires it to succeed.
  process.exitCode = 0;
});
