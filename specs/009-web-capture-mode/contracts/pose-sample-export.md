# Contract: Pose Sample JSON (engine schema v1, as emitted by Mudra Web)

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

This is **not a new schema**. It is Engine's schema v1
([`specs/002-pose-recorder/contracts/json-schema.md`](../../002-pose-recorder/contracts/json-schema.md),
implemented by `apps/engine/dataset/serializer.py`), restated here only to pin down the choices Mudra
Web must make when filling fields that are ambiguous in a browser. Any disagreement between the two
documents is a bug in this one.

Mudra Capture's equivalent document
([`specs/003-mobile-pose-capture/contracts/sample-json.md`](../../003-mobile-pose-capture/contracts/sample-json.md))
is the precedent this contract follows deliberately, so that a merged dataset carries one set of
conventions rather than two.

**Binding rule**: Web MUST NOT rename, remove, reorder, or redefine any existing field.
`schema_version` stays `1`. A breaking change is a cross-application event requiring Engine to change
first (constitution, Monorepo & Cross-Application Boundaries).

---

## Document shape and key order

Key order is part of this contract, because it is machine-checked (see *Verification* below). The
order is Engine's, exactly as `PoseSerializer.to_dict` builds it. Additive fields are shown **bold**.

```json
{
  "schema_version": 1,
  "pose_id": "dragon",
  "display_name": "dragon",
  "description": null,
  "sample_uuid": "0f0b5f2a-1c9e-4a1b-9a1e-8f2d3c4b5a60",
  "sample_number": "sample_000001",
  "timestamp": "2026-09-07T14:02:11.482000+00:00",
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "metadata": {
    "timestamp": "2026-09-07T14:02:11.482000+00:00",
    "camera": {
      "index": 0,
      "width": 1280,
      "height": 720,
      "mirrored_preview": true
    },
    "versions": { "application": "mudra-web/0.1.0", "mediapipe": "0.10.14" },
    "num_hands": 2,
    "hands": [
      { "handedness": "right", "confidence": 0.9921215772628784 },
      { "handedness": "left",  "confidence": 0.9873441457748413 }
    ],
    "capture": {
      "countdown_start_time": "2026-09-07T14:02:08.480000+00:00",
      "capture_time": "2026-09-07T14:02:11.482000+00:00",
      "countdown_seconds": 3.0,
      "countdown_enabled": true,
      "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905",
      "contributor_label": "walter"
    }
  },
  "hands": [
    {
      "handedness": "right",
      "confidence": 0.9921215772628784,
      "raw": [ { "x": 0.238, "y": 0.806, "z": 2.7877436536982714e-7 }, "… 21 total" ],
      "normalized": [ { "x": 0.0, "y": 0.0, "z": 0.0 }, "… 21 total" ]
    }
  ]
}
```

---

## Field provenance

Every field, where its value comes from, and why that value is truthful.

