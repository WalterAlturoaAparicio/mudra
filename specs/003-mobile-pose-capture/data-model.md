# Phase 1 Data Model: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24 · revised 2026-07-26 for **Revision R1**

All types are **immutable Dart value classes** with value equality and `const` constructors where
possible. Domain types import nothing from Flutter, plugins, or `dart:io` — that is what keeps them
testable on the host and portable to iOS.

Types marked **[engine-mirrored]** exist to satisfy the shared JSON schema and MUST NOT drift from
the engine's definitions; see [contracts/sample-json.md](./contracts/sample-json.md). Types and rules
introduced or changed by R1 are marked **(R1)**.

## Naming: the three sessions **(R1.1)**

The spec's Glossary defines three distinct scopes. The code names them the same way, with **no
overlap**:

| Concept | Domain type | Scope |
|---|---|---|
| **Recording session** (a take) | `RecordingSession`, `RecordingSessionState`, `RecordingResult` | One press of Record. Identified by `session_uuid`. |
| **Capture session** (one visit to the capture screen) | `CaptureSettings` + `CaptureSessionScope` | Owns settings and the orientation lock; spans many takes. |
| **Camera session** (one device acquisition) | `CameraSession`, `CameraSessionInfo` | At most one at a time. |

**Rename required**: the baseline named a take `CaptureSession`/`CaptureSessionState`, which now
collides with the screen-level scope. Those types are renamed to `RecordingSession` /
`RecordingSessionState` (tasks T082a). The persisted key `session_uuid` is **unchanged** — this is a
naming correction, not a schema change.

---

## Landmark domain

### `Handedness` (enum) **[engine-mirrored]**

`left` | `right` | `unknown`. Parsed case-insensitively from the detector label; anything
unrecognized maps to `unknown` rather than throwing. Serialized as the lowercase wire value.

Every **stored** label names the user's **physical** hand under the canonical convention (FR-053) —
the same convention the engine relies on. Before R1 that held because the front camera was the only
permitted lens; after R1 it holds because non-canonical captures are converted before storage.

**(R1)** `flipped` — `left ↔ right`, `unknown → unknown`. Used only by `CanonicalViewConverter`.

### `Landmark` **[engine-mirrored]**

| Field | Type | Rules |
|---|---|---|
| `x` | `double` | Normalized `[0,1]` in **canonical** (mirrored front-camera) frame space (may fall slightly outside for partially out-of-frame points) |
| `y` | `double` | Normalized `[0,1]` |
| `z` | `double` | Relative depth, wrist-referenced; smaller = closer |
| `visibility` | `double?` | Always `null` for MediaPipe Hands; kept for schema symmetry |

**(R1)** The `x` axis is the only one mirroring affects, and the only one the canonical conversion
touches.

### `HandLandmarks` **[engine-mirrored]**

Exactly **21** `Landmark`s (`HandLandmarkCount = 21`). The constructor asserts the count — an
invariant every downstream layer relies on, enforced once at the boundary.

### `HandDetection`

One detected hand: `handedness`, `confidence` (`double`, `[0,1]`), `landmarks`.

### `LandmarkFrame`

One frame delivered by the detector — the unit the capture session consumes.

| Field | Type | Notes |
|---|---|---|
| `hands` | `List<HandDetection>` | 0..N, in detector order |
| `frameWidth` / `frameHeight` | `int` | Analysis resolution; lands in `metadata.camera` |
| `timestampMicros` | `int` | Monotonic capture instant from the native side |
| `convention` | `ViewConvention` | **(R1)** which viewing convention these coordinates are in |
| `handCount` | `int` (derived) | `hands.length` |

Frames are ephemeral: they never reach storage, only the samples derived from them do.

**(R1)** A frame carries its own convention so the conversion is a **total function on data** rather
than a decision made from ambient state. Everything above the camera seam only ever observes frames
with `convention == ViewConvention.canonical`; a frame in any other convention above that line is a
programming error and asserts in debug.

---

## Camera domain **(R1)**

Everything the application knows about a camera, expressed without naming a platform (FR-112). No
type here mentions CameraX, AVFoundation, or a texture backend.

### `LensPosition` (enum)

