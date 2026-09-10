import { createReadStream, readFileSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));

/** Repository root — `apps/web/` sits two levels below it. */
const REPO_ROOT = resolve(APP_ROOT, '../..');

/**
 * Shared repository-level model assets (FR-101, constitution v1.6.0/v1.7.0): each is
 * referenced from `assets/`, never copied into `apps/web/` source. Both branches below
 * expose every model at the same URL so application code has one path in dev and in build.
 *
 * `selfie_segmenter.tflite` (research D7, v1.7.0) follows the exact same rule as
 * `hand_landmarker.task` — its absence on disk is not an error here: the dev/build server
 * simply 404s that one URL, and `probeCapabilities()` reports the capability unavailable,
 * exactly the "common case" the capability-gating contract is built around.
 */
const SHARED_MODELS: ReadonlyArray<{ readonly file: string; readonly url: string }> = [
  { file: 'hand_landmarker.task', url: '/hand_landmarker.task' },
  { file: 'selfie_segmenter.tflite', url: '/selfie_segmenter.tflite' },
];

/**
 * Repository-level shared **directories** — the same rule as `SHARED_MODELS` above, for a
 * whole folder rather than one file (item 12).
 *
 * `assets/poses/` holds pose reference imagery, published there by
 * `scripts/export_pose_images.py`. Web serves it from the repository location and vendors no
 * copy, so `test/architecture/boundaries.test.ts`'s "imports nothing from, and names no path
 * inside, a sibling application" stays true — and, exactly like the models, an unpopulated
 * directory is a 404 the application already handles gracefully, never a build failure.
 */
const SHARED_ASSET_DIRECTORIES: ReadonlyArray<{ readonly dir: string; readonly url: string }> = [
  { dir: 'poses', url: '/pose-images' },
];

/** Public URL the detector loads the shared hand-landmark model from, in dev and build alike. */
export const MODEL_URL = '/hand_landmarker.task';

/** Public URL prefix pose reference imagery is served from, in dev and build alike. */
export const POSE_IMAGE_URL_PREFIX = '/pose-images';

/** Public URL the segmenter loads the shared selfie-segmentation model from, in dev and build alike. */
export const SEGMENTER_MODEL_URL = '/selfie_segmenter.tflite';

function sharedModelPlugin(): Plugin {
  return {
    name: 'mudra-shared-model',

    // Dev: stream each repository asset in place. No copy exists on disk.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0];
        if (url === undefined) {
          next();
          return;
        }
        const model = SHARED_MODELS.find((entry) => entry.url === url);
        const directory = SHARED_ASSET_DIRECTORIES.find((entry) =>
          url.startsWith(entry.url + '/'),
        );
        if (model === undefined && directory === undefined) {
          next();
          return;
        }
        const source =
          model !== undefined
            ? resolve(REPO_ROOT, 'assets', model.file)
            : resolve(REPO_ROOT, 'assets', directory!.dir, url.slice(directory!.url.length + 1));
        // Never let a `..` in a request escape the shared directory it names.
        if (!source.startsWith(resolve(REPO_ROOT, 'assets'))) {
          response.statusCode = 403;
          response.end('Refused');
          return;
        }
        try {
          const { size } = statSync(source);
          response.setHeader('Content-Type', contentTypeFor(source));
          response.setHeader('Content-Length', String(size));
          createReadStream(source).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end(`Shared asset not found at ${source}`);
        }
      });
    },

    // Build: emit each present model into dist/ as a build artifact — a missing optional
    // model (selfie_segmenter.tflite) is skipped, not a build failure.
    async generateBundle() {
      for (const model of SHARED_MODELS) {
        const source = resolve(REPO_ROOT, 'assets', model.file);
        try {
          const sourceBytes = await readFile(source);
          this.emitFile({ type: 'asset', fileName: model.file, source: sourceBytes });
        } catch {
          this.warn(`Shared model not found, skipping: ${source} (${model.url})`);
        }
      }
      for (const directory of SHARED_ASSET_DIRECTORIES) {
        const base = resolve(REPO_ROOT, 'assets', directory.dir);
        const files = await walk(base);
        if (files.length === 0) {
          this.warn(`Shared asset directory is empty, skipping: ${base} (${directory.url})`);
          continue;
        }
        for (const file of files) {
          this.emitFile({
            type: 'asset',
            fileName:
              directory.url.slice(1) + '/' + relative(base, file).split(sep).join('/'),
            source: await readFile(file),
          });
        }
      }
    },
  };
}

