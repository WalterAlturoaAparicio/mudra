---

description: "Task list for Mudra Web — Pose-Driven Effect Runtime"
---

# Tasks: Mudra Web — Pose-Driven Effect Runtime

**Input**: Design documents from `/specs/007-mudra-web/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks **are** included. The specification explicitly requires them — golden-fixture
verification is a constitutional obligation (v1.6.0, cross-language ports), and FR-012, FR-019,
FR-029, FR-081, FR-084 and the privacy contract each name a test as the means of enforcement.

**Organization**: Grouped by user story so each is independently implementable and testable.


> **Reconciliation note (2026-09-10).** The checkboxes below were re-derived after the disk
> failure that destroyed `apps/web/`, `apps/studio/` and this specs directory. A task is
> ticked only where every repository path it names exists on disk; tasks that name no path
> are behavioural or manual-verification items and were deliberately left unticked rather
> than assumed. The recovery itself is described in `_RECUPERACION.md` at the repository
> root, which also lists what could not be recovered.
> Still open here: `test/domain/landmarks.test.ts` (T012) and the Mudra-owned audio and
> image assets (T082) were lost with no recoverable copy and must be written again. The
> recorded dataset was restored on 2026-09-10 and the exemplar bundle rebuilt from it, so
> the recognition suites pass again.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `US1`–`US4`, mapping to the user stories in spec.md
- Exact file paths are given in every task

## Path Conventions

TypeScript application at `apps/web/`; Python build scripts at repository-level `scripts/`. Layout per
plan.md's Structure Decision.

> **Local tooling note**: Speckit scripts on this machine need
> `SPECIFY_FEATURE_DIRECTORY=specs/007-mudra-web` (`jq` absent, `python3` is a stub). Not a repository
> concern; change nothing to hide it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring `apps/web/` into existence with a strict toolchain and nothing else.

- [x] T001 Create the directory skeleton under `apps/web/` per plan.md (`src/domain/{landmarks,normalization,recognition,events,effects,runtime,config}`, `src/{application,infrastructure,presentation}`, `test/{domain,fixtures,architecture,adapters}`, `config/`, `assets/{audio,images}`, `public/`)
- [x] T002 Create `apps/web/package.json` with `@mediapipe/tasks-vision` as the only runtime dependency and dev dependencies for TypeScript, Vite, Vitest, ESLint, Prettier; add scripts `dev`, `build`, `preview`, `test`, `typecheck`, `lint`
- [x] T003 Create `apps/web/tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, target ES2022, module ESNext
- [x] T004 [P] Create `apps/web/vite.config.ts` configuring `server.fs.allow` to reach the repository-level `assets/` directory and a build step copying `assets/hand_landmarker.task` into `dist/` (research D2 — referenced, never copied into source)
- [x] T005 [P] Create `apps/web/vitest.config.ts` with a `node` environment project for `test/domain` and `test/architecture`, and a `jsdom` project for `test/adapters`
- [x] T006 [P] Create `apps/web/.eslintrc.cjs` and `apps/web/.prettierrc` banning `any`, requiring explicit return types on exported functions, and requiring doc comments on exported symbols
- [x] T007 [P] Create `apps/web/.gitignore` excluding `node_modules/`, `dist/`, `public/exemplars.bin`, `public/exemplars.manifest.json` (build artifacts, per contracts/exemplar-bundle.md)
- [x] T008 [P] Create `apps/web/index.html` with a single mount element and no inline script beyond the module entry point
- [x] T009 [P] Create `apps/web/README.md` stating purpose, the authorized milestone scope, how to build the data, how to run, and the explicit non-goals from spec.md's Out of Scope

**Checkpoint**: `npm install && npm run typecheck && npm test` runs green on an empty suite.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The recognition half of the pipeline plus the data it needs. Every user story depends on
this phase; none may begin until it is complete.

**⚠️ CRITICAL**: The golden-fixture tasks (T016–T018, T027–T028) discharge a constitutional obligation.
A port merged without them is not authorized.

### Domain value types

- [x] T010 [P] Implement `Handedness`, `Landmark`, `HandLandmarks` (enforcing exactly 21 points at construction), `HandObservation`, and `LandmarkFrame` in `apps/web/src/domain/landmarks/types.ts` per data-model.md §1
- [x] T011 [P] Implement topology constants `HAND_LANDMARK_COUNT`, `WRIST`, `MIDDLE_FINGER_MCP`, `FINGERTIPS`, `HAND_CONNECTIONS` in `apps/web/src/domain/landmarks/topology.ts`
- [ ] T012 [P] Write unit tests for the 21-landmark invariant and topology edge validity in `apps/web/test/domain/landmarks.test.ts`