`front` | `rear`. The wire value (`"front"` / `"rear"`) is what `metadata.camera.position` stores
(FR-081).

### `ViewConvention` (enum)

`canonical` | `unmirrored`.

`canonical` is the mirrored front-camera view every stored sample uses (FR-053). `unmirrored` is what
a rear lens produces. The names deliberately describe the **convention**, not the lens, so a future
platform that mirrors differently needs no new vocabulary. A lens maps to a convention by default
(`front → canonical`, `rear → unmirrored`), but the session reports what it actually produced rather
than what the lens implies.

### `CaptureMode` (enum) and `CaptureProfile`

| Mode | Lens | Convention | Countdown |
|---|---|---|---|
| `selfCapture` | `front` | `canonical` | enabled, 3.0 s |
| `operatorCapture` | `rear` | `unmirrored` | disabled |

`CaptureProfile` carries `defaultLens`, `countdownEnabled`, `countdownSeconds`. Both profiles are
`CaptureConfig` data, not constants at a call site (Principle V).

A profile establishes values **once**, at capture-session initialization — entering the capture screen
or changing mode (FR-071). It is not a live rule: after initialization the values belong to
`CaptureSettings`, and re-entering the screen with the same mode does not re-apply the profile.

### `CameraRequest`

What the application asks for: `lens` (`LensPosition`), `analysisSize` (`Size`, the resolution
landmarks are computed against). Nothing else — mirroring is a property of the lens, not a request.

### `CameraSessionInfo`

What a live camera reports about itself. Every field either drives the preview or lands in sample
metadata.

| Field | Type | Notes |
|---|---|---|
| `textureId` | `int` | Preview surface handle |
| `previewWidth` / `previewHeight` | `int` | **Display-oriented** preview size — the source of the aspect ratio (FR-099) |
| `analysisWidth` / `analysisHeight` | `int` | Resolution landmarks are normalized against; lands in `metadata.camera.width/height` |
| `lens` | `LensPosition` | FR-081 |
| `convention` | `ViewConvention` | What the frames are actually in |
| `mirroredPreview` | `bool` (derived) | `convention == canonical`; FR-082 |
| `platformLensId` | `int` | The platform's own identifier, preserved verbatim (FR-084) |
| `rotationDegrees` | `int` | Rotation the platform applied to reach display orientation — recorded so the preview size is auditable, not inferred |
| `detectorVersion` | `String?` | Lands in `metadata.versions.mediapipe` |
| `previewAspect` | `double` (derived) | `previewWidth / previewHeight` |

### `CameraReleaseReason` (enum)

`screenLeft` | `backgrounded` | `lensSwitch` | `modeChange` | `superseded` | `error` | `shutdown`.

Every release records its reason in the structured `camera_released` event (FR-096). A leak in the
field is diagnosed by finding an acquire with no matching release, which requires the reason to be
present to be actionable.

### `CameraMetadata` **[additive to the sample schema]**

The descriptive record attached to every sample (FR-081–FR-085).

| Field | Type | Persisted as |
|---|---|---|
| `position` | `LensPosition` | `metadata.camera.position` |
| `mirroredPreview` | `bool` | `metadata.camera.mirrored_preview` |
| `platformLensId` | `int` | `metadata.camera.lens_facing` |
| `countdownEnabled` | `bool` | `metadata.capture.countdown_enabled` |

`countdownEnabled` is persisted in the **capture** block, beside `countdown_seconds`, because it
describes the take rather than the lens (research D19). All four are additive and optional;
`schema_version` stays `1`.

**Invariant** (FR-058): camera metadata reports what was **used**, never what was stored. A rear-lens
sample converted into the canonical convention still reports `position: rear` and
`mirrored_preview: false`. That is what makes the conversion auditable instead of invisible.

**Invariant**: `platformLensId == metadata.camera.index` by construction, asserted by a test — the two
fields exist for different reasons (research D19) and must never disagree.

### `CaptureSettings`

The live, user-owned state of a **capture session** (one visit to the capture screen).