| Field | Value in Mudra Web | Justification |
|---|---|---|
| `schema_version` | `1` | The contract. Never varies. |
| `pose_id` | The pose the operator selected | FR-025 — never inferred by recognition |
| `display_name` | From the loaded exemplar data when the pose exists there; the operator's optional entry for a new pose; otherwise `null` | FR-014a. The bundle manifest already carries `display_name` per pose, derived from the dataset (research D10 of feature 007) |
| `description` | Always `null` | FR-014b — the browser loads no description; inventing one would be untruthful under FR-030 |
| `sample_uuid` | UUID v4 minted when the sample is accepted | Globally unique, so duplicates from a repeated export are detectable (FR-052b) |
| `sample_number` | `sample_NNNNNN`, assigned **at export time**, matching the archive filename | Numbering is a property of the archive, not of a stored sample — see *Numbering* below |
| `timestamp` | Instant the sample was accepted, Engine format | research D3 |
| `normalization.strategy` | `translation_scale` | The value the application's own `normalize()` implements — `NORMALIZATION_STRATEGY` |
| `normalization.version` | `1.0` | `NORMALIZATION_VERSION`. Both are read from the existing normalization module, never re-typed |
| `metadata.timestamp` | Same as top-level `timestamp` | Engine's own convention |
| `metadata.camera.index` | `0` | Required by Engine (looked up unconditionally). Browsers expose no stable camera index; `0` is documented to mean "the default camera this session opened" and carries no other meaning (research D4) |
| `metadata.camera.width` / `.height` | `MirroredSurface.width` / `.height` | Real device pixels of the analysed surface |
| `metadata.versions.application` | `mudra-web/<package version>` | Existing Engine-owned field. Carries the producing application, so **no `source` field is added** (FR-034, research D5) |
| `metadata.versions.mediapipe` | The installed `@mediapipe/tasks-vision` version | The detection backend actually used |
| `metadata.num_hands` | `hands.length` | Always consistent with the arrays below |
| `metadata.hands[]` | Per detected hand: `handedness`, `confidence` | Mirrors `hands[]` exactly |
| `metadata.capture.countdown_start_time` | Instant the take was triggered | For a disabled countdown this is the trigger instant — a zero-length countdown |
| `metadata.capture.capture_time` | Instant this sample was accepted | Differs per sample within a burst |
| `metadata.capture.countdown_seconds` | Configured countdown in seconds; `0.0` when disabled | Engine's existing default already means the same thing |
| `hands[].handedness` | The detector's label | Correct without adjustment — see *Coordinates* below |
| `hands[].confidence` | The detector's handedness score, in `[0,1]` | |
| `hands[].raw` | 21 canonical-raw points | See *Coordinates* |
| `hands[].normalized` | `normalize(raw)` | The application's existing normalization, reused (FR-024) |

---

## Additive fields — four, each justified

Every one is **additive, optional, and inside a block Engine already reads**, so a reader that ignores
them still reads every sample correctly. Engine's `_metadata_from_dict` and `_capture_from_dict`
rebuild these blocks by explicit key lookup with no `extra="forbid"` and no strict shape check —
verified, not assumed — so unknown keys are ignored and Engine loads these samples today.

| Field | Block | Status | Why it is genuinely required |
|---|---|---|---|
| `session_uuid` | `metadata.capture` | Established by Capture | The recording session is the unit of review, deletion and export (FR-031). Without it, a sample merged into the dataset cannot be traced to the take that produced it |
| `contributor_label` | `metadata.capture` | **New in this feature** | After an archive is merged into `datasets/poses/`, `manifest.json` is no longer alongside the samples. A per-sample label is the only way a contributor's batch can be reviewed or withdrawn later. This is the concrete need; without it the field would be provenance theatre |
| `countdown_enabled` | `metadata.capture` | Established by Capture | Distinguishes "no countdown" from "a countdown configured to zero seconds", which `countdown_seconds` alone cannot |
| `mirrored_preview` | `metadata.camera` | Established by Capture | Records the coordinate convention of `raw`, so a future normalization strategy re-derived from `raw` cannot inherit an ambiguity. Always `true` in Web — and written anyway, because a merged dataset in which the same key is present for phone samples and absent for browser samples would carry two conventions where it should carry one |

### Deliberately omitted

| Field | Why Web does not write it |
|---|---|
| `metadata.camera.position` | The browser cannot determine which physical lens is in use. `facingMode` is a request, not a guarantee, and on a laptop the concept does not apply. An absent optional field is correct where an invented value would be false (FR-032) |
| `metadata.camera.lens_facing` | Same reason: there is no platform lens constant in a browser |
| Any UI or configuration value | Burst size, capture interval, viewport size, user agent, locale, device information — none appears in a sample. Knowing a value is not a reason to export it (FR-033) |

**Rule for any future addition**: additive, optional, inside an existing block, tolerated when absent,
and justified in this table. Anything else requires a `schema_version` bump and an Engine change first.

---

## Coordinates: mirroring is not a display treatment

