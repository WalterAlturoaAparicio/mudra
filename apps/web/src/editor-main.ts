/**
 * The editor's composition root (T034; constitution v1.7.0, Milestone 2).
 *
 * Mirrors `main.ts`'s discipline exactly: one place concrete adapters are constructed and
 * injected, no module-level singleton, no global mutable state (constitution Principle I). The
 * editor shares the **same kinds** of collaborators the default experience uses — one
 * `ActionRegistry`, one `EffectRuntime` — so an effect authored here is, by construction, the
 * same shape `main.ts` executes for a real visitor (SC-008).
 *
 * Project-first startup (item 6): everything up to and including the active-project lookup
 * below runs regardless of whether a project exists yet — none of it is project-specific.
 * Only once a `Project` is actually in hand (loaded, or explicitly created/opened/imported
 * through `ProjectStartScreen`) does `mountEditor()` build the dock layout and the editor
 * surfaces around it. No project is ever fabricated silently.
 *
 * This is also where the two menus are assembled (items 8 and 9): **File**'s items come from
 * `ProjectPanel`, which performs them; **View**'s are built here, because layout is this
 * root's own concern — which panels exist, where they mount, and what is persisted about them.
 */

import { EditorRuntimeController } from './application/editor-runtime-controller';
import { createProject } from './domain/editor/types';
import type { Project } from './domain/editor/types';
import type { EditorLayout } from './domain/ports/layout-store';
import { NearestNeighbourMatcher } from './domain/recognition/matcher';
import type { PoseEntry } from './domain/recognition/types';
import { createActionRegistry } from './domain/runtime/actions';
import { probeCapabilities } from './domain/runtime/capabilities';
import { EffectRuntime } from './domain/runtime/effect-runtime';
import { ManifestAssetResolver } from './infrastructure/assets/asset-manifest';
import { HtmlAudioSink } from './infrastructure/audio/audio-sink';
import { GetUserMediaCamera } from './infrastructure/camera/get-user-media-camera';
import { loadSessionConfig } from './infrastructure/config/session-config-loader';
import { createMediaPipeDetector } from './infrastructure/detection/mediapipe-detector';
import { createMediaPipeFaceDetector } from './infrastructure/detection/mediapipe-face-detector';
import { loadEffectCatalog } from './infrastructure/effects/catalog-loader';
import { loadExemplarBundle } from './infrastructure/exemplars/bundle-loader';
import { IndexedDbAssetBlobStore } from './infrastructure/persistence/indexeddb-asset-blob-store';
import { IndexedDbLayoutStore } from './infrastructure/persistence/indexeddb-layout-store';
import { IndexedDbProjectRepository } from './infrastructure/persistence/indexeddb-project-repository';
import { createMediaPipePersonSegmenter } from './infrastructure/segmentation/mediapipe-person-segmenter';
import {
  buildProjectAssetManifest,
  findBrokenEffectAssetReferences,
  referencedBy,
} from './infrastructure/assets/project-asset-manifest';
import { AssetLibraryPanel } from './presentation/editor/asset-library-panel';
import { CameraPanel } from './presentation/editor/camera-panel';
import { DialogHost } from './presentation/editor/dialog';
import { DockLayout } from './presentation/editor/dock-layout';
import { EditorShell } from './presentation/editor/editor-shell';
import { MenuBar } from './presentation/editor/menu-bar';
import type { MenuItem } from './presentation/editor/menu-bar';
import { LAYOUTS } from './presentation/editor/layout-catalog';
import { LAYOUT_PRESETS } from './presentation/editor/panel-sizes';
import { ParticlePreview } from './presentation/editor/particle-preview';
import type { PoseOption } from './presentation/editor/pose-trigger-panel';
import { ProjectPanel } from './presentation/editor/project-panel';
import { ProjectStartScreen } from './presentation/editor/project-start-screen';
import { DiagnosticsPanel } from './presentation/debug/diagnostics-panel';
import { faceOverlayCommands } from './presentation/debug/face-overlay';
import { landmarkOverlayCommands } from './presentation/debug/landmark-overlay';
import { PipelineSection } from './presentation/debug/pipeline-section';
import type { FaceAnchorTrace } from './domain/runtime/effect-runtime';
import type { RenderCommand } from './domain/runtime/frame-output';
import { Stage } from './presentation/stage/stage';

declare const __DATASET_FINGERPRINT__: string | null;