/** Where the MediaPipe WASM runtime is served from, in dev and in build alike. */
export const WASM_DIR = '/mediapipe-wasm';

const WASM_SOURCE = resolve(APP_ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');

/**
 * Serve the MediaPipe WASM runtime from one stable URL.
 *
 * `FilesetResolver` fetches its `.wasm` and `.js` files at runtime by directory, so they
 * cannot be bundled into a module graph — they have to exist as files at a known path. A
 * `new URL(..., import.meta.url)` pointing into `node_modules` works in dev and silently
 * does not survive the build, which is exactly the kind of difference that shows up only
 * in production.
 */
function mediapipeWasmPlugin(): Plugin {
  return {
    name: 'mudra-mediapipe-wasm',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0] ?? '';
        if (!url.startsWith(WASM_DIR + '/')) {
          next();
          return;
        }
        const file = resolve(WASM_SOURCE, url.slice(WASM_DIR.length + 1));
        if (!file.startsWith(WASM_SOURCE)) {
          response.statusCode = 403;
          response.end('Refused');
          return;
        }
        try {
          const { size } = statSync(file);
          response.setHeader(
            'Content-Type',
            file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
          );
          response.setHeader('Content-Length', String(size));
          createReadStream(file).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end('Not found: ' + file);
        }
      });
    },

    async generateBundle() {
      for (const file of await walk(WASM_SOURCE)) {
        this.emitFile({
          type: 'asset',
          fileName: WASM_DIR.slice(1) + '/' + relative(WASM_SOURCE, file).split(sep).join('/'),
          source: await readFile(file),
        });
      }
    },
  };
}

/**
 * Ship `config/` and `assets/` as runtime data rather than bundling them.
 *
 * Effects and session tuning are **data** (FR-039): changing what a pose does must be an
 * edit to a JSON file, not a rebuild of a module graph. Vite's dev server already serves
 * anything under the project root, so this only has to handle the build — where the two
 * directories would otherwise be left behind.
 */
function runtimeDataPlugin(): Plugin {
  const roots = ['config', 'assets'];

  return {
    name: 'mudra-runtime-data',

    async generateBundle() {
      for (const root of roots) {
        const base = resolve(APP_ROOT, root);
        for (const file of await walk(base)) {
          this.emitFile({
            type: 'asset',
            fileName: root + '/' + relative(base, file).split(sep).join('/'),
            source: await readFile(file),
          });
        }
      }
    },
  };
}

/** Just enough of a MIME table for the shared assets this server streams. */
function contentTypeFor(path: string): string {
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (path.endsWith('.webp')) {
    return 'image/webp';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full)));
    } else if (!entry.name.startsWith('.')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The dataset fingerprint this build is made against (FR-082, FR-083).
 *
 * Read from the exemplar manifest present at build time and compared at load against the
 * manifest actually served. A mismatch means the bundle and the build came from different
 * dataset revisions, which degrades recognition *silently* — so it is reported.
 *
 * `null` when no bundle has been generated yet: the check is skipped and says so, rather
 * than inventing a value that would always appear to match.
 */
function datasetFingerprint(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(APP_ROOT, 'public/exemplars.manifest.json'), 'utf-8'),
    ) as { dataset_fingerprint?: unknown };
    return typeof manifest.dataset_fingerprint === 'string' ? manifest.dataset_fingerprint : null;
  } catch {
    return null;
  }
}

export default defineConfig({
  root: APP_ROOT,
  plugins: [sharedModelPlugin(), mediapipeWasmPlugin(), runtimeDataPlugin()],
  define: {
    __DATASET_FINGERPRINT__: JSON.stringify(datasetFingerprint()),
  },
  server: {
    fs: {
      // Reach the repository-level assets/ directory (models and pose imagery) without
      // vendoring any of it (FR-101).
      allow: [APP_ROOT, resolve(REPO_ROOT, 'assets')],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Application chunks go to static/, leaving dist/assets/ to mean what it means in the
    // source tree: Mudra-owned experience assets.
    assetsDir: 'static',
    rollupOptions: {
      // Two pages, built explicitly (Vite only auto-detects a lone root index.html):
      // the default zero-chrome experience and the editor (constitution v1.7.0).
      input: {
        main: resolve(APP_ROOT, 'index.html'),
        editor: resolve(APP_ROOT, 'editor.html'),
      },
    },
  },
});