### Configuration

- [x] T013 Implement the validated configuration module in `apps/web/src/domain/config/session-config.ts` holding landmark weights, `confidenceFloor` 0.5, `ambiguityMargin` 0.12, `softmaxTemperature`, `holdDurationMs` 1000, `minSamples` 20, `activePoseSet`, renderer radii, and latency/fps budgets — no literal may appear at any call site (Principle V)
- [x] T014 [P] Create `apps/web/config/session.json` with the default active pose set `["hi","peace","tp","dragon"]` (research D11) and the tunables above
- [x] T015 [P] Write configuration validation tests (rejects out-of-range thresholds, unknown pose ids, empty active set) in `apps/web/test/domain/config.test.ts`

### Normalization + its golden fixtures

- [x] T016 Create `scripts/export_web_fixtures.py` generating normalization fixture cases from Engine's `TranslationScaleNormalizer` into `apps/web/test/fixtures/normalization_cases.json`, consuming only the symbols listed in contracts/engine-consumption.md
- [x] T017 Implement the translation-scale normalizer in `apps/web/src/domain/normalization/normalize.ts` per data-model.md §2, including the degenerate-span fallback
- [x] T018 Write the golden-fixture test asserting agreement with Engine within `1e-9` absolute in `apps/web/test/domain/normalization.test.ts` (FR-019, research D5)

### Exemplar bundle

- [x] T019 Create `scripts/export_web_exemplars.py` producing `apps/web/public/exemplars.manifest.json` and `apps/web/public/exemplars.bin` per contracts/exemplar-bundle.md, deriving `display_name` and `required_hands` **from the dataset** and never reading Capture's catalog (research D10, FR-098)
- [x] T020 Implement the mandatory `excluded[]` manifest section in `scripts/export_web_exemplars.py`, recording every catalog pose below `min_samples` with its actual count and reason (FR-023a, FR-085)
- [x] T021 Implement deterministic ordering and the `dataset_fingerprint` in `scripts/export_web_exemplars.py` (sorted pose ids, sorted filenames, timestamp excluded from the fingerprint) per FR-081
- [x] T022 [P] Write a determinism test running the export twice and comparing both output files byte for byte in `apps/web/test/domain/bundle-determinism.test.ts` (or an equivalent Python test under `tests/`) (FR-081, FR-084)
- [x] T022a [P] Write the **source-dataset immutability** test in `tests/web/test_export_read_only.py`: hash every file under `datasets/poses/` (path + sha256, sorted), run `scripts/export_web_exemplars.py`, re-hash, and assert byte-identity. It must verify the **actual dataset on disk**, not that the export code merely intends to be read-only — following the `tests/studio/test_read_only.py` precedent (FR-086)
- [x] T023 Implement the bundle loader in `apps/web/src/infrastructure/exemplars/bundle-loader.ts` parsing the manifest, slicing the `Float32Array` payload by `hand_offset`/`hand_count`, and rejecting an unknown `format_version` or mismatched fingerprint with a reported error (FR-083)
- [x] T024 [P] Write bundle-loader tests covering a well-formed bundle, an unknown `format_version`, a stale fingerprint, and the presence of `excluded[]` in `apps/web/test/domain/bundle-loader.test.ts`, **plus an assertion that the eligible pose population contains at least one one-handed and at least one two-handed pose** so a dataset or export change cannot silently remove either (FR-023c)

### Recognition

