/**
 * The composition root — the one place concrete adapters are constructed and injected.
 *
 * Everything below is built here and passed down. There is no module-level singleton and
 * no global mutable state (constitution Principle I): the session *owns* its collaborators
 * because it was handed them, which is what lets the same session be assembled in a test
 * out of fakes with no special support from the production code.
 *
 * Load order is deliberate. The bundle comes first because it is what tells configuration
 * which pose ids are real, so an active pose set naming a pose the bundle does not contain
 * fails at startup rather than never matching (FR-024a).
 */

import { resolveDefaultCatalog } from './application/default-catalog-resolver';
import { Session } from './application/session';
import type { SessionSnapshot } from './application/session';
import { NearestNeighbourMatcher } from './domain/recognition/matcher';
import { createActionRegistry } from './domain/runtime/actions';
import { probeCapabilities } from './domain/runtime/capabilities';
import { EffectRuntime } from './domain/runtime/effect-runtime';
import { ManifestAssetResolver } from './infrastructure/assets/asset-manifest';
import { HtmlAudioSink } from './infrastructure/audio/audio-sink';
import { GetUserMediaCamera } from './infrastructure/camera/get-user-media-camera';
import { loadSessionConfig } from './infrastructure/config/session-config-loader';
import { createMediaPipeDetector } from './infrastructure/detection/mediapipe-detector';
import { loadEffectCatalog } from './infrastructure/effects/catalog-loader';
import { loadExemplarBundle } from './infrastructure/exemplars/bundle-loader';
import { IndexedDbProjectRepository } from './infrastructure/persistence/indexeddb-project-repository';
import { createMediaPipePersonSegmenter } from './infrastructure/segmentation/mediapipe-person-segmenter';
import { DebugMode } from './presentation/debug/debug-mode';
import { Stage } from './presentation/stage/stage';
import { Shell, plainLanguage } from './presentation/shell/shell';

/**
 * Fingerprint of the dataset this build was made against, or `null` when there was no
 * bundle at build time. Injected by `vite.config.ts`; see the staleness check in
 * `bundle-loader.ts` (FR-083).
 */
declare const __DATASET_FINGERPRINT__: string | null;

/**
 * Where the MediaPipe WASM runtime is served from.
 *
 * One stable path in dev and in build alike — `vite.config.ts` streams it in dev and emits
 * it at build. It is a directory of files fetched at runtime, not a module, so it cannot be
 * bundled and must not be referenced through `node_modules`.
 */
const WASM_PATH = '/mediapipe-wasm';

function bootstrap(): void {
  const mount = document.getElementById('mudra-root');
  if (mount === null) {
    throw new Error('index.html is missing the #mudra-root mount element.');
  }

  const registry = createActionRegistry();
  const assets = new ManifestAssetResolver();
  const audio = new HtmlAudioSink(assets);

  let session: Session | null = null;

  const shell = new Shell({
    mount,
    document,
    onStart: async () => {
      // This handler runs inside a genuine user gesture, which is the only moment a browser
      // accepts as consent to make noise.
      audio.unlock();
      const built = await build();
      session = built;
      await built.start();
    },
    onStop: () => {
      session?.stop();
      session = null;
    },
  });

  async function build(): Promise<Session> {
    const bundle = await loadExemplarBundle({
      supportedFormatVersion: 1,
      expectedFingerprint:
        typeof __DATASET_FINGERPRINT__ === 'string' ? __DATASET_FINGERPRINT__ : null,
    });

    const config = await loadSessionConfig({
      knownPoseIds: bundle.poses.map((pose) => pose.poseId),
    });

    const catalog = await resolveDefaultCatalog({
      repository: new IndexedDbProjectRepository(registry),
      loadShippedDefault: () => loadEffectCatalog({ registry }),
    });
    const matcher = new NearestNeighbourMatcher(bundle, config.recognition.weights);

    const { capabilities, segmenter } = await probeCapabilities(() =>
      createMediaPipePersonSegmenter({ wasmPath: WASM_PATH }),
    );

    const runtime = new EffectRuntime({
      catalog,
      registry,
      capabilities,
      resolveAsset: (reference) => assets.resolve(reference),
    });

    const stage = new Stage({ canvas: shell.stageCanvas });
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle,
      config,
      catalog,
      capabilities,
      assets,
      audio,
    });

    shell.setPoses(
      config.activePoseSet.flatMap((poseId) => {
        const pose = bundle.poses.find((entry) => entry.poseId === poseId);
        return pose === undefined
          ? []
          : [
              {
                poseId: pose.poseId,
                displayName: pose.displayName,
                requiredHands: pose.requiredHands,
              },
            ];
      }),
    );

    const detector = await createMediaPipeDetector({ wasmPath: WASM_PATH });

    return new Session({
      camera: new GetUserMediaCamera(),
      detector,
      matcher,
      runtime,
      stage,
      config,
      audio,
      debug,
      segmenter,
      onFrame: (snapshot: SessionSnapshot) => {
        shell.update(snapshot);
        debug.update(snapshot);
      },
    });
  }

  // The camera is released when the page is left, not only when the visitor stops (FR-004).
  window.addEventListener('pagehide', () => {
    session?.stop();
    session = null;
  });
}

try {
  bootstrap();
} catch (error: unknown) {
  // Nothing has started yet at this point — the only failure reachable here is a missing
  // mount element, which is a broken page rather than a broken camera.
  const mount = document.getElementById('mudra-root');
  if (mount !== null) {
    mount.textContent = plainLanguage(error);
  }
  console.error(error);
}
