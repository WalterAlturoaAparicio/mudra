/**
 * Capture Mode's composition root (constitution v1.8.0, Milestone 3).
 *
 * The same discipline `main.ts` and `editor-main.ts` follow: one place concrete adapters are
 * constructed and injected, no module-level singleton, no global mutable state.
 *
 * **This file is only reachable from `capture.html`, which `vite.config.ts` emits only when
 * `VITE_MUDRA_CAPTURE=1`.** Nothing in the default experience or the editor imports anything under
 * `src/…/capture/…`, so a public build contains none of this — the gate is the bundler's input
 * list rather than a runtime conditional (contracts/capture-gating.md, research D1).
 *
 * Note what is **not** constructed here: no matcher, no `EffectRuntime`, no `PoseEventEmitter`, no
 * segmenter. Capture Mode is a data-collection pipeline and cannot become a second recognition
 * system, because nothing that would let it is ever built (FR-022).
 */

import { buildCaptureExport } from './application/capture-export';
import { CaptureController } from './application/capture-controller';
import type { CaptureSnapshot } from './application/capture-controller';
import { createSession } from './domain/capture/session';
import type { CaptureSample, CaptureSession, RequiredHands } from './domain/capture/types';
import type { CaptureTimeSource } from './domain/ports/clock';
import { GetUserMediaCamera } from './infrastructure/camera/get-user-media-camera';
import { loadCaptureConfig } from './infrastructure/config/capture-config-loader';
import { loadSessionConfig } from './infrastructure/config/session-config-loader';
import { createMediaPipeDetector } from './infrastructure/detection/mediapipe-detector';
import { loadExemplarBundle } from './infrastructure/exemplars/bundle-loader';
import { IndexedDbCaptureRepository } from './infrastructure/persistence/indexeddb-capture-repository';
import { landmarkOverlayCommands } from './presentation/debug/landmark-overlay';
import { Stage } from './presentation/stage/stage';
import { CaptureExportPanel } from './presentation/capture/capture-export-panel';
import { CaptureShell } from './presentation/capture/capture-shell';
import { ConsentGate } from './presentation/capture/consent-gate';
import { SampleList } from './presentation/capture/sample-list';
import { SessionPanel } from './presentation/capture/session-panel';
import type { KnownPose } from './presentation/capture/session-panel';
import { TakeControls } from './presentation/capture/take-controls';

/** Build-time constants, injected by `vite.config.ts` (research D5). */
declare const __DATASET_FINGERPRINT__: string | null;
declare const __APP_VERSION__: string;
declare const __MEDIAPIPE_VERSION__: string;

/** Same stable path `vite.config.ts` serves the MediaPipe WASM runtime from. */
const WASM_PATH = '/mediapipe-wasm';

/** Real time and real identity — the only place these are constructed (research D10). */
const timeSource: CaptureTimeSource = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

