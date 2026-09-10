# Contract: Export Archive & Capture Manifest

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

Defines what a Mudra Web capture export **is**, so Engine — and any tooling later — can understand an
archive by reading one file. The manifest is the entry point; the sample files remain the source of
truth for landmark data.

The manifest is **not** a change to the pose-sample schema. It sits at the archive root, beside the
dataset tree, and is invisible to anything reading individual samples. This mirrors Mudra Capture's
export contract deliberately, so the two applications produce archives of the same shape.

---

## Archive layout

```text
mudra-web-capture-<export-date>.zip
├── manifest.json                                  ← entry point (FR-048)
└── datasets/
    └── poses/
        ├── dragon/
        │   ├── sample_000001.json
        │   ├── sample_000002.json
        │   └── sample_000003.json
        └── peace/
            └── sample_000001.json
```

One export contains **every session currently held in the capture store**, grouped by pose, with
per-pose numbering continuous across sessions (FR-046, FR-047). Extract to a staging directory and
merge from there — see the merge consequence in
[pose-sample-export.md](./pose-sample-export.md#numbering-and-the-merge-consequence).

---

## `manifest.json`

```json
{
  "manifest_version": 1,
  "schema_version": 1,
  "producer": "mudra-web/0.1.0",
  "export_timestamp": "2026-09-07T14:11:03.204000+00:00",
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "dataset_fingerprint": "9f2b1c07…",
  "total_samples": 342,
  "pose_counts": { "dragon": 210, "peace": 132 },
  "sessions": [
    {
      "session_uuid": "3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905",
      "contributor_label": "walter",
      "pose_id": "dragon",
      "display_name": "dragon",
      "required_hands": 2,
      "started_at": "2026-09-07T13:19:56.400000+00:00",
      "total_samples": 210,
      "discarded_samples": 14
    }
  ]
}
```

| Field | Why it is here |
|---|---|
| `manifest_version` | The manifest's own version, independent of the sample schema |
| `schema_version` | Which pose-sample schema the sample files use — `1` |
| `producer` | The same string as each sample's `metadata.versions.application` |
| `export_timestamp` | When this archive was produced. The **only** wall-clock value in the archive; entry timestamps are fixed (see below) |
| `normalization` | The convention every sample in this archive was normalized under |
| `dataset_fingerprint` | The exemplar bundle the browser was running against. Records the *context* of the export, not a property of any sample — which is why it lives here and never in a sample (spec Assumptions) |
| `total_samples`, `pose_counts` | What the archive contains, without walking the tree |
| `sessions[]` | Provenance for each included session, including its discarded count, which no sample carries |

`dataset_fingerprint` is `null` when the build was made with no bundle present — the same "skip the
comparison and say so" handling `bundle-loader.ts` already applies, never an invented value.

---

## Determinism (FR-049, SC-009)

The archive is written by a store-only writer the application owns (research D2). Determinism is a
requirement, not a side effect, and every rule below is separately testable.

| Property | Rule |
|---|---|
| Compression method | `0` (stored) for every entry. No deflate, no ZIP64, no encryption |
| Entry order | `manifest.json` first, then every sample entry sorted lexicographically by full entry name |
| Entry names | Forward slashes only; no leading slash; no `..` segment; no drive letter; UTF-8 bytes, with general-purpose bit 11 (UTF-8 name flag) set |
| Entry timestamps | Fixed constant — the DOS epoch `1980-01-01T00:00:00` (MS-DOS date `0x0021`, time `0x0000`) — for **every** entry. Never `Date.now()` |
| Version-made-by / version-needed | Fixed constants (`20`), never platform-derived |
| External file attributes | Fixed constant `0` |
| CRC-32 | Computed per entry over the exact stored bytes, IEEE polynomial `0xEDB88320` |
| Sizes | Compressed size equals uncompressed size, since every entry is stored |
| Sample file bytes | `JSON.stringify(document, null, 2)` encoded UTF-8 — the same two-space indentation Engine writes |
| Result | Same store content ⇒ **byte-identical archive** across runs and across machines |

The only non-determinism in the whole archive is `manifest.json`'s `export_timestamp`, which is
content, not framing. Two exports of the same store differ in exactly that one value — which is why
SC-009's byte-identity check fixes the clock, exactly as the domain tests do.

---

## Compatibility verification

Correctness is not asserted by reading the writer. It is asserted from outside, in a different
language, by an implementation nobody involved wrote:

`scripts/export_web_capture_fixtures.py` gains an archive check that opens a generated archive with
Python's standard `zipfile` module and asserts:

1. `ZipFile(path)` opens with no warning, and `testzip()` returns `None` — every CRC validates.
2. `namelist()` matches the specified layout exactly: `manifest.json` first, then
   `datasets/poses/<pose_id>/sample_NNNNNN.json` in sorted order.
3. Every entry's `compress_type` is `ZIP_STORED` and every `date_time` is the fixed constant.
4. Every extracted sample file loads through `PoseSerializer.from_json` without error and reports
   `schema_version` 1 — the end-to-end guarantee behind SC-001 and SC-002.
5. Reading the archive twice yields identical bytes (SC-009).

A Web-side test covers the writer's own structure (local headers, central directory,
end-of-central-directory offsets, CRC values against known vectors) so a failure points at a record
layout rather than only at "Python would not open it".

---

## What the archive never contains

- No image, video, canvas pixel, thumbnail, or preview of any kind — including of a captured sample.
  Sample review renders landmark coordinates as vector output and produces nothing exportable
  (FR-052, research D8).
- No segmentation mask.
- No file outside `manifest.json` and `datasets/poses/**`.
- No personally identifying data. The only contributor-associated value in the whole archive is the
  constrained `contributor_label`, in the manifest and in each sample's `metadata.capture`.
