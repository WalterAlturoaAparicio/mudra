# Contract: Pose Sample JSON (engine schema v1, as emitted by Capture)

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24 · revised 2026-07-26 (**Revision R1**)

This is **not a new schema**. It is the engine's schema v1
([`specs/002-pose-recorder/contracts/json-schema.md`](../../002-pose-recorder/contracts/json-schema.md)),
restated here only to pin down the choices Capture must make when filling fields that are ambiguous
on a phone. Any disagreement between the two documents is a bug in this one.

**Binding rule**: Capture MUST NOT rename, remove, reorder, or redefine any existing field.
`schema_version` stays `1`. A *breaking* change is a cross-application event requiring the engine to
change first (constitution, Monorepo & Cross-Application Boundaries).

## Additive fields

Five values Capture stores that the engine's schema does not name. Every one is **additive, optional,
and inside a block the engine already reads**, so a reader that ignores them still reads every sample
correctly (FR-052).

| Field | Block | Requirement | Added |
|---|---|---|---|
| `session_uuid` | `metadata.capture` | FR-045 | baseline |
| `countdown_enabled` | `metadata.capture` | FR-083 | **R1** |
| `position` | `metadata.camera` | FR-081 | **R1** |
| `mirrored_preview` | `metadata.camera` | FR-082 | **R1** |
| `lens_facing` | `metadata.camera` | FR-084 | **R1** |

```json
"camera": {
  "index": 1,
  "width": 640,
  "height": 480,
  "position": "front",
  "mirrored_preview": true,
  "lens_facing": 1
},
"capture": {
  "countdown_start_time": "2026-07-24T13:19:56.400000+00:00",
  "capture_time": "2026-07-24T13:20:00.123456+00:00",
  "countdown_seconds": 3.0,
  "countdown_enabled": true,
  "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905"
}
```

**Why this is compatible**:

- `schema_version` stays `1`; no existing field changes meaning or position.
- **Verified, not assumed**: `apps/engine/dataset/serializer.py` rebuilds `metadata.camera` and
  `metadata.capture` by explicit key lookup on plain frozen dataclasses — there is no `extra="forbid"`
  and no strict shape check. Unknown keys are ignored; the engine loads these samples today,
  unmodified.
- This is the **same additive pattern the engine itself used** when `metadata.capture` was introduced
  in feature 002 (optional block, `null`/absent tolerated, no version bump).
- A reader that knows nothing about sessions or lenses still reads every sample correctly.

**Placement rationale** (research D19): `countdown_enabled` sits in `metadata.capture` beside
`countdown_seconds` because it describes the take, not the lens. `lens_facing` is stored even though
`metadata.camera.index` currently holds the same integer, because `index` is an **engine-owned** field
that Capture fills with a lens constant by local convention; FR-084 asks for the platform's own
identifier independently of that convention. A test asserts the two agree, so the redundancy cannot
drift into a contradiction.

**Countdown disabled**: `countdown_enabled` is `false`, `countdown_seconds` is `0.0`, and
`countdown_start_time` is the instant Record was pressed — a zero-length countdown. No field becomes
newly nullable, and the engine's existing default (`countdown_seconds: float = 0.0`) already means the
same thing.

**Known consequence, stated plainly**: the engine's serializer preserves only the keys it knows, so
an engine load-then-resave cycle **drops** all five additive fields. Samples written by Capture and
read by the engine are unaffected; only a rewrite loses them. Teaching the engine's `PoseMetadata` and
`CaptureTiming` to carry and re-emit them is a small follow-up **on the engine side** — tracked as
such, not silently assumed. Until then, `manifest.json` (see
[export-manifest.md](./export-manifest.md)) carries the session records independently, so traceability
survives even if a sample is rewritten.

**Rule for any future addition**: additive, optional, inside an existing block, tolerated when
absent, and documented here. Anything else requires a `schema_version` bump and an engine change
first.

## The `raw` field: same key, redefined meaning (R1)

FR-056 redefines what the existing `hands[].raw` array **means**, without touching the schema.