- [x] T025 [P] Implement `Exemplar`, `LandmarkWeights` (wrist 0.5, fingertips 2.0, others 1.0), `PoseEntry`, `Candidate`, and the `RecognitionOutcome` discriminated union in `apps/web/src/domain/recognition/types.ts` per data-model.md §3
- [x] T026 Implement the weighted nearest-neighbour matcher in `apps/web/src/domain/recognition/matcher.ts` behind a `PoseMatcher` interface — hand-agnostic one-handed matching, like-for-like two-handed matching constrained to a shared `sampleId`, and **mean not sum** combination (FR-021, FR-022, FR-023)
- [x] T027 Extend `scripts/export_web_fixtures.py` to emit matcher fixture cases computed over **float32-quantized** exemplars into `apps/web/test/fixtures/matcher_cases.json` (research D5)
- [x] T028 Write matcher golden-fixture tests in `apps/web/test/domain/matcher.test.ts` covering one-handed, two-handed pairing, the same-sample constraint, mean-not-sum, the confidence floor, and the ambiguity margin, within `1e-5` relative (FR-029)
- [x] T029 [P] Implement numerically-stable `softmaxConfidence` in `apps/web/src/domain/recognition/softmax.ts` (max-subtracted) with tests in `apps/web/test/domain/softmax.test.ts` (FR-025)
- [x] T030 Implement eligibility filtering and the confidence/ambiguity gates in `apps/web/src/domain/recognition/classify.ts`, restricting candidates to the active pose set as a **candidate-set filter only** — touching no threshold, weight, or formula (FR-024a, FR-024b)
- [x] T031 [P] Write a test asserting the active pose set changes only which candidates are offered, never the thresholds or the ranking of a fixed candidate subset, in `apps/web/test/domain/active-pose-set.test.ts` (FR-024b)

### Pose events

- [x] T032 Implement `HoldState` with `progress()` and `readyToConfirm()` in `apps/web/src/domain/events/hold-state.ts` per data-model.md §4
- [x] T033 Implement the pose-event emitter in `apps/web/src/domain/events/pose-events.ts` producing `entered` / `held` / `confirmed` / `exited` per the transition table, driven by an **injected clock** and elapsed wall-clock time (FR-031, FR-036)
- [x] T034 Write pose-lifecycle tests with a fake clock in `apps/web/test/domain/pose-events.test.ts` asserting: one `confirmed` per continuous hold across many frames, reset on break, reset on pose change, and `entered`/`exited` pairing (FR-032, FR-033, FR-034)

### Architecture guards

- [x] T035 [P] Write the layering test in `apps/web/test/architecture/layering.test.ts` asserting `src/domain/**` references no DOM global, no canvas API, and no MediaPipe symbol (research D13)
- [x] T036 [P] Write the boundary test in `apps/web/test/architecture/boundaries.test.ts` asserting no file under `apps/web/src/**` imports from `apps/engine/` or `apps/capture/`, and that no path under `apps/capture/` is read (FR-098, FR-100)
- [x] T037 [P] Write the privacy test in `apps/web/test/architecture/privacy.test.ts` scanning `apps/web/src/**` for the prohibited storage, imagery-readback, and upload APIs listed in contracts/privacy.md (FR-005–FR-008, SC-010). Add a focused assertion that no user-facing recording/capture/download/share affordance exists — no `<a download>`, and no control whose label matches record / capture / save / download / share (FR-007). This is an API-and-label check by design, **not** a UI crawler: the API scan alone cannot catch an affordance wired to a permitted path, and a crawler is disproportionate to the risk

**Checkpoint**: Recognition is provably faithful to Engine and pose events are correct — with no
browser involved. `npm test` green.

---

## Phase 3: User Story 1 — Make a pose, see something happen (Priority: P1) 🎯 MVP

**Goal**: The complete visible loop — camera → landmarks → recognition → pose event → effect →
Canvas2D → a transformation the user sees.

**Independent Test**: Open the app with a webcam, grant access, form a supported pose, hold it; an
effect plays. No configuration, no documentation, no technical knowledge required.

### Camera and detection

- [x] T038 [US1] Define the `CameraSource` / `CameraSession` interfaces in `apps/web/src/domain/ports/camera.ts` expressing acquisition, the mirrored surface, and a single terminal `close()`
- [x] T039 [US1] Implement the camera adapter in `apps/web/src/infrastructure/camera/get-user-media-camera.ts`, distinguishing no-camera, permission-denied, permission-dismissed, and device-in-use as separate reported conditions (FR-003)
- [x] T040 [US1] Implement the **single mirrored surface** in `apps/web/src/infrastructure/camera/mirrored-surface.ts` — one horizontally-flipped canvas that is simultaneously the detector's input and the displayed image (research D1, FR-009, FR-013)
- [x] T041 [US1] Define the `HandDetector` interface in `apps/web/src/domain/ports/detector.ts` exposing only `detect(surface, timestampMs) → LandmarkFrame` (FR-016)
- [x] T042 [US1] Implement the MediaPipe adapter in `apps/web/src/infrastructure/detection/mediapipe-detector.ts` using `HandLandmarker` in VIDEO mode with `numHands: 2`, loading the shared model, and reporting initialization failure in plain language (FR-014, FR-017, research D2)
- [ ] T043 [US1] Emit a `LandmarkFrame` for **every** processed frame including zero-hand frames in the adapter (FR-015)
- [x] T044 [P] [US1] Write the mirroring test in `apps/web/test/domain/mirroring.test.ts` feeding a known-convention input and asserting known handedness and known normalized coordinates (FR-012, SC-008)
- [x] T045 [P] [US1] Write camera adapter tests with a fake `getUserMedia` covering all four failure conditions in `apps/web/test/adapters/camera.test.ts`