This is the point the specification asked to be made unambiguous, and it is settled by how the
pipeline is actually built, not by convention.

`CanvasMirroredSurface` draws each camera frame into a canvas with a horizontal flip
(`setTransform(-1, 0, 0, 1, width, 0)`), and **that canvas is simultaneously what the detector
analyses and what the operator sees** (feature 007, research D1). Therefore:

- The detector's output is **already** in mirrored (selfie) space — the same space the recorded dataset
  uses, and the space MediaPipe assumes when it labels handedness.
- **No landmark coordinate is ever flipped afterwards.** `mirrorNormalizedX` exists in the codebase for
  exactly one purpose — feeding a known-convention input through the mirroring test — and nothing in
  the pipeline calls it.
- **No handedness label is ever swapped.** The label already names the operator's physical hand.

So `hands[].raw` is the earliest **canonical** observation, in the sense Mudra Capture's R1 revision
defined for that key: the dataset is the canonical source of truth, not a recording of a detector. A
browser reaches that convention natively rather than by conversion, which is why `mirrored_preview` is
`true` and why there is nothing to convert.

`hands[].normalized` is `normalize(raw)` using the application's existing translation-scale
normalizer — wrist re-origined to `(0,0,0)`, divided by the wrist-to-middle-MCP span, rotation
deliberately preserved. There is no second normalization in this feature (FR-024).

---

## Numbering and the merge consequence

Within an archive, sample files are numbered `sample_NNNNNN.json`, zero-padded to six digits,
sequential per `pose_id`, starting at `000001`, and **continuous across every session contributing to
that pose** (FR-047). `sample_number` inside the document always equals its filename.

Numbering is assigned at export, not at capture, because it is a property of the archive: two sessions
for one pose produce one unbroken sequence, which is only knowable once the export set is known.

**Known consequence, stated plainly** (the same class of consequence Capture's contract records):
extracting an archive directly over an existing `datasets/poses/` can overwrite same-named files, and
because export never mutates the store (FR-052a) a second export re-emits samples the first already
contained. Both are handled the same way: **extract to a staging directory, then merge**. Every sample
carries a globally unique `sample_uuid`, so duplicates are always detectable regardless of filename.

---

## Verification

Engine remains the authority. `scripts/export_web_capture_fixtures.py` writes
`apps/web/test/fixtures/pose_sample_cases.json`, where each case carries:

- `inputs` — pose identity, session metadata and per-hand raw landmarks;
- `engine_document` — `PoseSerializer.to_dict(...)` for those inputs, Engine's own output;
- `expected_document` — the same document with the four additive fields inserted at their contracted
  positions.

The Web suite then asserts three things per case:

1. **Full structural match**: the Web serializer's output matches `expected_document` — same key set
   and same key **order** at every level, same array lengths and order, exact equality of every numeric
   value as a double, and identical strings, booleans and nulls (FR-066).
2. **Additive-and-nothing-else**: removing the four contracted keys from the Web output reproduces
   `engine_document` exactly, key order included. This is what makes "additive only" a machine-checked
   rule rather than a promise.
3. **Byte equality is not required**: Python renders `2.79e-07` where JavaScript renders `2.79e-7` for
   the same IEEE-754 double. The values are identical and only the text differs, so comparison is on
   parsed structure (research D9). Both `JSON.parse` and `JSON.stringify` preserve insertion order for
   the non-integer string keys this schema uses, so key order is genuinely comparable.

The generator additionally asserts, on the Python side, that `PoseSerializer.from_dict` loads both
`engine_document` and `expected_document` without error — proving the additive fields do not break
Engine's reader.

Fixtures are regenerated whenever Engine's schema handling changes. A resulting diff is a
cross-application event to be handled deliberately, never a file to re-baseline (FR-067).

**Cases covered** (FR-065): one hand; two hands; countdown enabled; countdown disabled; absent optional
fields (`display_name` and `description` both null); and a numeric-stress case carrying very small
magnitudes, negatives, and values requiring full double precision.