| Field | Type | Initialized from | Changed by |
|---|---|---|---|
| `mode` | `CaptureMode` | last used in this run, else `selfCapture` | user only (FR-062/FR-063) |
| `lens` | `LensPosition` | the mode's profile | user only (FR-065) |
| `countdownEnabled` | `bool` | the mode's profile | user only (FR-072) |
| `countdownSeconds` | `double` | the mode's profile | user only |
| `confirmTakes` | `bool` | `true` | user only (FR-078) |

Derived: `mirrored` follows `lens` (FR-067) and is **not** stored — a stored copy could disagree with
the lens, and FR-067 says it never may.

**The single rule that governs this type**: values change when the user changes them, or when the mode
changes (which re-initializes all of them from the new profile). Nothing else — not a lens switch
(FR-074), not backgrounding, not screen lock, not screen recreation, not a completed take, **and not
re-entering the capture screen with the same mode** — alters them. SC-032 is the test of exactly this
rule.

Scope: the **capture session** (one visit to the capture screen), held by an application-run-scoped
notifier so screen recreation cannot reset it. Re-entering the capture screen **without** changing the
mode does not re-initialize the settings, so a user's choice survives leaving and returning within one
application run (FR-071). Nothing is persisted across application runs (FR-075).

### Camera session lifecycle

`CameraSessionController` owns the states; the capture screen only expresses intent.

```text
                 ┌──────────────────── close(reason) ◄─────────────────┐
                 ▼                                                     │
   ┌────────┐ request  ┌──────────┐  opened   ┌──────┐  request(other lens/mode)
   │ closed │─────────►│ opening  │──────────►│ live │──────────────────┘
   └────────┘          └──────────┘           └──────┘
        ▲                    │ superseded          │ platform error
        │                    │ or failed           ▼
        │                    ▼                 ┌───────┐  retry
        └───────────────── ┌───────┐ ◄─────────│ error │────────────► opening
                           │ closed│           └───────┘
                           └───────┘
```

| Rule | Requirement |
|---|---|
| At most one camera session in `opening` or `live` at any instant | FR-092 |
| A request while `opening` supersedes the pending one; when the superseded open resolves it is closed immediately and never published | FR-070, FR-093 |
| `close` completes before the next `open` begins | FR-066 |
| `close` is idempotent and completes even when the preceding open failed partway | FR-095 |
| Any in-flight recording session is abandoned on every transition out of `live`, writing nothing | FR-094 |
| Leaving the screen, backgrounding, or screen lock ⇒ `close`; returning to the foreground while the screen still owns the camera ⇒ `open` | FR-086, FR-090 |
| Screen recreation leaves exactly one live camera session and no orphan | FR-091 |

### Camera failure taxonomy (FR-107–FR-111)

Each start step fails distinctly, and every one of them has a route out — no path ends in an
indefinite spinner (SC-029).

| Failure | Cause | User sees | Route out |
|---|---|---|---|
| `permissionDenied` | Permission refused | Why the camera is needed | Request again |
| `permissionPermanentlyDenied` | Refused with "don't ask again" | Must be granted in system settings | Open settings (FR-110) |
| `cameraBusy` | Another application holds the camera | Plain-language explanation | Retry (FR-108) |
| `lensUnavailable` | Requested lens absent or lost mid-session | Which lens is unavailable | Other lens / other mode remains usable (FR-064, FR-069) |
| `detectorUnavailable` | Model failed to load | Detection unavailable | Retry |
| `startFailed` | Any other platform failure | Generic explanation | Retry |

**Invariant** (FR-111): every failure state is exitable — after the cause is resolved, re-entering the
capture screen must succeed. Enforced by the failure never being cached: each entry runs the ordered
start path from the beginning.

---

## Pose catalog domain

### `PoseDefinition`

Configuration, not user data. Loaded from `assets/config/pose_catalog.json`
(see [contracts/pose-catalog.md](./contracts/pose-catalog.md)).