### Effect runtime core

- [x] T046 [US1] Implement `EffectDefinition`, `Trigger`, `Condition`, `Timeline`, `TimelineEntry`, `Action` types in `apps/web/src/domain/effects/types.ts` per data-model.md §5, with `atMs` **absolute** (FR-046)
- [x] T047 [US1] Implement the `RenderCommand` union, `AudioCue`, and `FrameOutput` in `apps/web/src/domain/runtime/frame-output.ts` per contracts/render-commands.md
- [x] T048 [US1] Implement the action registry and `ActionDescriptor` (type, behaviour, parameter schema, optional capability, `update`) in `apps/web/src/domain/runtime/action-registry.ts` — registration, never a switch (FR-071, research D8)
- [x] T049 [US1] Implement the anchor resolver in `apps/web/src/domain/effects/anchor-resolver.ts` supporting `screen`, `handCentroid`, and `landmark`, resolving once per frame and handing actions an already-resolved point (FR-058–FR-060, research D9)
- [x] T050 [US1] Implement the effect runtime in `apps/web/src/domain/runtime/effect-runtime.ts` — trigger matching against pose events, condition evaluation, playback instantiation, elapsed-time advance, and `FrameOutput` production. **It calls no drawing or audio API** (FR-066, FR-069)
- [x] T051 [US1] Implement the `screen_flash` action descriptor in `apps/web/src/domain/runtime/actions/screen-flash.ts` with `color` and `intensity` parameters, emitting `fillScreen` (FR-052)
- [x] T052 [US1] Implement the `particle_burst` action descriptor in `apps/web/src/domain/runtime/actions/particle-burst.ts` with `count`, `color`, `radius`, `spread`, and `anchor` parameters, emitting **one batched** `drawCircles` command per frame (FR-054, contracts/render-commands.md)
- [x] T053 [P] [US1] Write headless runtime tests in `apps/web/test/domain/effect-runtime.test.ts` asserting a full `FrameOutput` sequence for a scripted effect with no browser present (FR-069)

### Renderer and shell

- [x] T054 [US1] Implement the Canvas2D renderer in `apps/web/src/presentation/renderer/canvas2d-renderer.ts` consuming the five render commands and **being the only component that draws** (FR-067, FR-070)
- [x] T055 [US1] Implement the stage in `apps/web/src/presentation/stage/stage.ts` compositing the mirrored camera surface and the runtime's commands each frame, and handling resize so anchors stay aligned (FR-011)
- [x] T056 [US1] Implement the session orchestrator in `apps/web/src/application/session.ts` wiring camera → detector → normalize → classify → events → runtime → renderer, driven by `requestVideoFrameCallback` with a `requestAnimationFrame` fallback (FR-096, research D3)
- [x] T057 [US1] Implement the composition root in `apps/web/src/main.ts` constructing and injecting every adapter — no module-level singletons, no global mutable state (Principle I)
- [x] T058 [US1] Implement the entry experience in `apps/web/src/presentation/shell/shell.ts`: a camera-permission call to action, the live view, and plain-language error states — with **no** landmarks, numbers, or technical vocabulary by default (FR-087, SC-012)
- [x] T059 [US1] Implement the non-technical hold-progress indicator in `apps/web/src/presentation/shell/hold-indicator.ts` driven by `HoldState.progress` (FR-035, FR-088)
- [x] T060 [US1] Implement the supported-poses affordance in `apps/web/src/presentation/shell/pose-hints.ts` showing the active poses without turning the default screen into a readout (FR-089)
- [x] T061 [US1] Create `apps/web/config/effects.json` with two starter effects mapping `hi` → screen flash and `peace` → particle burst, per contracts/effect-catalog.md
- [x] T062 [P] [US1] Write renderer tests in `apps/web/test/adapters/renderer.test.ts` asserting a fixed command list produces the expected calls against a recording fake 2D context
- [x] T063 [P] [US1] Implement camera release on stop and on page unload in `apps/web/src/application/session.ts` (FR-004)

