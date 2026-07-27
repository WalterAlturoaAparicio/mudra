---

description: "Task list for 005-live-recognition-preview (Phase 2.75 — Live Recognition Preview)"
---

# Tasks: Phase 2.75 — Live Recognition Preview

**Input**: Design documents from `/specs/005-live-recognition-preview/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **included and mandatory** here — not optional. Constitution v1.4.0
(capture standards) requires `flutter test` coverage of the domain layer, the application layer,
and configuration loading, and `flutter analyze` clean, as part of the definition of done. The
matcher and stability logic in particular MUST be deterministic and host-testable (Principle IV);
this is not a nice-to-have for this feature, it is the property that makes it trustworthy as a
dataset-debugging tool at all.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: US1–US4 map to the user stories in spec.md
- All paths are relative to the repository root, under `apps/capture/`

## Path Conventions

Extends the existing Flutter application at `apps/capture/` (specification 003 / Revision R1).
Dart source under `apps/capture/lib/<layer>/recognition/` and `.../effects/`, tests under
`apps/capture/test/<layer>/recognition/`.

---

## Phase ↔ Plan cross-reference

`plan.md` describes **design decisions D1–D10**; this file sequences **execution phases 1–7**
grouped by user story.

| tasks.md phase | plan.md decisions | Task IDs |
|---|---|---|
| 1 Setup | Project Structure | T001–T004 |
| 2 Foundational | D1–D8 (types only) | T005–T016 |
| 3 US1 Live prediction | D1–D3, D6, D9 | T017–T030, T067 |
| 4 US2 Stability & effects | D4, D7, D8 | T031–T045, T068 |
| 5 US3 Dataset debugging | D5, D10 | T046–T053 |
| 6 US4 Whole catalog / two-handed | D2 | T054–T058 |
| 7 Polish | — | T059–T066 |

**Analysis follow-ups applied (2026-07-26)**: T067 (finding M1 — dedicated `RecognitionPreviewScreen`
camera lifecycle test) and T068 (finding M2 — recognition-remains-active-during-effects test) were
appended after the initial `/speckit-analyze` pass. L1 (no ML / no face mesh / data-driven effects)
is accepted as satisfied by construction, needing no test. L2 (a `home_screen_test.dart` regression
test protecting specification 003's FR-007) is deferred to a future Capture baseline improvement,
out of scope for this spec. L3 (default lens/mirroring assertions) is folded into T030 rather than
given a separate file.

---

## Phase 1: Setup (Shared Infrastructure) — *plan: Project Structure*

**Purpose**: Bring the new feature directories and asset into existence inside the existing app.

- [X] T001 Create the layer skeleton `apps/capture/lib/{domain,application,infrastructure,presentation}/recognition/` and `apps/capture/lib/{domain,infrastructure}/effects/`, each holding a `.gitkeep` until populated
- [X] T002 [P] Create the test skeleton `apps/capture/test/{domain,application,infrastructure,presentation}/recognition/`
- [X] T003 [P] Write `apps/capture/assets/config/effect_catalog.json` with the six milestone-named poses (horse, dog, snake, dragon, bird, tp) and the `generic_fallback` entry, exactly per contracts/effect-catalog.md
- [X] T004 [P] Register `assets/config/effect_catalog.json` (already-covered `assets/config/` glob should suffice — verify in `apps/capture/pubspec.yaml`) and add placeholder sprite assets referenced by T003 under `apps/capture/assets/effects/` (or confirm the painters fall back to drawn shapes when a sprite is absent, per contracts/effect-catalog.md's placeholder-safety rule, and skip creating sprite files)

**Checkpoint**: `flutter analyze` clean on the empty skeleton; the effect catalog asset loads.

---

## Phase 2: Foundational (Blocking Prerequisites) — *plan: D1–D8 (types)*

**Purpose**: The typed core every story sits on — value objects, ports, and configuration.
**No user story work may begin until this phase is complete.**

- [X] T005 [P] Implement `Exemplar` and `LandmarkWeights` (21-entry invariant, asserted at construction like `HandLandmarks`) in `apps/capture/lib/domain/recognition/exemplar.dart` per data-model.md
- [X] T006 [P] Implement `Candidate` in `apps/capture/lib/domain/recognition/candidate.dart`
- [X] T007 [P] Implement `RecognitionResult` (sealed: `NoHandDetected`, `Unrecognized`, `Ambiguous`, `Recognized`, each carrying `latency` and `frameTimestamp`) in `apps/capture/lib/domain/recognition/recognition_result.dart`
- [X] T008 [P] Implement `StabilityState` (fields, `heldDuration`/`progress`/`readyToConfirm` derived getters) and `ConfirmationEvent` in `apps/capture/lib/domain/recognition/stability.dart` per data-model.md's transition diagram
- [X] T009 [P] Implement `EffectKind` (enum: `glow`, `spritePair`, `particleBurst`, `fadeWithLines`, `genericConfirm`) and `EffectDefinition` in `apps/capture/lib/domain/effects/effect_definition.dart`
- [X] T010 [P] Implement `PoseReadiness` and `CatalogReadiness` in `apps/capture/lib/domain/recognition/catalog_readiness.dart`
- [X] T011 [P] Declare the domain ports `PoseMatcher`, `ExemplarSource` (+ `ExemplarLoadResult`), `EffectCatalogSource` in `apps/capture/lib/domain/ports/ports.dart` (extending the existing file) per contracts/recognition-interfaces.md
- [X] T012 [P] Implement `RecognitionConfig` (landmark weights, `minExemplarsPerPose=20`, `confidenceFloor`, `ambiguityMargin`, `softmaxTemperature`, `stabilityDuration=3.0s`, `targetLatency=200ms`) in `apps/capture/lib/shared/config/recognition_config.dart`, wired as a field on (or alongside) `CaptureConfig`
- [X] T013 [P] Implement `ExemplarLoadFailure` and `EffectCatalogFailure` in `apps/capture/lib/shared/errors/failures.dart` (extending the existing file)
- [X] T014 [P] Unit-test the domain value objects (21-weight invariant, `RecognitionResult` variant equality, `StabilityState` derived-getter math, `CatalogReadiness.isReady` threshold) in `apps/capture/test/domain/recognition/value_objects_test.dart`
- [X] T015 Write the softmax confidence helper (pure function: `List<double> distances → List<double> confidences`, temperature from `RecognitionConfig`) in `apps/capture/lib/domain/recognition/softmax.dart`, with a unit test in `apps/capture/test/domain/recognition/softmax_test.dart` (sums to 1, monotonic in distance, deterministic)
- [X] T016 [P] Implement a `FakeExemplarSource` and a scriptable `FakePoseMatcher`/`FakeClock`-friendly test double set in `apps/capture/test/support/recognition_fakes.dart`, alongside the existing `test/support/fakes.dart`

**Checkpoint**: `flutter analyze` clean, domain value-object and softmax tests green.

---

## Phase 3: User Story 1 — Watch a pose get recognized live (Priority: P1) 🎯 MVP — *plan: D1–D3, D6, D9*

**Goal**: A continuously updating prediction, confidence, top-3, and latency, driven by the real
camera seam and the real stored dataset.

**Independent Test**: With a fixture exemplar set and a fixture live frame, verify the matcher
produces the expected ranked candidates and confidence values, and that the recognition screen
displays them.

### Tests for User Story 1

- [X] T017 [P] [US1] Matcher determinism and weighting test in `apps/capture/test/domain/recognition/matcher_test.dart` — same exemplars + same frame → same output every time; fingertip-weighted distance changes ranking versus unweighted in a constructed case; empty exemplar list and handless frame both produce an empty candidate list, never throw
- [X] T018 [P] [US1] Two-hand combined scoring and required-hand-count gate test (same file or a sibling) — a two-handed pose is eligible only with both hands present; per-hand comparison is against matching handedness only (research D2)
- [X] T019 [P] [US1] `FileExemplarSource` test in `apps/capture/test/infrastructure/recognition/file_exemplar_source_test.dart` against fixture `PoseSample` files — produces one `Exemplar` per sample, grouped by pose, using the persisted `normalized` vector (never recomputed)
- [X] T020 [P] [US1] `RecognitionSessionController.process()` test (prediction path only, no stability yet) in `apps/capture/test/application/recognition/recognition_session_controller_test.dart` — a scored frame above the confidence floor and margin yields `Recognized`; below floor yields `Unrecognized`; within margin of second place yields `Ambiguous`; no hand yields `NoHandDetected`; latency is populated

### Implementation for User Story 1

- [X] T021 [P] [US1] Implement `WeightedEuclideanNearestNeighborMatcher` in `apps/capture/lib/infrastructure/recognition/weighted_euclidean_matcher.dart` per research D1/D2 and contracts/recognition-interfaces.md
- [X] T022 [US1] Implement `FileExemplarSource` (scans the existing dataset root via `FileSampleRepository`, builds `Exemplar`s and `CatalogReadiness` in one pass per research D10) in `apps/capture/lib/infrastructure/recognition/file_exemplar_source.dart`
- [X] T023 [US1] Implement `LoadExemplars` use case (calls `ExemplarSource.load()` once per screen entry, surfaces `ExemplarLoadFailure`) in `apps/capture/lib/application/recognition/load_exemplars.dart`
- [X] T024 [US1] Implement `RecognitionSessionController.process()` (score → candidates → softmax confidence → confidence-floor/ambiguity-margin gate → `RecognitionResult`, latency measured from frame timestamp to result) in `apps/capture/lib/application/recognition/recognition_session_controller.dart` per contracts/recognition-interfaces.md — stability tracking deferred to US2 (T031+)
- [X] T025 [US1] Implement `PredictionHud` (top prediction, confidence, top-3 list, latency, and the "no hand" / "not confident" / "ambiguous" states from FR-013) in `apps/capture/lib/presentation/recognition/prediction_hud.dart`
- [X] T026 [US1] Build `RecognitionPreviewScreen` (acquires the camera through `cameraSessionControllerProvider` exactly as the capture screen does — research D9 — defaults to front lens/mirrored, renders `PreviewStage` (reused) with `PredictionHud` overlaid, subscribes to `CameraSessionController.frames` and feeds each canonical frame to `RecognitionSessionController.process()`) in `apps/capture/lib/presentation/recognition/recognition_preview_screen.dart`
- [X] T027 [US1] Wire `LoadExemplars` to run once on screen entry (before the camera frame subscription starts consuming) in `RecognitionPreviewScreen`, showing a loading state and surfacing `ExemplarLoadFailure` per contracts/recognition-interfaces.md
- [X] T028 [US1] Add the recognition preview's secondary entry point to the home screen (FR-026 — an icon/button alongside, not replacing, Record and Sync) in `apps/capture/lib/presentation/home/home_screen.dart`
- [X] T029 [US1] Register providers (`poseMatcherProvider`, `exemplarSourceProvider`, `recognitionConfigProvider`, `recognitionSessionControllerProvider`) in `apps/capture/lib/shared/di/providers.dart`
- [X] T030 [P] [US1] Widget tests for `RecognitionPreviewScreen`'s live-prediction states (loading, no-hand, unrecognized, ambiguous, recognized with top-3) in `apps/capture/test/presentation/recognition/recognition_preview_screen_test.dart`, using `FakeCameraSource` and `FakeExemplarSource` — include an assertion that the screen defaults to the front lens and the preview starts mirrored (FR-003; folded in here rather than a separate test file, per analysis finding L3)
- [X] T067 [US1] `RecognitionPreviewScreen` camera lifecycle widget test, in `apps/capture/test/presentation/recognition/recognition_preview_screen_test.dart` (same file as T030, a dedicated group) — a feature-specific regression test, not a re-test of `CameraSessionController`'s own already-covered internals (analysis finding M1). Using `FakeCameraSource`, assert: entering the screen results in exactly one open camera session; leaving the screen releases every camera resource; the release completes within 1 second (SC target from FR-027); re-entering afterward opens a fresh session with no leaked reference to the previous one (`FakeCameraSource.liveCount == 1` throughout, never 0 sessions "stuck" or 2 sessions live at once across an enter → leave → re-enter sequence)

**Checkpoint**: US1 complete — with a fixture dataset and a fake camera, the screen shows a live,
continuously updating prediction, and its own camera lifecycle wiring is verified independently
of the shared controller's tests. This is the MVP.

---

## Phase 4: User Story 2 — Confirm a pose and see its effect (Priority: P1) — *plan: D4, D7, D8*

**Goal**: Stability tracking, one-shot confirmation, and a data-driven visual effect.

**Independent Test**: Feed a `FakeClock`-driven sequence of `Recognized(pose)` results for longer
than the configured stability duration and verify exactly one `ConfirmationEvent` is raised, and
that a second continuous hold raises a second one.

### Tests for User Story 2

- [X] T031 [P] [US2] Stability transition tests with `FakeClock` in `apps/capture/test/application/recognition/stability_test.dart` — holding the same pose accumulates `heldDuration`; a different `Recognized` pose, `Unrecognized`, `Ambiguous`, or `NoHandDetected` resets to zero immediately; reaching `stabilityDuration` raises exactly one `ConfirmationEvent`; continuing to hold does not raise a second one; releasing and re-holding raises an independent second one
- [X] T032 [P] [US2] `AssetEffectCatalogSource` test in `apps/capture/test/infrastructure/effects/asset_effect_catalog_source_test.dart` — loads the six milestone entries plus fallback; a `pose_id` absent from the file returns the generic fallback (never null); a malformed entry (unknown `kind`, out-of-range `intensity`, unparseable `color`) fails loudly naming the entry, per contracts/effect-catalog.md's validation rules
- [X] T033 [P] [US2] Widget tests for each `EffectKind` painter (glow, spritePair, particleBurst, fadeWithLines, genericConfirm) in `apps/capture/test/presentation/recognition/effect_overlay_test.dart` — each renders without throwing given a hand-landmark anchor position and an `EffectDefinition`; a `spritePair` definition with no `sprite_asset` falls back to a drawn shape rather than a missing-asset error

### Implementation for User Story 2

- [X] T034 [US2] Extend `RecognitionSessionController` with `StabilityState` tracking (per data-model.md's transition diagram) and confirmation emission, updating `process()`'s return type to `(RecognitionResult, ConfirmationEvent?)` per contracts/recognition-interfaces.md, in `apps/capture/lib/application/recognition/recognition_session_controller.dart`
- [X] T035 [US2] Implement `AssetEffectCatalogSource` (loads and validates `effect_catalog.json` once at construction, mirroring `AssetPoseCatalogSource`'s validate-once contract) in `apps/capture/lib/infrastructure/effects/asset_effect_catalog_source.dart`
- [X] T036 [P] [US2] Implement the `glow` and `fadeWithLines` `CustomPainter`s in `apps/capture/lib/presentation/recognition/effects/glow_painter.dart` and `fade_with_lines_painter.dart`
- [X] T037 [P] [US2] Implement the `spritePair` and `particleBurst` `CustomPainter`s (with the drawn-shape fallback when `sprite_asset` is absent) in `apps/capture/lib/presentation/recognition/effects/sprite_pair_painter.dart` and `particle_burst_painter.dart`
- [X] T038 [P] [US2] Implement the `genericConfirm` `CustomPainter` (the fallback effect, FR-020) in `apps/capture/lib/presentation/recognition/effects/generic_confirm_painter.dart`
- [X] T039 [US2] Implement `EffectOverlay` (selects and renders the right painter for an `EffectDefinition`, positioned via the same screen-space transform `PreviewStage` already applies to the camera texture, per research D8) in `apps/capture/lib/presentation/recognition/effect_overlay.dart`
- [X] T040 [US2] Wire `ConfirmationEvent` → `EffectCatalogSource.effectFor(poseId)` → `EffectOverlay` playback in `RecognitionPreviewScreen`, ensuring exactly one playback per event and that the live prediction pipeline keeps running while an effect plays (FR-022)
- [X] T041 [US2] Add the continuously-updating stability indicator (progress toward confirmation, FR-015) to `PredictionHud` in `apps/capture/lib/presentation/recognition/prediction_hud.dart`
- [X] T042 [P] [US2] Register `effectCatalogSourceProvider` in `apps/capture/lib/shared/di/providers.dart`
- [X] T043 [US2] Widget test: a full confirm-then-effect cycle end to end through `RecognitionPreviewScreen` using `FakeClock` and `FakePoseMatcher`, in `apps/capture/test/presentation/recognition/confirmation_flow_test.dart`
- [X] T044 [P] [US2] Widget test: an effect for a `pose_id` with no themed entry plays the generic fallback (extends T033's coverage into the full screen), same file as T043 or a sibling
- [X] T045 [P] [US2] Widget test: releasing and re-holding the same pose produces two independent effect playbacks, not one merged into the other (SC-008), same file as T043
- [X] T068 [US2] Recognition-remains-active-during-effects test, in `apps/capture/test/application/recognition/recognition_session_controller_test.dart` or a sibling — continuously feed frames through `RecognitionSessionController` while an `EffectOverlay` triggered by a `ConfirmationEvent` is mid-playback (analysis finding M2; effects are presentation-only and MUST NOT gate the pipeline, FR-022). Assert: `RecognitionResult`s keep arriving at the normal cadence throughout the effect's playback window (no pause, no dropped frame attributable to the effect); `PredictionHud` keeps updating (widget-level assertion, in `recognition_preview_screen_test.dart`); recognition latency stays within the FR-012/SC-002 target (< 200ms) for frames processed during playback, not just before or after it

**Checkpoint**: US1 + US2 — a pose can be recognized, held, confirmed exactly once, and its effect
plays; releasing and re-holding produces an independent second confirmation; the effect never
gates the live pipeline.

---

## Phase 5: User Story 3 — Use recognition to find weak spots in the dataset (Priority: P2) — *plan: D5, D10*

**Goal**: Poses below the minimum sample threshold are excluded and clearly flagged; catalog-wide
readiness is visible without a second dataset scan.

**Independent Test**: Seed a fixture dataset where one pose has 0 samples, one has 5, and one has
25 (threshold 20); verify only the 25-sample pose is ever offered as a candidate, and all three
appear correctly in the readiness view.

### Tests for User Story 3

- [X] T046 [P] [US3] `FileExemplarSource` below-threshold exclusion test (extends T019) in `apps/capture/test/infrastructure/recognition/file_exemplar_source_test.dart` — a pose below `minExemplarsPerPose` contributes zero exemplars and is reported not-ready in the same `ExemplarLoadResult`, with no second read
- [X] T047 [P] [US3] `RecognitionSessionController`/matcher test: a pose entirely excluded from the exemplar map never appears as a candidate, in `apps/capture/test/application/recognition/recognition_session_controller_test.dart`
- [X] T048 [P] [US3] Widget test: the three visibly distinct states (confidently recognized, unstable/low-confidence/ambiguous, insufficient data) render differently and are asserted by key, in `apps/capture/test/presentation/recognition/recognition_states_test.dart`

### Implementation for User Story 3

- [X] T049 [US3] Ensure `RecognitionPreviewScreen`/`PredictionHud` distinguish "not enough data for this pose" from "attempted but not recognized" wherever a pose's readiness is `false` (FR-023), in `apps/capture/lib/presentation/recognition/prediction_hud.dart`
- [X] T050 [US3] Build `CatalogReadinessSheet` (every catalog pose, ready/not-ready, with its exemplar count) in `apps/capture/lib/presentation/recognition/catalog_readiness_sheet.dart`, reachable from `RecognitionPreviewScreen` without a second exemplar load (reuses the `CatalogReadiness` already produced by T023's `LoadExemplars`)
- [X] T051 [US3] Add the entry point to `CatalogReadinessSheet` from `RecognitionPreviewScreen`
- [X] T052 [P] [US3] Widget test for `CatalogReadinessSheet` in `apps/capture/test/presentation/recognition/catalog_readiness_sheet_test.dart` — all 18 catalog poses appear, ready/not-ready matches the seeded exemplar counts
- [X] T053 [US3] Document, in `apps/capture/README.md`, that recognition instability on a
  correctly-performed pose is the intended signal to record more samples for it (ties the feature
  back to specification 003's Record flow)

**Checkpoint**: US1–US3 — a contributor can identify dataset gaps from the recognition preview
alone, with no external tool.

---

## Phase 6: User Story 4 — Works across the whole catalog without special-casing (Priority: P3) — *plan: D2*

**Goal**: Two-handed poses go through the exact same recognition, stability, and confirmation flow
as one-handed poses, with no special-cased user action.

**Independent Test**: Record a small fixture set for a two-handed pose, perform it with both
hands, and verify it can be predicted, become stable, and confirm exactly like a one-handed pose.

### Tests for User Story 4

- [X] T054 [P] [US4] End-to-end test: a two-handed pose's full pipeline (score → confidence →
  `Recognized` → stability → `ConfirmationEvent` → effect lookup) using fixture two-hand samples,
  in `apps/capture/test/application/recognition/two_handed_pose_test.dart` — no special-casing
  anywhere in the call path
- [X] T055 [P] [US4] Test: a two-handed pose with only one hand visible never reaches
  `Recognized` regardless of how close the single hand is to that pose's exemplars (extends
  T018's coverage into the full pipeline), same file as T054

### Implementation for User Story 4

- [X] T056 [US4] Verify (and adjust if needed) that `RecognitionPreviewScreen`'s hand-count
  messaging (reusing `RequiredHandsBadge` from specification 003's design system) applies to the
  currently top-predicted or attempted pose, in
  `apps/capture/lib/presentation/recognition/prediction_hud.dart`
- [X] T057 [P] [US4] Widget test: a two-handed pose's confirmation and effect playback render
  identically in kind to a one-handed pose's (only the eligibility gate differs), in
  `apps/capture/test/presentation/recognition/confirmation_flow_test.dart`
- [X] T058 [US4] Confirm `CatalogReadinessSheet` reports two-handed poses' readiness correctly
  (exemplar count reflects samples where both hands were present, per specification 003's
  existing per-sample hand-count data) — add a case to T052 if not already covered

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T059 [P] Extend `apps/capture/test/architecture/layer_boundaries_test.dart` to assert
  `domain/recognition/` and `domain/effects/` import nothing from Flutter, a plugin, or
  `dart:io`, and that `infrastructure/recognition/`/`infrastructure/effects/` do not import from
  `infrastructure/storage/` or `infrastructure/export/` (mirrors the existing camera-boundary
  rules; FR-004's read-only contract deserves the same enforcement, not just documentation)
- [X] T060 [P] Add an end-to-end no-hardware integration test (fixture dataset → `LoadExemplars`
  → `FakeCameraSource`-driven frames → `RecognitionSessionController` → `ConfirmationEvent` →
  effect lookup, with zero dataset writes asserted throughout) in
  `apps/capture/test/integration/recognition_pipeline_test.dart`, mirroring specification 003's
  `full_pipeline_test.dart` pattern
- [X] T061 [P] Update `apps/capture/README.md`: the recognition preview's purpose (dataset
  validation + demo), the `PoseMatcher` interface as Principle III's first realized pluggable
  strategy, how to author a new effect (a JSON edit, per contracts/effect-catalog.md), and the
  explicit non-goals (no ML, no training, no cloud) restated from the constitution's Phase 2.75
  exception
- [X] T062 [P] Confirm `flutter analyze` is clean and `flutter test` is green from
  `apps/capture/`, including every new recognition test
- [ ] T063 Run the full `quickstart.md` manual matrix (rows 1–19) on a physical Android device
  with a real, previously-recorded dataset, and record the results
- [ ] T064 ⭐ Run the SC-002/SC-007 latency and scale checks from `quickstart.md`: recognition
  latency under 200ms for at least 95% of frames over a 2-minute session, and the same target
  holding with a dataset seeded to at least 5,000 samples across the catalog
- [ ] T065 Verify FR-004 mechanically on-device: inspect the dataset directory and confirm no
  sample, session record, or export archive was written by any use of the recognition preview
  during rows 1–19
- [ ] T066 [P] Tune `RecognitionConfig`'s `confidenceFloor`, `ambiguityMargin`, and
  `softmaxTemperature` (research D3/D4, left unset by the spec) against the real recorded dataset
  used in T063, and record the chosen values and the reasoning in `research.md`'s Open Risks table

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Everything else depends on US1's matcher +
  exemplar loading + controller core
- **US2 (Phase 4)**: depends on US1 (extends `RecognitionSessionController`, needs a working
  `RecognitionResult` stream to drive stability from)
- **US3 (Phase 5)**: depends on US1 (needs `LoadExemplars`/`CatalogReadiness`); independent of
  US2 — could be built in parallel with it if desired, since neither modifies the other's files
- **US4 (Phase 6)**: depends on US1 and US2 (the full confirm-and-effect pipeline must exist to
  prove it applies unchanged to two-handed poses)
- **Polish (Phase 7)**: depends on all four stories

### Critical path

`T001 → T005-T013 → T015 → T017-T020 → T021-T024 → T026-T029 → T031 → T034-T035 → T039-T040 → T054-T058 → T063-T064`

### Within User Story 1

Tests (T017–T020) are written before the implementation they cover. T021 and T022 are
independent; T023 depends on T022 (it calls `ExemplarSource.load()`); T024 depends on T021–T023;
T025–T026 depend on T024; T028–T029 can proceed in parallel with T025–T027.

### Parallel Opportunities

- Setup: T002, T003, T004 in parallel
- Foundational: T005–T013 all in parallel (separate files); T014–T016 after their subjects exist
- US1: T017–T020 in parallel; T021/T022 in parallel; T029/T030 in parallel with T025–T028; T067
  depends on T026 (the screen must exist first) but is otherwise independent of T029/T030
- US2: T031–T033 in parallel; T036/T037/T038 (the four painters) all in parallel; T042/T044/T045
  in parallel with T039–T041; T068 depends on T034 and T040 (stability + effect wiring must exist
  first)
- US3: T046–T048 in parallel; T052 in parallel with T053
- US4: T054/T055 in parallel; T057 in parallel with T056/T058
- Polish: T059, T060, T061, T062 in parallel

---

## Parallel Example: User Story 1

```bash
# Tests first, independent files:
Task: "Matcher determinism and weighting test in apps/capture/test/domain/recognition/matcher_test.dart"
Task: "FileExemplarSource test in apps/capture/test/infrastructure/recognition/file_exemplar_source_test.dart"
Task: "RecognitionSessionController prediction-path test in apps/capture/test/application/recognition/recognition_session_controller_test.dart"

