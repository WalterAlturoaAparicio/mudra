# Implementation Plan: Mudra Capture — Mobile Pose Dataset Collector

**Branch**: `003-mobile-pose-capture` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-mobile-pose-capture/spec.md`

**Revision**: regenerated for **Revision R1** (camera lifecycle, capture modes, preview fidelity) —
see [spec.md → Revision History](./spec.md#revision-history). The baseline application described
below is **already implemented and merged**; R1 changes the camera subsystem inside it. Sections that
describe work still to be done are marked **(R1)**.

## Summary

Mudra Capture is a Flutter/Android application, living at `apps/capture/`, whose only job is
producing engine-compatible hand-pose samples in volume. One press of **Record** optionally runs a
countdown over a live preview, then automatically captures ~1 second of MediaPipe hand landmarks,
storing every valid frame as its own sample and reporting accepted vs discarded counts. **Sync**
packages the dataset into a ZIP the engine imports untouched.

R1 rebuilds how that application owns the camera. Today a single app-scoped landmark source is
`stop()`ped but never released, so the device stays claimed after the capture screen closes; the
preview is stretched to fill the screen; and the front lens is the only configuration the app will
accept. After R1 the camera lives behind a **platform-neutral session boundary** that is opened and
fully released per visit, exactly one session exists at a time, both lenses are selectable through
two capture modes, and every capture — whichever lens produced it — is converted into the single
**canonical viewing convention** the whole dataset already uses before it reaches disk. The persisted
schema stays at version 1: the new camera metadata is additive inside existing blocks, and the
"canonical raw" change is terminology, not structure.

Technically: CameraX still owns the camera natively and binds a preview texture plus an
`ImageAnalysis` stream into MediaPipe Tasks `HandLandmarker` (LIVE_STREAM), with landmark frames
reaching Dart over an `EventChannel`. R1 makes the native controller **per-session** rather than
per-plugin, so teardown is total by construction; makes the preview report its **actual** resolution
so Dart can render it undistorted; and adds an explicit lens parameter. Everything above the seam —
mode/settings state, canonicalization, the session loop, validation, normalization, persistence,
export — stays pure Dart and host-testable.

## Technical Context

**Language/Version**: Dart 3.9 / Flutter 3.35 (stable). Native layer: Kotlin (Android).

**Primary Dependencies**: unchanged by R1 — `flutter_riverpod` (state + DI), `permission_handler`
(camera permission, including the permanently-denied path FR-110 needs), `archive` (streaming ZIP),
`share_plus` (share sheet), `path_provider` (app storage), `uuid` (sample UUIDs),
`package_info_plus`, `device_info_plus`. Native: `com.google.mediapipe:tasks-vision`, AndroidX
**CameraX**. Dev: `flutter_test`, `flutter_lints`. **R1 introduces no new package** — it is a
restructuring of code the app already owns.

**Storage**: Application-private filesystem,
`<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json` — the engine's layout, byte-compatible
schema v1. No database. Unchanged by R1.

**Testing**: `flutter test` (unit + widget) on the host; golden JSON fixtures generated from the
Python engine for schema/normalization parity. R1 adds host-testable coverage for canonicalization,
the single-session invariant, mode/settings behaviour, and preview aspect-ratio math — see
[research.md D22](./research.md#d22--what-r1-makes-testable-without-a-device). The Kotlin camera path
is still validated manually on hardware per `quickstart.md`.

**Target Platform**: Android phones (minSdk 24, targetSdk 35). iOS deliberately unimplemented but
unblocked — after R1 the platform-specific surface is `infrastructure/camera/` plus the Kotlin
plugin, and nothing else (FR-112–FR-116).

**Project Type**: Mobile application inside a monorepo, sibling to the Python engine at
`apps/engine/`.

**Performance Goals**: preview and detection sustain ≥20 fps on mid-range hardware (SC-002); a full
Record→result cycle under 6 s with the countdown enabled (SC-003), faster without it; UI responsive
with ≥5,000 stored samples (SC-011). **R1 adds**: camera released within 1 s of leaving the capture
screen (SC-019), a lens switch back to live preview within 1.5 s (SC-024), and 20 consecutive
enter/leave cycles with no degradation (SC-018).

**Constraints**: fully offline — no network, no accounts, no backend (FR-034/FR-038/FR-039). Never
persist pixel data (FR-030, Principle II) — R1's camera metadata is descriptive only (FR-085). Never
overwrite an existing sample (FR-018/FR-029). No business logic in widgets. **R1 constraints**:
`schema_version` stays `1` (FR-057); at most one live camera session at any instant (FR-092); no
persisted user preferences — every R1 setting is session-scoped (FR-075).

**Scale/Scope**: 18 catalog poses, default target 500 samples each; 2 primary screens (home,
capture) plus a pose picker and a permission rationale. R1 touches the capture screen, the camera
infrastructure, the Kotlin plugin, and the sample builder — roughly 12 existing files plus 9 new
ones, and no change to catalog, export, manifest, or integrity code.

## Constitution Check

*GATE: evaluated against constitution **v1.3.0** before Phase 0, re-evaluated after Phase 1 design.
Verdicts below are for the application **including R1**.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Architecture-First & Modular Boundaries** | Every capability behind an interface; dependencies point inward; no global mutable state | **PASS** — R1 *strengthens* this. The camera moves from an app-lifetime `HandLandmarkSource` singleton to a `CameraSource` → `CameraSession` pair (research D14), which is precisely the "replaceable independently" property FR-112–FR-116 demand. The single-session invariant lives in one application-layer controller, not scattered across widgets. Riverpod state stays in a container, not in globals (research D8). |
| **II. Coordinates, Never Images** | No image, frame, or pixel data persisted anywhere | **PASS** — R1 adds four descriptive metadata values (lens position, mirroring, countdown, platform lens id). None is derived from pixels; FR-085 states this explicitly. The canonicalization transform operates on landmark coordinates only. The existing test asserting the dataset tree contains nothing but `.json` still holds. |
| **III. Extensibility by Design** | Stable `pose_id` identity; append-only datasets | **PASS** — untouched by R1. Additionally, FR-053–FR-058 *protect* future extensibility: storing every sample in one viewing convention is what lets a future normalization strategy be re-derived across the whole corpus without consulting which lens took each sample. |
| **IV. Typed, Modeled, Clean** | Typed immutable models, no raw maps, docs, tests on data + I/O | **PASS** — `CaptureMode`, `CaptureProfile`, `LensPosition`, `ViewConvention`, `CameraMetadata`, `CaptureSettings`, `CameraSessionInfo` are all immutable value types with equality. `Map` still appears only at serializer and channel boundaries. |
| **V. Centralized Config & Observability** | No hardcoded tunables; structured logging including explicit startup/shutdown; no per-frame INFO | **PASS** — the two mode profiles (lens, mirroring, countdown default) become `CaptureConfig` data, not constants in widgets, and the native preview/analysis resolutions stop being hardcoded (`PREVIEW_WIDTH`/`PREVIEW_HEIGHT` are removed — research D16). FR-096 adds structured `camera_acquired`/`camera_released` records carrying an explicit release **reason**, at info; frame events stay at debug. |
| **VI. Scope Discipline** | No recognition, ML, gameplay, or effects | **PASS** — R1 adds no inference and no feature surface beyond the camera. FR-075 explicitly refuses the settings screen that persisting preferences would require, which is the YAGNI rule applied to R1's own natural next step. |
| **Monorepo & Cross-Application Boundaries** | JSON schema is the only contract; schema changes are cross-application events; no cross-app imports; no premature shared packages | **PASS with two recorded consequences** — see below. |

### Monorepo gate, in detail

R1 adds four values to persisted samples. This is the gate that deserves scrutiny, because the
constitution makes any schema change a cross-application event.

**Verified, not assumed**: `apps/engine/dataset/serializer.py` reconstructs samples by *explicit key
lookup* on plain dataclasses (`camera["index"]`, `data.get("capture")`) — there is no
`extra="forbid"`, no Pydantic model, and no strict-shape validation on these blocks. Unknown keys
inside `metadata.camera` and `metadata.capture` are therefore **ignored, not rejected**. The engine
loads R1 samples today, unmodified. This is the same additive pattern already used for
`session_uuid`, and the same one the engine itself used when `metadata.capture` was introduced in
feature 002.

- **Consequence 1 (pre-existing, now larger)**: `PoseSerializer` re-emits only the keys it knows, so
  an engine **load-then-resave** cycle drops `session_uuid` and now also the four R1 values. Samples
  written by Capture and *read* by the engine are unaffected; only a rewrite loses them. Teaching the
  engine's `PoseMetadata`/`CaptureTiming` to carry and re-emit these fields is a follow-up **on the
  engine side**, recorded in [contracts/sample-json.md](./contracts/sample-json.md). Until then the
  export `manifest.json` carries session records independently.
- **Consequence 2 (new, R1)**: FR-056 redefines the *documented meaning* of the existing `raw` field
  — it is now the earliest **canonical** observation, not verbatim detector output. No field is
  renamed, no structure changes, `schema_version` stays `1`, and every sample already on disk stays
  valid. But the engine's docstring for `HandSample.raw` ("raw and normalized landmark sets") is now
  stale. This is a **documentation** follow-up on the engine side, tracked in the spec's Revision
  History; it is not a schema change and does not gate this feature.

Neither consequence requires an engine code change before merge, because neither breaks the engine's
ability to read what Capture writes — which is what the constitution's "reflected in every
application before merge" clause protects. Both are stated rather than assumed.

**Post-Phase-1 re-evaluation**: unchanged — all gates still PASS. The R1 design added no
cross-application dependency, no persisted pixel data, no new package, and no out-of-milestone
surface. **Complexity Tracking is empty: there are no justified violations.**

## Project Structure

### Documentation (this feature)

```text
specs/003-mobile-pose-capture/
├── plan.md                     # This file (regenerated for R1)
├── spec.md                     # Feature specification, including Revision History
├── research.md                 # Phase 0 — D1..D13 (baseline) + D14..D21 (R1) + risks
├── data-model.md               # Phase 1 — entities, validation, state machines
├── quickstart.md               # Phase 1 — how to run and validate
├── contracts/
│   ├── sample-json.md          # The engine schema v1 as Capture must emit it (+ R1 fields)
│   ├── camera-channel.md       # Kotlin ⇄ Dart camera + landmark contract (R1; supersedes
│   │                           #   platform-channel.md)
│   ├── platform-channel.md     # Superseded redirect → camera-channel.md
│   ├── pose-catalog.md         # Catalog configuration format
│   └── interfaces.md           # Dart port interfaces (domain-owned)
├── checklists/
│   └── requirements.md         # Spec quality checklist (incl. R1 re-validation)
└── tasks.md                    # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