**Checkpoint**: 🎯 **MVP.** The loop is visibly working. Validate with quickstart scenarios 1–3.

---

## Phase 4: User Story 2 — Change what a pose does without touching runtime logic (Priority: P2)

**Goal**: Prove effects are data. Editing configuration changes behaviour; adding an effect requires no
logic change.

**Independent Test**: Modify only `apps/web/config/effects.json` and observe changed behaviour; add a
new effect entry for an active pose and see it fire — with `git status` showing only the config file.

- [x] T064 [US2] Implement the effect-catalog loader and validator in `apps/web/src/infrastructure/effects/catalog-loader.ts` enforcing every rule in contracts/effect-catalog.md, reporting the offending entry by `id` (FR-045)
- [x] T065 [US2] Implement parameter-schema validation against registered `ActionDescriptor`s in `apps/web/src/domain/runtime/param-schema.ts`, rejecting unknown types, unknown keys, and out-of-range values at load (FR-045, FR-072)
- [x] T066 [US2] Implement deterministic multi-match behaviour in `apps/web/src/domain/runtime/effect-runtime.ts` — all matching effects play, in catalog order (FR-044)
- [x] T067 [US2] Implement the `confidence_at_least` and `cooldown` conditions in `apps/web/src/domain/effects/conditions.ts` (FR-043)
- [x] T068 [P] [US2] Write the **no-hardcoded-effects** architecture test in `apps/web/test/architecture/no-hardcoded-effects.test.ts` scanning `src/domain/runtime/**` and `src/presentation/**` for any literal matching a known `pose_id` or catalog effect `id` (FR-040, US2 acceptance 4, constitution v1.6.0)
- [x] T069 [P] [US2] Write the configuration-only test in `apps/web/test/domain/config-driven-effects.test.ts` loading a modified catalog fixture (different colour, timing, anchor, plus one added effect) and asserting a different `FrameOutput`, with no runtime source involved (SC-006)
- [x] T070 [P] [US2] Write catalog validation tests in `apps/web/test/domain/catalog-validation.test.ts` covering unknown action type, unknown condition type, duplicate `id`, physical asset path, negative `atMs`, and a timeline shorter than its entries
- [x] T071 [P] [US2] Write the registry-completeness test in `apps/web/test/domain/registry-completeness.test.ts` asserting every shipped catalog `action.type` resolves and every descriptor exposes a parameter schema (FR-072)
- [x] T071a [P] [US2] Write the **registry-extensibility** test in `apps/web/test/domain/registry-extensibility.test.ts` proving FR-073: register a dummy action type through the **production** registry (no second registry implementation), place it on a timeline, and assert it is scheduled at its `atMs` and produces its expected `RenderCommand`s — demonstrating that adding an action required no edit to the timeline scheduler, the event system, or renderer dispatch

**Checkpoint**: Effects are provably data. Validate with quickstart scenario 5.

---

## Phase 5: User Story 3 — Effects that unfold over time (Priority: P2)

**Goal**: Timeline composition with absolute offsets, and the three action behaviours — including
continuous actions that track a live hand.

**Independent Test**: Configure a multi-action effect with distinct offsets and durations; each action
begins and ends when configured, and the continuous one follows the hand across frames.

