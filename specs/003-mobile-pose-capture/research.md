# Phase 0 Research: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

Decisions taken before design, each with the alternatives that were rejected. The recurring
constraint behind almost every decision: **samples produced on a phone must be indistinguishable
from samples produced by the engine**, because the dataset is the only contract between the two
applications (constitution, Monorepo & Cross-Application Boundaries).

---

## D1 — Hand landmark detection on Android

**Decision**: MediaPipe **Tasks Vision `HandLandmarker`** (`com.google.mediapipe:tasks-vision`) in
`LIVE_STREAM` mode, running natively on Android and surfaced to Dart behind a single Dart interface
(`HandLandmarkSource`).

**Rationale**: The engine uses the MediaPipe Tasks `HandLandmarker` with the bundled
`hand_landmarker.task` model. Using the same task, the same model file, and the same 21-point
topology is the only way to guarantee that a landmark recorded on a phone means the same thing as
one recorded on the desktop — same normalized `[0,1]` coordinate space, same wrist-relative `z`,
same handedness semantics under mirroring.

**Alternatives considered**:

- *ML Kit (`google_mlkit_*`)* — has pose, face, and object detection, but **no hand landmarker**.
  Rejected: cannot produce the required 21-point hand topology.
- *Community Flutter MediaPipe packages* — none wrap the current Tasks Vision API for hands with a
  maintained Android implementation. Rejected: an unmaintained third-party package sitting on the
  project's core data path is exactly the dependency risk the constitution's footprint rule warns
  about.
- *Raw TFLite hand model via `tflite_flutter`* — would require reimplementing palm detection,
  landmark regression, and the tracking heuristics MediaPipe performs between them. Rejected:
  guaranteed semantic drift from the engine's landmarks, which silently corrupts the dataset.

**Consequence**: the exact `hand_landmarker.task` file the engine uses is bundled into the app's
Android assets, so both applications run byte-identical model weights.

---

## D2 — Camera pipeline and preview

**Decision**: **CameraX owns the camera natively.** A single `ProcessCameraProvider` binds two use
cases: `Preview` (rendered into a `SurfaceTexture` registered with Flutter's `TextureRegistry`, so
Dart displays it with a `Texture` widget) and `ImageAnalysis`
(`STRATEGY_KEEP_ONLY_LATEST`, feeding `HandLandmarker.detectAsync`).

**Rationale**: The camera device can only have one owner. Landmark detection and preview must come
from the same stream, and keeping only the latest frame prevents the analyzer from building a
backlog that would desynchronize the preview from the landmarks the user is actually producing.

**Alternatives considered**:

- *Flutter `camera` package for preview + native analysis* — two independent camera clients
  competing for the device. Rejected: unreliable binding, and the preview would show frames the
  detector never saw.
- *Dart-side image conversion (`camera` package streaming `CameraImage` into a Dart detector)* —
  YUV→RGB conversion per frame in Dart at 30 fps. Rejected on performance grounds; it also does not
  solve D1.

---

## D3 — Channel protocol between native and Dart

**Decision**: `MethodChannel` for lifecycle control (`start`, `stop`, `dispose`) and an
`EventChannel` streaming one compact map per detected frame, with landmarks carried as a
`Float32List` (63 floats per hand: x, y, z × 21) rather than nested maps or JSON text.

**Rationale**: At ~30 fps a nested-map or JSON payload would allocate thousands of short-lived
objects per second. Flutter's standard message codec transfers typed data lists as raw bytes, which
keeps the per-frame cost near-zero and leaves the frame budget to the preview.

**Alternatives considered**:

- *JSON strings over the channel* — human-debuggable but allocates and parses per frame. Rejected.
- *Pigeon-generated typed channels* — nicer ergonomics, but adds a codegen dependency for one
  small, stable interface. Rejected as premature; the interface is four calls and one stream.

---

## D4 — Normalization parity with the engine

**Decision**: Port `translation_scale` v1.0 to Dart **operation for operation**: origin = landmark 0
(wrist), reference = landmark 9 (middle-finger MCP), `span` = 3-D Euclidean distance between them,
`span < 1e-9` falls back to `1.0` (translation only), then every point becomes
`(p - origin) / span` per axis. Strategy name `translation_scale`, version `1.0`.

**Rationale**: Both languages use IEEE-754 doubles, so performing the same operations in the same
order yields bit-identical results. Parity is verified by **golden fixtures generated from the
Python implementation** and asserted in Dart tests — not by re-deriving the maths and hoping.

