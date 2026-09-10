# Contract: Exemplar Bundle

**Feature**: `007-mudra-web` | **Producer**: `scripts/export_web_exemplars.py` | **Consumer**: `apps/web/`

Two files: a JSON manifest and a binary payload. The full dataset is never shipped to the browser
(FR-079).

## Files

```
apps/web/public/exemplars.manifest.json    # provenance, per-pose metadata, offsets
apps/web/public/exemplars.bin              # Float32Array payload  (~574 KB)
```

Both are **build artifacts**, generated into `public/` and git-ignored. They are not source, and the
dataset they derive from is never modified (FR-086).

## Manifest

```jsonc
{
  "format_version": 1,
  "generated_at": "2026-08-20T00:00:00Z",
  "dataset_fingerprint": "sha256:…",        // over sorted (path, sha256) of every included sample
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "min_samples": 20,
  "landmark_count": 21,
  "components": 3,
  "total_hands": 2333,
  "poses": [
    { "pose_id": "hi", "display_name": "Hi", "required_hands": 1,
      "sample_count": 112, "hand_offset": 0, "hand_count": 112,
      "hands": [ { "sample_id": "…", "handedness": "left" } ] }
  ],
  "excluded": [
    { "pose_id": "domain_expansion", "sample_count": 1, "reason": "below_min_samples" }
  ]
}
```

| Field | Purpose | Requirement |
|---|---|---|
| `format_version` | Consumer rejects an unknown version rather than misreading it | FR-083 |
| `dataset_fingerprint` | Detects a stale bundle built from a different dataset revision | FR-082, FR-083 |
| `normalization` | Records which convention the coordinates are in | FR-082 |
| `hand_offset` / `hand_count` | Slice into the payload; no per-hand parsing | FR-080 |
| `hands[].sample_id` | **Required** — two-handed matching pairs hands from the same take | FR-022 |
| `excluded[]` | **Mandatory.** A pose must never disappear silently | FR-023a, FR-085 |

## Payload

`Float32Array` of `total_hands × 21 × 3`, little-endian, `[x, y, z]` per landmark, hands in manifest
order. No header — the manifest describes the layout.

## Determinism (FR-081)

The same dataset **must** produce byte-identical output. Guaranteed by:

- Poses iterated in sorted `pose_id` order; samples in sorted filename order; hands in stored order.
- `float32` conversion is a well-defined IEEE-754 narrowing, unlike decimal float formatting.
- `generated_at` is excluded from `dataset_fingerprint`, so a rebuild at a different time still yields
  an identical fingerprint (the timestamp is provenance, not identity).

A test runs the export twice and compares both files byte for byte (FR-084).

## Staleness detection

At load the application verifies `format_version`, and compares the manifest's
`dataset_fingerprint` against the value embedded in the build. A mismatch is reported prominently
rather than silently producing degraded recognition (FR-083).

## Pose populations

| Population | Count | Determined by |
|---|---|---|
| Catalog poses | **18** | Pose identities defined in the project |
| Eligible poses | **17** | ≥ `min_samples` (20) recorded samples |
| Active poses | **4** default | Runtime configuration — *not* a property of the bundle |

The bundle contains **all 17 eligible** poses regardless of the active set, so widening recognition
coverage is a configuration change and never a re-export (FR-080).

Verified against the repository on 2026-08-20: 18 catalog poses, 1,378 total samples, one exclusion
(`domain_expansion`, 1 sample). Of the 17 eligible, 5 are one-handed and 12 are two-handed.