Existing tree, with **R1 additions marked `+`** and **R1 rewrites marked `~`**:

```text
apps/capture/
├── lib/
│   ├── domain/                     # Pure Dart. No Flutter, no plugins, no I/O.
│   │   ├── landmarks/              # Landmark, HandLandmarks, HandDetection, LandmarkFrame,
│   │   │                           # ~ Handedness (gains `flipped`), ~ LandmarkFrame (gains
│   │   │                           #   the ViewConvention it was observed in)
│   │   ├── camera/               + # LensPosition, ViewConvention, CaptureMode, CaptureProfile,
│   │   │                         + #   CameraSessionInfo, CameraMetadata, CameraReleaseReason
│   │   ├── canonical/            + # CanonicalViewConverter — the FR-053..FR-058 transform
│   │   ├── poses/                  # PoseDefinition, PoseCatalog, PoseProgress
│   │   ├── samples/                # ~ HandSample.raw → canonicalRaw (FR-056); SampleMetadata
│   │   │                           #   gains cameraMetadata; CaptureTiming gains countdownEnabled
│   │   ├── capture/                # ~ CaptureSession → RecordingSession, CaptureSessionState →
│   │   │                           #   RecordingSessionState (R1.1); Summary no longer ends the screen
│   │   ├── export/                 # DatasetManifest, IntegrityReport, IntegrityFinding
│   │   ├── normalization/          # LandmarkNormalizer + TranslationScaleNormalizer
│   │   ├── validation/             # SampleValidator
│   │   └── ports/                  # ~ HandLandmarkSource → CameraSource + CameraSession;
│   │                               #   SampleRepository, PoseCatalogSource, DatasetExporter,
│   │                               #   DatasetIntegrityValidator, DatasetManifestBuilder,
│   │                               #   SessionStore, OrientationController, Clock, UuidFactory,
│   │                               #   AppLogger
│   ├── application/                # Use cases + state notifiers. No widgets, no plugins.
│   │   ├── camera/               + # CameraSessionController (the single-session invariant,
│   │   │                         + #   open/close serialization, lifecycle reaction),
│   │   │                         + #   CaptureSettingsNotifier (mode, lens, countdown, confirm)
│   │   ├── capture/                # ~ RunCaptureSession takes settings + canonical frames
│   │   ├── catalog/                # LoadPoseCatalog, SelectPose, PoseProgressNotifier
│   │   ├── export/                 # ExportDataset
│   │   └── lifecycle/              # RecordAppLifecycle
│   ├── infrastructure/             # Implements domain ports. Only layer that knows the platform.
│   │   ├── camera/               ~ # (was landmarks/) MethodChannelCameraSource +
│   │   │                         + #   MethodChannelCameraSession
│   │   ├── storage/                # FileSampleRepository, FileSessionStore
│   │   ├── serialization/          # ~ PoseSampleSerializer emits the R1 metadata additively
│   │   ├── catalog/                # AssetPoseCatalogSource
│   │   ├── export/                 # ZipDatasetExporter, DatasetIntegrityChecker, ManifestBuilder
│   │   └── platform/               # SystemClock, UuidV4Factory, CameraPermissions (+ permanently
│   │                               #   denied → settings), SharePresenter, DeviceInfoSource,
│   │                               #   OrientationController, StructuredAppLogger
│   ├── presentation/               # Widgets and screens only.
│   │   ├── home/                   # HomeScreen (unchanged: FR-006/FR-007 still stand)
│   │   ├── capture/                # ~ CaptureScreen rebuilt for the session loop and layout
│   │   │                         + #   PreviewStage (aspect-ratio-correct preview + aligned
│   │   │                         + #   overlays), CaptureControlBar (mode/lens/countdown/confirm)
│   │   ├── catalog/                # Pose picker
│   │   ├── permissions/            # ~ Rationale screen distinguishes denied vs permanently denied
│   │   └── design/                 # Theme, spacing, typography, shared widgets
│   ├── shared/                     # ~ CaptureConfig gains the two mode profiles; Result/Failure
│   └── main.dart                   # Composition root: ProviderScope + wiring
├── assets/
│   ├── config/pose_catalog.json    # The 18 poses (FR-003)
│   ├── poses/                      # Reference images by pose_id
│   └── models/hand_landmarker.task # Same model file the engine uses
├── android/
│   └── app/src/main/kotlin/.../    # ~ HandLandmarkerPlugin (per-session controller lifetime),
│                                   # ~ CameraXController (lens parameter, true preview size,
│                                   #   total release)
├── test/
│   ├── domain/                   + # Canonicalization transform, mode profiles, aspect math
│   ├── application/              + # Single-session invariant, settings ownership, session loop
│   ├── infrastructure/           + # R1 metadata serialization, camera-channel decoding
│   ├── presentation/             + # Preview letterbox/pillarbox, layout at smallest size
│   └── fixtures/                   # Golden JSON generated from the Python engine
├── analysis_options.yaml
├── pubspec.yaml
└── README.md
```

