# Implementation Plan: Mudra Capture — Mobile Pose Dataset Collector

**Branch**: `003-mobile-pose-capture` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-mobile-pose-capture/spec.md`

## Summary

Mudra Capture is a Flutter/Android application, living at `apps/capture/`, whose only job is
producing engine-compatible hand-pose samples in volume. One press of **Record** runs a countdown
over a live front-camera preview, then automatically captures ~1 second of MediaPipe hand landmarks,
storing every valid frame as its own sample and reporting accepted vs discarded counts. **Sync**
packages the dataset into a ZIP the engine imports untouched.

Technically: CameraX owns the camera natively and binds both a preview texture and an
`ImageAnalysis` stream into MediaPipe Tasks `HandLandmarker` (LIVE_STREAM); landmark frames reach
Dart over an `EventChannel` behind a single `HandLandmarkSource` interface. Everything above that
interface — session orchestration, validation, normalization, serialization, storage, export — is
pure Dart and fully testable on the host. The engine's schema v1 and its `translation_scale` v1.0
normalization are ported operation-for-operation and verified against golden fixtures generated from
the Python implementation.

## Technical Context

**Language/Version**: Dart 3.9 / Flutter 3.35 (stable). Native layer: Kotlin (Android).

**Primary Dependencies**: `flutter_riverpod` (state + DI), `permission_handler` (camera permission),
`archive` (streaming ZIP), `share_plus` (share sheet), `path_provider` (app storage), `uuid`
(sample UUIDs). Native: `com.google.mediapipe:tasks-vision`, AndroidX **CameraX**.
Dev: `flutter_test`, `flutter_lints`.

**Storage**: Application-private filesystem,
`<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json` — the engine's layout, byte-compatible
schema v1. No database.

**Testing**: `flutter test` (unit + widget) on the host; golden JSON fixtures generated from the
Python engine for schema/normalization parity. Native Kotlin path validated manually on hardware per
`quickstart.md`.

**Target Platform**: Android phones (minSdk 24, targetSdk 35). iOS deliberately unimplemented but
unblocked — only `infrastructure/landmarks/` is platform-specific.

**Project Type**: Mobile application inside a monorepo, sibling to the Python engine at the
repository root.

**Performance Goals**: Preview and detection sustain ≥20 fps on mid-range hardware (SC-002: ≥20
samples per press); complete Record→result cycle under 6 s (SC-003); UI responsive with ≥5,000
stored samples (SC-011).

**Constraints**: Fully offline — no network, no accounts, no backend (FR-034/FR-038/FR-039). Never
persist pixel data (FR-030, Principle II). Never overwrite an existing sample (FR-018/FR-029). No
business logic in widgets (constitution, capture standards).

**Scale/Scope**: 18 catalog poses, default target 500 samples each (~9,000 samples at completion);
2 primary screens (home, capture) plus a pose picker and a permission rationale; ~5 use cases.

## Constitution Check

*GATE: evaluated against constitution v1.2.0 before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Architecture-First & Modular Boundaries** | Every capability behind an interface; dependencies point inward; no global mutable state | **PASS** — `HandLandmarkSource`, `SampleRepository`, `PoseCatalogSource`, `DatasetExporter`, `Clock`/`UuidFactory` are domain-owned interfaces implemented in `infrastructure/`. Riverpod holds state in a container, not in globals (research D8). |
| **II. Coordinates, Never Images** | No image, frame, or pixel data persisted anywhere | **PASS** — the camera frame exists only as a preview texture and a detector input; nothing writes bytes except JSON. Reference images are bundled UI assets, never referenced from a sample (FR-031). A test asserts the dataset tree contains only `.json` files. |
| **III. Extensibility by Design** | Stable `pose_id` identity; append-only datasets | **PASS** — samples reference `pose_id`; the repository only ever creates new numbered files (FR-018/FR-026/FR-029). |
| **IV. Typed, Modeled, Clean** | Typed immutable models, no raw maps, docs, tests on data + I/O | **PASS** — immutable Dart value classes with equality; `Map` appears only inside serializer/channel boundaries; `flutter test` covers domain, application, and serialization round-trips. |
| **V. Centralized Config & Observability** | No hardcoded tunables; structured logging **including explicit startup and shutdown lines**; no per-frame INFO | **PASS** — `CaptureConfig` and the pose catalog are data. `AppLogger` emits a structured `StartupRecord` (version, config profile, dataset root, catalog size, camera configuration, platform) and `ShutdownRecord` (run duration, samples recorded, samples discarded, export count, graceful confirmation), matching Loguru's structured-field shape since Dart has no Loguru. Frame-level events at debug only. *(Closes analysis finding D1 — this MUST was previously unaddressed.)* |
| **VI. Scope Discipline** | No recognition, ML, gameplay, or effects | **PASS** — FR-040/FR-041 fence these off; the app cannot even name a pose it sees, only the pose the user selected. |
| **Monorepo & Cross-Application Boundaries** | JSON schema is the only contract; schema changes are cross-application events; no cross-app imports; no premature shared packages | **PASS with a recorded consequence** — no code is shared with the engine, and the normalizer is deliberately duplicated with golden-fixture parity tests. `session_uuid` is added **additively** inside the existing `metadata.capture` block with `schema_version` unchanged, the same pattern the engine used to introduce that block; the engine reads such samples today. The engine's serializer does not yet *re-emit* the field, so an engine-side round-trip drops it — recorded as an engine follow-up in [contracts/sample-json.md](./contracts/sample-json.md), with `manifest.json` carrying session records independently in the meantime. |

**Post-Phase-1 re-evaluation**: unchanged — all gates still PASS. The design added no cross-app
dependency, no persisted pixel data, and no out-of-milestone surface. **Complexity Tracking is
empty: there are no justified violations.**

## Project Structure

### Documentation (this feature)

```text
specs/003-mobile-pose-capture/
├── plan.md                     # This file
├── spec.md                     # Feature specification (clarified)
├── research.md                 # Phase 0 output — D1..D13 + risks
├── data-model.md               # Phase 1 output — entities, validation, state machine
├── quickstart.md               # Phase 1 output — how to run and validate
├── contracts/
│   ├── sample-json.md          # The engine schema v1 as Capture must emit it
│   ├── platform-channel.md     # Kotlin ⇄ Dart landmark stream contract
│   ├── pose-catalog.md         # Catalog configuration format
│   └── interfaces.md           # Dart port interfaces (domain-owned)
├── checklists/
│   └── requirements.md         # Spec quality checklist
└── tasks.md                    # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/capture/
├── lib/
│   ├── domain/                     # Pure Dart. No Flutter, no plugins, no I/O.
│   │   ├── landmarks/              # Landmark, HandLandmarks, HandDetection, LandmarkFrame, Handedness
│   │   ├── poses/                  # PoseDefinition, PoseCatalog, PoseProgress
│   │   ├── samples/                # PoseSample, HandSample, SampleMetadata, CaptureTiming, SampleRef
│   │   ├── capture/                # CaptureSessionState, CaptureSession, CaptureResult,
│   │   │                           #   SessionEndReason, RejectionReason
│   │   ├── export/                 # DatasetManifest, IntegrityReport, IntegrityFinding
│   │   ├── normalization/          # LandmarkNormalizer interface + TranslationScaleNormalizer
│   │   ├── validation/             # SampleValidator (21 landmarks, finite, required hands)
│   │   └── ports/                  # HandLandmarkSource, SampleRepository, PoseCatalogSource,
│   │                               #   DatasetExporter, DatasetIntegrityValidator,
│   │                               #   DatasetManifestBuilder, SessionStore, OrientationController,
│   │                               #   Clock, UuidFactory, AppLogger
│   ├── application/                # Use cases + state notifiers. No widgets, no plugins.
│   │   ├── capture/                # RunCaptureSession, CaptureSessionNotifier, CountdownTicker
│   │   ├── catalog/                # LoadPoseCatalog, SelectPose, PoseProgressNotifier
│   │   ├── export/                 # ExportDataset (validate → manifest → package)
│   │   └── lifecycle/              # RecordAppLifecycle (startup/shutdown records)
│   ├── infrastructure/             # Implements domain ports. Only layer that knows the platform.
│   │   ├── landmarks/              # MethodChannel/EventChannel client → HandLandmarkSource
│   │   ├── storage/                # FileSampleRepository (append-only), FileSessionStore
│   │   ├── serialization/          # PoseSampleSerializer (engine schema v1), ManifestSerializer
│   │   ├── catalog/                # AssetPoseCatalogSource (+ validation)
│   │   ├── export/                 # ZipDatasetExporter, DatasetIntegrityChecker, ManifestBuilder
│   │   └── platform/               # SystemClock, UuidV4Factory, CameraPermissions, SharePresenter,
│   │                               #   DeviceInfoSource, OrientationController, StructuredAppLogger
│   ├── presentation/               # Widgets and screens only.
│   │   ├── home/                   # HomeScreen: pose, reference image, count, progress, Record/Sync
│   │   ├── capture/                # Camera preview + countdown overlay + capture summary
│   │   ├── catalog/                # Pose picker
│   │   ├── permissions/            # Rationale screen
│   │   └── design/                 # Theme, spacing, typography, shared widgets
│   ├── shared/                     # CaptureConfig, Result/Failure types, extensions
│   └── main.dart                   # Composition root: ProviderScope + wiring
├── assets/
│   ├── config/pose_catalog.json    # The 18 poses (FR-003)
│   ├── poses/                      # Reference images by pose_id (placeholders until authored)
│   └── models/hand_landmarker.task # Same model file the engine uses
├── android/
│   └── app/src/main/kotlin/.../    # HandLandmarkerPlugin, CameraXController, channel names
├── test/
│   ├── domain/                     # Normalizer parity, validation, value objects
│   ├── application/                # Capture session orchestration with a fake source
│   ├── infrastructure/             # Serializer golden fixtures, repository numbering, catalog
│   ├── presentation/               # Widget tests per screen state
│   └── fixtures/                   # Golden JSON generated from the Python engine
├── analysis_options.yaml
├── pubspec.yaml
└── README.md
```

**Structure Decision**: `apps/capture/` as a self-contained Flutter application, per the new
Monorepo section of constitution v1.2.0 — the Python engine stays at the repository root and shares
nothing with Capture except the sample JSON schema. Inside `lib/`, the four mandated layers are
top-level directories with a fifth (`shared/`) for cross-cutting types; **feature-first grouping
happens inside each layer** (e.g. `application/capture/`, `application/catalog/`), which keeps the
dependency direction visible at a glance while still grouping by feature.

## Implementation Phases

Ordered so that every phase leaves the app in a demonstrable state, and so the unverifiable native
work is isolated at a single well-defined seam.

Two numbering schemes exist by necessity: this plan describes **capability phases (A–G)**, while
`tasks.md` sequences **execution phases (1–7)** grouped by user story. The mapping is authoritative
and each `tasks.md` phase header cross-references its letter, so neither document can be read in
isolation and mis-sequenced.

| Plan phase | Delivers | tasks.md phase | Task IDs | Verifiable by |
|---|---|---|---|---|
| **A. Foundation** | Flutter project at `apps/capture/`, analysis options, config, domain value objects, ports, lifecycle logging | Phases 1–2 | T001–T020, T070–T071 | `flutter analyze` + domain unit tests |
| **B. Schema parity** | Normalizer, serializer, file repository, session identity | Phase 3 (US1) | T021–T029, T072 | Golden-fixture tests vs the Python engine; append-only numbering tests |
| **C. Capture loop** | Session state machine, countdown, orientation lock, sample-limit handling — against a **fake** landmark source | Phase 3 (US1) | T030–T035, T073–T075 | Application tests; samples recorded from synthetic landmarks |
| **D. Native binding** | Kotlin CameraX (front camera, mirrored, rejected on unsupported config) + MediaPipe HandLandmarker, preview texture, EventChannel | Phase 3 (US1) | T036–T039 | Manual on-device validation — **not** host-testable |
| **E. Quality & catalog** | Validation, accepted/discarded accounting, summary, catalog, progress, pose picker | Phases 4–5 (US2, US3) | T040–T055 | Application + widget tests |
| **F. Export** | Integrity validation, manifest, streaming ZIP in an isolate, share sheet | Phase 6 (US4) | T056–T061, T076–T079 | Export tests on a temp dataset; engine imports the result |
| **G. Docs & polish** | App README, monorepo README, empty/error states, KPI benchmark | Phase 7 | T062–T069, T080 | Review against spec + quickstart run-through |

Everything except **plan phase D** (`tasks.md` T036–T039) is verifiable in this environment. Phase D
is written but can only be confirmed on hardware; it sits behind a single interface so the rest of
the application is already proven when it lands.

## Complexity Tracking

> No constitutional violations require justification. Table intentionally empty.
