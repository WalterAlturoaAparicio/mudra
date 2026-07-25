---

description: "Task list for 003-mobile-pose-capture (Mudra Capture)"
---

# Tasks: Mudra Capture — Mobile Pose Dataset Collector

**Input**: Design documents from `/specs/003-mobile-pose-capture/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **included and mandatory** here — not optional. Constitution v1.2.0
(capture standards) requires `flutter test` coverage of the domain layer, the application layer, and
JSON serialization round-trips, and `flutter analyze` clean, as part of the definition of done.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: US1–US4 map to the user stories in spec.md
- All paths are relative to the repository root

## Path Conventions

Flutter application at `apps/capture/` per plan.md. Dart source under `apps/capture/lib/<layer>/`,
tests under `apps/capture/test/<layer>/`, Android native under
`apps/capture/android/app/src/main/kotlin/com/mudra/capture/`.

---

## Phase ↔ Plan cross-reference

`plan.md` describes **capability phases A–G**; this file sequences **execution phases 1–7** grouped
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
| 7 Polish | G Docs & polish | T062–T069, T080 |

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
- [X] T037 [US1] Implement `CameraXController` in `apps/capture/android/app/src/main/kotlin/com/mudra/capture/CameraXController.kt`: one `ProcessCameraProvider` binding `Preview` (into a Flutter `TextureRegistry` surface) and `ImageAnalysis` (`KEEP_ONLY_LATEST`) → `HandLandmarker` LIVE_STREAM with `numHands = 2`, results forwarded to the event sink on the main thread. **Camera selection is explicit and mandatory (FR-044)**: bind `CameraSelector.DEFAULT_FRONT_CAMERA`, mirror the preview, return `lensFacing = 1` + `mirrored = true` + device/OS info from `start()`, and fail with `camera_configuration_unsupported` when no front camera exists or mirroring is unavailable — **never** silently fall back to the rear camera
- [X] T037a [US1] Enforce the camera contract on the Dart side in `apps/capture/lib/infrastructure/landmarks/method_channel_hand_landmark_source.dart`: assert `lensFacing == 1` and `mirrored == true` on every `start()`, raise `CameraFailure` otherwise, and propagate `lensFacing` into `metadata.camera.index`; test both the accept and reject paths in `apps/capture/test/infrastructure/camera_contract_test.dart` (FR-044, guards against silent dataset corruption)
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

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Everything else depends on US1's storage + session core
- **US2 (Phase 4)**: depends on US1 (extends the session and its result)
- **US3 (Phase 5)**: depends on Foundational; integrates with US1 for post-session refresh
- **US4 (Phase 6)**: depends on US1 (needs stored samples to export)
- **Polish (Phase 7)**: depends on all desired stories

### Critical path

`T001 → T002 → T007-T014 → T016-T019 → T026-T028 → T030-T032 → T072 → T036-T039 → T043-T044 → T076-T077 → T058-T060`

### Refinement tasks added after the analysis report

| Task | Closes | Requirement |
|---|---|---|
| T070, T071 | D1 (CRITICAL) | FR-042/FR-043 structured startup + shutdown records |
| T037 (extended), T037a | E1 (HIGH) | FR-044 explicit front camera, mirroring, rejection of unsupported configs |
| T080 | E2 (HIGH) | SC-001 primary KPI benchmark |
| T073 | E3 (MEDIUM) | FR-012 reference thumbnail during countdown |
| T075 | E4 (MEDIUM) | FR-049/FR-050 orientation lock + safe abort |
| Phase cross-reference table | F1 (MEDIUM) | Plan ↔ tasks numbering |
| T062 (extended) | B1 (LOW) | Sync / dataset-export terminology |
| T074 | C1 (LOW) | FR-051 sample-limit behaviour |
| T072 | new | FR-045/FR-046 session identity |
| T076–T079 | new | FR-047/FR-048 manifest + integrity validation |
| T081 | new | Engine-side follow-up for `session_uuid` round-tripping |

### Within User Story 1

Tests (T021–T025) are written before the implementation they cover. T026/T027 are independent;
T028 depends on T027 (it serializes what it writes); T031 depends on T026–T030; T033–T034 depend on
T032; T039 depends on T036–T038.

### Native-work isolation

T036–T039 are the only tasks that cannot be verified in the current environment (no device/emulator,
Android licenses unaccepted). Every other task is provable with `flutter analyze` and `flutter test`.
They are ordered last within US1 deliberately, so the entire Dart application is already green before
the platform binding is attempted.

### Parallel Opportunities

- Setup: T003, T005, T006 in parallel
- Foundational: T007–T015 and T020 all in parallel (separate files); T016 before T017 before T018
- US1: T021–T025 in parallel; T026, T027, T029 in parallel
- US2: T040–T042 in parallel; T043 parallel with the summary UI
- US3: T047–T049 in parallel; T050, T052, T055 in parallel
- US4: T056, T057 in parallel; T059 parallel with T058
- Polish: T062, T063, T064, T067 in parallel

---

## Parallel Example: User Story 1

```bash
# Tests first, all independent files:
Task: "Normalizer parity test in apps/capture/test/domain/normalizer_test.dart"
Task: "Serializer golden test in apps/capture/test/infrastructure/serializer_test.dart"
Task: "Repository test in apps/capture/test/infrastructure/repository_test.dart"
Task: "Capture-session test in apps/capture/test/application/capture_session_test.dart"

# Then the independent implementations:
Task: "TranslationScaleNormalizer in apps/capture/lib/domain/normalization/translation_scale_normalizer.dart"
Task: "PoseSampleSerializer in apps/capture/lib/infrastructure/serialization/pose_sample_serializer.dart"
Task: "FakeHandLandmarkSource in apps/capture/test/support/fake_hand_landmark_source.dart"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **stop and validate**: a session with
the fake source writes engine-readable samples; on hardware, Record captures real landmarks.

### Incremental delivery

1. Setup + Foundational → skeleton runs
2. + US1 → **records samples** (MVP)
3. + US2 → quality is visible and enforced
4. + US3 → the catalog becomes workable end to end
5. + US4 → the dataset reaches the engine

Each increment is demonstrable on its own and breaks nothing before it.

### Suggested checkpoints for review

- After Phase 2: layer boundaries and the port surface
- After US1: schema parity (the hardest thing to change later)
- After US4: the engine import check (SC-005) — the acceptance test for the whole feature

## Notes

- `[P]` = different files, no dependencies
- Tests are mandatory per constitution v1.2.0, not optional
- Commit after each task or logical group
- T036–T039 will likely need on-device iteration; treat their first version as a starting point, not
  a finished artifact