**Structure Decision**: unchanged from the baseline — `apps/capture/` is a self-contained Flutter
application under the constitution's monorepo layout, with the four mandated layers as top-level
directories inside `lib/` and feature-first grouping *within* each layer. R1 adds two new
feature groups (`domain/camera/`, `application/camera/`) and **renames**
`infrastructure/landmarks/` to `infrastructure/camera/`, because after R1 that directory owns camera
acquisition and lens selection, not only landmark delivery. The rename is what keeps the platform
seam honestly named; it is a directory move plus import updates, with no logic change.

## Revision R1 design

The eight decisions R1 turns on, in dependency order. Full rationale and rejected alternatives are in
[research.md](./research.md) as **D14–D22**; this section states what is being built.

### 1. The camera seam becomes a session, not a singleton (D14)

`HandLandmarkSource` is replaced by two interfaces:

```dart
abstract interface class CameraSource {
  Future<Set<LensPosition>> availableLenses();
  Future<CameraSession> open(CameraRequest request);   // lens + desired analysis size
}

abstract interface class CameraSession {
  CameraSessionInfo get info;          // texture id, true preview WxH, analysis WxH,
                                       // lens, mirrored, platform lens id, detector version
  Stream<LandmarkFrame> get frames;    // canonical convention applied upstream of consumers
  Future<void> close();                // total, idempotent (FR-086/FR-095)
}
```

