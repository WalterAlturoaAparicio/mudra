# Phase 1 Data Model: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

All types are **immutable Dart value classes** with value equality and `const` constructors where
possible. Domain types import nothing from Flutter, plugins, or `dart:io` — that is what keeps them
testable on the host and portable to iOS.

Types marked **[engine-mirrored]** exist to satisfy the shared JSON schema and MUST NOT drift from
the engine's definitions; see [contracts/sample-json.md](./contracts/sample-json.md).

---

## Landmark domain

### `Handedness` (enum) **[engine-mirrored]**

`left` | `right` | `unknown`. Parsed case-insensitively from the detector label; anything
unrecognized maps to `unknown` rather than throwing. Serialized as the lowercase wire value.

Under the mirrored front-camera preview (FR-037a) the label already names the user's **physical**
hand — the same convention the engine relies on.

### `Landmark` **[engine-mirrored]**

| Field | Type | Rules |
|---|---|---|
| `x` | `double` | Normalized `[0,1]` in mirrored frame space (may fall slightly outside for partially out-of-frame points) |
| `y` | `double` | Normalized `[0,1]` |
| `z` | `double` | Relative depth, wrist-referenced; smaller = closer |
| `visibility` | `double?` | Always `null` for MediaPipe Hands; kept for schema symmetry |

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
| `handCount` | `int` (derived) | `hands.length` |

Frames are ephemeral: they never reach storage, only the samples derived from them do.

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

`handedness`, `confidence`, `raw: HandLandmarks`, `normalized: HandLandmarks`.

### `HandMeta`

`handedness`, `confidence` — the per-hand summary inside `metadata`.

### `CaptureTiming`

| Field | Type | Notes |
|---|---|---|
| `captureTime` | `String` | UTC ISO-8601 of this frame's capture instant |
| `countdownStartTime` | `String?` | When Record was pressed |
| `countdownSeconds` | `double` | Configured countdown length |
| `sessionUuid` | `String?` | The session that produced this sample (FR-045). **Additive** — see [contracts/sample-json.md](./contracts/sample-json.md) |

### `SampleMetadata`

`timestamp`, `cameraIndex` (Android lens-facing: `0` back, `1` front), `cameraWidth`,
`cameraHeight`, `mediapipeVersion?`, `applicationVersion`, `numHands`, `hands: List<HandMeta>`,
`capture: CaptureTiming?`.

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

### `CaptureSessionState` (sealed)

Deliberately mirrors the engine's recording lifecycle so both applications describe the same flow.

```text
idle ──press Record──► countdown ──reaches zero──► capturing ──window ends──► saving ──► summary ──► idle
                           │                          │                         │
                           └────── cancel ────────────┘                         └── failure ──► error ──► idle
```

| State | Carries | Notes |
|---|---|---|
| `Idle` | — | Record enabled |
| `Countdown` | `remaining`, `total` | Preview **must** stay live (FR-011); cancellable |
| `Capturing` | `elapsed`, `window`, running `accepted`/`discarded` | Automatic; cancellable |
| `Saving` | `accepted` | Persisting the buffered samples |
| `Summary` | `CaptureResult` | Shown until dismissed or the next session starts |
| `Cancelled` | — | No samples written (FR-016) |
| `Failed` | `Failure` | Storage/camera error surfaced in plain language |

Legal transitions are explicit; anything else is a programming error and throws in debug.

**Session-ending conditions** beyond the normal window expiry:

| Condition | Behaviour | Requirement |
|---|---|---|
| User cancels | → `Cancelled`, nothing written | FR-016 |
| `maxSamplesPerSession` reached | Stop accepting frames, **finalize normally** (persist everything accepted), summary states the limit was reached | FR-051 |
| Orientation changes | → `Cancelled` with `orientationChanged`, **nothing written**, user told why, return to idle | FR-049/FR-050 |
| App backgrounded / camera lost | → `Failed`, nothing partial written | Edge cases, SC-016 |

Orientation is **locked** for the whole session (countdown included), so the abort path is a
safety net for changes the lock cannot prevent, not the primary mechanism.

### `CaptureSession` — session identity (FR-045/FR-046)

Minted when Record is pressed, closed when the session ends. It is the traceability anchor future
analytics and synchronization rely on.

| Field | Type | Notes |
|---|---|---|
| `sessionUuid` | `String` | UUID v4, minted at the start of the session |
| `poseId` | `String` | The pose being collected |
| `startedAt` | `DateTime` | UTC, when Record was pressed |
| `finishedAt` | `DateTime?` | UTC, when the session reached a terminal state |
| `totalSamples` | `int` | Accepted and persisted |
| `discardedSamples` | `int` | Rejected by validation |
| `endReason` | `SessionEndReason` | `completed` \| `cancelled` \| `limitReached` \| `orientationChanged` \| `failed` |

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
| `countdownSeconds` | `3.0` | Countdown before capture (FR-010) |
| `captureWindowSeconds` | `1.0` | Automatic capture duration (FR-014) |
| `defaultTargetSampleCount` | `500` | Catalog fallback |
| `datasetRoot` | `datasets` | Mirrors the engine's layout |
| `posesDirname` | `poses` | |
| `filenamePrefix` / `filenameDigits` | `sample_` / `6` | `sample_000001.json` |
| `jsonIndent` | `2` | Human-readable output |
| `exportFileName` | `mudra_capture_export.zip` | |
| `manifestFileName` | `manifest.json` | Archive-root manifest (FR-047) |
| `maxSamplesPerSession` | `120` | Safety bound on buffered frames; reaching it finalizes the session normally with a message (FR-051) |
| `lockOrientationDuringSession` | `true` | FR-049 |
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