# Then the independent implementations:
Task: "WeightedEuclideanNearestNeighborMatcher in apps/capture/lib/infrastructure/recognition/weighted_euclidean_matcher.dart"
Task: "FileExemplarSource in apps/capture/lib/infrastructure/recognition/file_exemplar_source.dart"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **stop and validate**: with a
fixture dataset and a fake camera, the screen shows a live, continuously updating prediction.

### Incremental delivery

1. Setup + Foundational → skeleton compiles, config and value objects tested
2. + US1 → **live prediction works** (MVP)
3. + US2 → stability, one-shot confirmation, and visual effects
4. + US3 → the recognizer becomes a dataset-debugging tool
5. + US4 → proven to work for two-handed poses with no special-casing

Each increment is demonstrable on its own and breaks nothing before it.

### Suggested checkpoints for review

- After Phase 2: the recognition domain's type boundary (this is the layer everything else
  depends on being right)
- After US1: matcher determinism (the hardest thing to get wrong silently — a non-deterministic
  or subtly-broken matcher would look fine in a demo and be useless as a debugging tool)
- After US2: the stability state machine (FR-016/FR-018's "resets immediately" / "exactly once"
  guarantees are easy to get almost-right and wrong in the edge cases)
- After T064: the two performance targets (SC-002/SC-007) — these are the only success criteria
  that need real hardware and a real large dataset to settle

## Notes

- `[P]` = different files, no dependencies
- Tests are mandatory per constitution v1.4.0, not optional
- Commit after each task or logical group
- T063–T064 need a physical device **and** a previously-recorded dataset of meaningful size;
  they cannot be faked the way the rest of this feature can
- `confidenceFloor`, `ambiguityMargin`, and `softmaxTemperature` are deliberately left untuned
  until T066 — they are the one part of this feature that can only be responsibly set against
  real recorded data, not guessed at during spec or planning