The distinction is the whole point: a **source** is a capability that outlives screens; a **session**
is a resource with a birth and a death. `close()` releases the camera binding, the preview texture,
the analysis executor, and the detector — there is no partial "stopped but still holding" state,
which is exactly the state the current `stop()`/`dispose()` split produces and the bug FR-086 names.

### 2. Exactly one session, enforced in one place (D15)

`CameraSessionController` (application layer) is the only thing that may call `open`/`close`. It
serializes every request through a single slot with a monotonic **request token**:

- a new request supersedes the pending one;
- when an `open` resolves and its token is no longer current, it is **closed immediately** and never
  published — this is FR-093 (leave while starting) and FR-070 (rapid switching) falling out of one
  mechanism rather than two special cases;
- `close` is always awaited before the next `open` begins (FR-066).

It also owns the lifecycle reaction (FR-090/FR-091): a `WidgetsBindingObserver` releases on
`inactive`/`paused` with reason `backgrounded` and reopens on `resumed` **only if** the capture
screen is still the requested owner. The controller's provider is `autoDispose` and scoped to the
capture screen, so leaving the screen releases the camera as a consequence of ownership ending rather
than as a `dispose()` side effect a future edit could forget.

### 3. Native teardown becomes total by construction (D16)

`HandLandmarkerPlugin` constructs a **fresh `CameraXController` per open** and drops the reference on
close, instead of reusing one controller for the plugin's lifetime. This removes the
non-restartable-executor bug (`analysisExecutor.shutdown()` today makes a controller unusable after
`dispose()`) and the leaked `SurfaceTextureEntry` (today `stop()` unbinds but never releases it) —
not by remembering to release more things, but by making the object's lifetime equal to the
resource's. `start` gains a required `lensFacing` argument and reports the **actual** preview
resolution from `SurfaceRequest.resolution` instead of the hardcoded 720×1280 constants.

