---

description: "Task list for 003-mobile-pose-capture (Mudra Capture)"
---

# Tasks: Mudra Capture — Mobile Pose Dataset Collector

**Input**: Design documents from `/specs/003-mobile-pose-capture/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

> **Revision R1 integrated (2026-07-26).** Phases 1–7 (T001–T081) are the **baseline**, largely merged;
> they are kept as the record of what exists. Phases 8–16 (T082–T138) implement Revision R1 — camera
> lifecycle, capture modes, preview fidelity, countdown, session loop, camera metadata, layout, and the
> camera abstraction (FR-053–FR-116).
>
> **T037 and T037a are superseded by R1** and marked as such below. They enforce front-camera-only
> capture; R1 permits both lenses and preserves the same anti-corruption guarantee by converting
> captures into the canonical convention before storage. They are **replaced**, not extended, by
> T099/T100 and T089/T090.

**Tests**: Test tasks are **included and mandatory** here — not optional. Constitution v1.3.0
(capture standards) requires `flutter test` coverage of the domain layer, the application layer, and
JSON serialization round-trips, and `flutter analyze` clean, as part of the definition of done.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: US1–US10 map to the user stories in spec.md (US5–US10 added in R1)
- All paths are relative to the repository root

## Path Conventions

Flutter application at `apps/capture/` per plan.md. Dart source under `apps/capture/lib/<layer>/`,
tests under `apps/capture/test/<layer>/`, Android native under
`apps/capture/android/app/src/main/kotlin/com/mudra/capture/`.

---

## Phase ↔ Plan cross-reference

`plan.md` describes **capability phases A–N**; this file sequences **execution phases 1–16** grouped
by user story. Neither supersedes the other — this table is the mapping, and each phase header below
repeats its letter.

| tasks.md phase | plan.md phase | Task IDs |
|---|---|---|
| 1 Setup | A Foundation | T001–T006 |
| 2 Foundational | A Foundation | T007–T020, T070–T071 |
| 3 US1 Record | B Schema parity · C Capture loop · D Native binding | T021–T039, T072–T075 |
| 4 US2 Quality | E Quality & catalog | T040–T046 |
| 5 US3 Catalog | E Quality & catalog | T047–T055 |
| 6 US4 Export | F Export | T056–T061, T076–T079 |
| 7 Polish | G Docs & polish | T062–T069, T080–T081 |
| **8 R1 Foundational** | **H Camera seam · I Canonical conversion** | **T082–T093** (incl. T082a, T086a) |
| **9 US5 Camera lifecycle** | **H Camera seam & lifecycle** | **T094–T105** |
| **10 US1′ Countdown & loop** | **J Modes/settings · L Session loop** | **T106–T111a** |
| **11 US7 Operator Capture** | **J Modes, lenses & settings** | **T112–T115a** |
| **12 US6 Preview fidelity** | **M Preview fidelity & layout** | **T116–T118** |
| **13 US8 Lens switching** | **J Modes, lenses & settings** | **T119–T122** |
| **14 US9 Traceability** | **K Camera metadata** | **T123–T127** |
| **15 US10 Capture layout** | **M Preview fidelity & layout** | **T128–T131** |
| **16 R1 Polish** | **N Validation & docs** | **T132–T138** (incl. T133a, T133b) |

---

## Phase 1: Setup (Shared Infrastructure) — *plan phase A*

**Purpose**: Bring the application skeleton into existence inside the monorepo.

- [X] T001 Create the Flutter application at `apps/capture/` (`flutter create --org com.mudra --project-name capture --platforms android apps/capture`), then delete the generated counter demo from `apps/capture/lib/main.dart` and `apps/capture/test/widget_test.dart`
- [X] T002 Declare dependencies in `apps/capture/pubspec.yaml`: `flutter_riverpod`, `permission_handler`, `archive`, `share_plus`, `path_provider`, `uuid`; dev: `flutter_lints`, `flutter_test`
- [X] T003 [P] Configure strict analysis in `apps/capture/analysis_options.yaml` (include `flutter_lints`, enable `prefer_final_locals`, `always_declare_return_types`, `public_member_api_docs` for `lib/domain/**`)
- [X] T004 Create the layer skeleton `apps/capture/lib/{domain,application,infrastructure,presentation,shared}/` with the sub-directories listed in plan.md, each holding a `.gitkeep` until populated
- [X] T005 [P] Register asset folders in `apps/capture/pubspec.yaml` (`assets/config/`, `assets/poses/`, `assets/models/`) and copy the engine's `assets/hand_landmarker.task` to `apps/capture/android/app/src/main/assets/hand_landmarker.task`
- [X] T006 [P] Add `apps/capture/.gitignore` entries for Flutter build output and confirm the repo root `.gitignore` does not swallow `apps/capture/`

**Checkpoint**: `cd apps/capture && flutter analyze` runs clean on an empty skeleton.

---

## Phase 2: Foundational (Blocking Prerequisites) — *plan phase A*

**Purpose**: The typed core every story sits on — value objects, ports, configuration, and the
composition root. **No user story work may begin until this phase is complete.**

- [X] T007 [P] Implement `Handedness`, `Landmark`, `HandLandmarks` (21-point invariant), `HandDetection`, `LandmarkFrame` in `apps/capture/lib/domain/landmarks/` per data-model.md
- [X] T008 [P] Implement `Pose`, `HandSample`, `HandMeta`, `CaptureTiming`, `SampleMetadata`, `PoseSample`, `SampleRef` in `apps/capture/lib/domain/samples/`
- [X] T009 [P] Implement `PoseDefinition`, `PoseCatalog`, `PoseProgress` in `apps/capture/lib/domain/poses/`
- [X] T010 [P] Implement `CaptureSessionState` (sealed), `CaptureResult`, `CaptureOutcome`, `RejectionReason` in `apps/capture/lib/domain/capture/`
- [X] T011 [P] Declare the domain ports `HandLandmarkSource`, `SampleRepository`, `PoseCatalogSource`, `DatasetExporter`, `SampleValidator`, `LandmarkNormalizer`, `Clock`, `UuidFactory`, `AppLogger` in `apps/capture/lib/domain/ports/` per contracts/interfaces.md
- [X] T012 [P] Implement `CaptureConfig` with every tunable from data-model.md in `apps/capture/lib/shared/config/capture_config.dart` (no magic numbers may appear at call sites)
- [X] T013 [P] Implement failure types `CameraFailure`, `RepositoryFailure`, `CatalogFailure`, `ExportFailure` and the `Result`/`Failure` helpers in `apps/capture/lib/shared/errors/`
- [X] T014 [P] Implement `SystemClock`, `UuidV4Factory`, and a `DebugAppLogger` (frame events at debug only) in `apps/capture/lib/infrastructure/platform/`
- [X] T015 [P] Unit-test the domain value objects (21-landmark invariant, equality, derived getters) in `apps/capture/test/domain/value_objects_test.dart`
- [X] T016 Write the pose catalog asset `apps/capture/assets/config/pose_catalog.json` with all 18 poses and their `required_hands` exactly as tabulated in contracts/pose-catalog.md
- [X] T017 Implement `AssetPoseCatalogSource` with full validation (id pattern, uniqueness, targets, required hands, catalog version) in `apps/capture/lib/infrastructure/catalog/asset_pose_catalog_source.dart`
- [X] T018 [P] Test catalog loading and every validation failure mode in `apps/capture/test/infrastructure/catalog_test.dart` (18 poses load; duplicate id, bad id pattern, zero target, `required_hands = 3`, unknown catalog version each fail with the entry named)
- [X] T019 Build the composition root in `apps/capture/lib/main.dart` + `apps/capture/lib/shared/di/providers.dart`: `ProviderScope`, provider declarations for every port, and a `MudraCaptureApp` shell with the design theme
- [X] T020 [P] Implement design tokens and shared widgets (spacing, typography, large-button style, progress bar) in `apps/capture/lib/presentation/design/`
- [X] T070 Implement structured lifecycle observability (FR-042/FR-043, constitution Principle V): `StartupRecord`/`ShutdownRecord` types, `AppLogger.startup`/`shutdown`, `StructuredAppLogger` emitting Loguru-shaped field maps, and `DeviceInfoSource`, in `apps/capture/lib/infrastructure/platform/structured_app_logger.dart` + `device_info_source.dart`
- [X] T071 Implement `RecordAppLifecycle` in `apps/capture/lib/application/lifecycle/record_app_lifecycle.dart` and wire it into `main.dart`: emit the startup record after config + catalog load (version, configuration profile, dataset root, catalog size, camera configuration, platform) and the shutdown record on graceful exit (run duration, total recorded, total discarded, export count, `graceful: true`); test both field sets in `apps/capture/test/application/lifecycle_test.dart` (exactly one of each — SC-017)

**Checkpoint**: `flutter analyze` clean, domain and catalog tests green, app launches to an empty
shell with the theme applied and emits a complete startup record.

---

## Phase 3: User Story 1 — Record a burst of samples (Priority: P1) 🎯 MVP — *plan phases B, C, D*

**Goal**: One press of Record produces many engine-compatible samples for the selected pose.

**Independent Test**: With the fake landmark source, one `RunCaptureSession` yields N stored samples
under `datasets/poses/<pose_id>/` that the engine's serializer can read; on a device, pressing Record
produces the same result from a real hand.

### Tests for User Story 1

- [X] T021 [P] [US1] Add a fixture-generation script `scripts/export_capture_fixtures.py` (repo root, Python) that writes engine-produced samples and normalization pairs to `apps/capture/test/fixtures/`, and run it
- [X] T022 [P] [US1] Normalizer parity test in `apps/capture/test/domain/normalizer_test.dart` — Dart output equals the engine's `normalized` arrays exactly for every fixture, including the degenerate-span fallback
- [X] T023 [P] [US1] Serializer golden test in `apps/capture/test/infrastructure/serializer_test.dart` — key order, nesting, `+00:00` timestamps, `camera.index`, `versions.application` provenance, and `deserialize(serialize(x)) == x`
- [X] T024 [P] [US1] Repository test in `apps/capture/test/infrastructure/repository_test.dart` — sequential numbering, `max+1` with gaps, never overwrites an existing file, creates pose directories, `saveAll` ordering, and only `.json` files exist afterwards
- [X] T025 [P] [US1] Capture-session test in `apps/capture/test/application/capture_session_test.dart` using `FakeHandLandmarkSource` — countdown never blocks the frame stream, capture starts automatically at zero, every valid frame becomes a sample, cancel writes nothing, ≥20 samples from a 1 s window at 30 fps

### Implementation for User Story 1

- [X] T026 [P] [US1] Implement `TranslationScaleNormalizer` (origin 0, scale 9, `1e-9` fallback, version `1.0`) in `apps/capture/lib/domain/normalization/translation_scale_normalizer.dart`
- [X] T027 [P] [US1] Implement `PoseSampleSerializer` emitting engine schema v1 exactly, per contracts/sample-json.md, in `apps/capture/lib/infrastructure/serialization/pose_sample_serializer.dart`
- [X] T028 [US1] Implement `FileSampleRepository` (append-only numbering, in-memory next-number cache, `saveAll`, `count`/`countAll`, dataset root under app documents) in `apps/capture/lib/infrastructure/storage/file_sample_repository.dart`
- [X] T029 [P] [US1] Implement `FakeHandLandmarkSource` (scripted frames, configurable rate, invalid/empty frame injection) in `apps/capture/test/support/fake_hand_landmark_source.dart`
- [X] T030 [US1] Implement `CountdownTicker` (non-blocking, `Stream`-based, cancellable) in `apps/capture/lib/application/capture/countdown_ticker.dart`
- [X] T031 [US1] Implement `RunCaptureSession` — the session state machine from data-model.md: mint `session_uuid` → lock orientation → countdown → capture window → per-frame validate → normalize → build `PoseSample` (uuid, timestamps, `CaptureTiming` incl. `session_uuid`, camera metadata) → buffer → `saveAll` → record the session → unlock orientation on every exit path → `CaptureResult` — in `apps/capture/lib/application/capture/run_capture_session.dart`
- [X] T072 [US1] Implement session identity (FR-045/FR-046): `CaptureSession`, `SessionEndReason`, `session_uuid` in `CaptureTiming` and the serializer's `metadata.capture` block per contracts/sample-json.md, and `FileSessionStore` in `apps/capture/lib/infrastructure/storage/file_session_store.dart` (stored outside `datasets/poses/`); test in `apps/capture/test/application/session_identity_test.dart` that all samples from one press share a `session_uuid`, that different presses differ, that a session with zero accepted samples is **not** recorded, and that the engine's parser still reads the sample (additive-compatibility assertion, FR-052)
- [X] T074 [US1] Implement the sample-limit path (FR-051): on reaching `maxSamplesPerSession`, stop accepting frames, finalize normally with `SessionEndReason.limitReached`, persist everything accepted, and surface a plain-language message; test in `apps/capture/test/application/session_limit_test.dart`
- [X] T075 [US1] Implement `OrientationController` (lock during a session, unlock on every exit path including failures, `unexpectedChanges` stream) in `apps/capture/lib/infrastructure/platform/orientation_controller.dart`, wire the abort path into `RunCaptureSession` (FR-049/FR-050), and test in `apps/capture/test/application/orientation_abort_test.dart` that an orientation change writes **zero** samples and returns to idle (SC-016)
- [X] T032 [US1] Implement `CaptureSessionNotifier` exposing `CaptureSessionState` to the UI, plus `CancelCaptureSession`, in `apps/capture/lib/application/capture/capture_session_notifier.dart`
- [X] T033 [US1] Build the capture screen in `apps/capture/lib/presentation/capture/capture_screen.dart`: live preview area, countdown overlay that never freezes the preview, capture indicator — widgets only, all state from the notifier
- [X] T073 [US1] Keep the pose **reference thumbnail visible during the countdown** alongside the live preview and the countdown digits (FR-012) in `apps/capture/lib/presentation/capture/countdown_overlay.dart`, with a widget test asserting all three are present simultaneously in `apps/capture/test/presentation/countdown_overlay_test.dart`
- [X] T034 [US1] Add the large Record button and wire it to `CaptureSessionNotifier` in `apps/capture/lib/presentation/home/home_screen.dart`
- [X] T035 [US1] Implement `CameraPermissions` (request, rationale, permanently-denied → settings) in `apps/capture/lib/infrastructure/platform/camera_permissions.dart` and the rationale screen in `apps/capture/lib/presentation/permissions/`
- [X] T036 [US1] Implement the Kotlin `HandLandmarkerPlugin` (MethodChannel `mudra.capture/landmarks`, EventChannel `.../frames`, `start`/`stop`/`dispose`, `PlatformException` codes) in `apps/capture/android/app/src/main/kotlin/com/mudra/capture/HandLandmarkerPlugin.kt` per contracts/platform-channel.md
- [X] ~~T037~~ **[SUPERSEDED BY R1 → T099]** [US1] Implement `CameraXController` … bind `CameraSelector.DEFAULT_FRONT_CAMERA`, mirror the preview, return `lensFacing = 1` + `mirrored = true`, fail with `camera_configuration_unsupported` when no front camera exists. *R1 permits the rear lens (FR-059–FR-070) and preserves the anti-corruption guarantee by converting captures into the canonical convention before storage (FR-053–FR-058). Rewritten by **T099**, not extended.*
- [X] ~~T037a~~ **[SUPERSEDED BY R1 → T098]** [US1] Enforce `lensFacing == 1 && mirrored == true` on every `start()` in the Dart source. *R1 asserts instead that the returned lens **equals the requested one** and that mirroring is consistent with it. Rewritten by **T098**, not extended.*
- [X] T038 [US1] Add Android configuration: CameraX + `tasks-vision` dependencies and `minSdk 24` in `apps/capture/android/app/build.gradle`, `CAMERA` permission and `android:hardwareAccelerated` in `apps/capture/android/app/src/main/AndroidManifest.xml`, and plugin registration in `MainActivity.kt`
- [X] T039 [US1] Implement `MethodChannelHandLandmarkSource` decoding the `Float32List` payload into `LandmarkFrame` in `apps/capture/lib/infrastructure/landmarks/method_channel_hand_landmark_source.dart`, and bind it in the providers (fake source overridable in tests)

**Checkpoint**: US1 complete — on the host, a fake session writes valid samples; on a device, Record
captures real landmarks. This is the MVP.

---

## Phase 4: User Story 2 — Trust the quality of what was collected (Priority: P1) — *plan phase E*

**Goal**: Invalid frames are discarded, never stored, and the user immediately sees accepted vs
discarded counts.

**Independent Test**: Run sessions with scripted invalid frames (no hands, one hand for a two-handed
pose, 20 landmarks, NaN coordinates) and verify nothing is written and the summary counts match.

### Tests for User Story 2

- [X] T040 [P] [US2] Validator tests in `apps/capture/test/domain/validator_test.dart` — each `RejectionReason` triggered in isolation, rule precedence, and parity with the engine's rules for the shared three
- [X] T041 [P] [US2] Accounting test in `apps/capture/test/application/capture_accounting_test.dart` — `accepted + discarded == frames observed`, zero-accepted session writes no file, per-reason counts are correct
- [ ] T042 [P] [US2] Widget test for the summary in `apps/capture/test/presentation/capture_summary_test.dart` — "N valid · M discarded" renders for accepted, all-discarded, and zero-frame outcomes

### Implementation for User Story 2

- [X] T043 [P] [US2] Implement `PoseSampleValidator` (≥1 hand, `required_hands`, exactly 21 landmarks, finite coordinates, ordered rules returning `RejectionReason`) in `apps/capture/lib/domain/validation/pose_sample_validator.dart`
- [X] T044 [US2] Extend `RunCaptureSession` to tally accepted/discarded and per-reason counts into `CaptureResult` in `apps/capture/lib/application/capture/run_capture_session.dart`
- [X] T045 [US2] Build the capture summary UI (large accepted count, discarded count, dominant rejection reason as a plain-language hint, and the "sample limit reached" message from FR-051) in `apps/capture/lib/presentation/capture/capture_summary.dart`
- [X] T046 [US2] Show the selected pose's required hand count before and during a session (FR-019b) in `apps/capture/lib/presentation/capture/capture_screen.dart` and the home pose card

**Checkpoint**: US1 + US2 — recording works and its quality is visible and trustworthy.

---

## Phase 5: User Story 3 — Work through the pose catalog (Priority: P2) — *plan phase E*

**Goal**: Per-pose reference image, target, collected count, and progress that motivate completion.

**Independent Test**: Switch poses and verify every pose-specific element updates and that recording
affects only the selected pose; reopen the app and verify counts persist.

### Tests for User Story 3

- [X] T047 [P] [US3] `PoseProgress` tests in `apps/capture/test/domain/pose_progress_test.dart` — fraction clamping, completion boundary, zero-target guard
- [ ] T048 [P] [US3] Progress hydration test in `apps/capture/test/application/pose_progress_test.dart` — counts come from stored files, refresh after a session, counts survive a repository re-read
- [ ] T049 [P] [US3] Home widget tests in `apps/capture/test/presentation/home_screen_test.dart` — pose name, reference image, placeholder when the asset is missing, count, progress bar, complete state, and only two primary actions present

### Implementation for User Story 3

- [X] T050 [P] [US3] Implement `LoadPoseCatalog` and `SelectPose` use cases in `apps/capture/lib/application/catalog/`
- [X] T051 [US3] Implement `PoseProgressNotifier` + `RefreshPoseProgress` (hydrate from `countAll`, update after each session) in `apps/capture/lib/application/catalog/pose_progress_notifier.dart`
- [X] T052 [P] [US3] Implement `PoseReferenceImage` widget with graceful placeholder fallback (name + description, no broken image) in `apps/capture/lib/presentation/design/pose_reference_image.dart`
- [X] T053 [US3] Complete the home screen: pose card, reference image, collected/target, progress bar, complete badge, secondary Sync slot, in `apps/capture/lib/presentation/home/home_screen.dart`
- [X] T054 [US3] Build the pose picker (list with per-pose progress, tap to select, complete poses visually distinct) in `apps/capture/lib/presentation/catalog/pose_picker_screen.dart`
- [X] T055 [P] [US3] Generate neutral placeholder reference images for all 18 poses in `apps/capture/assets/poses/` and document the drop-in replacement path in `apps/capture/README.md`

**Checkpoint**: US1–US3 — a contributor can work the catalog end to end.

---

## Phase 6: User Story 4 — Hand the dataset to the engine (Priority: P2) — *plan phase F*

**Goal**: Sync produces a ZIP the engine imports with zero manual processing.

**Independent Test**: Seed a temp dataset with two poses, run the exporter, and assert the archive
contains `datasets/poses/<pose_id>/sample_NNNNNN.json` for every sample; then load the extracted
files with the engine's serializer.

### Tests for User Story 4

- [X] T056 [P] [US4] Exporter test in `apps/capture/test/infrastructure/exporter_test.dart` — folder structure preserved, every sample present and byte-identical, empty dataset returns an empty result without writing an archive
- [ ] T057 [P] [US4] Sync widget test in `apps/capture/test/presentation/sync_test.dart` — idle, in-progress, success, and "nothing to export" states

### Implementation for User Story 4

- [X] T076 [P] [US4] Implement `DatasetIntegrityChecker` (parseable JSON, schema compliance, folder structure, duplicate `sample_uuid`/number detection, valid `pose_id`s, reconcilable totals; catalog coverage as a warning) in `apps/capture/lib/infrastructure/export/dataset_integrity_checker.dart` per contracts/export-manifest.md — read-only, never repairs
- [X] T077 [P] [US4] Implement `ManifestBuilder` + `ManifestSerializer` producing `manifest.json` (manifest/schema/capture versions, export timestamp, device, platform, totals, per-pose counts, normalization, session records from `SessionStore`, sha256 per-collection checksums, integrity report) in `apps/capture/lib/infrastructure/export/manifest_builder.dart`
- [X] T078 [P] [US4] Integrity + manifest tests in `apps/capture/test/infrastructure/integrity_test.dart` and `manifest_test.dart` — each critical check fails a seeded corruption and **produces no archive**; `total_samples` equals the real file count; `pose_counts` sums to it; every sample's `session_uuid` resolves to a `sessions[]` entry; checksums recompute
- [X] T058 [US4] Implement `ZipDatasetExporter` using the streaming `ZipFileEncoder` inside a background isolate in `apps/capture/lib/infrastructure/export/zip_dataset_exporter.dart`, writing `manifest.json` at the archive root beside `datasets/poses/**`
- [X] T059 [P] [US4] Implement `SharePresenter` wrapping `share_plus` in `apps/capture/lib/infrastructure/platform/share_presenter.dart`
- [X] T060 [US4] Implement the `ExportDataset` use case + notifier — **validate integrity → build manifest → package → share**, aborting with `IntegrityFailure` (naming the check and file) before any archive is written; plus progress, empty-dataset case, and refusal to export while a session is running — in `apps/capture/lib/application/export/export_dataset.dart`
- [X] T079 [US4] Surface export outcomes in the UI: validating, packaging, success with sample/pose totals, "nothing to export", and integrity-abort with the failed check, in `apps/capture/lib/presentation/home/sync_status.dart`
- [X] T061 [US4] Wire the Sync button with its states and result message in `apps/capture/lib/presentation/home/home_screen.dart`

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns — *plan phase G*

- [X] T062 [P] Write `apps/capture/README.md`: architecture and layer rules, the platform seam, how to add a pose, how to drop in artwork, how to run tests, the **Sync = user-facing label / dataset export = domain term** glossary note, and the known device-verification gap
- [X] T063 [P] Update the repository `README.md` with the monorepo layout (engine at root, `apps/capture/`) — the deferred TODO recorded in constitution v1.2.0's Sync Impact Report
- [ ] T064 [P] Add empty, loading, and error states for every screen (no dataset yet, catalog failure, storage failure, camera lost mid-session)
- [X] T065 Verify Principle II mechanically: a test asserting the dataset tree contains only `.json` files after a session, in `apps/capture/test/infrastructure/no_pixels_test.dart`
- [ ] T066 Performance pass against SC-011: seed 5,000 samples, confirm home screen and export stay responsive; move any blocking work off the UI isolate
- [X] T067 [P] Confirm `flutter analyze` is clean and `flutter test` is green from `apps/capture/`
- [ ] T068 Run the full `quickstart.md` manual matrix (rows 1–28) on a physical Android device and record the results
- [ ] T069 Run the engine import check from `quickstart.md` — export from the device, unzip into `datasets/poses/`, load every sample with the engine's `PoseSerializer` (SC-005)
- [ ] T080 ⭐ Run the **primary KPI benchmark** from `quickstart.md`: a timed 5-minute recording session on a release build, counting accepted samples, passing at **≥300** (SC-001). Record device, build, and count alongside the release
- [ ] T081 [P] File the engine-side follow-up: teach the engine's `CaptureTiming`/`PoseSerializer` to carry and re-emit `metadata.capture.session_uuid` so an engine round-trip stops dropping it (see contracts/sample-json.md). **Out of scope for this feature** — engine work, tracked so the known consequence is not forgotten

---

## Phase 8: R1 Foundational (Blocking Prerequisites) — *plan phases H, I*

**Purpose**: the typed camera vocabulary and the canonical conversion every R1 story sits on. **No R1
story work may begin until this phase is complete.** It is also the phase that breaks compilation
deliberately — the port and field renames must land together, so the tree is green before behaviour
changes.

- [X] T082 [P] Implement the camera domain types — `LensPosition`, `ViewConvention`, `CaptureMode`, `CaptureProfile`, `CameraRequest`, `CameraSessionInfo` (incl. derived `mirroredPreview` and `previewAspect`), `CameraMetadata`, `CameraReleaseReason` — in `apps/capture/lib/domain/camera/camera.dart` per data-model.md § Camera domain
- [X] T083 [P] Add `Handedness.flipped` (`left ↔ right`, `unknown` unchanged) and a `convention` field on `LandmarkFrame` in `apps/capture/lib/domain/landmarks/landmarks.dart`, with a debug assertion that frames observed above the camera seam are always `ViewConvention.canonical`
- [X] T084 Replace `HandLandmarkSource` and `LandmarkSourceSession` with `CameraSource` and `CameraSession` in `apps/capture/lib/domain/ports/ports.dart` per contracts/interfaces.md — `availableLenses()`, `open(CameraRequest)`, `info`/`frames`/`close()`; delete the `lensFacing MUST be 1` / `mirrored MUST be true` doc contracts, which R1 replaces
- [X] T085 Rename `HandSample.raw` → `canonicalRaw` (FR-056), add `countdownEnabled` to `CaptureTiming` (FR-083), and add `camera: CameraMetadata` to `SampleMetadata` (FR-081/FR-082/FR-084) in `apps/capture/lib/domain/samples/pose_sample.dart`, updating every call site
- [X] T082a **[R1.1 / A1]** Rename the take types to end the "session" collision — `CaptureSession` → `RecordingSession`, `CaptureSessionState` → `RecordingSessionState` (and its `Idle`/`Countdown`/`Capturing`/`Saving`/`Summary`/`Cancelled`/`Failed` subclasses' file) — in `apps/capture/lib/domain/capture/`, updating every call site. **Mechanical rename only**: no behaviour change, and the persisted key `session_uuid` is untouched (spec Glossary → *The three sessions*)
- [X] T086 [P] Implement `CaptureSettings` (mode, lens, countdownEnabled, countdownSeconds, confirmTakes; `mirrored` **derived** from lens, never stored) in `apps/capture/lib/domain/camera/capture_settings.dart`
- [X] T086a **[R1.1 / F1]** Widen the orientation lock to the whole capture session in `apps/capture/lib/infrastructure/platform/platform_adapters.dart` and `apps/capture/lib/presentation/capture/capture_screen.dart`: lock on entering the capture screen, restore the previous setting on leaving via **every** exit path including failures, and stop locking/unlocking per take. Rename `CaptureConfig.lockOrientationDuringSession` → `lockOrientationOnCaptureScreen`. Test in `apps/capture/test/application/orientation_scope_test.dart` that the lock outlives a completed take and is released exactly once on exit (FR-049 revised, FR-050)
- [X] T087 Extend `CaptureConfig` in `apps/capture/lib/shared/config/capture_config.dart` with `selfCaptureProfile`, `operatorCaptureProfile`, `defaultConfirmTakes`, `analysisWidth`/`analysisHeight`, `cameraReleaseTimeout`, and the renamed `lockOrientationOnCaptureScreen` — the two profiles are configuration data, never constants at a call site (Principle V)
- [X] T088 [P] Replace `CameraFailure.unsupportedConfiguration` with the R1 taxonomy — `permissionDenied`, `permissionPermanentlyDenied`, `cameraBusy`, `lensUnavailable`, `detectorUnavailable`, `startFailed` — each carrying a plain-language message and a declared route out, in `apps/capture/lib/shared/errors/failures.dart` per data-model.md § Camera failure taxonomy
- [X] T089 [P] Canonical-conversion tests **before** the implementation, in `apps/capture/test/domain/canonical_converter_test.dart`: a canonical frame is returned unchanged; an unmirrored frame has `x → 1 − x` on all 21 points with `y`/`z` untouched; handedness flips; a two-handed frame keeps each hand's landmarks with its own entry and is **never** reordered; `convert(convert(f)) == convert(f)`; a synthetic rear-lens frame converges on the equivalent front-lens frame (SC-031)
- [X] T090 Implement `CanonicalViewConverter` in `apps/capture/lib/domain/canonical/canonical_view_converter.dart` — pure, involutive, never mutates its input, never touches metadata (FR-053–FR-055, FR-058)
- [X] T091 [P] Implement `FakeCameraSource` in `apps/capture/test/support/fake_camera_source.dart` — scriptable lens set, scripted frames in either convention, injectable open failures and open latency — and delete `apps/capture/test/support/fake_hand_landmark_source.dart`, migrating its callers. **[R1.1 / C2]** It MUST be complete enough to drive the whole pipeline, not only the capture loop: deterministic frame sequences long enough to fill a capture window, controllable timing, and every failure code from contracts/camera-channel.md (FR-116)
- [X] T092 Update `PoseSampleSerializer` in `apps/capture/lib/infrastructure/serialization/pose_sample_serializer.dart` for the `canonicalRaw` rename while keeping the emitted JSON key `"raw"` and the output **byte-identical** (FR-057)
- [X] T093 [P] Pin the name/key divergence in `apps/capture/test/infrastructure/serializer_test.dart`: the Dart field is `canonicalRaw`, the wire key is `"raw"`, and existing golden fixtures still match exactly — so a future reader cannot "fix" the serializer and silently change the schema

**Checkpoint**: `flutter analyze` clean and `flutter test` green with **no behaviour change yet** —
the rename and the new vocabulary are in, the app still records exactly as before.

---

## Phase 9: User Story 5 — Enter and leave capture without the camera locking up (Priority: P1) 🎯 R1 MVP — *plan phase H*

**Goal**: the camera is fully released every time the capture screen is left, and reacquired cleanly
every time it is shown, without limit.

**Independent Test**: open and leave the capture screen 20 consecutive times, background the app, lock
the screen, unlock, and force screen recreation. The preview returns every time and the camera-in-use
indicator is off whenever the capture screen is not displayed.

### Tests for User Story 5

- [X] T094 [P] [US5] Single-session invariant tests in `apps/capture/test/application/camera_session_controller_test.dart` using `FakeCameraSource` — a request while opening supersedes the pending one; the superseded session is closed and never published; `close` completes before the next `open` begins; ten rapid alternating requests converge on the last lens with exactly one live session (FR-070/FR-092/FR-093)
- [X] T095 [P] [US5] Lifecycle tests in `apps/capture/test/application/camera_lifecycle_test.dart` — backgrounding releases with reason `backgrounded`; resuming reacquires without user action; resuming when the screen no longer owns the camera does **not** reacquire; screen recreation leaves exactly one session (FR-090/FR-091)
- [X] T096 [P] [US5] Teardown robustness tests in `apps/capture/test/application/camera_teardown_test.dart` — `close` after a failed `open` completes without throwing; `close` twice is a no-op; leaving during a countdown or capture abandons the take, writes nothing, and still releases (FR-094/FR-095)

### Implementation for User Story 5

- [X] T097 [US5] Implement `CameraSessionController` in `apps/capture/lib/application/camera/camera_session_controller.dart` — `request(CameraRequest)` / `release(CameraReleaseReason)` serialized through one slot with a monotonic request token, a `WidgetsBindingObserver` for foreground/background, and `CanonicalViewConverter` applied to the frame stream so nothing above it observes a non-canonical frame (research D15/D17)
- [X] T098 [US5] Implement `MethodChannelCameraSource` and `MethodChannelCameraSession` in `apps/capture/lib/infrastructure/camera/method_channel_camera_source.dart` per contracts/camera-channel.md — `availableLenses`, `open` with an explicit lens, total `close`, `Float32List` frame decoding, and `PlatformException` → `CameraFailure` mapping for every R1 code. **Assert the returned lens equals the requested one** and that `mirrored` is consistent with it, raising `CameraFailure` otherwise (replaces T037a). Delete `apps/capture/lib/infrastructure/landmarks/`
- [X] T099 [US5] Rewrite `CameraXController` in `apps/capture/android/app/src/main/kotlin/com/mudra/capture/CameraXController.kt` (replaces T037): bind the **requested** lens via `CameraSelector`, take the preview size from `SurfaceRequest.resolution` and report it **rotation-adjusted for display** with `rotationDegrees` (removing `PREVIEW_WIDTH`/`PREVIEW_HEIGHT`), report `lens`/`mirrored`/`platformLensId`, and make `close()` release the camera binding, the `SurfaceTextureEntry`, the analysis executor, and the detector — **one total operation**, no `stop`/`dispose` split
- [X] T100 [US5] Rewrite `HandLandmarkerPlugin` in `apps/capture/android/app/src/main/kotlin/com/mudra/capture/HandLandmarkerPlugin.kt`: rename the channels to `mudra.capture/camera` and `mudra.capture/camera/frames`, add `availableLenses` (query `hasCamera` for both selectors), replace `start`/`stop`/`dispose` with `open`/`close`, **construct a fresh `CameraXController` per open and drop it on close** (research D16), emit `mirrored` per frame, and map every failure to its R1 `PlatformException` code
- [X] T101 [US5] Rewire the composition root in `apps/capture/lib/shared/di/providers.dart`: replace the app-lifetime `handLandmarkSourceProvider` with a `cameraSourceProvider` plus an **`autoDispose`** `cameraSessionControllerProvider` scoped to the capture screen, so release happens because ownership ended rather than because a `dispose()` override remembered it
- [X] T102 [US5] Rebuild `CaptureScreen` camera wiring in `apps/capture/lib/presentation/capture/capture_screen.dart`: express *intent* only (request on mount, release on unmount), delete the `stop()`-in-`dispose()` path, and render the ordered start sequence's states (checking permission → acquiring → starting analysis → live) rather than a bare spinner (FR-107)
- [X] T103 [US5] Emit the structured lifecycle events in `apps/capture/lib/application/camera/camera_session_controller.dart` — one `camera_acquired` and one `camera_released` per session, the release carrying its `CameraReleaseReason` and duration, with a release exceeding `cameraReleaseTimeout` logged at error rather than swallowed (FR-096); assert both in `apps/capture/test/application/camera_logging_test.dart`
- [X] T104 [US5] Extend `CameraPermissions` in `apps/capture/lib/infrastructure/platform/platform_adapters.dart` to distinguish denied from **permanently denied** and expose an open-settings action, and surface both in `apps/capture/lib/presentation/permissions/permission_screen.dart` (FR-109/FR-110)
- [X] T105 [P] [US5] Widget tests in `apps/capture/test/presentation/camera_failure_test.dart` — every `CameraFailure` variant renders a distinct plain-language message **and** a working action; **no** variant renders an indefinite loading state (SC-029); the failure is not cached, so a retry re-runs the full start path (FR-111)

**Checkpoint**: US5 complete on the host. **The six hardware criteria (quickstart L1–L6) remain
unproven until T136** — a green suite here is not evidence the leak is fixed.

---

## Phase 10: User Story 1 (revised) — Conditional countdown & the capture loop (Priority: P1) — *plan phases J, L*

**Goal**: Record starts a take with or without a countdown, and the screen stays ready for the next
take with the camera still held.

**Independent Test**: with the countdown disabled, one press captures immediately; after a take, the
screen returns to ready without the camera being released and reacquired.

### Tests for User Story 1 (revised)

- [X] T106 [P] [US1] Countdown-path tests in `apps/capture/test/application/countdown_conditional_test.dart` — with the countdown disabled the session emits **no** `CountdownState` and capture begins immediately; with it enabled the existing behaviour is unchanged; `countdownSeconds` is `0.0` and `countdownStartTime` is the press instant in the disabled case (FR-010)
- [X] T107 [P] [US1] Loop tests in `apps/capture/test/application/capture_loop_test.dart` — a completed take returns to `Idle` **without** releasing the camera; with `confirmTakes` on the summary blocks the next take until dismissed; with it off the screen returns to ready immediately and the result is still conveyed; progress updates in both cases (FR-076–FR-080)

### Implementation for User Story 1 (revised)

- [X] T108 [US1] Change `RunCaptureSession.run` in `apps/capture/lib/application/capture/run_capture_session.dart` to take `CaptureSettings` and skip the countdown phase entirely when it is disabled, consuming the controller's canonical frame stream rather than owning a source
- [X] T109 [US1] Replace the pop-on-terminal behaviour in `apps/capture/lib/presentation/capture/capture_screen.dart`: `SummaryState`, `CancelledState`, and `FailedState` all return to `Idle` on the same screen with the camera untouched; only the explicit close action leaves (FR-076)
- [X] T110 [US1] Refresh pose progress after every saved take regardless of whether the summary is shown, in `apps/capture/lib/application/catalog/pose_progress_notifier.dart` and its capture-screen listener (FR-080)
- [X] T111 [US1] Add `SessionEndReason.cameraReleased` and route every no-save exit — cancel, orientation change, camera release, lens switch, mode change — through a **single** abandon operation in `apps/capture/lib/application/capture/run_capture_session.dart`, so "nothing partial is ever written" is one code path rather than six (FR-068/FR-094, SC-016)
- [X] T111a **[R1.1 / E1]** [US1] Create `apps/capture/lib/presentation/capture/capture_control_bar.dart` with the **take-confirmation toggle**, wired to `CaptureSettingsNotifier`. *Moved here from the P3 layout phase: FR-078 is part of this P1 story and cannot be demonstrated without the control.* Widget test in `apps/capture/test/presentation/capture_control_bar_test.dart` — toggling it off makes the next take return to ready without a blocking summary (FR-078)

**Checkpoint**: US5 + US1′ — repeated takes on one screen, with or without a countdown, and the camera
held throughout. The take-confirmation control is usable, so FR-078 is demonstrable now rather than in
Phase 15.

---

## Phase 11: User Story 7 — Record someone else with Operator Capture (Priority: P2) — *plan phase J*

**Goal**: two capture modes whose defaults are established once and then owned by the user.

**Independent Test**: choose Operator Capture — rear lens, unmirrored preview, countdown off; record;
enable the countdown and record again; both takes are stored with metadata that distinguishes them.

### Tests for User Story 7

- [X] T112 [P] [US7] Settings-ownership tests in `apps/capture/test/application/capture_settings_test.dart` — each mode initializes its own defaults exactly once; a lens switch changes **nothing** about the countdown in either direction; backgrounding, screen lock, screen recreation, and a completed take all leave every setting untouched; a mode change re-initializes all of them. Assert **zero** unrequested changes across a scripted session (SC-032, FR-071–FR-074, FR-079)

### Implementation for User Story 7

- [X] T113 [US7] Implement `CaptureSettingsNotifier` in `apps/capture/lib/application/camera/capture_settings_notifier.dart` — holds `CaptureSettings`, re-initializes from the mode's `CaptureProfile` **only** on a mode change, and is scoped to the application run (not the widget) so screen recreation cannot reset it and the most recent mode is preselected (FR-063/FR-071/FR-075)
- [X] T114 [US7] Add the mode selector to `apps/capture/lib/presentation/capture/capture_control_bar.dart` — reachable without leaving the capture screen, taking effect for the next take, with a mode whose default lens the device lacks shown as **unavailable with a stated reason** while the other stays fully usable (FR-062/FR-064)
- [X] T115 [US7] Wire mode changes through `CameraSessionController.request` in `apps/capture/lib/presentation/capture/capture_screen.dart`, abandoning any in-flight recording session with reason `modeChange` and leaving already-saved samples untouched
- [X] T115a **[R1.1 / E1]** [US7] Add the **countdown toggle** to `apps/capture/lib/presentation/capture/capture_control_bar.dart`, wired to `CaptureSettingsNotifier`. *Moved here from the P3 layout phase: US7's own independent test requires enabling the countdown in Operator Capture, so this P2 story cannot pass without it.* Extend `apps/capture/test/presentation/capture_control_bar_test.dart` to cover toggling in both directions and confirm a lens switch afterwards leaves it unchanged (FR-072/FR-074)

**Checkpoint**: both modes usable; Operator Capture records with the rear lens, and the countdown can
be turned on for it — US7's independent test passes end to end. Its samples are only **trustworthy**
once T127 and the on-device SC-031 check in T135 pass.

---

## Phase 12: User Story 6 — See an undistorted preview (Priority: P2) — *plan phase M*

**Goal**: the preview shows the camera's true proportions, centered, with neutral bands.

**Independent Test**: display the preview at several surface aspect ratios and confirm a square held
in frame appears square in every case, with bands rather than distortion.

### Tests for User Story 6

- [X] T116 [P] [US6] Widget tests in `apps/capture/test/presentation/preview_stage_test.dart` — at a surface wider than the camera the image is pillarboxed and horizontally centered; taller, letterboxed and vertically centered; the rendered box always matches the session's reported aspect within tolerance; overlays land inside the **image** box, not the bands (FR-097/FR-098/FR-101)

### Implementation for User Story 6

- [X] T117 [US6] Implement `PreviewStage` in `apps/capture/lib/presentation/capture/preview_stage.dart` — `Center → AspectRatio(info.previewAspect) → Stack(Texture, overlays)` with a neutral background, replacing the `Stack(fit: StackFit.expand)` + bare `Texture` that stretches today; the ratio comes from `CameraSessionInfo`, never from a constant (FR-099)
- [X] T118 [US6] Move the countdown, capturing, and summary overlays into the `PreviewStage` stack in `apps/capture/lib/presentation/capture/capture_overlays.dart` so their alignment to the visible image is structural rather than a coordinate calculation (FR-101)

**Checkpoint**: the preview is undistorted at every surface shape. SC-022's on-device square check
runs in T136.

---

## Phase 13: User Story 8 — Switch between front and rear cameras in place (Priority: P3) — *plan phase J*

**Goal**: change lens without leaving the screen or restarting the application.

**Independent Test**: switch lenses back and forth ten times; the preview reappears each time,
mirroring follows the lens, and no camera error occurs.

### Tests for User Story 8

- [X] T119 [P] [US8] Lens-switch tests in `apps/capture/test/application/lens_switch_test.dart` — the previous session is fully closed before the new one opens; mirroring follows the lens regardless of which mode selected it; a switch during a countdown or capture abandons the take and reports that nothing was saved; ten rapid switches converge on the last requested lens with exactly one live session (FR-066–FR-068/FR-070)

### Implementation for User Story 8

- [X] T120 [US8] Add the lens-switch control to `apps/capture/lib/presentation/capture/capture_control_bar.dart`, dispatching a `CameraRequest` for the other lens through the controller (FR-065)
- [X] T121 [US8] Abandon any in-flight take on a lens switch with reason `lensSwitch` and tell the user nothing was saved, in `apps/capture/lib/presentation/capture/capture_screen.dart` (FR-068)
- [X] T122 [US8] Disable the switch control **with a stated reason** when `availableLenses()` reports a single usable lens, rather than failing on tap, in `apps/capture/lib/presentation/capture/capture_control_bar.dart` (FR-069)

**Checkpoint**: lens switching works in place, and the countdown is provably unaffected by it.

---

## Phase 14: User Story 9 — Trust what a sample was recorded with (Priority: P3) — *plan phase K*

**Goal**: every sample states its lens, mirroring, countdown, and platform lens identifier.

**Independent Test**: record takes in each mode with the countdown on and off, then read the stored
samples and confirm each reports the configuration actually active when it was taken.

### Tests for User Story 9

- [X] T123 [P] [US9] R1 metadata tests in `apps/capture/test/infrastructure/camera_metadata_test.dart` — all five additive fields serialize with the right values for each mode; `lens_facing == metadata.camera.index` in every emitted sample; a converted rear-lens sample still reports `position: rear` and `mirrored_preview: false` (FR-058); with the countdown disabled, `countdown_enabled` is `false` and `countdown_seconds` is `0.0`
- [X] T124 [P] [US9] Backwards-compatibility test in `apps/capture/test/infrastructure/pre_r1_compat_test.dart` — a pre-R1 golden fixture carrying none of the additive fields deserializes successfully with them **absent rather than wrong** (FR-052, SC-026)
- [X] T125 [P] [US9] Cross-lens agreement test in `apps/capture/test/domain/cross_lens_agreement_test.dart` — the same synthetic hand delivered once as a mirrored frame and once as an unmirrored one produces samples that agree on handedness and match geometrically within the tolerance accepted between two consecutive samples of one take, while each still reports its own lens (SC-031)

### Implementation for User Story 9

- [X] T126 [US9] Build `CameraMetadata` from the **live** session and settings at the instant each frame is captured, in `RunCaptureSession._buildSample` (`apps/capture/lib/application/capture/run_capture_session.dart`), so samples taken before and after a lens or mode change each report their own configuration (FR-085)
- [X] T127 [US9] Emit the five additive fields in `apps/capture/lib/infrastructure/serialization/pose_sample_serializer.dart` — `position`, `mirrored_preview`, `lens_facing` inside `metadata.camera`; `countdown_enabled` inside `metadata.capture` — additive, optional, `schema_version` unchanged, per contracts/sample-json.md

**Checkpoint**: every sample is self-describing, and pre-R1 samples still load.

---

## Phase 15: User Story 10 — Work from a layout built for capturing (Priority: P3) — *plan phase M*

**Goal**: reference, progress, preview, Record, and Sync visible together, with the preview central
but not fullscreen.

**Independent Test**: on the smallest supported screen, all five elements are visible and reachable at
once without scrolling and nothing is clipped.

### Tests for User Story 10

- [X] T128 [P] [US10] Layout widget tests in `apps/capture/test/presentation/capture_layout_test.dart` — all five required elements are present simultaneously at the smallest supported surface size; the **preview** yields space first as the surface shrinks; nothing is clipped or scrollable; the reference image and progress stay visible through countdown, capture, and summary (FR-102/FR-104/FR-106, SC-027)

### Implementation for User Story 10

- [X] T129 [US10] Rebuild the capture screen layout in `apps/capture/lib/presentation/capture/capture_screen.dart` — reference image, progress, `PreviewStage`, Record, Sync in one non-scrolling column, the preview as the visual focal point but **not** fullscreen (FR-102/FR-103)
- [X] T130 [US10] Lay out the finished control bar in `apps/capture/lib/presentation/capture/capture_control_bar.dart` so **all four** controls — mode (T114), lens (T120), countdown (T115a), take confirmation (T111a) — are reachable without leaving the capture screen and legible at the smallest supported size (FR-105). *All four already exist by this phase; this task positions them, it does not build them* **[R1.1 / E1]**
- [X] T131 [US10] Make the preview the flexible element and the other four fixed, so constrained space shrinks the preview rather than clipping anything, in `apps/capture/lib/presentation/capture/capture_screen.dart` (FR-106)

**Checkpoint**: all R1 user stories independently functional on the host.

---

## Phase 16: R1 Polish & Validation — *plan phase N*

- [X] T132 [P] Update `apps/capture/README.md` — the camera seam (`CameraSource`/`CameraSession`), the single-session invariant and why it lives in one controller, the canonical viewing convention and why `raw` means *canonical raw*, and the two capture modes
- [X] T133 Remove the superseded surface: delete `apps/capture/lib/infrastructure/landmarks/`, the old fake source, and any remaining reference to `mudra.capture/landmarks` or `contracts/platform-channel.md` in code or docs
- [X] T133a **[R1.1 / C1]** [P] Add the **layer-boundary architecture test** in `apps/capture/test/architecture/layer_boundaries_test.dart`, asserting by static import analysis that: `lib/application/camera/**` and `lib/infrastructure/camera/**` import nothing from `storage/`, `serialization/`, or `export/`; `lib/infrastructure/storage/**` and `lib/infrastructure/export/**` import nothing from `camera/`; and `lib/domain/**` imports no Flutter, plugin, or `dart:io` symbol. Each violation must name the offending file and import, so the failure is actionable. This makes FR-115 **enforced rather than observed**, which is the point — a convention nobody checks drifts (Principle I)
- [X] T133b **[R1.1 / C2]** Add the **end-to-end no-hardware integration test** in `apps/capture/test/integration/full_pipeline_test.dart`, driving the complete pipeline through `FakeCameraSource` with a temp dataset root: camera initialization → mode/settings → capture flow (both with and without a countdown) → per-frame validation → persistence → integrity validation → manifest → export archive. Assert the archive contains what was recorded and that every sample loads back. This is what makes SC-030/FR-116 verified rather than assumed
- [X] T134 Confirm `flutter analyze` is clean and `flutter test` is green from `apps/capture/`, including every new R1 test
- [ ] T135 Run `quickstart.md` manual rows **29–44** on a physical Android device and record the results
- [ ] T136 ⭐ Run the **camera lifecycle validation** L1–L6 from `quickstart.md` on hardware — release within 1 s (SC-019), another app acquires the camera (SC-020), 20 enter/leave cycles (SC-018), zero busy errors over 30 minutes (SC-021), lens switch under 1.5 s (SC-024), square-object undistortion (SC-022) — plus the four additional device checks. **This is the only evidence the leak R1 exists to fix is actually fixed**; a green test suite is not
- [ ] T137 Run the **SC-028 throughput comparison** from `quickstart.md`: the same benchmark in Self Capture (countdown + confirmation on) and in Operator Capture (both off). The second must yield **at least twice** the samples per minute, or the R1 session loop needs revisiting
- [ ] T138 [P] File the engine-side follow-ups (both **out of scope** here, tracked so they are not forgotten): (1) teach `PoseMetadata`/`CaptureTiming`/`PoseSerializer` to carry and re-emit the five additive fields so an engine round-trip stops dropping them; (2) correct the engine's documentation of `HandSample.raw`, whose meaning FR-056 redefines without renaming it

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Everything else depends on US1's storage + session core
- **US2 (Phase 4)**: depends on US1 (extends the session and its result)
- **US3 (Phase 5)**: depends on Foundational; integrates with US1 for post-session refresh
- **US4 (Phase 6)**: depends on US1 (needs stored samples to export)
- **Polish (Phase 7)**: depends on all desired stories
- **R1 Foundational (Phase 8)**: depends on the baseline being merged — **blocks every R1 story**
- **US5 (Phase 9)**: depends on Phase 8. **Everything else in R1 depends on US5's camera session**
- **US1′ (Phase 10)**: depends on US5 (the take must not own the camera) — *no dependency on modes*
- **US7 (Phase 11)**: depends on US5 and US1′ (the countdown must already be conditional)
- **US6 (Phase 12)**: depends on US5 only (needs true preview dimensions) — **parallel with US7**
- **US8 (Phase 13)**: depends on US7 (mode defaults exist before switching between them)
- **US9 (Phase 14)**: depends on Phase 8's converter and US7's settings
- **US10 (Phase 15)**: depends on US6, US7, US8 (it surfaces their controls)
- **R1 Polish (Phase 16)**: depends on all R1 stories

### Critical path (baseline)

`T001 → T002 → T007-T014 → T016-T019 → T026-T028 → T030-T032 → T072 → T036-T039 → T043-T044 → T076-T077 → T058-T060`

### Critical path (R1)

`T082-T085 → T090 → T091 → T097 → T098 → T099-T100 → T101-T102 → T108-T109 → T113 → T126-T127 → T136`

### Baseline task provenance (post-analysis refinements, 2026-07-24)

| Task | Closes | Requirement |
|---|---|---|
| T070, T071 | D1 (CRITICAL) | FR-042/FR-043 structured startup + shutdown records |
| ~~T037, T037a~~ | E1 (HIGH) | FR-044 — **restated by R1**, not reversed: the guarantee now holds through canonical conversion rather than through refusing the rear lens |
| T080 | E2 (HIGH) | SC-001 primary KPI benchmark |
| T073 | E3 (MEDIUM) | FR-012 reference thumbnail during countdown |
| T075 | E4 (MEDIUM) | FR-049/FR-050 orientation lock + safe abort |
| Phase cross-reference table | F1 (MEDIUM) | Plan ↔ tasks numbering |
| T062 | B1 (LOW) | Sync / dataset-export terminology |
| T074 | C1 (LOW) | FR-051 sample-limit behaviour |
| T072 | new | FR-045/FR-046 session identity |
| T076–T079 | new | FR-047/FR-048 manifest + integrity validation |
| T081 | new | Engine-side follow-up for `session_uuid` round-tripping |

### R1 task provenance

| Tasks | Delivers | Requirements |
|---|---|---|
| T082–T088 | Camera vocabulary, settings, config profiles, failure taxonomy | FR-059–FR-061, FR-107–FR-111 |
| T089–T090, T125 | Canonical viewing convention | FR-053–FR-058, SC-031 |
| T092–T093 | `canonicalRaw` rename with the wire key pinned | FR-056/FR-057 |
| T094–T103 | Camera lifecycle, single-session invariant, native rebuild | FR-086–FR-096, FR-112–FR-116 |
| T104–T105 | Camera stability and error handling | FR-107–FR-111, SC-029 |
| T106, T108 | Conditional countdown | FR-010, FR-071 |
| T107, T109–T111 | Capture session loop | FR-076–FR-080 |
| T112–T115 | Capture modes and settings ownership | FR-059–FR-064, FR-071–FR-075, SC-032 |
| T116–T118 | Preview fidelity | FR-097–FR-101, SC-022 |
| T119–T122 | Lens selection and switching | FR-065–FR-070, SC-024 |
| T123–T124, T126–T127 | Camera metadata | FR-081–FR-085, FR-052, SC-025/SC-026 |
| T128–T131 | Capture screen layout | FR-102–FR-106, SC-027 |
| T136–T137 | The hardware-only criteria | SC-018–SC-022, SC-024, SC-028 |
| ~~T037~~ → T099, ~~T037a~~ → T098 | Superseded front-camera-only enforcement | FR-044 (revised) |
| **T082a** | R1.1/A1 — end the "session" name collision | Glossary → *The three sessions* |
| **T086a** | R1.1/F1 — orientation locked for the whole capture session | FR-049 (revised), FR-050 |
| **T111a, T115a, T130** | R1.1/E1 — confirmation and countdown controls built in the phases that need them | FR-072, FR-078, FR-105 |
| **T133a** | R1.1/C1 — layer boundaries enforced automatically | FR-115 (extended) |
| **T091, T133b** | R1.1/C2 — complete pipeline exercisable with no hardware | FR-116 (extended), SC-030 |
| **T135** | R1.1/C3 — SC-023 added to the manual matrix | SC-023 |

### Native-work isolation (R1)

T099 and T100 are the only R1 tasks that cannot be verified in the current environment. They are
ordered **after** the Dart side of US5 deliberately, so the controller and its invariant are already
proven against `FakeCameraSource` before the platform binding is touched. T136 is where the six
hardware-only criteria are actually settled — it is not optional polish.

### Parallel Opportunities

- Setup: T003, T005, T006 in parallel
- Foundational: T007–T015 and T020 all in parallel; T016 → T017 → T018
- US1: T021–T025 in parallel; T026, T027, T029 in parallel
- US2: T040–T042 in parallel; T043 parallel with the summary UI
- US3: T047–T049 in parallel; T050, T052, T055 in parallel
- US4: T056, T057 in parallel; T059 parallel with T058
- Polish: T062, T063, T064, T067 in parallel
- **R1 Foundational**: T082, T083, T086, T088, T089, T091 in parallel; T082a and T086a are wide
  mechanical renames and should land **alone**, not alongside other edits to the same files;
  T084 → T085 → T092 → T093
- **US5**: T094–T096 in parallel; T099 and T100 are the same Kotlin change set and are **not** parallel
- **Phases 11 and 12 (US7, US6) run in parallel** — different files, and US6 depends only on US5
- **US9**: T123–T125 in parallel before T126/T127
- **R1 Polish**: T132, T133a in parallel; T133b depends on the whole pipeline and runs last before T134

---

## Parallel Example: R1 Foundational

```bash
# Independent domain files:
Task: "Camera domain types in apps/capture/lib/domain/camera/camera.dart"
Task: "CaptureSettings in apps/capture/lib/domain/camera/capture_settings.dart"
Task: "CameraFailure taxonomy in apps/capture/lib/shared/errors/failures.dart"
Task: "Canonical converter tests in apps/capture/test/domain/canonical_converter_test.dart"
Task: "FakeCameraSource in apps/capture/test/support/fake_camera_source.dart"
```

---

## Implementation Strategy

### Baseline MVP (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **stop and validate**: a session with
the fake source writes engine-readable samples; on hardware, Record captures real landmarks.

### Incremental delivery (baseline)

1. Setup + Foundational → skeleton runs
2. + US1 → **records samples** (MVP)
3. + US2 → quality is visible and enforced
4. + US3 → the catalog becomes workable end to end
5. + US4 → the dataset reaches the engine

### R1 MVP (User Story 5 only)

Phase 8 → Phase 9 → **stop and validate on hardware**. US5 alone makes the application usable beyond
the first recording, which is what puts SC-001 back in reach. Everything else in R1 is improvement on
top of a working loop; US5 is the difference between usable and not.

### Incremental delivery (R1)

1. Phase 8 → the vocabulary and the conversion land with **no behaviour change**
2. + US5 → **the camera is released and reacquired reliably** (R1 MVP)
3. + US1′ → takes repeat on one screen, with or without a countdown
4. + US7 (‖ US6) → Operator Capture; undistorted preview
5. + US8 → lens switching in place
6. + US9 → samples become self-describing
7. + US10 → the layout built for capturing

Each increment is demonstrable on its own and breaks nothing before it.

### Suggested checkpoints for review

- After Phase 2: layer boundaries and the port surface
- After US1: schema parity (the hardest thing to change later)
- After US4: the engine import check (SC-005)
- **After Phase 8**: the canonical conversion — like schema parity, it is very hard to change once
  samples exist that depend on it
- **After US5, on hardware**: the camera lifecycle (T136). Do not build the rest of R1 on an unproven
  release path

## Notes

- `[P]` = different files, no dependencies
- Tests are mandatory per constitution v1.3.0, not optional
- Commit after each task or logical group
- T036–T039 and T099–T100 will likely need on-device iteration; treat their first version as a
  starting point, not a finished artifact
- Phases 1–7 are the merged baseline. Unchecked baseline tasks (T042, T048, T049, T057, T064, T066,
  T068, T069, T080, T081) remain outstanding and are **not** superseded by R1

