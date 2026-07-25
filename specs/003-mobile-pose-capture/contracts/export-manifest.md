# Contract: Export Archive & Dataset Manifest

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

Defines what a Mudra Capture export **is**, so any importer — the engine today, tooling later — can
understand an archive by reading one file. The manifest is the **official entry point**; the sample
files remain the source of truth for landmark data.

The manifest is **not** a change to the pose-sample schema. It sits beside the dataset tree at the
archive root and is invisible to anything reading individual samples (FR-052).

## Archive layout

```text
mudra_capture_export.zip
├── manifest.json                                  ← entry point (FR-047)
└── datasets/
    └── poses/
        ├── dragon/
        │   ├── sample_000001.json
        │   └── sample_000002.json
        └── peace/
            └── sample_000001.json
```

Unzipping into the engine's repository root merges `datasets/poses/**` directly into its dataset,
with `manifest.json` landing alongside as an inert descriptor (SC-005).

## `manifest.json`

```json
{
  "manifest_version": 1,
  "schema_version": 1,
  "capture_version": "mudra-capture/0.1.0",
  "export_timestamp": "2026-07-24T14:02:11.482000+00:00",
  "platform": "android",
  "device": {
    "manufacturer": "Google",
    "model": "Pixel 7",
    "os_version": "Android 14 (API 34)"
  },
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "total_samples": 342,
  "pose_counts": { "dragon": 210, "peace": 132 },
  "sessions": [
    {
      "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905",
      "pose_id": "dragon",
      "started_at": "2026-07-24T13:19:56.400000+00:00",
      "finished_at": "2026-07-24T13:20:01.180000+00:00",
      "total_samples": 28,
      "discarded_samples": 2,
      "end_reason": "completed"
    }
  ],
  "checksums": {
    "algorithm": "sha256",
    "collections": { "dragon": "9f2b…", "peace": "1c07…" }
  },
  "integrity": {
    "checked_samples": 342,
    "passed": true,
    "critical_failures": [],
    "warnings": [
      { "check": "catalog_coverage", "message": "pose_id 'legacy_sign' is not in the current catalog", "path": "datasets/poses/legacy_sign" }
    ]
  }
}
```

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `manifest_version` | integer | yes | Version of **this** format; currently `1`. Independent of `schema_version` |
| `schema_version` | integer | yes | Sample schema the archive's samples conform to (`1`) |
| `capture_version` | string | yes | Producing application, matching `metadata.versions.application` |
| `export_timestamp` | string | yes | UTC ISO-8601, `+00:00` offset |
| `platform` | string | yes | `android` \| `ios` |
| `device` | object | yes | `manufacturer`, `model`, `os_version` — device class, **never** a user or hardware identifier |
| `normalization` | object | yes | `strategy` + `version` applied across the dataset |
| `total_samples` | integer | yes | MUST equal the actual number of sample files in the archive |
| `pose_counts` | object | yes | `pose_id` → count; MUST sum to `total_samples` |
| `sessions` | array | yes | One entry per session represented in the dataset (FR-046) |
| `checksums` | object | no | `algorithm` + per-collection digest; omitted when disabled or uncomputable (FR-047 "where available") |
| `integrity` | object | yes | The pre-export validation result (FR-048) |

### `sessions[]`

`session_uuid`, `pose_id`, `started_at`, `finished_at`, `total_samples`, `discarded_samples`,
`end_reason` (`completed` | `limit_reached`). Only sessions that actually produced samples appear —
cancelled, aborted, and failed sessions write nothing and are therefore not represented.

Every sample's `metadata.capture.session_uuid` MUST resolve to an entry here (SC-013). This is what
makes traceability survive even the engine round-trip that currently drops the field from a sample.

### `checksums`

`sha256` over each pose collection: the digest of the concatenated file contents in ascending sample
number order. Recomputable by any importer without trusting the producer, which is the only kind of
checksum worth publishing.

## Integrity validation (FR-048)

Runs **before** packaging. Critical failures abort the export — no archive is produced (SC-015).
Warnings are recorded in the manifest and do not block.

| Check | Severity | Fails when |
|---|---|---|
| `parseable_json` | critical | A sample file is not valid JSON |
| `schema_compliance` | critical | Missing required fields, `schema_version != 1`, hand without exactly 21 landmarks, `num_hands` inconsistent with `hands` |
| `folder_structure` | critical | A sample sits outside `datasets/poses/<pose_id>/`, or a filename does not match `sample_NNNNNN.json` |
| `duplicate_detection` | critical | A `sample_uuid` appears twice, or a sample number repeats within one pose |
| `valid_pose_ids` | critical | A directory name or a sample's `pose_id` violates `^[a-z0-9_]+$`, or the two disagree |
| `manifest_generation` | critical | Totals cannot be reconciled with the files on disk |
| `catalog_coverage` | warning | A `pose_id` is absent from the current catalog — legitimate after a catalog edit |

On abort the user sees which check failed and on which file, in plain language. A dataset that
cannot be validated is never handed to the engine.

## Verification

- Exporter tests assert: manifest present at the archive root, `total_samples` equals the real file
  count, `pose_counts` sums correctly, every sample's `session_uuid` resolves to a `sessions[]` entry,
  and checksums recompute.
- A seeded-corruption test asserts each critical check aborts the export and produces **no** archive.
- The engine import check in [quickstart.md](../quickstart.md) proves the archive still unzips
  straight into the engine's dataset (SC-005).