### 4. Canonicalization at the seam, before anything sees a frame (D17)

`CanonicalViewConverter` is a pure domain service applied to `CameraSession.frames` by the controller,
so validation, normalization, persistence, and any future consumer all observe one convention:

| Aspect | Transform when the source is unmirrored (rear lens) |
|---|---|
| Geometry | `x' = 1 − x` for every landmark; `y`, `z`, `visibility` untouched |
| Handedness | `left ↔ right`; `unknown` stays `unknown` |
| Hand order | **Never reordered** — each entry is converted in place, which is how FR-054's "preserve each hand's identity" is met |

Handedness must flip because MediaPipe derives the label assuming a mirrored (selfie) input; mirroring
the image without relabelling would name the wrong physical hand. Normalization cannot absorb this:
`translation_scale` is a translation and a scale, and a reflection is neither — which is the concrete
reason FR-055 requires conversion on *every* persisted landmark set, before normalization runs.

The Dart field `HandSample.raw` is renamed **`canonicalRaw`** (FR-056), while the serializer keeps
writing the JSON key `"raw"` (FR-057). A test pins that divergence so nobody "fixes" it later.

### 5. Modes initialize settings once; the session owns them after (D18)

```text
CaptureMode.selfCapture     → CaptureProfile(lens: front, mirrored: true,  countdown: on  @ 3.0s)
CaptureMode.operatorCapture → CaptureProfile(lens: rear,  mirrored: false, countdown: off)
```

