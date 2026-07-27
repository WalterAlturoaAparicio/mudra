# Contract: Effect Catalog (`assets/config/effect_catalog.json`)

**Feature**: 005-live-recognition-preview | **Date**: 2026-07-26

Mirrors `assets/config/pose_catalog.json` deliberately (specification 003,
`contracts/pose-catalog.md`): configuration data, loaded and validated once at startup, never
hardcoded per-pose branches in UI code (FR-019). Authoring or changing an effect is an edit to
this file, never a Dart change.

## Format

```json
{
  "catalog_version": 1,
  "effects": [
    {
      "pose_id": "horse",
      "kind": "spritePair",
      "sprite_asset": "assets/effects/horse_ears.png",
      "intensity": 0.8
    },
    {
      "pose_id": "dog",
      "kind": "spritePair",
      "sprite_asset": "assets/effects/dog_ears.png"
    },
    {
      "pose_id": "snake",
      "kind": "glow",
      "color": "#2BB673"
    },
    {
      "pose_id": "dragon",
      "kind": "particleBurst",
      "color": "#FF7A3D",
      "intensity": 1.0
    },
    {
      "pose_id": "bird",
      "kind": "spritePair",
      "sprite_asset": "assets/effects/feathers.png"
    },
    {
      "pose_id": "tp",
      "kind": "fadeWithLines"
    }
  ],
  "generic_fallback": {
    "kind": "genericConfirm",
    "color": "#4C6FFF"
  }
}
```

## Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `catalog_version` | `int` | yes | Format version, independent of the pose-sample `schema_version` — this file has nothing to do with the persisted dataset schema. |
| `effects[].pose_id` | `string` | yes | Matches a `pose_id` in `pose_catalog.json`. A `pose_id` with no entry here uses `generic_fallback` (FR-020) — this is legal, not an error. |
| `effects[].kind` | `string` | yes | One of the fixed `EffectKind` values: `glow`, `spritePair`, `particleBurst`, `fadeWithLines`, `genericConfirm` (research D8). |
| `effects[].color` | `string?` | no | Hex color, used by `glow`/`particleBurst`/`fadeWithLines`. Absent falls back to a kind-specific default color. |
| `effects[].sprite_asset` | `string?` | no | Asset path, used by `spritePair`. **Absence is legal** — the same placeholder-safety pattern `pose_catalog.json`'s `reference_image` already establishes (specification 003, FR-005): a missing sprite falls back to a simple shape drawn by the painter itself, never a broken screen. |
| `effects[].intensity` | `number?` | no | `[0, 1]`, defaults to a kind-specific value if absent. |
| `generic_fallback` | `object` | yes | The effect definition for any `pose_id` absent from `effects[]` (FR-020). Same shape as one `effects[]` entry, minus `pose_id`. |

## Validation (`AssetEffectCatalogSource`, at load time)

1. `catalog_version` is present and a supported value.
2. Every `effects[].pose_id` is unique — no pose gets two definitions.
3. `kind` is one of the fixed `EffectKind` values; an unknown kind fails loudly, naming the entry.
4. `color`, when present, parses as a valid hex color.
5. `intensity`, when present, is within `[0, 1]`.
6. `generic_fallback` is present and itself valid by rules 3–5.

A validation failure is a developer error, not a runtime condition to paper over — it fails at
startup naming the offending entry, the same rule `PoseCatalog`'s own validation already follows.

## Non-goals

- This file does **not** affect matching, confidence, or stability in any way — it is consulted
  only after a `ConfirmationEvent` is raised, purely to choose what to render.
- `pose_id`s appearing here that do not exist in `pose_catalog.json` are a warning, not a critical
  failure — an effect can be authored ahead of a pose being added to the catalog, or left behind
  after a pose is retired, without breaking the build.
