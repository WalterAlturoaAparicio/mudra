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
landscape sensor stream must swap the axes. The native side reports the display-oriented size plus the
rotation degrees it applied, so the value is auditable rather than inferred.

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