Both profiles are `CaptureConfig` data (Principle V). `CaptureSettingsNotifier` holds the live
`CaptureSettings` — mode, lens, countdown enabled/seconds, take confirmation — and is re-initialized
from the profile **only when the mode changes**. Every other event (lens switch, backgrounding,
screen lock, screen recreation, take completion) leaves it alone. That single rule is what satisfies
FR-071, FR-073, FR-074, FR-079 and SC-032 together, and it is why the notifier is scoped to the
application run rather than to the widget: a screen the OS recreates must not silently reset the
user's countdown.

Mirroring is **not** a user setting: it follows the active lens (FR-067), so `CaptureSettings`
derives it rather than storing it.

**Terminology (settled in R1.1)** — the spec's Glossary now defines three non-interchangeable scopes,
and the code uses the same three names:

| Term | Meaning | Types |
|---|---|---|
| **Recording session** | One press of Record (a take). Identified by `session_uuid`. | `RecordingSession`, `RecordingSessionState` |
| **Capture session** | One visit to the capture screen: owns the settings and the orientation lock, spans many takes. Initialized on entry **or** on a mode change; re-entering with the same mode does **not** re-initialize. | `CaptureSettings` |
| **Camera session** | One device acquisition; at most one at a time. | `CameraSession`, `CameraSessionInfo` |

The baseline called a take `CaptureSession`/`CaptureSessionState`, which collides with the screen-level
scope. Those types are renamed (task T082a); the persisted `session_uuid` is untouched, so this is a
naming correction rather than a schema change.

### 6. Camera metadata: additive, and placed where it means something (D19)

```json
"camera":  { "index": 1, "width": 640, "height": 480,
             "position": "front", "mirrored_preview": true, "lens_facing": 1 },
"capture": { "countdown_start_time": "…", "capture_time": "…",
             "countdown_seconds": 3.0, "countdown_enabled": true,
             "session_uuid": "…" }
```

`countdown_enabled` goes in `metadata.capture` beside `countdown_seconds`, not in `metadata.camera` —
it is a property of the take, not of the lens. `lens_facing` is stored explicitly even though
`index` currently holds the same number, because `index` is an *engine-owned* field that Capture
fills with a lens constant by local convention; FR-084 asks for the platform's identifier
independently of that convention. A test asserts the two agree, so the redundancy can never drift
into a contradiction.

With the countdown disabled, `countdown_seconds` is `0.0` and `countdown_start_time` is the instant
Record was pressed — a zero-length countdown, no new nullability, no new type.

### 7. The preview is sized by the camera, not by the screen (D20)

```dart
Center(child: AspectRatio(aspectRatio: info.previewAspect,
                          child: Stack(children: [Texture(...), ...overlays])))
```

