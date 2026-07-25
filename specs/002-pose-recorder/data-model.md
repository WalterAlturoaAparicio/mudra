# Phase 1 Data Model: Pose Recorder

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

Domain value objects live in `app/models/pose.py` as **frozen, slotted dataclasses** with no I/O
or JSON knowledge (constitution Principle IV; research D3). They reuse the Phase-1 neutral types
`Landmark`, `HandLandmarks`, and `Handedness` from `app/models/landmarks.py` unchanged. The JSON
wire format is defined separately in [contracts/json-schema.md](./contracts/json-schema.md) and
owned by `PoseSerializer` — the domain never references it.

---

## Reused from Phase 1 (`app/models/landmarks.py`)

- **`Landmark`** — frozen `(x, y, z, visibility=None)`; `to_pixel(w, h)`.
- **`HandLandmarks`** — exactly 21 `Landmark`s (invariant enforced in `__post_init__`);
  `mirrored()`.
- **`Handedness`** — `LEFT` / `RIGHT` / `UNKNOWN` (str enum).

The recorder builds pose samples from a Phase-1 `FrameDetection` (the frozen capture).

---

## `Pose`

Identity of a reusable pose (not itself persisted per-sample; its fields are embedded in each
sample and could later back a pose-index file).

| Field | Type | Notes |
|-------|------|-------|
| `pose_id` | `str` | Permanent identifier; `^[a-z0-9_]+$`, ≤64 chars. The ONLY internal key. |
| `display_name` | `str \| None` | Optional human-facing label. Never used as an identifier. |
| `description` | `str \| None` | Optional free text. |

**Validation**: `pose_id` matches the configured pattern (research D7). `display_name`/
`description` are free text (trimmed; empty → `None`).

---

## `HandSample`

One detected hand within a sample, carrying both landmark representations (research D2).

| Field | Type | Notes |
|-------|------|-------|
| `handedness` | `Handedness` | Physical hand (left/right/unknown). |
| `confidence` | `float` | Handedness classification confidence `[0,1]` (from Phase-1 detection). |
| `raw` | `HandLandmarks` | Exact detector landmarks (21 points). |
| `normalized` | `HandLandmarks` | Normalizer output (21 points). |

**Validation**: both `raw` and `normalized` carry exactly 21 landmarks (inherited invariant).

---

## `PoseMetadata`

Reproducibility context for a sample (FR-015).

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | `str` | UTC ISO-8601 capture time. |
| `camera_index` | `int` | Camera device index used. |
| `camera_width` | `int` | Capture width (px). |
| `camera_height` | `int` | Capture height (px). |
| `mediapipe_version` | `str \| None` | Detector library version if resolvable, else `None`. |
| `application_version` | `str` | Mudra app version. |
| `num_hands` | `int` | Number of hands in the sample. |
| `hands` | `tuple[HandMeta, ...]` | Per-hand `(handedness, confidence)` summary. |

Where **`HandMeta`** is a tiny frozen dataclass `(handedness: Handedness, confidence: float)`.

---

## `NormalizationInfo`

How a sample was normalized — a small frozen dataclass, independent of the implementation
(research D11). Sourced from the `Normalizer`.

| Field | Type | Notes |
|-------|------|-------|
| `strategy` | `str` | Normalizer strategy name, e.g. `"translation_scale"`. |
| `version` | `str` | Strategy version, e.g. `"1.0"`. |

---

## `PoseSample`

The atomic dataset unit and the object the repository persists.

| Field | Type | Notes |
|-------|------|-------|
| `schema_version` | `int` | Schema version (starts at `1`). Set by the serializer on write. |
| `pose` | `Pose` | Identity (pose_id/display_name/description). |
| `sample_uuid` | `str` | Immutable, globally-unique UUID4 — the internal identity (research D10). Minted by the recorder at capture. |
| `sample_number` | `str` | Sequential, filesystem-friendly stem, e.g. `sample_000023`; assigned by the repository on save. |
| `timestamp` | `str` | UTC ISO-8601 (mirrors `metadata.timestamp`). |
| `normalization` | `NormalizationInfo` | Strategy + version used to normalize this sample. |
| `metadata` | `PoseMetadata` | Reproducibility metadata. |
| `hands` | `tuple[HandSample, ...]` | 1..N hands (validation guarantees ≥1). |

**Notes**: The recorder mints `sample_uuid` and stamps `normalization` when it builds the sample;
`sample_number` is left blank on the draft and assigned by the repository on save (which returns a
`SampleRef`). The serialized JSON field order is fixed by the schema (see contracts), not by this
table.

---

## `SampleRef`

A lightweight handle to a persisted sample (returned by `save`, used by `list`/`load`).

| Field | Type | Notes |
|-------|------|-------|
| `pose_id` | `str` | Owning pose. |
| `sample_uuid` | `str` | The sample's immutable UUID. |
| `sample_number` | `str` | Sequential stem, e.g. `sample_000023` (also the filename stem). |
| `location` | `str` | Absolute path (or storage-specific URI) of the sample. |

---

## Relationships

```text
Pose 1 ──owns──> * PoseSample 1 ──has──> 1..2 HandSample 1 ──has──> raw:  HandLandmarks(21 × Landmark)
                                                                 └──> norm: HandLandmarks(21 × Landmark)
PoseSample 1 ──has──> 1 PoseMetadata 1 ──has──> * HandMeta
save(PoseSample) ──returns──> SampleRef
```

## Validation rules (enforced by `PoseValidationService`, pre-normalization)

| Rule | Source | Failure reason surfaced |
|------|--------|-------------------------|
| At least one hand detected | FR-003 | "No hands detected" |
| Each hand has exactly 21 landmarks | FR-003 | "Invalid hand data: expected 21 landmarks" |
| All landmark coordinates are finite (no NaN/Inf) | FR-003 | "Invalid hand data: non-finite coordinates" |
| `pose_id` matches `^[a-z0-9_]+$`, ≤64 chars, non-empty | FR-006 | "Invalid pose_id: use lowercase letters, digits, underscores" |

Validation runs **before** normalization and saving; on failure nothing is written (FR-004) and
the reason is shown + logged.

## Lifecycle

`FrameDetection` (frozen capture) → **validate** → **normalize** each hand → build `PoseSample`
with a freshly-minted `sample_uuid` and a stamped `normalization` block (+`PoseMetadata`) →
`PoseRepository.save` assigns the sequential `sample_number` and writes append-only → `SampleRef`
returned → structured success **log** (with full-workflow `elapsed_duration_ms`) + user message →
live camera resumes. No object outlives the save except the persisted JSON file.

## Forward-compatibility (Principle III)

`pose_id` identity, append-only per-identity collections, `schema_version`, and persisted **raw**
landmarks together let sequences (Phase 3) reference poses by id, and let recognition (later)
re-normalize or re-featurize the corpus without re-recording. Sequence recording will add its own
`SequenceSample` alongside — it does not modify these types.