- [x] T072 [US3] Implement the timeline scheduler in `apps/web/src/domain/runtime/timeline-scheduler.ts` activating entries at their **absolute** `atMs` and deactivating at `atMs + durationMs`, with no entry's position depending on another's (FR-046, FR-047)
- [ ] T073 [US3] Implement the three action behaviours (`instantaneous`, `duration`, `continuous`) in the scheduler, advancing by elapsed time so effects are frame-rate independent (FR-048, FR-049)
- [x] T074 [US3] Implement concurrent playbacks in `apps/web/src/domain/runtime/effect-runtime.ts` so overlapping effects neither cancel nor corrupt one another, and playbacks release on completion (FR-050, FR-051)
- [x] T075 [P] [US3] Implement the `background_wash` action descriptor in `apps/web/src/domain/runtime/actions/background-wash.ts` compositing a full-screen colour/gradient/image **over** the camera view with `opacity`, `blend`, and in/out transition (FR-053 — overlay, never behind the user)
- [x] T076 [P] [US3] Implement the `landmark_trail` continuous action descriptor in `apps/web/src/domain/runtime/actions/landmark-trail.ts` following a configured landmark and emitting `drawPolyline` (FR-055)
- [x] T077 [P] [US3] Implement the `play_audio` action descriptor in `apps/web/src/domain/runtime/actions/play-audio.ts` emitting an `AudioCue` — never calling `play()` (FR-054a, research D6)
- [x] T078 [US3] Implement the logical asset resolver in `apps/web/src/infrastructure/assets/asset-manifest.ts` mapping `@audio/…` and `@image/…` to physical assets through an indirection, reporting unresolvable references without aborting the effect (FR-062–FR-064)
- [x] T079 [US3] Implement the audio sink in `apps/web/src/infrastructure/audio/audio-sink.ts` consuming `AudioCue`s, unlocked by the camera-grant gesture, reporting blocked playback to diagnostics (FR-054a)
- [x] T080 [US3] Implement the capability registry in `apps/web/src/domain/runtime/capabilities.ts` and declare `person_segmentation` **unavailable** (FR-075, research D12)
- [x] T081 [US3] Implement the reserved `person_visibility` action descriptor in `apps/web/src/domain/runtime/actions/person-visibility.ts` — requires `person_segmentation`, produces no commands, and records `capability_unavailable` in `FrameOutput.diagnostics` (FR-076, FR-077)
- [ ] T082 [US3] Add Mudra-owned experience assets under `apps/web/assets/audio/` and `apps/web/assets/images/`, and register them in the asset manifest — Mudra-owned or project-licensed only, no third-party protected material (FR-065)
- [x] T083 [US3] Extend `apps/web/config/effects.json` with a composed effect **triggered by the `tp` pose** demonstrating all three behaviours at distinct offsets (flash at 0 ms, particles at 60 ms, wash 100–900 ms, trail continuous, audio at 0 ms) (FR-056). `tp` is chosen because it is the active pose with no effect yet assigned, and because it is the pose the conceptual teleport effect would later extend — reaching that extension in configuration alone is the milestone's stated architectural claim
- [x] T084 [P] [US3] Write timeline tests in `apps/web/test/domain/timeline.test.ts` asserting each action begins within 50 ms of its configured offset, durations are honoured, and moving one entry repositions no other (SC-014, FR-047)
- [x] T085 [P] [US3] Write continuous-action tests in `apps/web/test/domain/continuous-actions.test.ts` asserting a trail's output tracks a moving landmark across successive frames
- [x] T086 [P] [US3] Write concurrency tests in `apps/web/test/domain/concurrent-playbacks.test.ts` asserting two overlapping effects both complete correctly (FR-050)
- [x] T087 [P] [US3] Write capability-gating tests in `apps/web/test/domain/capabilities.test.ts` asserting an unavailable capability yields no commands, a diagnostics entry, and no effect abort (FR-077, FR-078, SC-011)
- [x] T088 [P] [US3] Write anchor-resolution tests in `apps/web/test/domain/anchors.test.ts` covering all three anchor kinds and the documented unresolvable-anchor behaviour (FR-061)

**Checkpoint**: Composed, time-based effects work. Validate with quickstart scenarios 6 and 7.

---

## Phase 6: User Story 4 — Understand what the system is doing (Priority: P3)

**Goal**: A debug mode exposing everything the default experience deliberately hides.

**Independent Test**: Toggle debug on and off; technical information appears and disappears, and the
visitor-facing experience is unchanged when off.