`Texture` is a leaf that fills whatever constraints it is given, which is why `Stack(fit:
StackFit.expand)` stretches it today. Wrapping it in `AspectRatio` inside a `Center` produces
letterboxing or pillarboxing for free, with the neutral bands being the container's own background
(FR-097/FR-098). The ratio comes from `CameraSessionInfo.previewWidth/Height`, reported by the
platform for the session that is actually running (FR-099) — and reported **rotation-adjusted**, so a
portrait phone receiving a landscape sensor stream gets the ratio it will actually display. Overlays
are children of the same `AspectRatio` box, which is what makes FR-101's alignment structural rather
than a coordinate calculation somebody has to keep correct.

**(R1.1)** The ratio is computed once per camera session and cannot go stale, because FR-049 now locks
orientation for the **whole capture session** — entering the capture screen locks, leaving restores.
Before R1.1 the lock covered only an in-flight take, which combined with R1's persistent screen would
have let the device rotate between takes and invalidate both the preview ratio and the frame geometry
a sample's coordinates depend on. Locking the screen is strictly less machinery than recomputing
either.

### 8. The capture screen becomes a loop, not a one-shot (D21)

`SummaryState` currently pops the screen. After R1 it returns to `Idle` with the camera untouched
(FR-076), gated by the take-confirmation setting (FR-077/FR-078). The screen gains the reference
image, progress, and Sync so all five FR-102 elements are visible at once, and a control bar for
mode, lens, countdown, and confirmation (FR-105).

The home screen is **kept as it is**: FR-006/FR-007 are unrevised, so Record and Sync still live
there too. Home's Record navigates to capture; capture's Record starts a take. The overlap is
deliberate and specified, not an oversight.

## Implementation Phases

Two numbering schemes exist by necessity: this plan describes **capability phases**, while
`tasks.md` sequences **execution phases** grouped by user story. The mapping is authoritative and
each `tasks.md` phase header cross-references its letter.

### Delivered (baseline, phases A–G)

| Plan phase | Delivers | Status |
|---|---|---|
| **A. Foundation** | Flutter project, analysis options, config, domain value objects, ports, lifecycle logging | ✅ merged |
| **B. Schema parity** | Normalizer, serializer, file repository, session identity | ✅ merged |
| **C. Capture loop** | Session state machine, countdown, orientation lock, sample-limit handling | ✅ merged |
| **D. Native binding** | Kotlin CameraX + MediaPipe HandLandmarker, preview texture, EventChannel | ✅ merged — **rebuilt by R1 phase H** |
| **E. Quality & catalog** | Validation, accepted/discarded accounting, summary, catalog, progress, pose picker | ✅ merged |
| **F. Export** | Integrity validation, manifest, streaming ZIP in an isolate, share sheet | ✅ merged |
| **G. Docs & polish** | READMEs, empty/error states, KPI benchmark | ✅ merged |

### Revision R1 (phases H–N)

Ordered so each phase leaves the app demonstrable, and so the unverifiable native work stays isolated
at one seam.