**Alternatives considered**:

- *Normalize later, on the engine side, from raw landmarks only* — would leave `normalized` empty
  or absent and break schema compatibility (FR-027). Rejected.
- *Extract a shared normalization package* — rejected by the constitution's "no premature shared
  packages" rule: the logic is ~15 lines, and duplication with a golden-fixture parity test is the
  cheaper, looser coupling.

---

## D5 — JSON schema fidelity

**Decision**: A Dart serializer that emits the engine's schema v1 exactly — same keys, same order,
same nesting, 2-space indent. Specific fidelity details resolved here:

| Concern | Resolution |
|---|---|
| `metadata.camera.index` | Android `CameraSelector` lens-facing constant: `0` = back, `1` = front. Principled, stable, and meaningful on a device with no "camera index". |
| `metadata.versions.application` | `"mudra-capture/<version>"` — preserves producer provenance inside an existing string field, with **no** schema change. |
| `metadata.versions.mediapipe` | The MediaPipe Tasks version reported by the native side. |
| `timestamp` format | Explicitly formatted as UTC ISO-8601 with 6-digit microseconds and a `+00:00` offset, matching Python's `datetime.isoformat()`. Dart's default `toIso8601String()` emits `Z`, which would be a gratuitous textual difference. |
| Float text | Dart writes shortest round-trip decimals, Python writes `repr`. Both parse to identical doubles; the schema constrains values, not their spelling. |
| `sample_number` | `sample_NNNNNN` (6 digits), assigned at write time, matching the engine's repository. |
| `metadata.capture` | Populated: `countdown_start_time`, per-frame `capture_time`, `countdown_seconds`. |

**Alternatives considered**: inventing a capture-specific field for provenance (e.g. `producer`) —
rejected, it would change the schema and therefore be a cross-application event requiring the engine
to change too.

---

## D6 — On-device storage and append-only numbering

**Decision**: Samples land in application-private storage at
`<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json`, mirroring the engine's layout exactly.
Numbering is `max(existing) + 1` per pose, seeded by one directory scan and then held in memory;
every write checks for existence first and advances on collision, so a sample is never overwritten.
Captured frames are **buffered in memory during the ~1 s window and persisted after it ends**.

**Rationale**: Writing ~25 files while the capture window is running would contend with the camera
and detector for the frame budget. Buffering costs a few hundred kilobytes and keeps capture smooth;
persistence then happens once, asynchronously.

**Alternatives considered**:

- *Write each frame as it arrives* — simplest, but risks jank during the exact second that matters.
- *SQLite index of samples* — faster counting for huge datasets, but introduces a second source of
  truth beside the files and a dependency. Rejected: counts are cached in memory and refreshed on a
  directory scan at startup, which satisfies SC-011 without a database.