| | Before R1 | After R1 |
|---|---|---|
| Key | `raw` | `raw` (unchanged) |
| Shape | 21 `{x,y,z}` objects | unchanged |
| Meaning | Verbatim detector output | The earliest **canonical** observation — detector output already converted into the canonical viewing convention if the lens did not natively produce it |

**Nothing breaks mechanically**: no field is renamed, added, removed, or reordered; `schema_version`
stays `1`; every sample already on disk stays valid and readable; the engine requires no change to
load R1 samples.

**What does change**: a rear-lens sample's `raw` array is not byte-for-byte what MediaPipe emitted.
This is deliberate and specified — the dataset is the canonical source of truth, not a recording of a
detector (FR-055). Without it, `raw` would be lens-dependent and a future normalization strategy
re-derived from it would inherit the split.

**Known consequence**: the engine documents `HandSample.raw` as "raw and normalized landmark sets",
which now under-describes what a Capture-produced sample contains. This is a **documentation**
follow-up on the engine side — not a schema change, and not a gate on this feature. It is recorded
in the spec's Revision History so it is not lost.

**In Dart, the field is named `canonicalRaw`** while the serializer writes the key `"raw"`. A test
pins that divergence so a future reader does not "correct" the serializer and silently change the
schema.

## File location

```text
<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json
```

`NNNNNN` is zero-padded to 6 digits, sequential per pose, never reused (FR-029).

## Mobile-specific field resolutions

| Field | Value on Capture | Why |
|---|---|---|
| `metadata.camera.index` | Android `CameraSelector` lens-facing constant — `0` = back, `1` = front. **(R1)** Reflects the lens actually used, so it is `0` for Operator Capture. | A phone has no OpenCV device index; the platform's own constant is stable and meaningful. |
| `metadata.camera.position` | `"front"` or `"rear"` **(R1)** | Platform-neutral statement of FR-081; readable without knowing a platform's constants. |
| `metadata.camera.mirrored_preview` | Whether the person posing saw a mirrored image **(R1)** | FR-082. Reports what was **used**, not what was stored — a converted rear-lens sample still says `false` (FR-058). |
| `metadata.camera.lens_facing` | The platform's own lens identifier, verbatim **(R1)** | FR-084. Equals `index` by construction; see the placement rationale above. |
| `metadata.capture.countdown_enabled` | Whether a countdown preceded this take **(R1)** | FR-083. `countdown_seconds` alone cannot distinguish "disabled" from "configured to zero". |
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
    "camera": {
      "index": 1,
      "width": 640,
      "height": 480,
      "position": "front",
      "mirrored_preview": true,
      "lens_facing": 1
    },
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
      "countdown_enabled": true,
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

The same take recorded in Operator Capture differs only in `metadata` — `"index": 0`,
`"position": "rear"`, `"mirrored_preview": false` — while `handedness` and the landmark arrays are in
the **same** convention as the example above, because the conversion ran before storage (FR-053).
That is the whole point: the sample body is lens-independent, and the metadata says which lens
produced it anyway.

## Verification

- **Golden fixtures**: sample documents produced by the Python engine live in
  `apps/capture/test/fixtures/`. Dart tests assert that (a) Capture's serializer reproduces the same
  parsed structure for the same input, and (b) Capture's normalizer reproduces the engine's
  `normalized` arrays within exact double equality.
- **Round trip**: `deserialize(serialize(sample)) == sample` for every fixture and generated sample.
- **Import check** (manual, `quickstart.md`): unzip an export into the engine's `datasets/` and load
  every sample with the engine's own `PoseSerializer` — zero errors, zero manual edits (SC-005).
- **(R1) Additive-field tolerance**: a sample carrying all five additive fields loads through the
  engine's `PoseSerializer` without error, and a **pre-R1 fixture with none of them** still loads
  through Capture's own deserializer with the fields absent rather than wrong (SC-026).
- **(R1) Key/name divergence**: a test asserts the serializer emits `"raw"` for the Dart field
  `canonicalRaw`, and that `lens_facing == index` in every emitted sample.
- **(R1) Cross-lens agreement**: the same physical hand recorded in both modes produces the same
  `handedness` and landmark geometry within the tolerance accepted between two consecutive samples of
  one take, while each sample still reports its own lens (SC-031).