| Plan phase | Delivers | Requirements | Depends on | Verifiable by |
|---|---|---|---|---|
| **H. Camera seam & lifecycle** | `CameraSource`/`CameraSession` ports; `CameraSessionController` with the single-session invariant and lifecycle reaction; `infrastructure/camera/`; per-session Kotlin controller with total teardown, lens parameter, true preview size; ordered start path with distinct errors | FR-086–FR-096, FR-107–FR-111, FR-112–FR-116, FR-044 (revised) | — | Host tests for the invariant with a fake source; **native release behaviour needs hardware** |
| **I. Canonical conversion** | `CanonicalViewConverter`; `ViewConvention` on frames; `raw` → `canonicalRaw`; serializer key pinned | FR-053–FR-058, FR-027 (revised) | — (pure; parallel with H) | Host tests: self/operator agreement on handedness and geometry (SC-031), golden-fixture parity unchanged |
| **J. Modes, lenses & settings** | `CaptureMode`/`CaptureProfile` as config; `CaptureSettingsNotifier`; lens switching through the controller; unavailable-lens handling | FR-059–FR-075, FR-010 (revised) | H | Host tests: mode initializes once, lens switch never alters the countdown (SC-032), rapid switching converges |
| **K. Camera metadata** | Additive `metadata.camera` and `metadata.capture` fields; sample builder reads the live configuration per take | FR-081–FR-085, FR-052 (extended) | I, J | Serializer tests; engine round-trip read test; pre-R1 fixtures still load (SC-026) |
| **L. Session loop** | Summary returns to idle; take-confirmation setting; progress updates per take; camera survives across takes | FR-076–FR-080 | J | Widget + application tests for the loop and the opt-out |
| **M. Preview fidelity & layout** | `PreviewStage` (aspect-correct, centered, aligned overlays); capture screen layout with all five elements; control bar; smallest-screen behaviour | FR-097–FR-106, FR-012 (extended by FR-104) | H | Widget tests across screen shapes; square-object check on device (SC-022) |
| **N. Validation & docs** | New quickstart rows, KPI re-run, README and contract updates, the end-to-end no-hardware integration test, and the layer-boundary architecture test | SC-018–SC-032, FR-115, FR-116 | H–M | Full `quickstart.md` pass on hardware; `flutter test` for the two new guards |

**Host-verifiable vs hardware-only.** Everything except the Kotlin half of **H** is provable in this
environment. The hardware-only claims are precisely: camera released within 1 s (SC-019), another app
can acquire it (SC-020), 20 enter/leave cycles (SC-018), zero busy errors over 30 minutes (SC-021),
lens switch under 1.5 s (SC-024), and the square-object undistortion check (SC-022). Those six are
called out here rather than discovered at review time — they are the reason FR-116/SC-030 exist, and
a `FakeCameraSource` covers the workflow around them.

**Superseded by this revision**: `tasks.md` T037/T037a assert front-camera-only capture
(`CameraSelector.DEFAULT_FRONT_CAMERA`, and `lensFacing == 1 && mirrored == true` on every start).
Phase H replaces both. They must be rewritten by `/speckit-tasks`, not extended.

## R1.1 — Post-analysis refinements (2026-07-26)

Six accepted findings from the cross-artifact analysis. Refinements only: no architectural redesign,
no new features, no schema change.

| Finding | Change to this plan | Where |
|---|---|---|
| **A1** Ambiguous "session" | Three named scopes fixed in spec, plan, and code; `CaptureSession`/`CaptureSessionState` renamed to `RecordingSession`/`RecordingSessionState` | §D18 terminology table; T082a |
| **F1** Orientation | **Behaviour change**: locked for the whole capture session instead of per take, which is also what makes the preview ratio safe to compute once | §D20; FR-049 revised; T086a |
| **C1** Camera ⇄ dataset isolation | Enforced by an automated architecture test rather than by convention | Phase N; T133a |
| **C2** No-hardware coverage | `FakeCameraSource` extended to drive the **complete** pipeline (init → capture → validation → storage → export) in one integration test | Phase N; T091 extended, T133b |
| **E1** Task ordering | Countdown and confirmation controls move to the phases of the stories that need them | Phases 10 and 11 |
| **C3** SC-023 | Added to the manual validation matrix | `quickstart.md` |

**Constitution re-check after R1.1**: unchanged, all gates still PASS. C1 and C2 *strengthen*
Principle I (the boundary is now enforced, not assumed) and the capture testing standard. F1 is the
only behaviour change and touches no principle.

## Complexity Tracking

> No constitutional violations require justification. Table intentionally empty.
>
> The two monorepo consequences recorded in the Constitution Check are *disclosures*, not deviations:
> neither breaks the engine's ability to read what Capture writes, which is the property the rule
> protects.