async function main(): Promise<void> {
  const mount = document.getElementById('mudra-capture-root');
  if (mount === null) {
    throw new Error('capture.html must provide #mudra-capture-root.');
  }

  const shell = new CaptureShell({ mount, document, onExit: () => exit() });

  const captureConfig = await loadCaptureConfig();
  const repository = new IndexedDbCaptureRepository();

  let controller: CaptureController | null = null;
  let session: CaptureSession | null = null;

  // Storage is checked **before** a session can be started, so Capture Mode never collects
  // samples it cannot persist (FR-071, contracts/capture-storage.md).
  try {
    await repository.open();
  } catch (error) {
    shell.showFailure(error);
    return;
  }

  const versions = {
    application: `mudra-web/${__APP_VERSION__}`,
    mediapipe: __MEDIAPIPE_VERSION__,
  };

  // -- panels -------------------------------------------------------------

  const takeControls = new TakeControls({
    mount: shell.panels,
    document,
    onTake: () => {
      controller?.beginTake();
    },
    onCancel: () => controller?.cancelTake(),
  });
  takeControls.element.hidden = true;
  takeControls.setEnabled(false);

  const sampleList = new SampleList({
    mount: shell.panels,
    document,
    onDeleteSample: async (id) => {
      await repository.deleteSample(id);
      await refreshSamples();
    },
    onClearSession: async () => {
      if (session === null) {
        return;
      }
      const confirmed = window.confirm(
        `Delete this session and all ${session.sampleCount} of its samples? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
      await repository.deleteSession(session.id);
      session = null;
      controller?.useSession(null);
      takeControls.element.hidden = true;
      takeControls.setEnabled(false);
      sessionPanel.element.hidden = false;
      shell.showNotice('Session deleted. Everything it held has been removed from this browser.');
      await refreshSamples();
    },
  });
  sampleList.element.hidden = true;

  const exportPanel = new CaptureExportPanel({
    mount: shell.panels,
    document,
    onExport: () =>
      buildCaptureExport({
        repository,
        versions,
        datasetFingerprint:
          typeof __DATASET_FINGERPRINT__ === 'string' ? __DATASET_FINGERPRINT__ : null,
        now: timeSource.now,
      }),
  });

  const sessionPanel = new SessionPanel({
    mount: shell.panels,
    document,
    config: captureConfig,
    knownPoses: await knownPoses(),
    onStart: (request) => {
      void startSession(
        request.contributorLabel,
        request.poseId,
        request.displayName,
        request.requiredHands,
      );
    },
  });
  sessionPanel.element.hidden = true;

  // -- consent, then the camera -------------------------------------------

  const consent = new ConsentGate({
    mount,
    document,
    onAccept: () => {
      void begin();
    },
  });
  // Mounted last so the gate sits above everything; nothing below it is usable until it is gone.
  mount.insertBefore(consent['root'] ?? mount.lastElementChild!, mount.firstChild);

  shell.setState('consent');

  /** Poses the dataset already knows, derived from the bundle — never another app's catalog. */
  async function knownPoses(): Promise<readonly KnownPose[]> {
    try {
      const bundle = await loadExemplarBundle({
        supportedFormatVersion: 1,
        expectedFingerprint:
          typeof __DATASET_FINGERPRINT__ === 'string' ? __DATASET_FINGERPRINT__ : null,
      });
      // `loadSessionConfig` is read only for its bundle format expectations; capture does not
      // touch recognition thresholds and never passes them anywhere (FR-023).
      await loadSessionConfig({ knownPoseIds: bundle.poses.map((pose) => pose.poseId) });
      return bundle.poses.map((pose) => ({
        poseId: pose.poseId,
        displayName: pose.displayName,
        requiredHands: (pose.requiredHands === 2 ? 2 : 1) as RequiredHands,
      }));
    } catch {
      // No bundle is not an error here: collecting samples for poses the dataset does not have
      // yet is a supported path, so the operator simply types the identifier.
      return [];
    }
  }

  async function begin(): Promise<void> {
    shell.setState('starting');
    try {
      const stage = new Stage({ canvas: shell.stageCanvas });
      const detector = await createMediaPipeDetector({ wasmPath: WASM_PATH });
      const sessionConfig = await loadSessionConfig();

      controller = new CaptureController({
        camera: new GetUserMediaCamera(),
        detector,
        stage,
        repository,
        config: captureConfig,
        time: timeSource,
        overlay: (frame) =>
          landmarkOverlayCommands(frame, sessionConfig.renderer, frame.width, frame.height),
        onFrame: (snapshot) => render(snapshot),
        onTakeFinished: () => {
          void refreshSamples();
        },
        onError: (error) => shell.showFailure(error),
      });

      await controller.start();
      shell.setState('ready');
      sessionPanel.element.hidden = false;
      await refreshSamples();
    } catch (error) {
      shell.showFailure(error);
    }
  }

  async function startSession(
    contributorLabel: string,
    poseId: string,
    displayName: string | null,
    requiredHands: RequiredHands,
  ): Promise<void> {
    try {
      session = createSession(
        {
          id: timeSource.newId(),
          contributorLabel,
          poseId,
          displayName,
          requiredHands,
          startedAt: timeSource.now(),
        },
        captureConfig,
      );
      await repository.createSession(session);
      controller?.useSession(session);
      takeControls.setRequiredHands(requiredHands);
      takeControls.setEnabled(true);
      takeControls.element.hidden = false;
      sampleList.element.hidden = false;
      sessionPanel.element.hidden = true;
      shell.showNotice('');
      await refreshSamples();
    } catch (error) {
      shell.showFailure(error);
    }
  }

  /** Redraw the review list and the export availability from the store's own answer. */
  async function refreshSamples(): Promise<void> {
    try {
      const samples: readonly CaptureSample[] =
        session === null ? [] : await repository.listSamples(session.id);
      sampleList.render(samples);
      exportPanel.setSampleCount(await repository.countAll());
      if (session !== null) {
        const stored = (await repository.listSessions()).find((s) => s.id === session?.id);
        if (stored !== undefined) {
          session = stored;
          controller?.useSession(stored);
        }
      }
    } catch (error) {
      shell.showFailure(error);
    }
  }

  function render(snapshot: CaptureSnapshot): void {
    shell.update(snapshot);
    takeControls.update(snapshot);
  }

  function exit(): void {
    controller?.stop();
    controller = null;
    repository.close();
    shell.setState('consent');
    shell.showNotice('Capture Mode is off and the camera has been released.');
  }

  // Release the camera when the page goes away — the light going out is the only signal an
  // operator has that it really stopped (FR-010).
  window.addEventListener('pagehide', () => exit());
}

void main();
