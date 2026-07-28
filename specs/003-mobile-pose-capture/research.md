# Phase 0 Research: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24 (D1–D13) · 2026-07-26 (D14–D22, R1)

Decisions taken before design, each with the alternatives that were rejected. The recurring
constraint behind almost every decision: **samples produced on a phone must be indistinguishable
from samples produced by the engine**, because the dataset is the only contract between the two
applications (constitution, Monorepo & Cross-Application Boundaries).

**D1–D13** are the baseline decisions, taken before the application was built. **D14–D22** were taken
for **Revision R1** (camera lifecycle, capture modes, preview fidelity) and are grounded in the code
that now exists — each one names the concrete behaviour it changes.

---

## D1 — Hand landmark detection on Android

**Decision**: MediaPipe **Tasks Vision `HandLandmarker`** (`com.google.mediapipe:tasks-vision`) in
`LIVE_STREAM` mode, running natively on Android and surfaced to Dart behind a single Dart interface.
*(R1 renamed that interface — see [D14](#d14--the-camera-seam-a-session-not-a-singleton); the
detector decision itself is unchanged.)*

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

> **Superseded in part by [D22](#d22--what-r1-makes-testable-without-a-device)** — the seam is now
> `CameraSource`/`CameraSession` and the fake is `FakeCameraSource`. The split below still holds.

**Decision**: Everything above the platform seam is testable on the host:

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

# Revision R1 decisions (2026-07-26)

R1 changes how the application owns the camera. Unlike D1–D13, these decisions are made against
existing code, so each states the behaviour it replaces.

---

## D14 — The camera seam: a session, not a singleton

**Decision**: replace `HandLandmarkSource` with two interfaces — `CameraSource` (a capability:
`availableLenses()`, `open(CameraRequest)`) and `CameraSession` (a resource: `info`, `frames`,
`close()`). `close()` is total and idempotent; there is no intermediate "stopped but still holding"
state.

**What it replaces**: `HandLandmarkSource` has `start`/`stop`/`dispose`, is bound as an
**app-lifetime** `Provider`, and `CaptureScreen.dispose()` calls only `stop()`. The camera therefore
stays claimed for the rest of the application run — the concrete cause of the "camera already in use"
report behind FR-086/FR-087.

**Rationale**: the three-verb interface makes partial release *representable*, and anything
representable eventually happens. A session whose only terminal operation is `close()` cannot be left
half-released, and its lifetime is visible in the type: you hold a `CameraSession` or you do not.
This is also what FR-112 asks for in the abstract — a boundary expressed in lens position, preview
dimensions, mirroring, and lifecycle rather than in a platform's camera API — so one change satisfies
both the bug and the extensibility requirement.

**Alternatives considered**:

- *Keep the interface, fix the call site* (add `dispose()` to `CaptureScreen.dispose()`) — the
  smallest possible change. Rejected: it leaves the app-lifetime provider and the restartable-executor
  problem (D16) in place, so the second entry into the capture screen fails instead of the first, and
  FR-089's "unlimited enter/leave cycles" would still not hold.
- *Reference-counted singleton* — one long-lived camera with acquire/release counting. Rejected: the
  count is global mutable state by another name (Principle I), and a single missed release reproduces
  today's bug with more machinery in the way.

---

## D15 — Exactly one camera session, enforced in one place

**Decision**: `CameraSessionController` (application layer) is the only caller of `open`/`close`. It
serializes requests through a single slot with a monotonic **request token**: a new request supersedes
the pending one; an `open` that resolves with a stale token is closed immediately and never published;
`close` is always awaited before the next `open` starts.

**Rationale**: FR-092 (at most one session), FR-093 (leave while starting), FR-070 (rapid switching
converges on the last request), and FR-066 (release before acquire) are four statements of the same
invariant. Implementing them as four guards would leave four places to get the ordering wrong; the
token makes "the world moved on while I was starting" a single, testable condition. The controller
also owns the `WidgetsBindingObserver` reaction (FR-090/FR-091), because backgrounding is just another
request to release.

**Alternatives considered**:

- *A mutex around open/close* — serializes correctly but makes a superseded request **wait** for a
  camera it no longer wants, which is exactly the "leaving while starting" stall FR-093 forbids.
- *Guards in `CaptureScreen`* — where the logic lives today. Rejected: the constitution forbids
  business logic in widgets, and a screen the OS may recreate at any moment is the worst possible
  owner of a device resource.

**Consequence**: the controller's provider is `autoDispose` and scoped to the capture screen. Release
happens because ownership ended, not because a `dispose()` override remembered to do it.

---

## D16 — Native lifetime equals resource lifetime

**Decision**: `HandLandmarkerPlugin` builds a **fresh `CameraXController` per open** and drops it on
close. `start` gains a required `lensFacing` argument, and the preview size is read from
`SurfaceRequest.resolution` instead of constants.

**What it replaces**: one controller for the plugin's lifetime, where `stop()` unbinds the camera and
closes the detector but leaves the `SurfaceTextureEntry` alive, and `dispose()` calls
`analysisExecutor.shutdown()` — which is **not restartable**, so a controller can never serve a second
session. Preview resolution is hardcoded at `720×1280` regardless of what the device produces, which
is half of the stretched-preview bug (D20 is the other half).

**Rationale**: making the object's lifetime equal the resource's lifetime removes an entire class of
leak instead of patching the instances of it. Nothing has to remember to release the texture, because
the object that owns it is gone.

**Alternatives considered**:

- *Recreate the executor on each start* — fixes the executor and nothing else; the texture leak and
  the "which fields are still valid after stop?" question remain.
- *Reuse the controller and add a `reset()`* — a second lifecycle to keep correct alongside the first,
  for no benefit: opening a camera already costs hundreds of milliseconds, so allocating one small
  object per session is not measurable.

---

## D17 — Canonicalization: applied at the seam, to everything persisted

**Decision**: `CanonicalViewConverter` is a pure domain service applied to `CameraSession.frames` by
the controller, before any consumer sees a frame. For an unmirrored (rear-lens) source it maps
`x' = 1 − x` on every landmark, swaps the `left`/`right` handedness label, leaves `y`/`z`/`visibility`
untouched, and **never reorders the hands list** — each entry is converted in place.

**Rationale**: three separate points.

1. *Why handedness must flip*: MediaPipe derives the handedness label assuming a mirrored, selfie-view
   input image. Flipping the geometry without relabelling would produce a sample whose label names the
   wrong physical hand — the silent corruption FR-044 was written to prevent.
2. *Why normalization cannot absorb it*: `translation_scale` is a translation followed by a uniform
   scale. A reflection is neither, so a mirrored and an unmirrored capture of the same hand do **not**
   converge under normalization. This is the concrete reason FR-055 requires the conversion on every
   persisted landmark set rather than only the normalized one.
3. *Why in-place per hand satisfies FR-054*: converting each entry independently keeps each hand's
   landmarks with its own (relabelled) handedness. The list may no longer read left-then-right, but no
   entry ever acquires another hand's geometry — which is what "preserve identity rather than swapping
   the entries" means.

**Placement**: at the seam rather than inside `RunCaptureSession._buildSample`, so validation,
normalization, persistence, and any future consumer observe one convention. Converting later would let
the preview overlay and the stored data disagree about which side of the frame a hand is on.

**Naming**: the Dart field `HandSample.raw` becomes `canonicalRaw` (FR-056) while the serializer keeps
emitting the JSON key `"raw"` (FR-057). A test pins the divergence so a future reader does not
"correct" it and silently change the schema.

**Alternatives considered**:

- *Store the lens and let consumers correct for it* — rejected by the clarification session: every
  downstream consumer, present and future, would have to know the rule, and one that forgets produces
  a dataset that looks fine.
- *Convert only the normalized set* — leaves the earliest-stored set lens-dependent, so a future
  normalization strategy re-derived from it would inherit the split. Directly contrary to FR-055.

---

## D18 — Mode initializes the settings once; the session owns them after

**Decision**: `CaptureMode.selfCapture → CaptureProfile(front, mirrored, countdown on @ 3.0 s)` and
`CaptureMode.operatorCapture → CaptureProfile(rear, unmirrored, countdown off)`, both as
`CaptureConfig` data. `CaptureSettingsNotifier` holds the live settings and is re-initialized from the
profile **only when the mode changes**. Mirroring is derived from the active lens, not stored.

**Rationale**: FR-071, FR-073, FR-074, FR-079, and SC-032 are one rule stated five times — *nothing
but the user and a mode change may alter a setting*. Expressing it as a single re-initialization
trigger makes the guarantee structural. The notifier is scoped to the application run rather than to
the widget so that screen recreation (FR-091) cannot reset a user's countdown, and so FR-063's
"remember the most recent mode" needs no extra mechanism.

**Terminology** *(settled in R1.1 — the spec's Glossary now defines all three)*: **recording session**
(one press of Record — what the baseline confusingly called a "capture session"), **capture session**
(one visit to the capture screen: the settings and orientation scope; begins on entry or on a mode
change, survives lens switches, backgrounding, screen lock, and recreation), and **camera session**
(one device acquisition). The ambiguity this decision originally worked around — whether backgrounding
or a re-entry ends the settings scope — is now answered in FR-071: neither does; only a mode change
re-initializes. That is the only reading consistent with SC-032's **zero** unrequested changes.

**Alternatives considered**:

- *Lens-keyed countdown defaults* (front on, rear off, re-applied on every switch) — the reading the
  raw R1 input allowed, and explicitly rejected in clarification: it would silently undo a user's
  choice on every lens switch, which FR-074 now forbids in both directions.
- *Persisting settings across runs* — FR-075 puts this out of scope, and Principle VI would reject it
  as feature surface beyond the milestone.

---

## D19 — Where the R1 metadata lives

**Decision**: `position`, `mirrored_preview`, and `lens_facing` are added to `metadata.camera`;
`countdown_enabled` is added to `metadata.capture`. All four are additive, optional, and inside
existing blocks. `schema_version` stays `1`.

**Rationale**: `countdown_enabled` describes the take, not the lens, so it belongs beside
`countdown_seconds`. `lens_facing` is stored explicitly even though `metadata.camera.index` currently
holds the same integer, because `index` is an **engine-owned** field that Capture fills with a lens
constant by local convention (D5); FR-084 asks for the platform's identifier independently of that
convention, so it gets its own key. A test asserts the two agree, so the redundancy cannot drift into
a contradiction.

**Verified, not assumed**: `apps/engine/dataset/serializer.py` rebuilds samples by explicit key lookup
on plain frozen dataclasses — no `extra="forbid"`, no strict shape check. Unknown keys in these blocks
are ignored, so the engine reads R1 samples unmodified. The known consequence is that an engine
load-then-resave drops them, exactly as it already does for `session_uuid`; that is an engine-side
follow-up, recorded in `contracts/sample-json.md`.

**Countdown disabled**: `countdown_seconds` is `0.0` and `countdown_start_time` is the instant Record
was pressed — a zero-length countdown. No new nullability, no new type, and the engine's existing
default (`countdown_seconds: float = 0.0`) already means the same thing.

**Alternatives considered**:

- *A new top-level `capture_mode` block* — cleaner to read, but a new top-level key is a more visible
  schema change than additions inside blocks the engine already tolerates, for no functional gain.
- *Reusing `index` alone for FR-084* — rejected above: it couples a requirement to a local convention
  about someone else's field.

---

## D20 — The preview is sized by the camera, not by the screen

**Decision**: render as `Center → AspectRatio(previewAspect) → Stack(Texture, overlays)`, with the
ratio taken from the session's **actually reported, rotation-adjusted** preview dimensions.

**What it replaces**: `Texture` inside `Stack(fit: StackFit.expand)`. `Texture` is a leaf that fills
whatever constraints it receives, so it currently stretches to the screen — the reported distortion.
The hardcoded `720×1280` (D16) means even a correct ratio computation would use the wrong numbers.

**Rationale**: `AspectRatio` inside a `Center` produces letterboxing or pillarboxing as a consequence
of layout, with the neutral bands being the container's own background — no branching on which
dimension is constrained, no way to get one orientation right and the other wrong. Making the overlays
children of the same box makes FR-101's alignment structural rather than a coordinate calculation
somebody must keep correct.

**Rotation**: CameraX reports resolution in sensor orientation, so a portrait phone consuming a
landscape sensor stream must swap the axes. *(Corrected by D23: the native side was found to report
sizes it had **itself** already swapped, using a rotation guess that ignored sensor orientation and
lens facing — while never rotating the buffer or the landmarks. D23 moves the swap to Dart, driven by a
correctly computed `rotationDegrees`, so there is exactly one rotation decision instead of two that
could disagree.)*

**(R1.1)** The ratio is computed **once per camera session** and is safe to cache because FR-049 now
locks orientation for the whole capture session, not merely for a take. The analysis pass caught this:
R1's persistent screen would otherwise have allowed rotation *between* takes, invalidating both the
cached ratio and the frame geometry. Widening the lock removes the case; the alternative — recomputing
the aspect on rotation and re-deriving geometry mid-capture-session — is strictly more machinery for a
case the product does not need.

---

## D21 — The capture screen is a loop, not a one-shot

**Decision**: `SummaryState` returns to `Idle` with the camera still held (FR-076), gated by the
take-confirmation setting (FR-077/FR-078). The capture screen gains the reference image, progress,
Sync, and a control bar for mode, lens, countdown, and confirmation. The **home screen is unchanged**.

**Rationale**: the requested layout (progress, Record, and Sync permanently on screen) only makes sense
if the screen persists across takes — which is also what stops the camera being torn down and
reacquired once per take, the single largest threat to SC-001. FR-006/FR-007 were not revised, so home
keeps its own Record and Sync; home's Record navigates to capture, capture's Record starts a take. The
overlap is specified, not accidental.

**What it replaces**: `_onEnded()` calls `Navigator.maybePop()` from three paths — cancellation,
summary dismissal, and the close button — so every take currently ends by leaving the screen and
dropping the camera.

---

## D22 — What R1 makes testable without a device

**Decision**: `FakeCameraSource` (scriptable lens set, scripted frames, injectable open failures and
delays) replaces `FakeHandLandmarkSource`, so the following are host-verifiable:

- the single-session invariant, superseded-start teardown, and rapid-switch convergence (D15);
- canonicalization: self/operator agreement on handedness and geometry (SC-031);
- settings ownership: mode initializes once, and no lens switch, background, or take changes the
  countdown (SC-032);
- the session loop with and without take confirmation;
- preview letterbox/pillarbox geometry and layout at the smallest supported size, via widget tests at
  several surface shapes;
- R1 metadata serialization, and pre-R1 golden fixtures still loading (SC-026).

**(R1.1)** Two of these become **automated guards** rather than ordinary tests, because both protect
properties that decay silently:

- a **layer-boundary architecture test** asserting camera code never touches storage and storage never
  touches camera (FR-115). A boundary nobody checks is a boundary that drifts, and this one has no
  visible symptom until it is expensive to undo.
- a **full-pipeline integration test** driving camera init → capture → validation → storage → export
  entirely through `FakeCameraSource` (FR-116, SC-030), so the no-hardware claim is verified end to
  end rather than inferred from the fact that unit tests happen to use a fake.

**Hardware-only, stated plainly**: release within 1 s (SC-019), another app acquiring the camera
(SC-020), 20 enter/leave cycles (SC-018), zero busy errors over 30 minutes (SC-021), lens switch under
1.5 s (SC-024), and the square-object undistortion check (SC-022). These six are the reason
FR-116/SC-030 exist — the workflow around them is provable without a camera even though they are not.

---

## D23 — One coordinate transform, from analysis space to display space (bug fix, 2026-07-27)

**Symptom reported**: the debug overlay (R2) revealed that landmarks were not aligned with the camera
preview — mirrored on some paths, rotated on others, on both lenses. Recognition still worked (it never
touched the preview), which was the first clue this was a **rendering** bug, not a detection one.

**Root cause, audited layer by layer** (camera sensor → preview surface → mirroring → rotation before
inference → MediaPipe's normalized output → Dart decoding → `CustomPainter`): two independent bugs,
both caused by the same structural gap — nothing in the codebase decided the analysis-space →
display-space transform **once**, so the preview and any overlay could each get it wrong differently.

1. **Rotation was decided twice, and applied nowhere.** `CameraXController.resolutionRotation()`
   computed a rotation guess from `Display.rotation` alone — ignoring `CameraCharacteristics
   .SENSOR_ORIENTATION` and lens facing entirely — and used the result **only** to relabel
   `previewWidth`/`previewHeight` before they reached Dart. The actual pixel buffer handed to the
   `SurfaceTexture` (`setDefaultBufferSize(resolution.width, resolution.height)`) was never rotated,
   and neither was the bitmap MediaPipe analyzed (`analyze()` builds it straight from
   `imageProxy.planes[0].buffer`, no `ImageProcessingOptions` rotation). Landmarks therefore stayed in
   raw sensor-orientation space while `PreviewStage` sized its box from a differently (and sometimes
   wrongly, since the formula ignored sensor/lens facts) rotated pair of numbers.
2. **Mirroring was read from the wrong stream.** The only mirror transform in the app is
   `CanonicalViewConverter` (`x' = 1-x`, rear lens only) — a **dataset-storage** convention ("every
   stored sample looks like the mirrored front camera"), applied unconditionally to
   `CameraSessionController.frames`. The original debug overlay (R2) was wired to that same stream for
   **on-screen rendering**. For the rear lens this mirrors the drawn landmarks while nothing mirrors
   the rear lens's actual (correctly unmirrored) preview pixels — a **guaranteed** misalignment,
   independent of any device quirk. The pre-existing recognition effect anchor (`_anchorFor`,
   `recognition_preview_screen.dart`) had the identical bug, just never surfaced because a demo-quality
   effect's few-pixels-off placement is far less obvious than an overlay drawn directly on the hand.

**Decision**: introduce `DisplayOrientation` (`lib/domain/canonical/display_orientation.dart`) as the
**single** place both facts are decided — `quarterTurns` (0–3, derived from a validated
`rotationDegrees`) and `mirrored` (from `CameraSessionInfo.mirroredPreview`, i.e. `lens == front`,
**never** from the canonical stream). It exposes two pure functions: `mapPoint` (rotate, then mirror —
the same order for both consumers) and `mapSize` (axis swap on odd quarter turns). Every renderer
consumes it identically:

- `PreviewStage` wraps the `Texture` in `RotatedBox(quarterTurns: ...)` — a **layout-time** rotation, so
  the raw buffer is given analysis-space constraints and the *rotated result* fills the display-shaped
  box, unlike a paint-only `Transform.rotate` which would leave it over/underfilling the box — then, if
  mirrored, an outer `Transform` (horizontal flip, applied **after** rotation, matching `mapPoint`'s
  order).
- `HandLandmarkPainter` calls `mapPoint` per landmark before scaling to pixels.
- The recognition effect anchor (`_anchorFor`) calls the same `mapPoint`.

**What stays untouched, deliberately**: the bitmap MediaPipe analyzes, the `detectAsync` call, and every
landmark coordinate `HandLandmarkerPlugin.emitFrame` sends — recorded samples and recognition matching
(`RecognitionSessionController.process`, exemplar comparison) all operate on
`CameraSessionController.frames` (the canonical, dataset-convention stream) exactly as before. This is
what keeps "recognition behaviour unchanged" true: the fix is scoped entirely to **display** consumers,
which is where the bug actually lived. A new `CameraSessionController.rawFrames` stream (fed from the
same single platform subscription as `frames`, so adding it costs one more independent broadcast
listener, not a second platform subscription) carries pre-canonicalization frames for exactly these
display consumers to use instead.

**Native-side correction (not touching MediaPipe's input)**: `CameraXController` now computes
`rotationDegrees` via the standard Camera2 formula —
`(sensorOrientation ± deviceRotationDegrees) % 360`, sign depending on lens facing — reading
`CameraCharacteristics.SENSOR_ORIENTATION` per camera rather than assuming it. `previewWidth`/
`previewHeight` are now reported **raw** (un-swapped), matching the analysis frame's own orientation, so
Dart performs the *only* rotation-aware swap, once, in `DisplayOrientation`. See
`contracts/camera-channel.md`'s *Preview dimensions* section for the wire-contract-level writeup.

**Verified without hardware**: `DisplayOrientation`'s point/size math is unit-tested for all four
rotations combined with mirrored/unmirrored (`test/domain/canonical/display_orientation_test.dart`).
`PreviewStage`'s actual `RotatedBox`/`Transform` composition is verified against real Flutter layout —
not just the math in isolation — via `tester.getRect()` assertions at each rotation
(`test/presentation/preview_stage_test.dart`), proving the widget-level and point-level halves of the
transform agree. `CameraSessionController.rawFrames` is verified to carry a rear-lens frame
**unmirrored** while `frames` carries the same frame mirrored, from one emission
(`test/application/camera_session_controller_test.dart`). **Hardware-only, stated plainly**: whether the
*visual* result looks correct on a real device — the six-layer chain from sensor mounting through
`RotatedBox` compositing can only be fully confirmed by eye, on hardware, across at least one device per
lens-facing/sensor-orientation combination available.

**(Update, same day) D23 did not fix the bug.** On-device testing after D23 shipped showed the debug
overlay's landmarks still misaligned with the preview. D23's architecture (one shared
`DisplayOrientation` transform, `rawFrames` instead of the canonical stream) was not wrong on its own
terms, but it was **built and shipped without a single piece of hardware verification** — every claim
about rotation direction, the preview/analysis relationship, and the sensor's mirroring behavior was
reasoned from documentation and code reading, never measured. D24 below is the correction: stop
theorizing, verify what can be verified without hardware, and build the instrumentation to verify the
rest on hardware, instead of shipping another guess.

---

## D24 — Coordinate-pipeline investigation: what's proven, what's assumed, and how to tell them apart

**Trigger**: D23 shipped a full analysis-space → display-space transform, but the debug overlay's
landmarks are still visually misaligned with the preview on a real device. This entry does three
things: (1) audits every coordinate space in the pipeline precisely enough to build a transformation
table, (2) states plainly which parts of that table are **proven** (verified by an executable test in
this environment) versus **assumed** (architecturally reasonable, never measured), and (3) documents
the instrumentation added so the assumed parts can be measured on hardware without more guessing.

**No architecture changed for this entry.** Per the explicit instruction that produced it: the camera
preview, dataset canonicalization, recording, and recognition are untouched. Only three things were
added, all inert until a developer opts in: two Logcat/console log lines, and one new, independently
toggleable visual layer (`CoordinateDebugPainter`).

### The coordinate spaces, stage by stage

| # | Stage | Width × Height | Rotation applied here | Mirror applied here | Origin | +X direction | +Y direction |
|---|---|---|---|---|---|---|---|
| 1 | Camera sensor (physical) | fixed per camera, not software-observable | — (this *is* the rotation reference: `CameraCharacteristics.SENSOR_ORIENTATION`) | none (mirroring is a display convention, not a sensor property) | sensor-defined | sensor-defined | sensor-defined |
| 2 | `ImageAnalysis` buffer fed to MediaPipe | `imageProxy.width × imageProxy.height` (`CameraXController.analyze()`) | **none** — `imageInfo.rotationDegrees` is computed by CameraX but never read | **none** — raw HAL output, copied byte-for-byte into a `Bitmap` | top-left | → right | ↓ down |
| 3 | MediaPipe normalized landmarks | normalized `[0,1]` against stage 2's exact bitmap | same as stage 2 (MediaPipe was given no `ImageProcessingOptions`) | same as stage 2 | top-left | → right | ↓ down |
| 4 | Dart `LandmarkFrame` (raw, `rawFrames`) | `frame.frameWidth × frame.frameHeight`, decoded verbatim from stage 3's wire payload | same as stage 3 | same as stage 3 | top-left | → right | ↓ down |
| 5 | `DisplayOrientation.mapPoint` output ("display space") | normalized `[0,1]` in the preview widget's own box | `quarterTurns` clockwise turns from `rotationDegrees` — **direction verified**, see below | horizontal flip **after** rotation, from `CameraSessionInfo.mirroredPreview` (`lens == front`) — **never** from `CanonicalViewConverter` | top-left | → right | ↓ down |
| 6 | Preview `Texture` (raw buffer) | `previewWidth × previewHeight` (`CameraXController`'s `Preview` use case — **independently resolution-selected from stage 2's `ImageAnalysis`**, no shared `ViewPort`) | **none** — same as stage 2's non-treatment, by construction (same `setDefaultBufferSize`-then-untouched pattern) | none | top-left | → right | ↓ down |
| 7 | `PreviewStage`'s displayed box | `AspectRatio` sized from stage 6's dims run through `DisplayOrientation.mapSize` | `RotatedBox(quarterTurns)` — **direction verified**, see below | `Transform.scale(-1,1)` after the `RotatedBox`, same order as stage 5 | top-left | → right | ↓ down |
| 8 | Flutter canvas (`HandLandmarkPainter`/`CoordinateDebugPainter`) | `CustomPaint`'s `size`, same box as stage 7 | none (painting only multiplies stage 5's already-rotated fraction by pixels) | none | top-left | → right | ↓ down |

### One landmark's journey (worked example)

A landmark MediaPipe reports at analysis-space `(0.2, 0.7)` — near the *left* edge, *lower* half of
the raw buffer — on a session with `rotationDegrees = 90`, front lens (`mirrored = true`):

1. Stage 3/4: `(0.2, 0.7)`, unchanged from what MediaPipe computed.
2. Stage 5, rotation (`quarterTurns = 1`, the 90°-clockwise case `(x,y) → (1-y, x)`):
   `(1 - 0.7, 0.2) = (0.3, 0.2)`.
3. Stage 5, mirror (`mirrored = true`, horizontal flip `(x,y) → (1-x, y)`):
   `(1 - 0.3, 0.2) = (0.7, 0.2)`.
4. Stage 8: multiplied by the `CustomPaint`'s actual pixel size, e.g. `(0.7, 0.2) × (720, 1280) =
   (504, 256)`.

This exact sequence is what `test/domain/canonical/display_orientation_test.dart`'s
`'90° + mirrored: rotates first, then flips the rotated x'` test asserts numerically, and it is what
the new `[coord-debug]` log line prints per landmark at runtime (see *Instrumentation* below) — so the
same computation can be read straight from a running device's console rather than re-derived by hand.

### What is **proven** (verified by an executable test in this environment, not assumed)

1. **`RotatedBox(quarterTurns: 1)` rotates clockwise**, and specifically: the child's own local
   top-left corner is rendered at the parent box's top-right; the child's local top-right corner at the
   parent's bottom-right. Measured directly via `tester.getRect()` on a marker widget — ground truth
   from Flutter's actual layout engine, not read from documentation. This was **never checked before
   D23 shipped**; the existing `preview_stage_test.dart` rotation tests only verified the bounding
   box's *aspect ratio*, which cannot distinguish a correct rotation from one rotated 180° wrong.
2. **`DisplayOrientation.mapPoint`'s quarterTurns=1 formula, `(x,y) → (1-y,x)`, predicts exactly
   where `RotatedBox` sends a point** — the ground-truth corners above match the formula's output for
   `(0,0)` and `(1,0)` precisely. The point-math and the widget-math agree.
3. **Mirroring via `Transform.scale(-1,1)` does not change the computed bounding `Rect`** (proven
   algebraically: `Rect.fromPoints` normalizes its two corner arguments regardless of which physical
   corner each one lands on after a flip) and is consistent with `preview_stage_test.dart`'s FR-101
   alignment test passing both before and after mirroring is applied.
4. **`mapPoint` can never move a point off the unit square** — every one of its four cases is built
   only from `x`, `y`, `1-x`, `1-y`, so it is a pure permutation/reflection, structurally incapable of
   representing a *scale* or *crop*. This matters: if the real bug is a scale/crop mismatch (see below),
   **no combination of rotation and mirroring in the current architecture can fix it** — confirming the
   instruction not to "add another rotation layer" is correct engineering advice, not just a constraint.
5. **The debug overlay reads `rawFrames`, not the canonical stream** — `frame` sent to the painter is
   provably distinct from what `RunRecordingSession`/`RecognitionSessionController` match against, for
   the rear lens specifically (`camera_session_controller_test.dart`'s `rawFrames bypasses
   canonicalization` group).

### What is **assumed** — never measured, and the leading unruled-out hypotheses

1. **Whether the computed `rotationDegrees` is actually correct on the reporting device.** The Camera2
   formula (`CameraXController.requiredRotationDegrees`) is textbook-standard, but its two inputs —
   `CameraCharacteristics.SENSOR_ORIENTATION` and the display's rotation at bind time — have never been
   observed on real hardware in this codebase's history. A wrong value here would produce **rotation and
   mirror errors that look identical to a formula bug**, because everything downstream trusts it blindly.
2. **Whether `Preview` and `ImageAnalysis` see the same field of view.** `CameraXController.open()` binds
   them with `provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)` — **no shared
   `ViewPort`**. Without one, CameraX independently selects a resolution for each use case from the
   camera's supported output sizes, and gives **no guarantee they share an aspect ratio or crop window**.
   `Preview.Builder().build()` requests no particular resolution at all; `ImageAnalysis.Builder()`
   explicitly requests `analysisSize` (e.g. `480×640`, aspect `0.75`). If CameraX picks a *different*
   aspect ratio for `Preview` (very plausible — phone camera sensors are commonly closer to `4:3` or
   `16:9`), then a landmark normalized against the **full extent** of the analysis frame does not
   correspond to the same physical point in the preview's **differently-cropped** extent — a mismatch
   that gets *worse toward the frame's edges and is near-invisible at dead center*, which is a
   distinctive, checkable symptom (see *How to read the new tool's output* below). **This is the
   leading hypothesis**, and it is structurally exactly what `mapPoint` (point 4 above) cannot
   represent or fix — a scale/crop term, not a rotation, would be required, and per the explicit
   instruction accompanying this investigation, no such term has been added without hardware evidence
   that it is actually needed.
3. **Whether the front camera's raw sensor buffer is naturally "mirrored" before MediaPipe sees it.**
   Every existing document (`contracts/camera-channel.md`, `data-model.md`, `landmarks.dart`'s own doc
   comments) states this as fact — "the front lens produces a mirrored image" — but no code anywhere
   (native or Dart) actually applies a mirror to a pixel before this point; it has only ever been
   asserted. If false on a given device, the wrist/finger landmarks would still land in roughly the
   right *rotated* position but on the *wrong physical hand* relative to the preview.

None of these three can be resolved by more reasoning — they are empirical questions about what a
specific piece of camera hardware and CameraX's resolution-selection algorithm actually do. That is
exactly why this entry ships instrumentation instead of a fourth guess.

### Instrumentation added

**Kotlin (`CameraXController.kt`), `Log.d("coord-debug", …)`, two call sites**:

- Inside `requiredRotationDegrees`: `lensFacing`, `sensorOrientation`, `deviceRotationDegrees`, and the
  computed `rotationDegrees` — isolates hypothesis 1 above to one Logcat line.
- Inside `open()`, once preview binding resolves: the raw `preview` and `requestedAnalysis` dimensions
  side by side, plus `rotationDegrees` — isolates hypothesis 2 above (compare the two aspect ratios
  directly).

Filter Logcat for `coord-debug` to see both.

**Dart (`HandLandmarkDebugOverlay`)**, throttled to at most once per second while the new coordinate
diagnostics toggle is on: lens, `mirroredPreview`, `rotationDegrees`, `quarterTurns`, raw and analysis
buffer sizes, the actual per-frame `frameWidth`/`frameHeight`, and — per hand — landmarks #0/#5/#17's
raw and display-space coordinates (the exact computation the worked example above walks through).
Prefixed `[coord-debug]`; grep to find or remove every line this entry added, native or Dart.

**Visual (`CoordinateDebugPainter`, `presentation/debug/`)**, toggled independently of the ordinary
skeleton view via a second app-bar icon (`CoordinateDebugToggleButton` /
`coordinateDebugEnabledProvider`), so the two can be shown separately:

- **Canvas bounds** (yellow outline): the `CustomPaint`'s actual paintable rectangle.
- **"Image rect"** (cyan outline + labeled `TL`/`TR`/`BR`/`BL` corners): the unit square's four corners
  mapped through the current `DisplayOrientation`. Under today's rotate-and-mirror-only transform this
  is mathematically guaranteed to coincide exactly with the canvas bounds (point 4 above) — it is drawn
  anyway so this tool remains useful if a scale/crop term is ever added, and so its *coincidence* today
  is a visible, checkable fact rather than a silent assumption.
- **Axes** (red = analysis +X, green = analysis +Y): short arrows from the mapped analysis origin,
  showing which screen direction each analysis axis currently maps to.
- **Landmarks #0 (wrist), #5 (index MCP), #17 (pinky MCP)**: large, labeled, high-contrast markers —
  chosen because they are spread across the palm rather than clustered on one finger, so a rotation,
  mirror, or scale error reads unambiguously between them.

### How to read the new tool's output (the decision tree the instruction asked for)

Enable both toggles, hold one hand steady in frame, and compare the drawn markers against the real hand
visible in the preview behind them:

- **The whole skeleton is rotated 90°/180°/270° from the hand, but its size and position relative to
  the frame center look otherwise proportionate** → hypothesis 1 (wrong `rotationDegrees`). Check the
  Kotlin `coord-debug` log's `sensorOrientation`/`deviceRotationDegrees`/computed `rotationDegrees` for
  this device against what the device's actual sensor-mount and current orientation should produce.
- **The skeleton is a left-right mirror image of the real hand (right hand's landmarks trace the left
  hand's outline)** → hypothesis 3 (front-camera mirroring assumption false on this device), *or* a
  `mirroredPreview` bug — check whether the `+X (analysis)` axis arrow points toward the same side as
  the real hand's thumb does when the hand is held with the palm facing the camera in the expected way.
- **Rotation and mirroring both look qualitatively right, but landmarks drift further from the real
  hand's position the closer they are to the frame's edge (dead center is fine)** → hypothesis 2 (the
  Preview/ImageAnalysis field-of-view mismatch). Compare the Kotlin log's `preview=W×H` and
  `requestedAnalysis=W×H` aspect ratios directly — if they differ, this is confirmed, and the correct
  fix (per the instruction that authorized it) is a crop-compensation **scale and translate** term added
  to `DisplayOrientation`, computed from the two *actually observed* aspect ratios at runtime — never a
  rotation or mirror change, and never a hardcoded ratio, since the CameraX-selected `Preview` resolution
  is device-dependent.
- **The cyan "image rect" does not coincide with the yellow canvas bounds** → should be structurally
  impossible today (point 4 above); if observed, it means either this analysis is wrong or something
  else in the render tree is scaling the `CustomPaint` unexpectedly — worth its own investigation before
  trusting anything else in this table.

---

## D25 — Developer camera calibration panel (2026-07-27, same day)

**Trigger**: D24's instrumentation reached the field before this entry — a screenshot showed **two**
independent symptoms: (1) the preview itself is visibly rotated 90° even in portrait, and (2) the
overlay still doesn't align with the preview even accounting for that. Two bugs, not one, and D23/D24's
reasoning-first approach had already been tried twice without success. The instruction that produced
this entry is explicit: stop hypothesizing, build a tool that lets a developer determine the answer
**empirically, by hand, on the device**, and change nothing else until that tool has been used.

**What this is not**: not a third automatic fix. Camera preview rendering, `DisplayOrientation`,
`CanonicalViewConverter`, recording, and recognition are **all untouched** by this entry — confirmed by
diff, not just by intent. No Kotlin, no CameraX binding, no MediaPipe call was touched.

**What this is**: `CameraCalibrationScreen` (`presentation/debug/camera_calibration_screen.dart`), a new
developer-only screen (`!kReleaseMode`-gated, reachable via a third app-bar icon on the capture and
recognition screens, alongside the existing two debug toggles) that exposes **every** display transform
as a live, independently-adjustable control:

| Preview | Overlay |
|---|---|
| Rotation (0°/90°/180°/270°) | Rotation (0°/90°/180°/270°) |
| Mirror | Mirror |
| Fit (contain/cover/fill) | Swap X/Y |
| | Scale |
| | X offset |
| | Y offset |

Both halves render through **fully manual, standalone pipelines** (`_ManualPreview` for the texture,
`_CalibratedOverlayPainter`/`OverlayCalibration.mapPoint` for the landmarks) that share nothing with
`PreviewStage` or `DisplayOrientation` — deliberately, so nothing this screen does can affect, or be
affected by, the automatic rendering path a normal user sees. `OverlayCalibration.mapPoint`'s operation
order is fixed and documented: swap X/Y, then rotate, then mirror, then scale about center, then
translate — the exact order a developer's found values must be read back in.

**Camera reuse, not reacquisition**: this screen never calls `CameraSessionController.request()`. It
reads the controller **already live** on whichever screen opened it — `cameraSessionControllerProvider`
is a singleton for the app run, kept alive by `ref.listenManual` on both the parent screen and this one,
so pushing this screen on top acquires nothing new and releases nothing on the way back. This is what
keeps "camera preview behaviour remains unchanged" true even while this screen is open elsewhere in the
app: nothing about camera acquisition, lifecycle, or the screen underneath changes.

**Current values are always on screen** (a banner over the preview, `Preview: rot=… mirror=… fit=…` /
`Overlay: rot=… mirror=… swapXY=… scale=… dx=… dy=…`) and reproducible on demand (a toolbar button opens
a dialog with the same text as `SelectableText`, so a developer can read the winning combination back
without leaving the app). Values persist across leaving and reopening the screen within one run
(`cameraCalibrationProvider`, scoped to the application run like every other debug toggle) — the point is
iterative, in-hand experimentation without losing progress.

**How the result feeds back**: once a developer finds the combination that makes the overlay land
exactly on the hand in the preview, those four to seven numbers (per half) are the ground truth D23/D24
were missing. The **preview** half's winning values point directly at what `requiredRotationDegrees`
and/or the raw `previewWidth`/`previewHeight` reporting need to become on the Kotlin side (or, if `fit`
turns out to matter, that `PreviewStage`'s letterbox/pillarbox assumption itself is wrong). The
**overlay** half's winning values point at what `DisplayOrientation.mapPoint` needs to become — and if a
non-trivial `scale`/`offsetX`/`offsetY` is required, that is direct, measured evidence for D24's
leading hypothesis (`Preview`/`ImageAnalysis` field-of-view mismatch), not another guess. This screen and
every temporary file it touches are deleted once that real fix ships.

**Verified without hardware**: `OverlayCalibration.mapPoint`'s fixed operation order is unit-tested
exhaustively — each control in isolation, plus one combination that would produce a different answer
under any other order (`test/application/debug/camera_calibration_notifier_test.dart`).
`CameraCalibrationNotifier` is tested for independence (preview controls never touch overlay state and
vice versa) and for reset. `CameraCalibrationScreen` is tested end to end against a fake camera session
already live — every control renders, tapping/dragging one updates only its own half, and the screen
never itself calls `request()` (`test/presentation/debug/camera_calibration_screen_test.dart`).

**A test-authoring pitfall worth recording**: the screen's widget tests originally built their
`ProviderContainer` inside `setUp()`, following this file's usual convention — and every test that
acquired the camera **hung for the full ten-minute test-runner timeout**, with the underlying
`CameraSessionController` silently stuck in `CameraClosed` even after twenty stepped pumps. The same
container, built **inline inside the `testWidgets` body** instead of `setUp()`, resolves to `CameraLive`
on the very first pump. The precise mechanism wasn't chased down further (a `package:test` `setUp`/test
zone boundary interacting with Riverpod's `ProviderContainer` is the leading suspect, but unconfirmed) —
what matters operationally is documented on `_Harness` in the test file: build the container inline, per
test, never via `setUp`/`late` fields, for any future test needing a `Provider.autoDispose` acquired
outside the widget under test.

**Hardware-only, stated plainly**: whether any particular combination of these controls actually
produces alignment on a real device — that is the entire question this tool exists to answer, and
nothing in this entry claims an answer. Quickstart rows 63+ are the procedure.

---

## D26 — Persistent per-device calibration system (2026-07-28)

**Trigger**: D25's calibration screen was used on the reference device, by hand, and a working
combination was found:

| | Front | Rear |
|---|---|---|
| Preview rotation | 0° | 0° |
| Preview mirror | false | false |
| Preview fit | contain | contain |
| Overlay rotation | 270° | 90° |
| Overlay mirror | true | true |
| Overlay swap X/Y | false | false |
| Overlay scale | 0.75 | 0.75 |
| Overlay X/Y offset | 0.00, 0.00 | 0.00, 0.00 |

The instruction that produced this entry changes strategy rather than continuing it: stop trying to
derive one universal transform for every Android device from a formula (D23's approach, twice
disproven), and stop treating the calibration screen as a disposable diagnostic (D25's framing). Instead,
make the values above this device's **default**, persist them per lens and per device, and keep the
calibration screen permanently available so any future device can find and keep its own. Explicit
constraint carried over from D25: `CameraXController.kt` and the native camera pipeline stay untouched —
there is still no evidence CameraX itself is wrong, and the remaining device-specific differences are
fully absorbed by calibration.

**What this is**: `domain/canonical/camera_calibration.dart` adds `CameraCalibration` (the nine fields
above, flat, JSON-serializable — `previewFit` uses a domain-local `PreviewFit` enum rather than `BoxFit`,
since `domain/` may import no Flutter package at all) and `CameraCalibrationSet` (front + rear,
`.defaults` = the table above). A new port, `CalibrationStore`, is implemented by
`infrastructure/storage/file_calibration_store.dart`, writing one JSON document to `<storage
root>/calibration.json` — deliberately a **sibling** of `datasets/`, never inside it, so neither the
exporter nor the integrity validator can ever see it; a corrupt or hand-edited file degrades to "nothing
saved" (falls back to defaults) rather than blocking startup.
`application/debug/camera_calibration_notifier.dart` is now an `AsyncNotifier<CameraCalibrationSet>`:
`build()` loads via the store, falling back to `.defaults`; every setter takes an explicit `LensPosition`
and both updates the in-memory state and persists it in the same call, so "change a value → the preview
or overlay updates immediately → it is saved" needs no separate save action anywhere in the design.

**The actual behavior change**: `PreviewStage` and `HandLandmarkPainter` — the widgets `CaptureScreen` and
`RecognitionPreviewScreen` actually render with — now take a `CameraCalibration` directly and use it for
every rotation/mirror/fit/landmark-mapping decision, **replacing** `DisplayOrientation.fromSession(info)`
as their input. This is the qualitative shift from D25: previously the calibration screen was a read-only
instrument sitting beside a still-automatic production path; now the values it edits *are* the production
path. `DisplayOrientation` itself is untouched and still exists, but its only remaining production-facing
consumer is the independent D24 coordinate-debug diagnostic (`CoordinateDebugPainter` + the throttled
console log) — kept deliberately as the "what a formula alone would have guessed" comparison, never again
as the thing that decides what a real user sees.

**The calibration screen was simplified, not just extended.** D25 built `_ManualPreview` and
`_CalibratedOverlayPainter` specifically to avoid touching production rendering while experimenting — a
deliberate, sound choice at the time. Now that the values found there are the production values, keeping
two separate implementations would risk exactly the kind of drift D23–D25 spent so much effort chasing:
a value tuned against one geometry silently meaning something different rendered through another. So the
screen was rewired to render through `PreviewStage`/`HandLandmarkPainter` directly — the same widgets, the
same code path, no second implementation left to drift. Added: a Reset action (resets only the lens
currently live on the screen, never the other one), an Export dialog (the whole two-lens set as
indented, selectable JSON text), and an Import dialog (a paste field; malformed input is caught, shown
inline as an error, and leaves the previously active calibration completely untouched — the dialog stays
open rather than closing on failure).

**A consequence worth stating plainly, not burying**: because the calibration screen's overlay used to
paint over the *entire* preview pane (a `Stack.expand` sibling of its own separately-fitted texture), and
because the values above were found against exactly that geometry, `PreviewStage`'s `overlays` list is
now **also** scoped to the full pane rather than the letterboxed image sub-rect it was confined to before
this entry. This is a real, disclosed change to a previously-tested guarantee
(`preview_stage_test.dart`'s FR-101 test), not an oversight — nesting the overlay inside the texture's own
fitted sub-rect instead would have silently changed what `overlayScale`/`overlayOffsetX`/`overlayOffsetY`
mean, which is precisely the kind of change [[feedback-verify-before-architecting-visual-bugs]] warns
against making without hardware confirmation. `spec.md`'s FR-101 was revised (not left stale) to name the
developer overlay as the documented exception; every other overlay (countdown, capture indicator, take
summary, prediction HUD, effect playback) is unaffected in practice since all of them are already centered
content, but the structural guarantee they relied on is not there anymore either, which is now
documented rather than implicit.

**Verified without hardware**: `CameraCalibration.mapOverlayPoint`'s fixed operation order (swap → rotate
→ mirror → scale → translate) carries over D25's exhaustive unit tests unchanged in substance
(`test/domain/canonical/camera_calibration_test.dart`). `FileCalibrationStore` round-trips save/load,
overwrites rather than appends, writes outside `datasets/`, and degrades a corrupt file to `null`
(`test/infrastructure/calibration_store_test.dart`). `CameraCalibrationNotifier` is tested for per-lens
independence, immediate persistence, `resetLens` scoping, and import success/failure
(`test/application/debug/camera_calibration_notifier_test.dart`). `PreviewStage` gained `cover`/`fill`
fit tests (previously untested, since the pre-R3 implementation only ever behaved like `contain`) using
`getRect()` rather than `getSize()` — `getSize()` reports the pre-transform local size and cannot see the
`FittedBox` scale R3 introduced (`test/presentation/preview_stage_test.dart`).

**A real bug the analyzer caught during this work, worth recording**: the calibration screen's import
dialog originally declared its `String? error` **inside** the `StatefulBuilder`'s rebuilding `builder:`
closure. Every time `setDialogState` triggered a rebuild (exactly the call made after catching a parse
failure), that closure re-ran from the top, re-declaring `error = null` before the dialog was rebuilt —
so the error message could never actually appear, only the *code path that would have set it* ran.
`dart analyze`'s `unnecessary_null_comparison`/`unnecessary_non_null_assertion` lints on the *consuming*
code caught this immediately (the analyzer could prove `error` was always `null` at that point in the
same build). Fixed by hoisting the declaration to the enclosing `showDialog` closure, which survives
across `StatefulBuilder` rebuilds. Worth generalizing: a `StatefulBuilder`'s mutable local state must live
**outside** its `builder:` callback, never inside it.

**Hardware-only, stated plainly**: the numbers above are unchanged from what was found on the reference
device, but the code path carrying them changed shape — from D25's standalone, calibration-screen-only
pipeline to the shared production pipeline `CaptureScreen`/`RecognitionPreviewScreen` now also use. Per
[[feedback-verify-before-architecting-visual-bugs]], that is a claim this environment cannot verify by
reasoning alone. An on-device check that the preview and overlay still look correct after this change —
not just that the numbers are unchanged — is the prerequisite for closing this out completely.

---

## Open risks

| Risk | Impact | Mitigation |
|---|---|---|
| Native binding cannot be compiled or run in the current environment (no device/emulator, Android licenses unaccepted) | Kotlin path unverified until hardware is available | All Dart layers are fully testable without it; the binding is isolated behind one interface so iteration is contained to two files |
| MediaPipe Tasks version drift between engine (Python) and capture (Android) | Subtle landmark differences | `versions.mediapipe` is recorded in every sample, making drift detectable in the dataset itself |
| Sustained detection rate on low-end devices below ~20 fps | Fewer than 20 samples per press (SC-002) | Capture window duration is configuration, not code; it can be lengthened per device class without a release |
| `archive` throughput on very large datasets | Slow export | Streaming encoder in an isolate; `DatasetExporter` interface allows swapping in a native zip implementation |
| **(R1)** The six hardware-only criteria cannot be verified in this environment | The leak R1 exists to fix is unproven until a device is available | Everything around them is host-tested (D22); the release path is one method on one object, and FR-096's structured `camera_released` records (with reason) make a field diagnosis possible from logs alone |
| **(R1)** Handedness relabelling is wrong for some device/detector combination | Rear-lens samples would be mislabelled — the exact corruption FR-044 guards against | SC-031 is an explicit on-device check (same hand, both modes, must agree); until it passes on hardware, Operator Capture is not trustworthy for collection. `metadata.camera.position` makes any affected samples identifiable and re-correctable after the fact |
| **(R1)** Rear-lens field of view and focal length differ from the front lens | Landmark geometry may differ systematically between modes beyond mirroring | Normalization is translation+scale, which removes most of it; SC-031's tolerance is the acceptance bar. `position` is recorded per sample, so a residual difference stays measurable in the dataset rather than hidden |
| **(D23, superseded by D24)** `requiredRotationDegrees`'s Camera2 formula is standard but unverified on real hardware — ~~logged nowhere yet~~ | ~~Field diagnosis blocked~~ | **Closed by D24**: `sensorOrientation`, `deviceRotationDegrees`, and `rotationDegrees` are now all logged (`Log.d("coord-debug", …)`); `rotation_degrees` is in the `camera_acquired` structured log |
| **(D24)** On-device testing after D23 shipped showed the bug persists — D23's rotation/mirror architecture was correct on its own terms but was never actually hardware-verified, and the leading unruled-out cause (`Preview`/`ImageAnalysis` bound without a shared `ViewPort`, so CameraX gives no guarantee they share a field of view or aspect ratio) is structurally something `DisplayOrientation.mapPoint` cannot represent, since it only permutes/reflects — never scales or crops | Landmarks may be correctly rotated and mirrored yet still visibly offset, worse toward the frame's edges | D24 ships instrumentation (two Kotlin `Log.d` sites, throttled Dart console logging, and an independently-toggleable `CoordinateDebugPainter` drawing canvas bounds/image-rect/axes/landmarks #0,#5,#17) instead of a fourth guess; `research.md` D24 has the full decision tree for reading its output. **Nothing about the actual bug is confirmed until this runs on hardware** |
| **(R3)** The values found on the reference device are now routed through a changed rendering geometry — the calibration screen's full-pane overlay and `PreviewStage`'s new `FittedBox`-based texture layout — rather than the exact pipeline they were originally validated against | The preview/overlay could look different on the reference device than it did when D25's values were found, even though every number is unchanged and every host-testable claim about the new geometry is covered by tests | The screen now renders through the identical `PreviewStage`/`HandLandmarkPainter` widgets production uses, eliminating the two-pipeline drift that caused D23–D25's original bug; what remains genuinely unverified without hardware is stated explicitly in `research.md` D26 rather than assumed correct |
| **(D25)** A screenshot after D24 showed the preview itself is visibly rotated in portrait, **and** the overlay still doesn't align even accounting for that — two independent symptoms, and two automatic-fix attempts (D23, and implicitly D24) had already failed to resolve either | No further automatic fix could be responsibly proposed without hardware evidence of which of mirror/rotation/scale/translate/crop/fit is actually wrong, for the preview and the overlay separately | D25 ships `CameraCalibrationScreen`, a fully manual, independently-controllable calibration panel for the preview and the overlay (rotation, mirror, swap-XY, scale, offset, fit), reusing the camera session already live rather than reacquiring it. **Nothing about the actual bug is diagnosed or fixed by D25 itself** — it is purely the instrument a developer uses to find the answer by hand; the automatic fix is future work gated on that result |
