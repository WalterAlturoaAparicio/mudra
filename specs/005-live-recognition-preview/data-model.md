# Phase 1 Data Model: Phase 2.75 — Live Recognition Preview

**Feature**: 005-live-recognition-preview | **Date**: 2026-07-26

All types are **immutable Dart value classes** with value equality and `const` constructors where
possible, exactly the discipline specification 003 already established. Domain types import
nothing from Flutter, plugins, or `dart:io` — the matcher, the stability tracker, and confidence
math are all fully testable on the host with no camera and no device.

Types marked **[reused]** are unchanged imports from specification 003 / Revision R1, listed here
only because this feature depends on them directly.

---

## Reused from specification 003 (unchanged)

| Type | From | Role here |
|---|---|---|
| `Handedness`, `Landmark`, `HandLandmarks` **[reused]** | `domain/landmarks/` | The shape every `Exemplar` and every live comparison is expressed in. |
| `LandmarkFrame` **[reused]** | `domain/landmarks/` | What the camera seam delivers per frame; already canonical by the time it reaches this feature (FR-002). |
| `PoseDefinition`, `PoseCatalog` **[reused]** | `domain/poses/` | Supplies `pose_id`, `requiredHands`, and display data; this feature adds no new pose metadata. |
| `PoseSample`, `HandSample` **[reused]** | `domain/samples/` | Read, never written, here. `HandSample.normalized` is the exact vector an `Exemplar` is built from (FR-005, research D6). |
| `CameraSource` / `CameraSession` / `CameraSessionController` **[reused]** | `domain/ports/`, `application/camera/` | Acquired identically to the capture screen (research D9); no new camera code. |
| `Clock` **[reused]** | `domain/ports/` | Drives `StabilityState`, tested with the existing `FakeClock` (research D7). |

---

## Recognition domain (new)

### `Exemplar`

One stored sample's normalized landmark vector, read for comparison only.

