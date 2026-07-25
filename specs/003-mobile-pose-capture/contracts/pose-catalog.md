# Contract: Pose Catalog Configuration

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

The catalog is **data, not code** (FR-001). Adding, renaming, retargeting, or reordering poses is an
asset edit — no widget, screen, or use case changes.

**Location**: `apps/capture/assets/config/pose_catalog.json`

## Format

```json
{
  "catalog_version": 1,
  "defaults": {
    "target_sample_count": 500,
    "required_hands": 1
  },
  "poses": [
    {
      "pose_id": "dragon",
      "display_name": "Dragon",
      "description": "Both hands interlocked, index fingers extended upward.",
      "reference_image": "assets/poses/dragon.png",
      "target_sample_count": 500,
      "required_hands": 2
    }
  ]
}
```

## Fields

| Field | Type | Required | Rules |
|---|---|---|---|
| `catalog_version` | integer | yes | Currently `1`; an unknown version fails loudly at startup |
| `defaults.target_sample_count` | integer | no | `> 0`, default `500`; applied when an entry omits it |
| `defaults.required_hands` | integer | no | `1` or `2`, default `1` |
| `poses[].pose_id` | string | yes | `^[a-z0-9_]+$`, ≤64 chars, **unique** — the engine's identifier rule, so a folder name is always filesystem-safe |
| `poses[].display_name` | string | yes | Non-empty; never used as an identifier (Principle III) |
| `poses[].description` | string | no | Shown under the reference image; may be empty |
| `poses[].reference_image` | string | no | Asset path. **May point at a file that does not exist** — the UI renders a placeholder (FR-005) |
| `poses[].target_sample_count` | integer | no | `> 0`; falls back to `defaults` |
| `poses[].required_hands` | integer | no | `1` or `2`; frames with fewer valid hands are discarded (FR-019a) |

## Validation

Performed once at load, before any screen renders. On failure the app shows an explicit error naming
the offending entry and does not start the capture flow — a malformed catalog is a developer error,
not a user condition.

1. `catalog_version` is known.
2. `poses` is non-empty.
3. Every `pose_id` matches the pattern, is ≤64 chars, and is unique across the catalog.
4. Every `display_name` is non-empty.
5. Every resolved `target_sample_count` is `> 0`.
6. Every resolved `required_hands` is `1` or `2`.

Reference images are **not** validated for existence — that is the placeholder path, by design.

## Initial catalog (FR-003)

Exactly these 18 poses, in this order:

| `pose_id` | `display_name` | `required_hands` |
|---|---|---|
| `bird` | Bird | 2 |
| `dog` | Dog | 2 |
| `domain_expansion` | Domain Expansion | 2 |
| `dragon` | Dragon | 2 |
| `hare` | Hare | 2 |
| `hi` | Hi | 1 |
| `horse` | Horse | 2 |
| `militar_hi` | Military Hi | 1 |
| `monkey` | Monkey | 2 |
| `ok` | OK | 1 |
| `ox` | Ox | 2 |
| `peace` | Peace | 1 |
| `ram` | Ram | 2 |
| `rat` | Rat | 2 |
| `snake` | Snake | 2 |
| `tiger` | Tiger | 2 |
| `tp` | TP | 2 |
| `wild_boar` | Wild Boar | 2 |

**Note on `required_hands`**: the traditional hand seals (bird, dog, dragon, hare, horse, monkey, ox,
ram, rat, snake, tiger, boar) are two-handed by construction, while `hi`, `militar_hi`, `ok`, and
`peace` are single-hand gestures. These values are an editable starting point — if a pose is being
collected one-handed on purpose, change the number in this file and nothing else.

## Reference images

- Resolved from `assets/poses/<pose_id>.png` by convention; `reference_image` may override the path.
- Ship as placeholders until artwork exists. Dropping real images into `assets/poses/` and running a
  build is the entire adoption path — no code change (FR-005).
- Reference images are **UI guidance only**: never persisted into a dataset, never referenced from a
  sample, never used for recognition (FR-031, Principle II).