/** Same stable path `vite.config.ts` serves the MediaPipe WASM runtime from. */
const WASM_PATH = '/mediapipe-wasm';

/**
 * The action type the particle preview is offered for.
 *
 * A composition-root concern by design: the inspector asks a factory whether a type has a
 * preview and knows nothing about which do (FR-072), and the runtime has no notion of previews
 * at all. Wiring one concrete panel to one concrete action is exactly what a composition root
 * is for — the same file that already decides which segmenter, which camera, and which
 * repository this application uses.
 */
const PARTICLE_ACTION_TYPE = 'particle_burst';

/**
 * Editor history bound (FR-075a) — data-model.md documents this value alongside
 * `config/capture.json`'s `undoDepth` (both default to 50), but the editor cannot read that
 * file directly: `test/architecture/capture-boundary.test.ts` forbids any project-tree module
 * from importing anything under `infrastructure/config/capture-config-loader` or the wider
 * `capture-`/`/capture/` namespace, on purpose — Capture Mode and the editor share nothing,
 * gated build or not. A literal here, kept equal to capture.json's default by convention
 * rather than by a shared import, is the boundary working as designed, not a shortcut around it.
 */
const UNDO_DEPTH = 50;

/** Stable ids for the panels View can show and hide (item 9). Persisted, so they must not drift. */
const PANEL_IDS = {
  project: 'project',
  explorer: 'explorer',
  assets: 'assets',
  effect: 'effect',
  trigger: 'trigger',
  palette: 'palette',
  inspector: 'inspector',
  camera: 'camera',
  diagnostics: 'diagnostics',
  timeline: 'timeline',
} as const;

/** The dataset's three pose populations, as one list the pose/trigger panel can render. */
function buildPoseOptions(
  poses: readonly PoseEntry[],
  excluded: readonly { readonly poseId: string }[],
  activePoseSet: readonly string[],
): readonly PoseOption[] {
  const eligible: PoseOption[] = poses.map((pose) => ({
    poseId: pose.poseId,
    displayName: pose.displayName,
    eligible: true,
    active: activePoseSet.includes(pose.poseId),
  }));
  const catalogOnly: PoseOption[] = excluded.map((pose) => ({
    poseId: pose.poseId,
    displayName: pose.poseId,
    eligible: false,
    active: false,
  }));
  return [...eligible, ...catalogOnly];
}