| Field | Type | Notes |
|---|---|---|
| `poseId` | `String` | Which catalog pose this came from. |
| `handedness` | `Handedness` | Resolved physical hand (specification 003's canonical convention already guarantees this is correct regardless of which lens recorded it). |
| `landmarks` | `HandLandmarks` | The persisted `normalized` vector — **not** recomputed here (research D6). |

**Invariant**: an `Exemplar` is never constructed from anything other than an existing,
already-persisted sample. This feature has no code path that produces a `PoseSample`.

### `LandmarkWeights`

The per-landmark weighting `RecognitionConfig` supplies to the distance function (research D1).

| Field | Type | Notes |
|---|---|---|
| `values` | `List<double>` | Exactly 21 entries, one per landmark index, asserted at construction — the same "assert the invariant once, at the boundary" pattern `HandLandmarks` itself uses. |

### `Candidate`

One pose considered for the current frame.

| Field | Type | Notes |
|---|---|---|
| `poseId` | `String` | |
| `distance` | `double` | Raw weighted squared distance to the nearest eligible exemplar (or exemplar pair, for a two-handed pose). |
| `confidence` | `double` | `softmax(−distance)` across every eligible candidate this frame (research D3); in `[0, 1]`. |

### `RecognitionResult` (sealed)

The outcome for one processed frame. Sealed so the UI and the stability tracker cannot observe a
state this feature does not define.

| Variant | Carries | Meaning |
|---|---|---|
| `NoHandDetected` | — | No hand in the frame at all (edge case). |
| `Unrecognized` | `topCandidates: List<Candidate>` (may be empty) | Every candidate failed the confidence floor. |
| `Ambiguous` | `topCandidates: List<Candidate>` (≥ 2) | The confidence floor passed but the top-vs-second margin did not (research D4). |
| `Recognized` | `topCandidates: List<Candidate>` (1–3, ranked) | Both gates passed; `topCandidates.first` is the prediction. |

Every variant carries `latency: Duration` (frame captured → this result produced) and
`frameTimestamp` for ordering — FR-012's continuously-displayed latency reads directly from the
most recent `RecognitionResult`.

**Rule**: only `Recognized` contributes to stability (FR-016); every other variant resets it.

---

## Stability domain (new)

### `StabilityState`

| Field | Type | Notes |
|---|---|---|
| `predictedPoseId` | `String?` | The pose currently being held stable, or `null` if nothing qualifies. |
| `heldSince` | `DateTime?` | When the current hold began, from the injected `Clock` (research D7); `null` alongside `predictedPoseId == null`. |
| `confirmedAt` | `DateTime?` | Set once this specific hold has already raised its `ConfirmationEvent`; prevents a second one until the hold breaks and restarts (FR-018). |

Derived:

- `heldDuration(Clock now)` → `now.nowUtc().difference(heldSince!)`, or `Duration.zero` when not
  holding.
- `progress(Clock now, Duration target)` → `heldDuration / target`, clamped to `[0, 1]` — what the
  continuously-updating stability indicator renders (FR-015).
- `readyToConfirm(Clock now, Duration target)` → `heldDuration(now) >= target && confirmedAt ==
  null`.

### Stability transitions

```text
                    Recognized(same pose as predictedPoseId)
                 ┌───────────────────────────────────────────┐
                 │                                           │
                 ▼                                           │
  idle ──Recognized(pose)──► holding(pose, since=now) ───────┘
   ▲                              │
   │                              │ heldDuration ≥ stabilityDuration
   │                              ▼
   │                    ConfirmationEvent(pose) raised once
   │                              │
   │                              ▼
   │                    holding(pose, confirmedAt=now) ── still holding, no repeat ──┐
   │                              │                                                    │
   └── NoHandDetected / Unrecognized / Ambiguous / Recognized(different pose) ─────────┘
       (reset to idle; a new hold, if any, starts its own duration and its own
        confirmation eligibility from zero)
```

**Rule, stated once because it governs everything above**: any `RecognitionResult` other than
`Recognized(predictedPoseId)` — including `Recognized` of a *different* pose — resets
`heldSince` and `confirmedAt` to a fresh `null` state (FR-016). Confirmation is therefore always
relative to one continuous, uninterrupted hold.

### `ConfirmationEvent`

| Field | Type | Notes |
|---|---|---|
| `poseId` | `String` | Which pose was confirmed. |
| `confirmedAt` | `DateTime` | From the same `Clock`. |

Raised exactly once per qualifying hold (FR-018); consumed by the effects layer to trigger exactly
one playback (research D8).

---

## Effects domain (new)

### `EffectKind` (enum)

`glow` | `spritePair` | `particleBurst` | `fadeWithLines` | `genericConfirm`. A small, fixed,
shared set of parameterized `CustomPainter` overlays (research D8) — adding a pose's effect is a
data change (below), never a new `EffectKind`.

### `EffectDefinition`

| Field | Type | Notes |
|---|---|---|
| `poseId` | `String?` | `null` represents the generic fallback entry, keyed by absence rather than a sentinel string. |
| `kind` | `EffectKind` | Which shared painter renders this effect. |
| `color` | `Color?` | Used by `glow`/`fadeWithLines`; `null` falls back to a kind-specific default. |
| `spriteAssetPath` | `String?` | Used by `spritePair` (e.g. ear shapes); absence is legal — the placeholder-safety pattern FR-005 already established, applied here to effects instead of reference images. |
| `intensity` | `double` | `[0, 1]`, defaults to a kind-specific value; controls duration/scale of the playback. |

**Contract**: `EffectCatalogSource.effectFor(poseId)` MUST return a definition for every `poseId`
— the generic fallback (`poseId == null` entry) when no themed one exists — so the caller never
has to null-check (FR-020).

---

## Catalog readiness (new)

### `PoseReadiness`

| Field | Type | Notes |
|---|---|---|
| `poseId` | `String` | |
| `exemplarCount` | `int` | How many samples qualified as exemplars for this pose right now. |
| `isReady` | `bool` (derived) | `exemplarCount >= RecognitionConfig.minExemplarsPerPose`. |

### `CatalogReadiness`

`List<PoseReadiness>`, one entry per catalog pose, produced as a byproduct of `LoadExemplars`
(research D10) — never a second dataset scan.

---

## Configuration (new)

`RecognitionConfig` — every tunable this feature introduces, added alongside `CaptureConfig`
(Principle V; no magic numbers at call sites).

| Field | Default | Purpose |
|---|---|---|
| `landmarkWeights` | fingertips (4,8,12,16,20) weighted higher than palm/wrist | The distance function's per-point weighting (research D1) |
| `minExemplarsPerPose` | `20` | Below this, a pose is excluded from matching and reported not-ready (research D5) |
| `confidenceFloor` | tuned at implementation time against recorded data | Minimum top confidence to count as a real prediction (research D4) |
| `ambiguityMargin` | tuned at implementation time against recorded data | Minimum top-vs-second confidence gap to avoid "ambiguous" (research D4) |
| `softmaxTemperature` | tuned at implementation time against recorded data | How sharply softmax separates close distances (research D3) |
| `stabilityDuration` | `3.0` seconds | How long a prediction must hold before confirming (FR-017; the fast end of the milestone's named 3–5 s range) |
| `targetLatency` | `200` ms | The budget FR-012/SC-002 hold the pipeline to; used by tests and by any future adaptive behavior, not enforced by throttling predictions |

---

## The frame-processing pipeline, end to end

```text
LandmarkFrame (canonical, from CameraSessionController.frames)
        │
        ▼
for each hand in frame.hands:
   for each Exemplar of matching handedness:
      weighted squared distance  ──►  per-hand distances
        │
        ▼
group distances into per-pose Candidates
  (sum both hands' distances for a two-handed pose; require declared hand count present)
        │
        ▼
softmax(−distance) over eligible Candidates  ──►  confidence per Candidate
        │
        ▼
apply confidence floor + ambiguity margin
        │
        ├─ fails ──► RecognitionResult.Unrecognized / Ambiguous / NoHandDetected
        │
        └─ passes ─► RecognitionResult.Recognized(topCandidates)
                              │
                              ▼
                    StabilityState transition (see above)
                              │
                              ▼
                    ConfirmationEvent? ──► EffectCatalogSource.effectFor(poseId) ──► playback
```

Everything above the camera seam (from `LandmarkFrame` onward) is pure Dart, with no dependency on
Flutter, a plugin, or `dart:io` — the same boundary discipline specification 003 already enforces,
verified by the same kind of architecture test (`layer_boundaries_test.dart`) that already covers
the camera/storage separation.
