# Pose Sample JSON Schema (v1)

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

This is the persisted, human-readable, versioned format for a single pose sample, owned by
`PoseSerializer` (constitution design-review gate for a new persisted schema). One file per
sample: `datasets/poses/<pose_id>/sample_NNNNNN.json`, indented (2 spaces), stable field order.

## `schema_version`

Integer, currently **`1`**. Any incompatible change increments this and is at minimum a MINOR
constitution event; `PoseSerializer.from_*` rejects unknown/incompatible versions with
`PoseSchemaError`.

## Field-by-field (top level)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | integer | yes | Format version (1). |
| `pose_id` | string | yes | Permanent identifier, `^[a-z0-9_]+$`. |
| `display_name` | string \| null | yes (nullable) | Optional human label; never an identifier. |
| `description` | string \| null | yes (nullable) | Optional free text. |
| `sample_uuid` | string | yes | Immutable global UUID4 — the internal identity used by future DBs/sync. |
| `sample_number` | string | yes | Sequential, filesystem-friendly stem, e.g. `sample_000023` (matches the filename). |
| `timestamp` | string | yes | UTC ISO-8601, e.g. `2026-07-24T13:20:00.123456+00:00`. |
| `normalization` | object | yes | How the sample was normalized (below). |
| `metadata` | object | yes | Reproducibility metadata (below). |
| `hands` | array | yes | 1..2 hand objects (below); order as detected. |

## `normalization` object

| Field | Type | Description |
|-------|------|-------------|
| `strategy` | string | Normalizer strategy name, e.g. `"translation_scale"`. |
| `version` | string | Strategy version, e.g. `"1.0"`. |

Recorded independently of the implementation so strategies are unambiguously distinguishable.

## `metadata` object

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | UTC ISO-8601 (mirrors top-level). |
| `camera` | object | `{ "index": int, "width": int, "height": int }`. |
| `versions` | object | `{ "application": string, "mediapipe": string\|null }`. |
| `num_hands` | integer | Number of hands in `hands`. |
| `hands` | array | Per-hand summary: `[{ "handedness": "left"\|"right"\|"unknown", "confidence": number }]`. |
| `capture` | object \| null | Capture timing (below); `null` for a capture taken without a countdown. |

### `metadata.capture` object

| Field | Type | Description |
|-------|------|-------------|
| `countdown_start_time` | string \| null | UTC ISO-8601 instant the countdown was armed (**R** pressed); `null` if there was none. |
| `capture_time` | string | UTC ISO-8601 instant the frame was actually captured (countdown zero). |
| `countdown_seconds` | number | Configured countdown length used for this capture (`0` = immediate). |

Additive and backward-compatible within v1: readers treat a missing or `null` `capture` as "no
timing recorded", so samples written before the countdown existed still load. Kept for debugging
and future analytics (e.g. how long users take to settle before the shutter).

## `hands[]` object

| Field | Type | Description |
|-------|------|-------------|
| `handedness` | string | `"left"`, `"right"`, or `"unknown"` (physical hand). |
| `confidence` | number | Handedness classification confidence, `[0,1]`. |
| `raw` | array | 21 landmark objects — exact detector output. |
| `normalized` | array | 21 landmark objects — normalizer output (translation+scale). |

Each **landmark** object: `{ "x": number, "y": number, "z": number }`. (No `visibility` in v1 —
MediaPipe Hands does not provide it; it can be added in a later schema version.)

## Example

```json
{
  "schema_version": 1,
  "pose_id": "open_palm",
  "display_name": "Open Palm",
  "description": "Right hand fully open, fingers spread.",
  "sample_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "sample_number": "sample_000001",
  "timestamp": "2026-07-24T13:20:00.123456+00:00",
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "metadata": {
    "timestamp": "2026-07-24T13:20:00.123456+00:00",
    "camera": { "index": 0, "width": 1280, "height": 720 },
    "versions": { "application": "0.1.0", "mediapipe": "0.10.35" },
    "num_hands": 1,
    "hands": [ { "handedness": "right", "confidence": 0.98 } ],
    "capture": {
      "countdown_start_time": "2026-07-24T13:19:57.100000+00:00",
      "capture_time": "2026-07-24T13:20:00.123456+00:00",
      "countdown_seconds": 3.0
    }
  },
  "hands": [
    {
      "handedness": "right",
      "confidence": 0.98,
      "raw": [
        { "x": 0.5123, "y": 0.7421, "z": 0.0000 },
        { "x": 0.4630, "y": 0.6902, "z": -0.0184 }
      ],
      "normalized": [
        { "x": 0.0000, "y": 0.0000, "z": 0.0000 },
        { "x": -0.1934, "y": -0.2037, "z": -0.0721 }
      ]
    }
  ]
}
```

> The `raw` / `normalized` arrays each contain exactly **21** landmarks; the example is truncated
> for brevity. Numbers are written at full precision (readability over size).

## Invariants (enforced by the serializer)

- Exactly 21 landmarks in both `raw` and `normalized` for every hand.
- `pose_id` matches the identifier pattern.
- `sample_uuid` is a valid UUID string; `sample_number` equals the file's stem.
- `normalization.strategy` and `normalization.version` are non-empty strings.
- `num_hands == len(hands) == len(metadata.hands)`.
- No image, frame, or binary payload appears anywhere (Principle II).
