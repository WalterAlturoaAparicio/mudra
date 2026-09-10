# Tasks: Mudra Web — Visual Effect Editor

**Input**: Design documents from `/specs/008-effect-editor/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. This codebase's constitution (Principle IV) mandates domain-layer tests, and
every contract in `contracts/` already names specific test files under its "Verification" section
— those names are treated as binding, not illustrative, and are the task IDs below.

**Organization**: Tasks are grouped by user story (spec.md, P1/P2/P2/P3) so each can be implemented
and validated independently, on top of one shared Foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4, matching spec.md's four user stories
- All file paths are relative to the repository root unless stated otherwise

---

## Phase 1: Setup

**Purpose**: Everything the Foundational phase and every user story phase build on.

- [X] T001 Add `fake-indexeddb` as a devDependency in `apps/web/package.json` (used only by adapter-level persistence tests; research D2)
- [X] T002 [P] Document and script a fetch-once-if-missing step for `assets/selfie_segmenter.tflite` (MediaPipe's public selfie-segmentation model), mirroring how `assets/hand_landmarker.task` is already obtained (`apps/engine/config/models.py`'s `model_url` fallback) — added as `apps/web/tools/fetch-selfie-segmenter.mjs` (not `apps/web/scripts/`: that path is reserved by an existing architecture test, `test/architecture/boundaries.test.ts`, for the repo-level Python export scripts only), wired to `npm run fetch-models`, documented in `apps/web/README.md`'s Prerequisites (research D7)
- [X] T003 Generalize `apps/web/vite.config.ts`'s `sharedModelPlugin()` to serve a list of shared repository-level models — `hand_landmarker.task` (unchanged) and `selfie_segmenter.tflite` (new) — at stable, distinct dev/build URLs
- [X] T004 [P] Create the editor's entry document `apps/web/editor.html` (mirrors `apps/web/index.html`'s existing structure) and its script entry `apps/web/src/editor-main.ts` (empty composition-root shell, populated in Phase 3)
- [X] T005 [P] Update `apps/web/README.md`'s "Storage" line (currently "None") to describe IndexedDB-backed local project persistence, and add a stub "Editor" section heading this feature's later tasks fill in (T069)

**Checkpoint**: Project builds; the editor route loads a blank page; no functional change yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain types, ports, and architecture-test scope every user story phase depends
on. **No user story task may start before this phase is complete.**

- [ ] T006 Define `Project`, `AssetLibrary`, `AssetLibraryEntry`, `CameraTreatmentSettings` types in `apps/web/src/domain/editor/types.ts` (data-model.md)
- [X] T007 Implement project validation in `apps/web/src/infrastructure/persistence/project-schema.ts` (relocated here during implementation from the originally planned `domain/editor/` path: it imports `catalog-loader.ts`, an infrastructure module, which the framework-free domain layer must never do — `Project`'s pure value types stay in `domain/editor/types.ts` per T006; only the wire-format parse/serialize logic lives in infrastructure): `schemaVersion` check, `catalog` (wire-format JSON) parsed via `infrastructure/effects/catalog-loader.ts`'s existing `parseCatalog` (unmodified), `assetLibrary` entry shape check — same fail-at-load discipline as `parseSessionConfig`. Also added `serializeCatalog(catalog: EffectCatalog): Json` to `catalog-loader.ts` itself, the exact structural inverse of `parseCatalog` (domain in, wire-format `catalog_version`/snake_case JSON out), so the wire/domain mapping continues to live in one place for both directions (contracts/project-schema.md)
- [ ] T008 [P] Define the `ProjectRepository` port in `apps/web/src/domain/ports/project-repository.ts` (data-model.md)
- [ ] T009 [P] Define the `PersonSegmenter` port in `apps/web/src/domain/ports/segmenter.ts` and the `SegmentationFrame` value type in `apps/web/src/domain/editor/segmentation-frame.ts` (data-model.md)
- [ ] T010 Add `MaskedEraseCommand` to the `RenderCommand` union in `apps/web/src/domain/runtime/frame-output.ts` (contracts/render-commands-extension.md)
- [ ] T011 Add the `segmentation: SegmentationFrame | null` field to `ActionContext` in `apps/web/src/domain/runtime/action-registry.ts`
- [ ] T012 Add `EffectRuntime.startEffect(effectId, nowMs)` to `apps/web/src/domain/runtime/effect-runtime.ts` for Play Timeline, reusing the existing internal playback-push logic `startTriggered` already has (research D9)
- [ ] T013 Replace `defaultCapabilities()` with an async `probeCapabilities(segmenterFactory): Promise<CapabilityRegistry>` in `apps/web/src/domain/runtime/capabilities.ts`, attempting `PersonSegmenter` construction behind a `try/catch`; `MapCapabilityRegistry` itself is unchanged (research D7)
- [ ] T014 [P] Create `apps/web/test/support/fake-project-repository.ts`: an in-memory `ProjectRepository` for domain-level tests (no browser, no IndexedDB)
- [ ] T015 Implement `EditorRuntimeController` in `apps/web/src/application/editor-runtime-controller.ts`: owns one `EffectRuntime` + `Stage`, advances every tick independent of whether a `CameraSource` is open, feeding an empty `LandmarkFrame` when it is not (research D11)
- [ ] T016 Extend `apps/web/test/architecture/no-hardcoded-effects.test.ts`'s glob scope to `src/presentation/editor/**` and `src/domain/editor/**` (research D12)
- [ ] T017 Extend `apps/web/test/architecture/layering.test.ts` to assert `src/presentation/editor/**` calls no `CanvasRenderingContext2D` member and owns no independent frame-scheduling loop of its own (contracts/editor-runtime-boundary.md)
- [ ] T018 Extend `apps/web/test/architecture/privacy.test.ts`'s prohibited-API scan to every new source tree, adding the one explicit, scoped exception for `indexedDB` under `src/infrastructure/persistence/**` (contracts/privacy-persistence.md)
- [ ] T019 [P] `apps/web/test/domain/project.test.ts`: schema-version mismatch, malformed `catalog`, broken asset-library entry — each a specific, attributable load error (contracts/project-schema.md)
- [ ] T020 [P] `apps/web/test/domain/capability-segmentation.test.ts`: `probeCapabilities()`'s success and failure branches, including that failure never throws past the composition root

**Checkpoint**: Domain types, ports, extended architecture tests, and the camera-optional runtime
controller all exist and pass. Every user story phase below builds only on this.

---

## Phase 3: User Story 1 - Build and preview an effect without touching code (Priority: P1) 🎯 MVP

**Goal**: A live camera/canvas stage, an action palette, a schema-driven inspector, a timeline, and
a pose/trigger panel, wired so an author can compose a multi-action effect and trigger it via Test
Trigger, Play Timeline, or a real pose — all through the existing `EffectRuntime`/renderer.

**Independent Test**: Open the editor with no saved project, add two actions, change three
properties, position both on the timeline, and trigger via both Test Trigger and a real pose hold.

- [ ] T021 [P] [US1] Implement `apps/web/src/presentation/editor/palette.ts`: lists `ActionRegistry.all()`, one entry per action type, marks entries whose `requiresCapability` the current `CapabilityRegistry` reports unavailable
- [ ] T022 [US1] Implement `apps/web/src/presentation/editor/inspector.ts`: `renderFieldsFor(actionType, params)`, generating one control per `ParamSpec.kind`, reading `ActionDescriptor.params` from the shared `ActionRegistry` instance (research D6)
- [ ] T023 [US1] Implement the seven per-kind control renderers (number, color, enum, asset, anchor, boolean, string) in `apps/web/src/presentation/editor/inspector-controls.ts`, each validating a change through the existing `resolveParams`/`ParamError` before it commits
- [ ] T024 [US1] Implement `apps/web/src/presentation/editor/timeline.ts`: renders clips from a selected effect's `TimelineEntry[]` using the greedy interval-packing lane layout (research D5, presentation-only — no data-model change)
- [ ] T025 [US1] Implement clip selection, drag-to-move (writes `atMs`), and edge-drag-to-resize (writes `durationMs`) in `timeline.ts`, touching only the dragged/resized entry
- [ ] T026 [US1] Implement clip delete and duplicate in `timeline.ts`
- [ ] T027 [US1] Visually distinguish instantaneous / duration / continuous clips in `timeline.ts`, reading `ActionDescriptor.behaviour`
- [ ] T028 [US1] Implement `apps/web/src/presentation/editor/pose-trigger-panel.ts`: pose selector sourced from the loaded exemplar bundle plus `SessionConfig.activePoseSet` (read-only), and editors for `Trigger.on`/`Trigger.conditions`
- [ ] T029 [US1] In `pose-trigger-panel.ts`, visually distinguish catalog-only / eligible / active for the selected trigger's `poseId` (FR-020)
- [ ] T030 [US1] Implement "Test Trigger": construct a `PoseEvent` from the selected effect's `Trigger` (confidence satisfying every `confidenceAtLeast` condition) and call `EffectRuntime.advance()` via `EditorRuntimeController` (research D9)
- [ ] T031 [US1] Implement "Play Timeline" calling `EffectRuntime.startEffect()` (T012) via `EditorRuntimeController`
- [ ] T032 [US1] Wire `EditorRuntimeController`'s loop to the editor's live stage canvas: real `LandmarkFrame`s via `HandDetector`/`CameraSource` when a camera is open, an empty `LandmarkFrame` every tick when it is not (FR-026)
- [ ] T033 [US1] Implement `apps/web/src/presentation/editor/editor-shell.ts`, composing stage + palette + inspector + timeline + pose/trigger panel into one view over an in-memory default `Project`
- [ ] T034 [US1] Wire `apps/web/src/editor-main.ts` (T004) as the composition root: construct `ActionRegistry`, `probeCapabilities()`-derived `CapabilityRegistry`, `EditorRuntimeController`, and `editor-shell.ts`, sharing every instance a live session would use
- [ ] T035 [P] [US1] `apps/web/test/domain/editor-runtime.test.ts`: Test Trigger and Play Timeline both drive `EffectRuntime.advance()`/`startEffect()` and produce identical, documented `RenderCommand[]` sequences for the same simulated timing, headlessly (contracts/editor-runtime-boundary.md, SC-003)
- [ ] T036 [P] [US1] `apps/web/test/adapters/inspector.test.ts` (jsdom): registering a throwaway action type through the production `ActionRegistry` renders correct controls for it with zero inspector source changes (SC-002)
- [ ] T037 [P] [US1] `apps/web/test/adapters/timeline.test.ts` (jsdom): ten move/resize/delete/duplicate operations leave every untouched clip's `atMs`/`durationMs` byte-identical (SC-007)
- [ ] T038 [US1] Run quickstart.md scenarios 1–5 manually; record results

**Checkpoint**: US1 fully functional and independently testable — an author can build, edit, and
preview a multi-action effect end to end, with or without a camera, with no persistence yet.

---

## Phase 4: User Story 2 - Save work and come back to it (Priority: P2)

**Goal**: Local project persistence (create/save/load/duplicate/import/export) and the "set active"
mechanism that lets the default, zero-chrome experience run an authored project.

**Independent Test**: Build an effect, save the project, reload, load it back, confirm identical
content; export to a file and import it into a new project.

- [ ] T039 [P] [US2] Implement `apps/web/src/infrastructure/persistence/indexeddb-project-repository.ts` — full `ProjectRepository` (create/save/load/list/duplicate/remove/exportBlob/importBlob/get\|setActiveProjectId), one IndexedDB database, a `projects` object store and a single-row `meta` store. `save`/`exportBlob` call `serializeCatalog` (T007) on `Project.catalog` before writing; `load`/`importBlob` call `parseCatalog` on the stored/imported wire JSON before returning a `Project` — the domain `EffectCatalog` never touches the store directly (contracts/project-schema.md)
- [ ] T040 [US2] Implement `apps/web/src/presentation/editor/project-panel.ts`: create/save/load/duplicate/export/import UI, wired to `ProjectRepository`
- [ ] T041 [US2] Implement "Set Active" / "Clear Active" controls in `project-panel.ts`, calling `setActiveProjectId`
- [ ] T042 [US2] Wire the default route's composition root (`apps/web/src/main.ts`) to read `getActiveProjectId()` once at boot: on a hit, load and validate that project's `catalog` in place of `config/effects.json`; on a miss or a validation failure, fall back to the shipped default catalog and clear the pointer (FR-033a–c, research D10)
- [ ] T043 [P] [US2] `apps/web/test/adapters/indexeddb-project-repository.test.ts` (using `fake-indexeddb`): full create/save/load/duplicate/remove/export/import round-trip (SC-004) and the `ActiveProjectPointer` state-transition table from data-model.md
- [ ] T044 [P] [US2] Extend `apps/web/test/adapters/default-experience.test.ts` (or a new `default-route-active-project.test.ts`): active project present / absent / broken → correct catalog selection and pointer-clearing (FR-033c, quickstart scenario 9)
- [ ] T045 [US2] Run quickstart.md scenarios 6–9 manually; record results

**Checkpoint**: US1 AND US2 both work independently — projects persist, reload losslessly, and can
become the default experience.

---

## Phase 5: User Story 3 - Reference project assets instead of typing paths (Priority: P2)

**Goal**: A project-scoped asset library, an asset picker in the inspector, and broken-reference
reporting.

**Independent Test**: Add a local asset to a project, pick it from an asset-kind property's picker,
confirm the stored value is a logical reference; remove the asset and confirm the broken reference
is surfaced by name.

- [X] T046 [US3] Build a project-scoped `AssetManifest` from `Project.assetLibrary.entries` at load, layered over `DEFAULT_ASSET_MANIFEST`, handed to the existing `ManifestAssetResolver` (data-model.md) — implemented at `apps/web/src/infrastructure/assets/project-asset-manifest.ts` (moved here from the originally planned `domain/editor/` path — same I1-precedent layering fix as T007: it constructs `Object URL`s, a browser-specific concern the framework-free domain layer must never do). Also added a new `AssetBlobStore` port (`domain/ports/asset-blob-store.ts`) + `IndexedDbAssetBlobStore` (`infrastructure/persistence/`), and `EffectRuntime.setResolveAsset()` (mirroring `setCatalog()`) so an added/removed asset resolves immediately without reconstructing the runtime
- [ ] T047 [US3] Implement `apps/web/src/presentation/editor/asset-library-panel.ts`: add a local file (audio/image) to the project's asset library, writing an `AssetLibraryEntry` plus a project-local IndexedDB blob-store entry keyed by a generated `storageKey`
- [ ] T048 [US3] Implement an asset-picker control for the inspector's `asset`-kind `ParamSpec` (extends T023), listing `AssetLibrary.entries` by `displayName` and writing the selected `reference` into the action's `params` (FR-034/FR-035)
- [ ] T049 [US3] Surface a broken asset reference (an effect's asset param whose reference does not resolve against the loaded manifest) by name in the project/effect inspection view (FR-038)
- [ ] T050 [P] [US3] `apps/web/test/domain/asset-library.test.ts`: manifest layering (project entries override/extend the global manifest), broken-reference detection, and that a resolved param value is always a logical reference, never a path
- [ ] T051 [US3] Run quickstart.md scenario 10 manually; record results

**Checkpoint**: US1, US2, AND US3 all work independently — an author can pick project assets from a
picker instead of typing references.

---

## Phase 6: User Story 4 - Author an effect that depends on person segmentation (Priority: P3)

**Goal**: A real `PersonSegmenter` behind the existing capability-gating mechanism, one genuinely
implemented segmentation-dependent action (`person_visibility`), and pre-trigger unavailability
marking in the palette and inspector.

**Independent Test**: With segmentation unavailable, confirm `person_visibility` is marked
unavailable in the palette/inspector and produces nothing when triggered while the rest of the
effect plays normally; where available, confirm it produces a genuine per-pixel result.

- [ ] T052 [US4] Implement `apps/web/src/infrastructure/segmentation/mediapipe-person-segmenter.ts` implementing `PersonSegmenter`, using `@mediapipe/tasks-vision`'s `ImageSegmenter` against `assets/selfie_segmenter.tflite` (T002/T003; research D7)
- [ ] T052a [P] [US4] `apps/web/test/adapters/mediapipe-person-segmenter.test.ts` (jsdom): `MediapipePersonSegmenter`'s construction success and construction-failure paths (a fake/stubbed `ImageSegmenter` that throws), and that `segment()` returns either a well-shaped `SegmentationFrame` (`mask`, `width`, `height`) or `null` — an adapter-level test of the real infrastructure class, distinct from T020/T058's domain-level tests against a fake `PersonSegmenter` port implementation
- [ ] T053 [US4] Wire `probeCapabilities()` (T013) to attempt `MediapipePersonSegmenter` construction at both composition roots (`apps/web/src/main.ts` and `apps/web/src/editor-main.ts`)
- [ ] T054 [US4] Update `apps/web/src/domain/runtime/actions/person-visibility.ts`: when `context.segmentation` is present, emit `{ kind: 'maskedErase', region: 'person', alpha: 1 - opacity }`; the capability-unavailable path is unchanged (contracts/capability-segmentation.md)
- [ ] T055 [US4] Add `Canvas2DRenderer.setPersonMask(image)` and the `maskedErase` execution branch (`globalCompositeOperation = 'destination-out'`, clipped by the mask) to `apps/web/src/presentation/renderer/canvas2d-renderer.ts`
- [ ] T056 [US4] Wire `apps/web/src/presentation/stage/stage.ts` to call `setPersonMask()` once per frame from the current `SegmentationFrame`, mirroring the existing `setCameraImage()` call
- [ ] T057 [US4] Add the unavailable marker to `palette.ts` (T021) and a persistent per-clip notice to `inspector.ts` (T022) for any action whose `requiresCapability` the current `CapabilityRegistry` reports `false` for (FR-044/FR-045)
- [ ] T058 [P] [US4] `apps/web/test/domain/capability-segmentation.test.ts` (extends T020): with the capability `true`, `person_visibility` emits `maskedErase`; with `false`, it emits nothing and one `capability_unavailable` diagnostic
- [ ] T059 [P] [US4] Extend `apps/web/test/adapters/renderer.test.ts`: `maskedErase` issues the expected `save`/`globalCompositeOperation`/`drawImage`/`restore` sequence against a recording fake context and a fake mask image
- [ ] T060 [P] [US4] `apps/web/test/adapters/palette-inspector-capability.test.ts` (jsdom): unavailable marking appears/disappears correctly against a fake `CapabilityRegistry`
- [ ] T061 [US4] `apps/web/test/architecture/no-fake-segmentation.test.ts`: source-scans segmentation-dependent action files for a full-frame `fillScreen`/background-wash-shaped substitute for `maskedErase` (contracts/capability-segmentation.md, verification 4)
- [ ] T062 [US4] Run quickstart.md scenarios 11–12 manually (with and without segmentation available); record results

**Checkpoint**: All four user stories now compose into the full milestone.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Camera visual treatment (not owned by a single user story), performance verification,
final documentation, and the full quickstart pass.

- [ ] T063 [P] Implement `CameraTreatmentSettings` as a render-time transform in `apps/web/src/presentation/stage/camera-treatment.ts` (brightness/contrast/saturation, mirror, zoom/scale, crop) applied to the camera image before `drawCamera`, never altering the imagery `HandDetector` receives (FR-048–051)
- [ ] T064 [P] Add camera-treatment controls to `editor-shell.ts`/a new `camera-panel.ts`, bound to `Project.cameraTreatment`
- [ ] T065 [P] `apps/web/test/domain/camera-treatment.test.ts`: treatment settings never mutate the `LandmarkFrame`/detection input (FR-051, quickstart scenario 13)
- [ ] T066 Extend the existing debug performance panel/metrics to confirm **both** (FR-058) Milestone 1's numeric frame/latency budgets hold unconditionally while the editor UI is being interacted with, **and** (FR-059) the editor UI itself remains responsive — no dropped input, no visible stalling — while doing so; the first is a quantitative measurement, the second a qualitative observation, and both are required, not one standing in for the other. Document the result in `apps/web/README.md`'s "Measured performance" style (SC-010, quickstart scenario 14)
- [ ] T067 [P] Complete `apps/web/test/architecture/privacy.test.ts` / `privacy-persistence.test.ts` per contracts/privacy-persistence.md's full verification list; run the manual DevTools pass confirming SC-005's guarantee (zero camera frames/images/video in storage or over the network across a full session) (SC-005, quickstart scenario 15)
- [ ] T068 Run `npm run typecheck && npm run lint && npm test` in `apps/web/` and resolve any failure
- [ ] T069 Update `apps/web/README.md`: replace the "Storage: None" line (T005's stub), add the full "Editor" section (routes, project persistence, asset library, segmentation capability) matching the existing "Configuration"/"Recognition"/"Privacy, verified" section style
- [ ] T070 [P] Update root `README.md` if the monorepo table or folder-structure section needs `apps/web/editor.html` or `assets/selfie_segmenter.tflite` entries (mirrors the precedent 007 set for `apps/web/` itself)
- [ ] T070a SC-008 end-to-end verification (cross-cutting: exercises US1, US2, and US3 together, so it carries no single-story label), in `apps/web/test/domain/sc008-end-to-end.test.ts`: using pose `dragon` (a member of the shipped default active pose set — `['hi', 'peace', 'tp', 'dragon']` in `DEFAULT_SESSION_CONFIG` — with no pre-existing effect in `config/effects.json`, which defines effects only for `hi`, `peace`, and `tp`), drive the editor's own surfaces (palette T021, inspector T022/T023, timeline T024/T025, pose/trigger panel T028) to build a new effect triggered by `dragon`'s `confirmed` event with a timeline of at least two actions, one of them carrying an asset-kind parameter set via the asset-library picker (T048); save the project (T039); then load the persisted project back and run its resulting `EffectDefinition` through `EffectRuntime.advance()`/`startEffect()` **unchanged** — the same calls T035 already exercises, no new runtime path — and assert the produced `RenderCommand[]` sequence matches what was authored. Corresponds to quickstart.md scenario 16
- [ ] T071 Run the full quickstart.md validation pass (all 16 scenarios) end to end and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Stories (Phase 3–6)**: All depend on Foundational completion
  - US1 has no dependency on US2/US3/US4 and is the MVP
  - US2 depends on US1 existing *content* to be meaningful to save, but its own tasks (persistence
    plumbing, the active-project mechanism) touch no file US1 touches and are independently testable
    against `EditorRuntimeController`'s in-memory default project alone
  - US3 depends on US1's inspector (T022/T023) existing, to extend its asset-kind control (T048)
  - US4 depends on US1's palette/inspector (T021/T022) existing, to add unavailable-marking (T057),
    and on Phase 2's `MaskedEraseCommand`/`segmentation` field (T010/T011)
  - Despite these light integration points, each story's **independent test** in spec.md remains
    verifiable without the later stories present
- **Polish (Phase 7)**: Depends on whichever stories are in scope for a given delivery

### Parallel Opportunities

- All Setup tasks marked [P] (T002, T004, T005) run in parallel
- Foundational tasks marked [P] (T008, T009, T014, T019, T020) run in parallel once T006/T007 land
- US1's control-renderer, timeline, and pose-panel tasks (T021, T035–T037) run in parallel once
  their shared prerequisites (T022/T024/T028) exist
- US2, US3, and US4's persistence/asset/segmentation infrastructure tasks (T039, T046, T052,
  T052a) are in three different directories and can proceed in parallel once Phase 2 is done, even
  though their UI-integration tasks (T040, T048, T057) each touch a file another story also
  touches and so should not be parallelized against each other

---

## Parallel Example: Phase 2 → Phase 3 handoff

```bash
# Once T006/T007 land, run these together:
Task: "Define ProjectRepository port in apps/web/src/domain/ports/project-repository.ts"
Task: "Define PersonSegmenter port in apps/web/src/domain/ports/segmenter.ts"
Task: "Create fake-project-repository.ts in apps/web/test/support/"
Task: "Domain test: project.test.ts"
Task: "Domain test: capability-segmentation.test.ts"

# Once Phase 2 completes, US1's independent surfaces start together:
Task: "Implement palette.ts"
Task: "Implement timeline.ts (rendering only, before interaction tasks)"
Task: "Implement pose-trigger-panel.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run quickstart.md scenarios 1–5 independently
5. Demo: an author can build, edit, and preview an effect with no persistence yet — the milestone's
   central architectural claim (editor authors data the existing runtime executes) is already
   provable at this point

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → validate (scenarios 1–5) → MVP demo
3. + US2 → validate (scenarios 6–9) → work now survives a reload
4. + US3 → validate (scenario 10) → assets are picked, not typed
5. + US4 → validate (scenarios 11–12) → segmentation ships, honestly gated
6. + Polish → validate (scenarios 13–16, full pass) → milestone complete

### Parallel Team Strategy

With multiple developers, after Foundational is done: Developer A takes US1 (the long pole — every
other story's UI integration point depends on its palette/inspector existing); Developer B starts
US2's persistence plumbing (T039) against the in-memory fake repository, independent of US1's UI;
Developer C starts US4's `PersonSegmenter`/capability wiring (T052, T052a, T053), independent of both.
Integration tasks (T040, T048, T057) land once their story's infrastructure and US1's UI are both
ready.

---

## Notes

- [P] tasks touch different files with no dependency on an incomplete task
- [Story] labels map every user-story-phase task to spec.md's US1–US4 for traceability
- Every contract's "Verification" section names the test file that task list above created it as —
  intentional, so `contracts/*.md` and `tasks.md` cannot drift silently
- Commit after each task or logical group; stop at any phase checkpoint to validate that story
  independently before continuing
- Avoid: vague tasks, two stories editing the same file in the same pass, and any task that would
  make a later story's independent test depend on an earlier story's *specific content* rather than
  its *existence*