| Field | Type | Validation |
|---|---|---|
| `poseId` | `String` | Matches `^[a-z0-9_]+$`, ≤64 chars, unique in the catalog (engine's rule) |
| `displayName` | `String` | Non-empty |
| `description` | `String` | May be empty |
| `referenceImage` | `String` | Asset path; **absence is legal** → placeholder (FR-005) |
| `targetSampleCount` | `int` | `> 0`; defaults to 500 |
| `requiredHands` | `int` | `1` or `2`; defaults to `1` (FR-002) |

### `PoseCatalog`

Ordered, non-empty `List<PoseDefinition>` plus lookup by `poseId`. Construction validates the whole
list and fails loudly, naming the offending entry — a malformed catalog is a developer error, not a
runtime condition to paper over.

### `PoseProgress`

| Field | Type | Notes |
|---|---|---|
| `pose` | `PoseDefinition` | |
| `collected` | `int` | Samples currently stored for this `poseId` |
| `fraction` | `double` (derived) | `min(collected / target, 1.0)` |
| `isComplete` | `bool` (derived) | `collected >= target` — visually distinct, never blocks recording (FR-024) |

---

## Sample domain **[engine-mirrored]**

### `Pose`

`poseId`, `displayName?`, `description?` — the identity block written into every sample.

### `HandSample`

`handedness`, `confidence`, `canonicalRaw: HandLandmarks`, `normalized: HandLandmarks`.

**(R1)** The field was named `raw`. It is now **`canonicalRaw`** (FR-056): the earliest *canonical*
observation of the hand, not a verbatim recording of detector output. The persisted JSON key stays
`"raw"` (FR-057), so `schema_version` stays `1` and every sample already on disk remains valid. A
serializer test pins that divergence — the Dart name and the wire key differ **on purpose**.

Both landmark sets are canonical: the conversion runs before normalization, because normalization is
a translation and a scale and therefore cannot undo a reflection (research D17).

### `HandMeta`

`handedness`, `confidence` — the per-hand summary inside `metadata`.

### `CaptureTiming`

| Field | Type | Notes |
|---|---|---|
| `captureTime` | `String` | UTC ISO-8601 of this frame's capture instant |
| `countdownStartTime` | `String?` | When Record was pressed |
| `countdownSeconds` | `double` | Configured countdown length; `0.0` when the countdown is disabled |
| `countdownEnabled` | `bool` | **(R1)** Whether a countdown preceded this take (FR-083). **Additive** |
| `sessionUuid` | `String?` | The take that produced this sample (FR-045). **Additive** — see [contracts/sample-json.md](./contracts/sample-json.md) |

**(R1)** With the countdown disabled, `countdownSeconds` is `0.0` and `countdownStartTime` is the
instant Record was pressed — a zero-length countdown. No field becomes newly nullable, and the
engine's existing default for `countdown_seconds` already means the same thing.

### `SampleMetadata`

`timestamp`, `cameraIndex` (platform lens-facing: `0` back, `1` front), `cameraWidth`,
`cameraHeight`, `mediapipeVersion?`, `applicationVersion`, `numHands`, `hands: List<HandMeta>`,
`capture: CaptureTiming?`, **(R1)** `camera: CameraMetadata`.

**(R1)** `CameraMetadata` supplies `position`, `mirrored_preview`, and `lens_facing` inside the
existing `metadata.camera` block; `countdown_enabled` travels in `CaptureTiming`. All are additive
and optional, so a reader that ignores them still reads every sample (FR-052).

### `PoseSample`

The atomic dataset unit: `schemaVersion` (1), `pose`, `sampleUuid`, `sampleNumber` (assigned at
write time; empty on a draft), `timestamp`, `normalization` (`strategy`, `version`), `metadata`,
`hands: List<HandSample>`.

**Invariants**: `numHands == hands.length == metadata.hands.length`; every `HandLandmarks` holds 21
points; no field carries pixel data.

### `SampleRef`

`poseId`, `sampleUuid`, `sampleNumber`, `location` — a lightweight handle returned by the repository.

---

## Capture session domain

### `RecordingSessionState` (sealed) — *renamed from `CaptureSessionState` in R1.1*

The state of **one take**. Deliberately mirrors the engine's recording lifecycle so both applications
describe the same flow.

**(R1)** Two changes: the countdown is **conditional** (FR-010), and every terminal state returns to
`Idle` **on the same screen with the camera still held** (FR-076) instead of leaving the screen.

```text
                    countdown enabled
idle ──press Record──┬──► countdown ──reaches zero──┐
                     │                              ▼
                     └──────────────────────────► capturing ──window ends──► saving ──► summary
                            countdown disabled          │                                  │
                            (FR-010)                    │                       dismissed / confirm off
                            │                           │                                  │
                            └────── cancel ─────────────┴──► cancelled ────────────────────┤
                                                        └──► failed ─────────────────────► idle
```

| State | Carries | Notes |
|---|---|---|
| `Idle` | — | Record enabled; **camera live** |
| `Countdown` | `remaining`, `total` | **Skipped entirely** when the countdown is disabled (R1). Preview **must** stay live (FR-011); cancellable |
| `Capturing` | `elapsed`, `window`, running `accepted`/`discarded` | Automatic; cancellable |
| `Saving` | `accepted` | Persisting the buffered samples |
| `Summary` | `CaptureResult` | **(R1)** Blocks the next take until dismissed when `confirmTakes` is on (FR-077); otherwise passes straight through to `Idle` while still conveying the result (FR-078) |
| `Cancelled` | — | No samples written (FR-016) |
| `Failed` | `Failure` | Storage/camera error surfaced in plain language |

Legal transitions are explicit; anything else is a programming error and throws in debug.

**(R1) The loop invariant**: no terminal state releases the camera or leaves the screen. Leaving is an
explicit user action only (FR-076). Pose progress updates on every saved take regardless of whether
the summary is shown (FR-080).

**Session-ending conditions** beyond the normal window expiry:

| Condition | Behaviour | Requirement |
|---|---|---|
| User cancels | → `Cancelled`, nothing written | FR-016 |
| `maxSamplesPerSession` reached | Stop accepting frames, **finalize normally** (persist everything accepted), summary states the limit was reached | FR-051 |
| Orientation changes | → `Cancelled` with `orientationChanged`, **nothing written**, user told why, return to idle | FR-049/FR-050 |
| App backgrounded / camera lost | → `Failed`, nothing partial written | Edge cases, SC-016 |
| **(R1)** Camera released for any reason — leaving, backgrounding, lens switch, mode change | → `Cancelled` with `cameraReleased`, **nothing written**, already-saved samples untouched | FR-068, FR-094 |
| **(R1)** Lens disappears mid-take | → `Failed` with `lensUnavailable`, nothing written, user told what happened | Edge cases |

**(R1.1)** Orientation is **locked for the whole capture session** — from entering the capture screen
until leaving it, not merely for the duration of a take (FR-049, revised). The abort path is a safety
net for changes the lock cannot prevent, not the primary mechanism. Because the lock now spans the
whole screen, `CameraSessionInfo.previewAspect` is computed once per camera session and cannot go
stale (FR-099), and no recording session can observe a geometry change.

**(R1)** `SessionEndReason` gains `cameraReleased`. Every path that ends a take without saving routes
through a single abandon operation, so "nothing partial is ever written" is one code path rather than
six.

### `RecordingSession` — take identity (FR-045/FR-046) — *renamed from `CaptureSession` in R1.1*

Minted when Record is pressed, closed when the take ends. It is the traceability anchor future
analytics and synchronization rely on. The persisted key is still `session_uuid`.

| Field | Type | Notes |
|---|---|---|
| `sessionUuid` | `String` | UUID v4, minted at the start of the session |
| `poseId` | `String` | The pose being collected |
| `startedAt` | `DateTime` | UTC, when Record was pressed |
| `finishedAt` | `DateTime?` | UTC, when the session reached a terminal state |
| `totalSamples` | `int` | Accepted and persisted |
| `discardedSamples` | `int` | Rejected by validation |
| `endReason` | `SessionEndReason` | `completed` \| `cancelled` \| `limitReached` \| `orientationChanged` \| `cameraReleased` **(R1)** \| `failed` |

Every sample produced by the session carries `sessionUuid` in its `metadata.capture` block. Sessions
that end in `cancelled`, `orientationChanged`, or `failed` write **no** samples, so no orphan
identifier ever reaches the dataset.

### `CaptureResult`

| Field | Type | Notes |
|---|---|---|
| `sessionUuid` | `String` | Links the result to its session |
| `poseId` | `String` | |
| `accepted` | `int` | Samples stored |
| `discarded` | `int` | Frames rejected by validation |
| `rejectionCounts` | `Map<RejectionReason, int>` | Why frames were dropped |
| `duration` | `Duration` | Capture window actually observed |
| `endReason` | `SessionEndReason` | Drives the summary message |
| `refs` | `List<SampleRef>` | What was written |

`accepted + discarded == frames observed in the window` — the identity the UI reports (FR-021).

### `RejectionReason` (enum)

`noHands` | `insufficientHands` | `wrongLandmarkCount` | `nonFiniteCoordinates`. Counted per session
so the summary can explain *why* a take was poor, not merely that it was.

---

## Validation rules

Applied per frame, in order; the first failure discards the frame (FR-019/FR-019a):

1. **Hands present** — `handCount >= 1`, else `noHands`.
2. **Required hands** — `handCount >= pose.requiredHands`, else `insufficientHands`.
3. **Landmark count** — every hand has exactly 21 landmarks, else `wrongLandmarkCount`.
4. **Finite coordinates** — every `x`, `y`, `z` is finite, else `nonFiniteCoordinates`.

Rules 1, 3, and 4 are exactly the engine's `PoseValidationService.validate_capture`. Rule 2 is
Capture-specific and *stricter* — it can only reduce what is stored, so every sample Capture writes
still passes the engine's own validation (SC-004).

---

## Canonical conversion **(R1)**

`CanonicalViewConverter` — pure, deterministic, and applied at the camera seam so **every** consumer
observes one convention (FR-053–FR-058).

```text
convert(frame):
  if frame.convention == canonical → frame unchanged
  else, for each hand, in place, without reordering:
      handedness → handedness.flipped        (left ↔ right; unknown unchanged)
      landmarks  → (1 − x, y, z, visibility) for all 21 points
  frame.convention → canonical
```

| Property | Why it matters |
|---|---|
| **Only `x` changes** | Mirroring is a horizontal reflection; `y`, `z`, and `visibility` are unaffected |
| **Handedness flips with the geometry** | MediaPipe derives the label assuming a mirrored selfie-view input, so flipping the image without relabelling would name the wrong physical hand — the silent corruption FR-044 exists to prevent |
| **Hands are never reordered** | Each entry keeps its own landmarks and its own relabelled handedness (FR-054). The list may no longer read left-then-right; no entry ever acquires another hand's geometry |
| **Runs before normalization** | `translation_scale` is a translation and a uniform scale; a reflection is neither, so mirrored and unmirrored captures do **not** converge under normalization. This is why FR-055 requires the conversion on every persisted landmark set |
| **Involutive** | `convert(convert(f)) == convert(f)` — the canonical branch is a no-op, so double application is safe |
| **Metadata is untouched** | FR-058: the sample still reports the lens and mirroring actually used |

**Test obligations**: converting a synthetic rear-lens frame yields the handedness and geometry of the
equivalent front-lens frame within the tolerance already accepted between two consecutive samples of
one take (SC-031); a two-handed frame keeps each hand's landmark set attached to its own entry; a
canonical frame is returned unchanged.

---

## Normalization

`TranslationScaleNormalizer` — `strategy = "translation_scale"`, `version = "1.0"`:

```text
origin    = points[0]                      (wrist)
reference = points[9]                      (middle-finger MCP)
span      = ‖reference − origin‖₂ (3-D)
if span < 1e-9 → span = 1.0                (degenerate hand: translate only)
p'        = (p − origin) / span            (per axis, visibility preserved)
```

Ported operation-for-operation from the engine (research D4) and pinned by golden fixtures.

---

## Export domain

### `DatasetManifest` (FR-047)

Written to `manifest.json` at the archive root; the official entry point for importers. Full field
reference in [contracts/export-manifest.md](./contracts/export-manifest.md).

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `int` | Sample schema the archive's samples conform to (`1`) |
| `manifestVersion` | `int` | Version of the manifest format itself (`1`) |
| `captureVersion` | `String` | Producing app version, e.g. `mudra-capture/0.1.0` |
| `exportTimestamp` | `String` | UTC ISO-8601 |
| `device` | `DeviceInfo` | Manufacturer, model, OS version |
| `platform` | `String` | `android` / `ios` |
| `totalSamples` | `int` | Must equal the archive's actual sample count |
| `poseCounts` | `Map<String,int>` | `pose_id` → sample count |
| `normalization` | `NormalizationInfo` | Strategy + version used across the dataset |
| `sessions` | `List<SessionSummary>` | Session records (FR-046), linking `session_uuid` to its samples |
| `checksums` | `Map<String,String>?` | Per-pose-collection digest where computable |
| `integrity` | `IntegrityReport` | What was validated before packaging |

### `IntegrityReport` (FR-048)

| Field | Type | Notes |
|---|---|---|
| `checkedSamples` | `int` | |
| `criticalFailures` | `List<IntegrityFinding>` | Non-empty ⇒ **export aborts** |
| `warnings` | `List<IntegrityFinding>` | Recorded in the manifest, does not block |
| `passed` | `bool` (derived) | `criticalFailures.isEmpty` |

`IntegrityFinding` carries a `check`, a human-readable `message`, and the offending path.

**Checks** (critical unless noted):

1. **Parseable JSON** — every sample file parses.
2. **Schema compliance** — required fields present, `schema_version == 1`, 21 landmarks per hand,
   `num_hands` consistent with `hands`.
3. **Folder structure** — every sample lives under `datasets/poses/<pose_id>/`, filenames match
   `sample_NNNNNN.json`.
4. **Duplicate detection** — no `sample_uuid` appears twice; no duplicate sample number within a pose.
5. **Valid pose ids** — every directory name and every sample's `pose_id` matches `^[a-z0-9_]+$`, and
   the two agree.
6. *(warning)* **Catalog coverage** — a `pose_id` not present in the current catalog is reported, not
   blocked; a dataset may legitimately outlive a catalog edit.

## Configuration

`CaptureConfig` — all tunables, no magic numbers at call sites (Principle V):

| Field | Default | Purpose |
|---|---|---|
| `countdownSeconds` | `3.0` | Countdown length **when enabled** (FR-010); the Self Capture profile's value |
| `selfCaptureProfile` | `(front, countdown on @ 3.0 s)` | **(R1)** Self Capture defaults (FR-060) |
| `operatorCaptureProfile` | `(rear, countdown off)` | **(R1)** Operator Capture defaults (FR-061) |
| `defaultConfirmTakes` | `true` | **(R1)** Per-take summary shown until dismissed (FR-077) |
| `analysisWidth` / `analysisHeight` | `480` / `640` | **(R1)** Requested analysis resolution — was hardcoded natively |
| `cameraReleaseTimeout` | `1s` | **(R1)** Budget for a full release (SC-019); exceeding it is logged, never swallowed |
| `captureWindowSeconds` | `1.0` | Automatic capture duration (FR-014) |
| `defaultTargetSampleCount` | `500` | Catalog fallback |
| `datasetRoot` | `datasets` | Mirrors the engine's layout |
| `posesDirname` | `poses` | |
| `filenamePrefix` / `filenameDigits` | `sample_` / `6` | `sample_000001.json` |
| `jsonIndent` | `2` | Human-readable output |
| `exportFileName` | `mudra_capture_export.zip` | |
| `manifestFileName` | `manifest.json` | Archive-root manifest (FR-047) |
| `maxSamplesPerSession` | `120` | Safety bound on buffered frames; reaching it finalizes the session normally with a message (FR-051) |
| `lockOrientationOnCaptureScreen` | `true` | **(R1.1)** Lock on entering the capture screen, restore on leaving — not per take (FR-049, revised). Renamed from `lockOrientationDuringSession`, whose name asserted the old, narrower scope |
| `computeChecksums` | `true` | Per-collection digests in the manifest; may be disabled on very large datasets |

---

## Persistence layout

```text
<app-documents>/datasets/poses/<pose_id>/sample_000001.json
                                          sample_000002.json
```

Identical to the engine's, so the export unzips straight into the engine's dataset root. Numbering is
`max(existing) + 1`, never reused, never overwritten (FR-029). Only `.json` files ever exist in this
tree — asserted by a test (Principle II).
