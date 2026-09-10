# Contract: Effect Catalog

**Feature**: `007-mudra-web` | **File**: `apps/web/config/effects.json`

The data-driven effect schema. Constitution v1.6.0 requires that authoring or changing an effect be a
**configuration change**, and that no conditional branch per named effect exist in the runtime.

## Format

```jsonc
{
  "catalog_version": 1,
  "effects": [
    {
      "id": "flash.hi",
      "name": "Greeting Flash",
      "trigger": {
        "on": "confirmed",                  // entered | held | confirmed | exited
        "pose_id": "hi",
        "conditions": [
          { "type": "confidence_at_least", "value": 0.5 },
          { "type": "cooldown", "ms": 1500 }
        ]
      },
      "timeline": {
        "duration_ms": 700,
        "entries": [
          { "at_ms": 0, "duration_ms": 260, "action": {
              "type": "screen_flash",
              "params": { "color": "#FFFFFF", "intensity": 0.85 } } },
          { "at_ms": 0, "action": {
              "type": "play_audio",
              "params": { "asset": "@audio/flash" } } }
        ]
      }
    }
  ]
}
```

## Rules

| Rule | Detail |
|---|---|
| `catalog_version` | Must equal `1`. A mismatch is a load error naming the expected value. |
| `id` | Unique across the catalog. Duplicates are a load error naming the id. |
| `trigger.on` | One of the four `PoseEvent` kinds. |
| `trigger.pose_id` | Need not be in the active pose set; an effect for an inactive pose simply never fires, and this is reported in debug rather than treated as an error. |
| `conditions` | Unknown `type` ⇒ load error. Never ignored (FR-045). |
| `at_ms` | **Absolute** offset from effect start. Non-negative. |
| `duration_ms` (entry) | Absent ⇒ instantaneous action. |
| `duration_ms` (timeline) | Must be ≥ the largest `at_ms + duration_ms`. |
| `action.type` | Must be registered. Unknown ⇒ load error naming the type and the effect id. |
| `action.params` | Validated against the registered descriptor's schema; unknown keys and out-of-range values are load errors. |
| Assets | Referenced as `@audio/…` / `@image/…` only. A physical path is a load error (FR-062). |
| Multiple matches | All matching effects play. Deterministic order: catalog order (FR-044). |

## Shipped action types

| Type | Behaviour | Key parameters | Capability |
|---|---|---|---|
| `screen_flash` | instantaneous* | `color`, `intensity` | — |
| `background_wash` | duration | `color`, `image?`, `opacity`, `blend` | — |
| `particle_burst` | duration | `count`, `color`, `radius`, `spread`, `anchor` | — |
| `landmark_trail` | continuous | `hand`, `landmark_index`, `color`, `width`, `length` | — |
| `play_audio` | instantaneous | `asset`, `volume` | — |
| `person_visibility` | duration | `opacity` | `person_segmentation` — **unavailable** |

\* `screen_flash` is instantaneous in *scheduling* (it fires at its `at_ms`) while its
`duration_ms` governs the decay curve it renders over — the distinction the spec's FR-048 draws
between when an action starts and how long its output persists.

`person_visibility` is declared and permanently inert in this milestone. It produces no commands, is
recorded in `FrameOutput.diagnostics` as skipped with reason `capability_unavailable`, and appears in
the debug overlay. It must never appear to succeed (FR-077).

## Enforcement

Three automated checks make this contract executable rather than aspirational:

1. **No hardcoded effects.** A test scans runtime source under `src/domain/runtime/` and
   `src/presentation/` for any literal matching a known `pose_id` or catalog effect `id`. A match
   fails the build. This is the direct enforcement of the constitutional rule and of User Story 2's
   acceptance scenario 4.
2. **Configuration-only change.** A test loads a modified catalog fixture (different colour, timing,
   and anchor; plus one added effect) and asserts the resulting `FrameOutput` differs — with no
   runtime source involved.
3. **Registry completeness.** Every `action.type` in the shipped catalog resolves to a registered
   descriptor, and every registered descriptor exposes a parameter schema (FR-072).
