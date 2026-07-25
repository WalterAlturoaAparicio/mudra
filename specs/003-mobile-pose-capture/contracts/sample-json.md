# Contract: Pose Sample JSON (engine schema v1, as emitted by Capture)

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

This is **not a new schema**. It is the engine's schema v1
([`specs/002-pose-recorder/contracts/json-schema.md`](../../002-pose-recorder/contracts/json-schema.md)),
restated here only to pin down the choices Capture must make when filling fields that are ambiguous
on a phone. Any disagreement between the two documents is a bug in this one.

**Binding rule**: Capture MUST NOT rename, remove, reorder, or redefine any existing field.
`schema_version` stays `1`. A *breaking* change is a cross-application event requiring the engine to
change first (constitution, Monorepo & Cross-Application Boundaries).

## The one addition: `metadata.capture.session_uuid`

FR-045 requires every sample to reference the session that produced it, while FR-052 forbids
redefining the engine's schema. Both are satisfied by a **single additive, optional field** inside
the existing `metadata.capture` block:

```json
"capture": {
  "countdown_start_time": "2026-07-24T13:19:56.400000+00:00",
  "capture_time": "2026-07-24T13:20:00.123456+00:00",
  "countdown_seconds": 3.0,
  "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905"
}
```

**Why this is compatible**:

- `schema_version` stays `1`; no existing field changes meaning or position.
- The engine's `PoseSerializer` reads `metadata.capture` by explicit key lookup and ignores unknown
  keys — it loads these samples today, unmodified.
- This is the **same additive pattern the engine itself used** when `metadata.capture` was introduced
  in feature 002 (optional block, `null`/absent tolerated, no version bump).
- A reader that knows nothing about sessions still reads every sample correctly.

**Known consequence, stated plainly**: the engine's serializer preserves only the keys it knows, so
an engine load-then-resave cycle **drops** `session_uuid`. Samples written by Capture and read by the
engine are unaffected; only a rewrite loses it. Teaching the engine's `CaptureTiming` to carry and
re-emit the field is a small follow-up **on the engine side** — tracked as such, not silently assumed.
Until then, `manifest.json` (see [export-manifest.md](./export-manifest.md)) carries the session
records independently, so traceability survives even if a sample is rewritten.

**Rule for any future addition**: additive, optional, inside an existing block, tolerated when
absent, and documented here. Anything else requires a `schema_version` bump and an engine change
first.

## File location

```text
<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json
```

`NNNNNN` is zero-padded to 6 digits, sequential per pose, never reused (FR-029).

## Mobile-specific field resolutions

| Field | Value on Capture | Why |
|---|---|---|
| `metadata.camera.index` | Android `CameraSelector` lens-facing constant — `0` = back, `1` = front. Capture uses `1`. | A phone has no OpenCV device index; the platform's own constant is stable and meaningful. |
| `metadata.camera.width` / `height` | The `ImageAnalysis` frame dimensions the landmarks were computed from — **not** the preview or display size. | Landmark coordinates are normalized against the analysis frame; recording anything else makes `to_pixel` wrong on import. |
| `metadata.versions.application` | `"mudra-capture/<app version>"`, e.g. `mudra-capture/0.1.0`. | Preserves producer provenance inside an existing string field without touching the schema. |
| `metadata.versions.mediapipe` | MediaPipe Tasks version reported by the native side, e.g. `"0.10.14"`. | Makes model drift between engine and phone detectable from the dataset itself. |
| `metadata.capture.countdown_start_time` | Instant Record was pressed (UTC ISO-8601). | Same semantics as the engine's countdown recorder. |
| `metadata.capture.capture_time` | Instant **this frame** was captured — distinct per sample within one session. | A session yields many samples; each carries its own shutter instant. |
| `metadata.capture.countdown_seconds` | Configured countdown length. | |
| `metadata.capture.session_uuid` | UUID v4 of the capture session that produced this sample. | Traceability (FR-045); additive and optional — see the section above. |
| `normalization.strategy` / `version` | `"translation_scale"` / `"1.0"` — always. | Parity with the engine's normalizer (research D4). |
| `sample_uuid` | UUID v4 minted per sample. | |
| `display_name` / `description` | Copied from the catalog entry, or `null`. | Catalog is the source of pose identity metadata. |

## Timestamp format

All timestamps are UTC ISO-8601 with microsecond precision and an explicit `+00:00` offset:

```text
2026-07-24T13:20:00.123456+00:00
```

Dart's `toIso8601String()` emits a trailing `Z`; Capture MUST convert to `+00:00` so the text matches
what the engine writes. Both forms parse identically, but a dataset that mixes them is needlessly
hard to diff.

## Numeric text

Dart prints shortest round-trip decimals; Python prints `repr`. The two may differ textually for the
same value (`0.1` vs `0.1`, `1e-7` vs `1.0000000000000001e-07`). This is acceptable: the schema
constrains **values**, and both parse to the same IEEE-754 double. Tests compare parsed values, not
strings.

## Example (truncated landmark arrays)

```json
{
  "schema_version": 1,
  "pose_id": "dragon",
  "display_name": "Dragon",
  "description": "Both hands interlocked, index fingers extended.",
  "sample_uuid": "9f1c2e64-8b7a-4c33-9a51-2f0d7a5b1c88",
  "sample_number": "sample_000042",
  "timestamp": "2026-07-24T13:20:00.123456+00:00",
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "metadata": {
    "timestamp": "2026-07-24T13:20:00.123456+00:00",
    "camera": { "index": 1, "width": 640, "height": 480 },
    "versions": { "application": "mudra-capture/0.1.0", "mediapipe": "0.10.14" },
    "num_hands": 2,
    "hands": [
      { "handedness": "left", "confidence": 0.97 },
      { "handedness": "right", "confidence": 0.98 }
    ],
    "capture": {
      "countdown_start_time": "2026-07-24T13:19:56.400000+00:00",
      "capture_time": "2026-07-24T13:20:00.123456+00:00",
      "countdown_seconds": 3.0,
      "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905"
    }
  },
  "hands": [
    {
      "handedness": "left",
      "confidence": 0.97,
      "raw": [ { "x": 0.51, "y": 0.74, "z": 0.0 } ],
      "normalized": [ { "x": 0.0, "y": 0.0, "z": 0.0 } ]
    }
  ]
}
```

## Verification

- **Golden fixtures**: sample documents produced by the Python engine live in
  `apps/capture/test/fixtures/`. Dart tests assert that (a) Capture's serializer reproduces the same
  parsed structure for the same input, and (b) Capture's normalizer reproduces the engine's
  `normalized` arrays within exact double equality.
- **Round trip**: `deserialize(serialize(sample)) == sample` for every fixture and generated sample.
- **Import check** (manual, `quickstart.md`): unzip an export into the engine's `datasets/` and load
  every sample with the engine's own `PoseSerializer` — zero errors, zero manual edits (SC-005).