- [x] T089 [US4] Implement the debug-mode toggle in `apps/web/src/presentation/debug/debug-mode.ts`, off by default and not discoverable by accident (FR-090, Assumptions)
- [x] T090 [US4] Implement the landmark overlay in `apps/web/src/presentation/debug/landmark-overlay.ts` drawing all 21 points per hand, `HAND_CONNECTIONS`, and the handedness label (FR-090, US4 acceptance 2)
- [x] T091 [US4] Implement the recognition panel in `apps/web/src/presentation/debug/recognition-panel.ts` showing ranked candidates with confidences, the event state, and hold progress (FR-030, FR-090)
- [ ] T092 [US4] Display the **active pose set alongside every confidence** in the recognition panel, so a confidence is never read without the context that gives it meaning (FR-024c, research D11)
- [x] T093 [US4] Implement the pose-population panel in `apps/web/src/presentation/debug/pose-panel.ts` listing catalog / eligible / active poses, with each exclusion's **reason and sample count** — including `domain_expansion` (1 sample, minimum 20) (FR-023a, FR-023b, SC-013)
- [x] T094 [US4] Implement performance instrumentation in `apps/web/src/application/metrics.ts` measuring frame rate and end-to-end capture-to-outcome latency (FR-093, FR-094)
- [x] T094a [US4] Extend `apps/web/src/application/metrics.ts` with the **trigger-to-first-paint** metric (FR-095, SC-005), retaining the frame-rate and recognition-latency measurements unchanged. Record three timestamps and expose both intervals: **(a)** `t_trigger` — when the pose event that satisfies a trigger is emitted; **(b)** `t_command` — when the runtime first emits a non-empty `RenderCommand` list for that playback; **(c)** `t_paint` — the first `requestAnimationFrame` callback that runs *after* the renderer has issued that playback's first draw call, taken as the practical proxy for first paint. Report `t_paint − t_trigger` against the 200 ms budget and `t_command − t_trigger` as the runtime-only portion. **Document these boundaries in `apps/web/README.md`**, including that (c) is a proxy: the browser exposes no per-element paint timestamp, and `requestAnimationFrame`-after-draw is the smallest practical measurement available without a paint-timing API
- [x] T094b [P] [US4] Write the metric-boundary test in `apps/web/test/domain/metrics.test.ts` with a fake clock, asserting `t_trigger`, `t_command`, and `t_paint` are captured at the correct pipeline points and that the reported interval is `t_paint − t_trigger` — the unit-testable part of FR-095; the wall-clock figure itself is measured in T100
- [x] T095 [US4] Display frame rate, latency, unavailable capabilities, skipped actions, unresolved anchors, and asset-resolution failures in `apps/web/src/presentation/debug/diagnostics-panel.ts` (FR-090, FR-077)
- [x] T096 [US4] Implement structured logging in `apps/web/src/domain/config/logger.ts` with per-frame diagnostics at debug level only, never at info (Principle V)
- [x] T097 [P] [US4] Write a test asserting debug mode alters no recognition or effect behaviour in `apps/web/test/domain/debug-neutrality.test.ts` (FR-091)
- [x] T098 [P] [US4] Write a test asserting the default experience emits no technical readout in `apps/web/test/adapters/default-experience.test.ts` (FR-087, SC-012)

**Checkpoint**: Full diagnostic visibility. Validate with quickstart scenarios 3, 7, 9 and 11.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T099 Update the root `README.md` Monorepo table to add **Mudra Web** (`apps/web/`, TypeScript, browser pose-driven effect playground) and add `apps/web/` to the Folder Structure section — **approved**; change no unrelated README content
- [x] T100 [P] Measure sustained frame rate, recognition latency, **and trigger-to-first-paint** against the ~30 fps, ≤200 ms, and ≤200 ms targets on a reference desktop browser and record all three in `apps/web/README.md` (FR-092, FR-093, FR-095, SC-004, SC-005)
- [x] T100a **SC-002 reliability trial.** After the implementation exists, run the intended user flow — open the app, grant camera, form the pose, hold — for **10 deliberate attempts per active pose** (`hi`, `peace`, `tp`, `dragon`; 40 attempts total). An attempt **succeeds** when a deliberate, correctly-formed pose produces its intended effect; it **fails** on no trigger, a wrong-pose trigger, or a trigger the user did not intend. Record the observed rate per pose and overall in `apps/web/README.md`, against SC-002's threshold of **at least 8 of 10**. Record the **actual measured** rate — do not pre-populate a figure, and do not adjust the recognition thresholds to reach it (FR-028); a shortfall is a finding about the active pose set or the dataset, reported as such
- [x] T101 [P] Verify the exemplar bundle is ≤ 2 MB and record the actual size (expected ≈ 574 KB) (SC-009) — **574.1 KB** measured 2026-09-10 over 17 poses / 2333 hands
- [ ] T102 Run every quickstart validation scenario end to end and correct any divergence between [quickstart.md](./quickstart.md) and actual behaviour
- [ ] T103 [P] Manually verify non-persistence per contracts/privacy.md — empty Local/Session Storage, IndexedDB and Cache Storage, and only inbound GETs in the Network tab (SC-010). Also confirm by inspection that **no user-facing recording, capture, download, or share affordance is reachable** anywhere in the running application, in either default or debug mode, and record the confirmation (FR-007)
- [x] T104 [P] Verify `npm run typecheck` and `npm run lint` are clean and wire them into the definition of done (constitution, web standards subsection)
- [ ] T105 Re-run the Constitution Check in [plan.md](./plan.md) against the delivered code and record the result
- [x] T106 [P] Confirm no file under `apps/engine/` or `apps/capture/` was modified by this feature (`git status`), and that `assets/hand_landmarker.task` exists in exactly one place (FR-098, FR-101)