async function bootstrap(): Promise<void> {
  const mountElement = document.getElementById('mudra-editor-root');
  if (mountElement === null) {
    throw new Error('editor.html is missing the #mudra-editor-root mount element.');
  }
  // A separately-typed `const` for the nested functions below to close over: TypeScript does
  // not carry a null-check's narrowing across a closure boundary, even for a `const`.
  const mount: HTMLElement = mountElement;
  mount.textContent = 'Loading editor…';

  const registry = createActionRegistry();
  const assets = new ManifestAssetResolver();

  const bundle = await loadExemplarBundle({
    supportedFormatVersion: 1,
    expectedFingerprint:
      typeof __DATASET_FINGERPRINT__ === 'string' ? __DATASET_FINGERPRINT__ : null,
  });
  const config = await loadSessionConfig({
    knownPoseIds: bundle.poses.map((pose) => pose.poseId),
  });
  const defaultCatalog = await loadEffectCatalog({ registry });
  const matcher = new NearestNeighbourMatcher(bundle, config.recognition.weights);

  // Rejects honestly — no model present, an unsupported browser, no compatible delegate —
  // and `probeCapabilities()` turns that into the same "unavailable, reported" state
  // FR-041/FR-042 already require; nothing here assumes the model was fetched.
  //
  // Face landmarks (Spec 011) are probed the same way, independently: a missing face model — the
  // default until a developer provisions it — marks only `face_landmarks` unavailable. Probing
  // only *constructs* the detector; nothing is analysed until a camera is attached and a
  // scheduled face-anchored action needs a face. The detector is page-scoped and closed once,
  // at `pagehide`, never by camera detach or by closing a project.
  const { capabilities, segmenter, faceDetector } = await probeCapabilities(
    () => createMediaPipePersonSegmenter({ wasmPath: WASM_PATH }),
    undefined,
    () => createMediaPipeFaceDetector({ wasmPath: WASM_PATH }),
  );

  const runtime = new EffectRuntime({
    catalog: defaultCatalog,
    registry,
    capabilities,
    resolveAsset: (reference) => assets.resolve(reference),
  });

  const poses = buildPoseOptions(bundle.poses, bundle.excluded, config.activePoseSet);
  const repository = new IndexedDbProjectRepository(registry);

  /** The same empty-catalog factory `ProjectStartScreen` and File ▸ New Project share —
   *  a project is only ever created by an explicit author action, never silently (item 6). */
  const onCreateProject = (): Project =>
    createProject(
      { version: 1, effects: [] },
      'project-' + Date.now().toString(36),
      'Untitled project',
      Date.now(),
    );

  /** Build the full editor around an already-open project. */
  async function mountEditor(initialProject: Project): Promise<void> {
    const layoutStore = new IndexedDbLayoutStore();
    const savedLayout = await layoutStore.load();

    // The editor's one modal host (spec 010 correction pass, item 6) — shared by `ProjectPanel`
    // (Save As / Close Project's own confirmations, previously wired to nothing, so both
    // silently fell back to `window.confirm`/no-op) and `EditorShell` (the leave-effect-with-
    // unsaved-changes prompt). `DialogHost` only ever shows one dialog at a time, so one shared
    // instance is correct, not merely convenient.
    const dialogs = new DialogHost({ document });
    mount.replaceChildren(dialogs.root);

    /** Persist the whole chrome state — sizes, hidden panels, preset — as one record. */
    const persistLayout = (layout: EditorLayout): void => {
      void layoutStore.save(layout);
    };

    const dockLayout = new DockLayout({
      document,
      ...(savedLayout === null ? {} : { initialSizes: savedLayout }),
      ...(savedLayout?.hiddenPanels === undefined
        ? {}
        : { initialHiddenPanels: savedLayout.hiddenPanels }),
      ...(savedLayout?.preset === undefined ? {} : { initialPreset: savedLayout.preset }),
      ...(savedLayout?.activeLayoutId === undefined
        ? {}
        : { initialActiveLayoutId: savedLayout.activeLayoutId }),
      ...(savedLayout?.activeTabs === undefined
        ? {}
        : { initialActiveTabs: savedLayout.activeTabs }),
      ...(savedLayout?.zoneLayouts === undefined
        ? {}
        : { initialZoneLayouts: savedLayout.zoneLayouts }),
      onSizesChange: () => persistLayout(dockLayout.getLayout()),
      onLayoutChange: (layout) => persistLayout(layout),
    });
    mount.append(dockLayout.root);

    // Reassigned by `onProjectChange` below to whichever resolver reflects the currently open
    // project's asset library — the diagnostics panel always reads unresolved references from
    // the resolver actually driving playback, never a stale one.
    let currentAssetResolver: ManifestAssetResolver = assets;
    // `audio`'s resolver is this same closure over `currentAssetResolver` — never the concrete
    // instance directly — so a project's asset-library edit (which replaces the resolver
    // instance, immediately above) reaches audio playback too, without reconstructing the sink
    // (P1.2, mirrors how `runtime.setResolveAsset` already keeps the runtime's own resolver
    // current).
    const audio = new HtmlAudioSink({
      resolve: (reference) => currentAssetResolver.resolve(reference),
    });
    const diagnosticsPanel = new DiagnosticsPanel(document, {
      budgets: config.budgets,
      capabilities,
      unresolvedAssets: () => currentAssetResolver.unresolvedReferences,
      audioSkips: () => audio.skipped,
    });

    const pipelineSection = new PipelineSection(document, capabilities);
    /** The latest face-anchor resolutions and when they happened — feeds the FaceMark overlay,
     *  which drops them once stale rather than drawing a frozen marker. */
    let latestFaceAnchors: {
      readonly traces: readonly FaceAnchorTrace[];
      readonly atMs: number;
    } | null = null;
    const FACE_OVERLAY_FRESH_MS = 500;

    const stageCanvas = document.createElement('canvas');
    const stage = new Stage({ canvas: stageCanvas });
    const runtimeController = new EditorRuntimeController({
      runtime,
      stage,
      matcher,
      config,
      audio,
      faceDetector,
      // FR-058/FR-059, SC-010, quickstart scenario 14: the same performance panel `main.ts`
      // uses, so the live pipeline's numeric budgets stay observable while the editor UI —
      // dragging a clip, opening a panel — is being interacted with.
      onFrame: (snapshot) => {
        diagnosticsPanel.update(
          snapshot.performance,
          snapshot.runtime.diagnostics,
          snapshot.activePlaybacks,
        );
        shell.setRuntimeDiagnostics(snapshot.runtime.diagnostics);
        // Spec 011: display-only — shows whether face analysis ran this frame, plus the fixed hold.
        shell.reflectFaceTracking(snapshot);
        if (snapshot.runtime.faceAnchors.length > 0) {
          latestFaceAnchors = { traces: snapshot.runtime.faceAnchors, atMs: snapshot.nowMs };
        }
        pipelineSection.update(snapshot);
      },
    });

    // **The camera-treatment fix (item 7).** These settings are project-level configuration,
    // and they are applied here, once, at mount — before the first frame is ever presented.
    // Previously the controller was told about them only from `onProjectChange`, i.e. only
    // after an author moved a slider, which is exactly why a reloaded project rendered
    // untreated until something was nudged. Nothing about the camera *device* is touched:
    // `Stage.present()` applies the treatment to a separate offscreen copy each frame, so
    // changing it never restarts a stream and never reaches the imagery detection sees
    // (FR-051).
    runtimeController.setCameraTreatment(initialProject.cameraTreatment);

    const blobStore = new IndexedDbAssetBlobStore();
    // A holder, not a `let`: these are assigned exactly once, after `shell` exists, but are
    // referenced from callbacks `shell`'s own construction wires up first.
    const panels: { assetLibrary: AssetLibraryPanel | undefined; camera: CameraPanel | undefined } =
      { assetLibrary: undefined, camera: undefined };

    /** One host element per show/hide-able panel, registered with the layout. */
    const hosts = new Map<string, HTMLElement>();
    const host = (id: string): HTMLElement => {
      const element = document.createElement('div');
      hosts.set(id, element);
      return element;
    };

    const explorerHost = host(PANEL_IDS.explorer);
    const projectHost = host(PANEL_IDS.project);
    const assetsHost = host(PANEL_IDS.assets);
    const effectHost = host(PANEL_IDS.effect);
    const triggerHost = host(PANEL_IDS.trigger);
    const paletteHost = host(PANEL_IDS.palette);
    const inspectorHost = host(PANEL_IDS.inspector);
    const cameraHost = host(PANEL_IDS.camera);
    const diagnosticsHost = host(PANEL_IDS.diagnostics);
    const timelineHost = host(PANEL_IDS.timeline);

    let cameraOn = false;
    let debugEnabled = false;
    const shell = new EditorShell({
      document,
      layout: {
        center: dockLayout.slots.center,
        right: inspectorHost,
        timeline: timelineHost,
        explorer: explorerHost,
        effect: effectHost,
        trigger: triggerHost,
        palette: paletteHost,
        inspector: inspectorHost,
      },
      registry,
      runtimeController,
      runtime,
      stageCanvas,
      initialProject,
      poses,
      historyDepth: UNDO_DEPTH,
      dialogs,
      resolveAsset: (reference) => currentAssetResolver.resolve(reference),
      createPreview: (actionType) => {
        if (actionType !== PARTICLE_ACTION_TYPE) {
          return null;
        }
        const preview = new ParticlePreview({ document });
        // Ticks come from the controller's own loop — `presentation/editor/**` may not run a
        // frame loop of its own (`test/architecture/layering.test.ts`).
        const unsubscribe = runtimeController.addFrameListener((snapshot) => {
          preview.tick(snapshot.runtime.activePlaybacks >= 0 ? performance.now() : 0);
        });
        return {
          root: preview.root,
          update: (params, durationMs) => preview.update(params, durationMs),
          destroy: () => {
            unsubscribe();
            preview.destroy();
          },
        };
      },
      onSelectAsset: (reference) => panels.assetLibrary?.select(reference),
      onProjectChange: (changed) => {
        // Undo/redo history is now `EditorShell`'s own concern, scoped per editing context
        // (spec 010 correction pass, item 6) — this hook no longer records anything itself.
        // The Edit menu's Undo/Redo state is not refreshed here: `MenuBar` already refreshes
        // itself after every click and every accelerator it handles (including these two), and
        // refreshing an already-hidden panel here would do nothing visible — the next `open()`
        // is what makes it correct.
        // Every edit — not only an asset-library one — re-derives the resolver, so a rename
        // or removal is reflected immediately too. Cheap enough at this project's scale
        // (FR-036 keeps the library deliberately small).
        void buildProjectAssetManifest(changed.assetLibrary, blobStore).then((manifest) => {
          const resolver = new ManifestAssetResolver(manifest);
          currentAssetResolver = resolver;
          runtime.setResolveAsset((reference) => resolver.resolve(reference));
          // FR-038: broken references are surfaced here, at inspection time, not only the
          // first time a playback happens to reach one.
          const broken = findBrokenEffectAssetReferences(changed, registry, manifest);
          panels.assetLibrary?.showBrokenReferences(broken);
        });
        panels.assetLibrary?.render();
        panels.camera?.render(changed.cameraTreatment);
        runtimeController.setCameraTreatment(changed.cameraTreatment);
      },
      onToggleCamera: async () => {
        if (cameraOn) {
          runtimeController.detachCamera();
          cameraOn = false;
          shell.setCameraOn(false);
          return;
        }
        // A genuine user gesture — the only moment a browser accepts as consent to make noise
        // (P1.2, same reasoning `main.ts`'s own `audio.unlock()` call documents).
        audio.unlock();
        const camera = new GetUserMediaCamera();
        const cameraSession = await camera.open();
        const detector = await createMediaPipeDetector({ wasmPath: WASM_PATH });
        runtimeController.attachCamera(cameraSession, detector, segmenter);
        cameraOn = true;
        shell.setCameraOn(true);
      },
    });
    shell.setCapabilities(capabilities);

    const projectPanel = new ProjectPanel({
      document,
      repository,
      prompts: dialogs,
      onCreateProject,
      getCurrentProject: () => shell.currentProject,
      onProjectSaved: () => persistLayout(dockLayout.getLayout()),
      onProjectOpened: (opened) => {
        // A different project's past is not this one's undo history — `EditorShell.loadProject`
        // starts a fresh editing context itself now (spec 010 correction pass, item 6).
        shell.loadProject(opened);
        projectPanel.setCurrentOpen(opened.id, opened.name);
        // Item 7, the other half: a project opened *after* mount must apply its own camera
        // treatment immediately too, not on the next slider move.
        runtimeController.setCameraTreatment(opened.cameraTreatment);
        panels.camera?.render(opened.cameraTreatment);
        void refreshActiveStanding();
      },
      onRename: (name) => shell.renameProject(name),
      onCloseProject: () => {
        runtimeController.stop();
        showStartScreen();
      },
    });
    projectPanel.setCurrentOpen(initialProject.id, initialProject.name);
    projectHost.append(projectPanel.root);

    /** Tell the editor whether this project is the one the public page runs (item 19). */
    async function refreshActiveStanding(): Promise<void> {
      const activeId = await repository.getActiveProjectId();
      shell.setProjectIsActive(activeId !== null && activeId === shell.currentProject.id);
    }

    panels.assetLibrary = new AssetLibraryPanel({
      document,
      blobStore,
      getLibrary: () => shell.currentProject.assetLibrary,
      onLibraryChange: (library) => shell.updateAssetLibrary(library),
      referencedBy: (reference) => referencedBy(shell.currentProject, registry, reference),
    });
    assetsHost.append(panels.assetLibrary.root);

    panels.camera = new CameraPanel(
      {
        document,
        onChange: (settings) => shell.updateCameraTreatment(settings),
      },
      initialProject.cameraTreatment,
    );
    cameraHost.append(panels.camera.root);
    diagnosticsHost.append(diagnosticsPanel.root, pipelineSection.root);

    // Registration order is mount order within each region.
    dockLayout.registerPanel({
      id: PANEL_IDS.project,
      label: 'Project',
      region: 'left',
      element: projectHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.explorer,
      label: 'Project explorer',
      region: 'left',
      element: explorerHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.assets,
      label: 'Assets',
      region: 'left',
      element: assetsHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.effect,
      label: 'Effect',
      region: 'right',
      element: effectHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.trigger,
      label: 'Pose & Trigger',
      region: 'right',
      element: triggerHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.palette,
      label: 'Actions',
      region: 'right',
      element: paletteHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.inspector,
      label: 'Inspector',
      region: 'right',
      element: inspectorHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.camera,
      label: 'Camera',
      region: 'right',
      element: cameraHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.diagnostics,
      label: 'Diagnostics',
      region: 'right',
      element: diagnosticsHost,
    });
    dockLayout.registerPanel({
      id: PANEL_IDS.timeline,
      label: 'Timeline',
      region: 'timeline',
      element: timelineHost,
    });
    // Every panel is registered: settle the restored trees so each open panel is mounted.
    dockLayout.finishRestore();

    /**
     * Debug mode in the editor (item 21).
     *
     * Deliberately the smallest thing that is genuinely useful and genuinely separate: the
     * existing `landmarkOverlayCommands` — the same overlay the public page's own debug mode
     * draws — handed to the controller as its overlay provider, drawn through the same
     * `Stage.present()` overlay argument that already exists. No second renderer, no debug
     * branch inside any effect, and nothing added to the normal user-facing UI.
     */
    let faceDebugEnabled = false;
    /** FaceMark: only what the pipeline already analysed / resolved, and only while fresh. */
    const faceOverlayNow = (nowMs: number): readonly RenderCommand[] => {
      const analysis = runtimeController.lastFaceAnalysis;
      const face =
        analysis !== null && nowMs - analysis.atMs <= FACE_OVERLAY_FRESH_MS ? analysis.frame : null;
      const anchors =
        latestFaceAnchors !== null && nowMs - latestFaceAnchors.atMs <= FACE_OVERLAY_FRESH_MS
          ? latestFaceAnchors.traces
          : [];
      return faceOverlayCommands(face, anchors);
    };
    const applyOverlays = (): void => {
      runtimeController.setOverlayProvider(
        debugEnabled || faceDebugEnabled
          ? (frame) => [
              ...(debugEnabled
                ? landmarkOverlayCommands(frame, config.renderer, frame.width, frame.height)
                : []),
              ...(faceDebugEnabled ? faceOverlayNow(frame.timestampMs) : []),
            ]
          : null,
      );
      dockLayout.root.dataset['debug'] = debugEnabled ? 'true' : 'false';
      dockLayout.root.dataset['faceDebug'] = faceDebugEnabled ? 'true' : 'false';
      // The pipeline/FaceMark diagnostics are a debug surface: shown only while a debug toggle is on.
      pipelineSection.root.hidden = !(debugEnabled || faceDebugEnabled);
    };
    const setDebug = (enabled: boolean): void => {
      debugEnabled = enabled;
      applyOverlays();
    };
    const setFaceDebug = (enabled: boolean): void => {
      faceDebugEnabled = enabled;
      applyOverlays();
    };
    setDebug(false);

    const viewMenuItems: readonly MenuItem[] = [
      // A panel closed from its own header (or this checkbox) reopens here, in its current zone
      // (spec 010 correction pass, item 4) — this is the recovery mechanism for every panel that
      // is not currently part of the workspace.
      ...dockLayout.listPanels().map((panel): MenuItem => ({
        kind: 'checkbox',
        label: panel.label,
        description: 'Open or close the ' + panel.label + ' panel.',
        isChecked: () => dockLayout.isPanelVisible(panel.id),
        onToggle: () => dockLayout.togglePanel(panel.id),
      })),
      { kind: 'separator' },
      ...Object.keys(LAYOUT_PRESETS).map((preset): MenuItem => ({
        kind: 'checkbox',
        label: 'Layout: ' + preset,
        description: 'Apply the ' + preset + ' panel arrangement.',
        isChecked: () => dockLayout.currentPreset === preset,
        onToggle: () => dockLayout.applyPreset(preset),
      })),
      { kind: 'separator' },
      // Docking layouts (spec 010 FR-007) — a distinct concept from the size presets just
      // above: those resize today's fixed three regions, this switches which *predefined
      // layout* (zone topology) is active. Named "Docking:" rather than reusing "Layout:" so
      // the two are never read as the same menu.
      ...Object.values(LAYOUTS).map((dockingLayout): MenuItem => ({
        kind: 'checkbox',
        label: 'Docking: ' + dockingLayout.label,
        description: 'Switch to the ' + dockingLayout.label + ' docking layout.',
        isChecked: () => dockLayout.currentLayoutId === dockingLayout.id,
        onToggle: () => dockLayout.applyLayout(dockingLayout.id),
      })),
      { kind: 'separator' },
      {
        label: 'Remember This Layout',
        description: 'Keep the current panel sizes and visibility for the next session.',
        onSelect: () => persistLayout(dockLayout.getLayout()),
      },
      {
        label: 'Restore Remembered Layout',
        description: 'Return to the layout most recently remembered in this browser.',
        onSelect: () => {
          void layoutStore.load().then((stored) => {
            if (stored === null) {
              return;
            }
            dockLayout.applyPreset(stored.preset ?? dockLayout.currentPreset);
            for (const panel of dockLayout.listPanels()) {
              dockLayout.setPanelVisible(panel.id, !(stored.hiddenPanels ?? []).includes(panel.id));
            }
          });
        },
      },
      {
        label: 'Reset Layout',
        description: 'Restore the shipped panel sizes and show every panel again.',
        onSelect: () => dockLayout.resetToDefault(),
      },
      { kind: 'separator' },
      {
        kind: 'checkbox',
        label: 'Debug Overlay',
        description: 'Draw detected hand landmarks over the stage. Editor-only.',
        shortcut: 'Ctrl+Shift+D',
        isChecked: () => debugEnabled,
        onToggle: () => setDebug(!debugEnabled),
      },
      {
        kind: 'checkbox',
        label: 'FaceMark Debug',
        description:
          "Draw the face mesh and each face-anchored action's resolved landmark. Editor-only; observes, never triggers face analysis.",
        isChecked: () => faceDebugEnabled,
        onToggle: () => setFaceDebug(!faceDebugEnabled),
      },
    ];

    // Undo/redo (spec 009 P3, corrected by spec 010's correction pass, item 6): `EditorShell`
    // now owns the history, scoped to whichever effect is the active editing context, so these
    // two menu items are thin pass-throughs rather than owning a global stack themselves.
    const editMenuItems: readonly MenuItem[] = [
      {
        label: 'Undo',
        description: 'Undo the last edit, within the effect currently being edited.',
        shortcut: 'Ctrl+Z',
        onSelect: () => shell.undo(),
        isEnabled: () => shell.canUndo,
        disabledReason: 'Nothing to undo yet in this effect.',
      },
      {
        label: 'Redo',
        description: 'Redo the last undone edit, within the effect currently being edited.',
        shortcut: 'Ctrl+Y',
        onSelect: () => shell.redo(),
        isEnabled: () => shell.canRedo,
        disabledReason: 'Nothing to redo.',
      },
    ];

    const menuBar = new MenuBar({
      document,
      menus: [
        { label: 'File', items: projectPanel.fileMenuItems() },
        { label: 'Edit', items: editMenuItems },
        { label: 'View', items: viewMenuItems },
      ],
    });
    dockLayout.slots.menu.append(menuBar.root);
    // Otherwise every item's disabled/checked state is whatever the DOM defaulted to until
    // the first menu open — visible as, e.g., Undo/Redo both reading enabled for a project
    // with no edit yet, the instant the editor first paints.
    menuBar.refresh();

    const title = document.createElement('span');
    title.className = 'mudra-menubar__title';
    title.textContent = 'Mudra Editor';
    dockLayout.slots.menu.append(title);

    void refreshActiveStanding();
    runtimeController.start();
    window.addEventListener('pagehide', () => {
      runtimeController.stop();
      // The one terminal release of the face detector: end of the page, not of a camera session.
      faceDetector?.close();
    });
  }

  /** Return to the project-first start screen — File ▸ Close Project, and first run. */
  function showStartScreen(notice?: string): void {
    const startScreen = new ProjectStartScreen({
      document,
      repository,
      onCreateProject,
      onProjectReady: (project) => {
        void mountEditor(project);
      },
      ...(notice === undefined ? {} : { notice }),
    });
    mount.replaceChildren(startScreen.root);
  }

  const activeId = await repository.getActiveProjectId();
  let initialProject: Project | null = null;
  let startNotice: string | undefined;
  if (activeId !== null) {
    try {
      initialProject = await repository.load(activeId);
    } catch (error) {
      startNotice =
        'The previously active project could not be loaded: ' +
        (error instanceof Error ? error.message : String(error));
    }
  }

  if (initialProject !== null) {
    await mountEditor(initialProject);
    return;
  }

  showStartScreen(startNotice);
}

bootstrap().catch((error: unknown) => {
  const mount = document.getElementById('mudra-editor-root');
  if (mount !== null) {
    mount.textContent = 'The editor failed to start.';
  }
  console.error(error);
});