- *`O_EXCL` exclusive create (the engine's approach)* — `dart:io` exposes no exclusive-create mode.
  The existence check plus single-isolate sequential writes gives the same guarantee in practice;
  the residual race is documented rather than pretended away.

---

## D7 — Export archive

**Decision**: `archive` package using the **streaming `ZipFileEncoder`** (writes incrementally to a
file rather than building the archive in memory), executed in a **background isolate**, producing
`mudra_capture_export.zip` with `datasets/poses/<pose_id>/…` preserved; delivered through
`share_plus` to the system share sheet.

**Rationale**: 5,000 samples is on the order of 100 MB — an in-memory encoder would risk an OOM on a
mid-range phone and would certainly freeze the UI, violating SC-011. Streaming plus an isolate keeps
memory flat and the interface responsive. The share sheet needs no storage permission on modern
Android and lets the user route the file anywhere (Drive, email, USB, another app).

**Alternatives considered**:

- *`flutter_archive` (native zip)* — faster, but adds platform bindings for both Android and a future
  iOS. Rejected for now; the interface (`DatasetExporter`) makes swapping it a one-file change.
- *Writing directly to public Downloads* — requires scoped-storage handling and gives the user no
  direct send path. Rejected per the clarification session.

---

## D8 — State management

**Decision**: **Riverpod** (`flutter_riverpod` 2.x) with `Notifier`/`AsyncNotifier`, and all
infrastructure injected through providers that tests override.

**Rationale**: It gives compile-time-safe dependency injection without service locators, and every
use case can be exercised in `flutter test` with a fake landmark source and a temp-directory
repository — which is what makes the app testable with no Android device attached.

**Note on Principle I ("global mutable state is prohibited")**: top-level `final …Provider = …`
declarations are immutable *descriptors*; the mutable state lives in a `ProviderContainer` owned by
the widget tree and replaced per test. This satisfies the principle, and is recorded here because a
reviewer could otherwise read the top-level declarations as globals.

**Alternatives considered**: `bloc` (more ceremony per interaction than a two-button app needs);
`provider`/`ChangeNotifier` (weaker typed DI, easy to slip business logic into widgets); plain
`setState` (would force logic into widgets, which the constitution forbids outright).

---

## D9 — Countdown and capture session

**Decision**: An explicit session state machine —
`idle → countdown → capturing → summary → idle`, with `cancelled` and `failed` as alternative
terminal states — driven by a non-blocking ticker (`Stream.periodic`/`Ticker`), never by sleeping.
Frame arrival and countdown progression are independent inputs to the machine.

**Rationale**: Deliberately mirrors the engine's recording state machine so the two applications
describe the same lifecycle with the same words. A blocking delay would freeze the preview, directly
violating FR-011 and SC-010.

---

## D10 — Pose catalog as configuration

**Decision**: `assets/config/pose_catalog.json`, loaded once at startup and validated into immutable
`PoseDefinition` objects. Validation: `pose_id` matches `^[a-z0-9_]+$` (the engine's rule) and is
unique, `target_sample_count > 0`, `required_hands ∈ {1, 2}`, display name non-empty. A malformed
catalog fails loudly at startup with the offending entry named.

**Rationale**: FR-001 requires the catalog to be data, not code. Validating at the boundary means the
rest of the app can treat catalog entries as always-valid values.

**Alternatives considered**: YAML (needs a parser dependency for no gain); Dart constants (violates
FR-001); remote catalog (violates the offline/no-backend constraint).

---

## D11 — Permissions

**Decision**: `permission_handler` for camera permission, with an in-app rationale screen and a
"open settings" path when permanently denied.

**Alternatives considered**: hand-rolled native permission calls — more platform code in exchange for
removing one small, ubiquitous dependency. Rejected; the package covers the permanently-denied case
correctly, which is easy to get wrong by hand.

---

## D12 — Testing without a device

**Decision**: Everything above the `HandLandmarkSource` interface is testable on the host:

- `FakeHandLandmarkSource` emits scripted frames (valid, invalid, absent-hand, one-handed) so capture
  sessions, validation, and accepted/discarded accounting are unit-tested deterministically.
- Serialization is verified against **golden JSON fixtures generated from the Python engine**, and a
  round-trip test proves Dart-written samples re-parse identically.
- The repository is tested against a temporary directory: numbering, append-only behaviour, counts.
- Widget tests cover the home screen states (idle, countdown, capturing, summary, permission denied).

The Kotlin binding and the real camera path are **not** covered by host tests; they are validated
manually via `quickstart.md` on hardware. This split is stated plainly rather than implied.

---

## D13 — iOS readiness

**Decision**: Only `infrastructure/landmarks/` contains Android-specific code. The Dart interface,
the channel names, and the frame payload are platform-neutral, and no other layer imports anything
Android-specific.

**Consequence**: adding iOS means implementing MediaPipe Tasks Vision for iOS behind the same channel
contract (Swift + AVFoundation) — zero changes to domain, application, or presentation code. This is
the concrete meaning of the "iOS can be added later without changes" requirement.

---

## Open risks

| Risk | Impact | Mitigation |
|---|---|---|
| Native binding cannot be compiled or run in the current environment (no device/emulator, Android licenses unaccepted) | Kotlin path unverified until hardware is available | All Dart layers are fully testable without it; the binding is isolated behind one interface so iteration is contained to two files |
| MediaPipe Tasks version drift between engine (Python) and capture (Android) | Subtle landmark differences | `versions.mediapipe` is recorded in every sample, making drift detectable in the dataset itself |
| Sustained detection rate on low-end devices below ~20 fps | Fewer than 20 samples per press (SC-002) | Capture window duration is configuration, not code; it can be lengthened per device class without a release |
| `archive` throughput on very large datasets | Slow export | Streaming encoder in an isolate; `DatasetExporter` interface allows swapping in a native zip implementation |