---

## Dependencies

```
Phase 1 (Setup)
   │
Phase 2 (Foundational) ◀── BLOCKING: no story may start before this completes
   │
   ├─▶ Phase 3 — US1 (P1) 🎯 MVP ──┐
   │                                │
   ├─▶ Phase 4 — US2 (P2) ◀─────────┤ needs US1's runtime + registry
   │                                │
   ├─▶ Phase 5 — US3 (P2) ◀─────────┤ needs US1's runtime + renderer
   │                                │
   └─▶ Phase 6 — US4 (P3) ◀─────────┘ needs a running pipeline to inspect
                                     │
                              Phase 7 (Polish)
```

**Story dependencies**: US1 is genuinely independent — it is the vertical slice. US2, US3 and US4 each
build on US1's pipeline but are independent **of each other** and may be developed in parallel once
US1 lands. US4 is last by priority so the default experience is never designed around debug output.

**Critical-path note**: T016–T018 (normalization fixtures) and T027–T028 (matcher fixtures) gate every
recognition task. They are the constitutional obligation for cross-language ports and cannot be
deferred to Polish.

---

## Parallel Execution Examples

**Phase 1** — T004, T005, T006, T007, T008, T009 are all independent files.

**Phase 2** — three independent tracks after T013:
- Normalization: T016 → T017 → T018
- Recognition types: T025 → T026 → T027 → T028
- Architecture guards: T035, T036, T037 (fully parallel, no production dependency)

**Phase 3** — T044, T045, T053, T062, T063 are parallel once their subjects exist.

**Phase 5** — T075, T076, T077 are three independent action files; T084–T088 are five independent test
files.

**Phase 6** — T097 and T098 are parallel.

---

## Implementation Strategy

### MVP scope

**Phases 1 + 2 + 3 (T001–T063).** This delivers the milestone's entire reason for existing: a person
makes a pose and something visibly happens. It answers the question the milestone was authorized to
answer, and everything after it strengthens rather than completes the claim.

### Incremental delivery

1. **T001–T009** — the application exists and its toolchain is strict.
2. **T010–T037** — recognition is provably faithful to Engine, verified with no browser.
3. **T038–T063** — 🎯 the loop is visible. *Demonstrable.*
4. **T064–T071** — effects are provably data, not code.
5. **T072–T088** — effects compose over time; the conceptual teleport becomes reachable in configuration alone.
6. **T089–T098** — full diagnostic visibility.
7. **T099–T106** — measured, verified, documented.

### Scope discipline

Every task above sits inside the v1.6.0 authorization. Nothing here builds an editor, segmentation, a
WebGL path, gameplay, a backend, or any user-generated-content surface. `person_visibility` (T081) is
deliberately inert and observable — it reserves a shape without acquiring a capability, which is the
opposite of building one.

---

## Task Summary

| Phase | Story | Tasks | Count |
|---|---|---|---|
| 1 — Setup | — | T001–T009 | 9 |
| 2 — Foundational | — | T010–T037 | 28 |
| 3 — Core loop 🎯 | US1 (P1) | T038–T063 | 26 |
| 4 — Effects as data | US2 (P2) | T064–T071 | 8 |
| 5 — Timelines | US3 (P2) | T072–T088 | 17 |
| 6 — Debug mode | US4 (P3) | T089–T098 | 10 |
| 7 — Polish | — | T099–T106 | 8 |
| **Total** | | | **106** |

Parallelizable tasks: **43** (marked `[P]`). Test tasks: **27**.
