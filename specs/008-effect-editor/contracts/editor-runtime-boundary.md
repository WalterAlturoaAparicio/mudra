# Contract: Editor / Runtime / Renderer Boundary

**Feature**: `008-effect-editor`

Constitution v1.7.0 restates, binding on the editor specifically: *"the editor MUST NOT execute
effect logic ... `EffectRuntime` remains the only component that schedules actions; and the editor
MUST NOT draw effect output itself ... the `Renderer` remains the only component that draws,
including in preview."*

## The boundary

```
presentation/editor/    ──authors──▶   EffectDefinition / Timeline data (domain/effects/types.ts)
                                              │
domain/runtime/         ──schedules──────────┘   EffectRuntime.advance(events, frame, nowMs)
                                              │
                                        RenderCommand[]
                                              │
presentation/(stage|renderer)/   ──draws─────┘   (the ONLY place a drawing call exists — unchanged from Milestone 1)
```

`presentation/editor/**` MUST NOT:
- Import or call anything from `presentation/renderer/` or `presentation/stage/` directly to draw
  a preview frame of its own — every preview pixel reaches the screen through the same
  `Stage.present()` / `Canvas2DRenderer.render()` Milestone 1 already built.
- Contain a second scheduler, timer, or "evaluate this timeline" loop that advances actions itself
  — `EditorRuntimeController` (research D11) exists precisely so the editor still calls
  `EffectRuntime.advance()`, never a substitute.
- Contain a branch, lookup, or conditional keyed to a specific pose identifier or a specific named
  effect (FR-055, the same rule `test/architecture/no-hardcoded-effects.test.ts` already enforces
  against `domain/runtime/`, extended to `presentation/editor/`).

`presentation/editor/**` MUST:
- Construct and mutate `EffectDefinition`/`Timeline`/`Project` **data** — the palette adds an
  `Action`, the inspector edits `params`, the timeline edits `atMs`/`durationMs`, the pose/trigger
  panel edits `Trigger`. None of these calls touches `ActionDescriptor.update()` or a drawing API.
- Read `ActionRegistry` and `CapabilityRegistry` (the same instances the runtime uses) to drive the
  palette and inspector — never maintain its own copy of "what actions exist" or "what is
  available."

## Test Trigger and Play Timeline, specifically

Both are editor-initiated, but neither is an editor-owned execution path:

| Action | What the editor does | What executes it |
|---|---|---|
| Test Trigger | Constructs one `PoseEvent` (research D9) | `EffectRuntime.advance([event], frame, nowMs)` — same method, same instance, `Session` calls for a real pose |
| Play Timeline | Calls `EffectRuntime.startEffect(effectId, nowMs)` (new, tiny addition — research D9) | The same `render()` loop `advance()` already runs internally every tick |

Neither constructs an `ActionOutput`, a `RenderCommand`, or a drawing call directly. SC-003 ("Test
Trigger and a real pose confirmation produce the same sequence of render commands") is true
because both paths are literally the same code, not because they are kept in sync by convention.

## Verification

1. **Architecture test** (extends `test/architecture/layering.test.ts`): `presentation/editor/**`
   references no `CanvasRenderingContext2D` member (`fillRect`, `drawImage`, `arc`, `stroke`, …)
   and no `setInterval`/`requestAnimationFrame`-driven timeline-advancement logic of its own —
   only `EditorRuntimeController`'s single, shared loop does.
2. **Architecture test** (extends `test/architecture/no-hardcoded-effects.test.ts`): the pose-id
   and effect-name literal scan covers `presentation/editor/**`.
3. **Integration test**: triggering the same effect through Test Trigger, Play Timeline, and a
   scripted real `PoseEvent` (via `EffectRuntime.advance()` directly, no UI) produces byte-equal
   `RenderCommand[]` sequences for the same simulated elapsed times (SC-003).
