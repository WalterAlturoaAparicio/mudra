# Contract: Person Segmentation Capability

**Feature**: `008-effect-editor` | **Producer**: `infrastructure/segmentation/` | **Consumer**:
`domain/runtime/capabilities.ts`, `person_visibility`'s `update()`, the editor's palette/inspector

Constitution v1.7.0 authorizes Person Segmentation as **one more capability-registry entry**,
gated exactly as Milestone 1's capability-gating rule already requires of any capability-dependent
action: inert and explicitly reported when unavailable, never silently degraded, never simulated.

## The guarantee

| Guarantee | Requirement |
|---|---|
| Segmentation availability is determined at runtime, from the actual current environment | FR-041 |
| It is never assumed or hardcoded to a fixed value | FR-041 |
| An action requiring it, when it is unavailable, is inert and reports why | FR-042, inherits FR-077 |
| Unavailability never prevents the rest of an effect from playing | FR-043 |
| Where implemented, segmentation-dependent behaviour is a genuine per-pixel/per-region separation | FR-046 |
| It is never simulated by compositing over an undifferentiated full-frame camera image | FR-046 |
| The palette and the inspector mark a segmentation-dependent action as unavailable **before** it is triggered, not only when triggered | FR-044, SC-006 |

## Detection

```
composition root
  → try: PersonSegmenter.create(...)   (MediaPipe ImageSegmenter, research D7)
  → success → capabilities.set(PERSON_SEGMENTATION, true)
  → failure → log at warn, capabilities.set(PERSON_SEGMENTATION, false)
```

`defaultCapabilities()` (Milestone 1, permanently `false`) is replaced by `probeCapabilities()`
(async, actually attempts construction). This is the **only** place availability is decided; the
editor's palette/inspector and the runtime's `EffectRuntime.render()` capability check both read
the **same** `CapabilityRegistry` instance — there is no second, editor-only notion of
availability to drift from the runtime's.

## Consumption

`person_visibility` (reserved and permanently inert in Milestone 1) becomes genuinely
capability-backed:

```
ActionDescriptor.requiresCapability = PERSON_SEGMENTATION   // unchanged
update(context):
  if context.segmentation === null → unreachable (runtime already skipped this action)
  else → emit { kind: 'maskedErase', region: 'person', alpha: 1 - opacity }
```

The `unavailable` path is **unchanged from Milestone 1**: `EffectRuntime.render()` already skips
any action whose `requiresCapability` the registry reports `false` for, before calling `update()`
at all, and records a `capability_unavailable` diagnostic (`FrameOutput.diagnostics`,
`test/domain/capabilities.test.ts`'s existing pattern). This milestone adds no new skip logic — it
only makes the `true` branch, previously unreachable, real.

## Palette and inspector marking (new — the pre-trigger visibility FR-044 requires)

The palette and inspector query `capabilities.has(PERSON_SEGMENTATION)` from the same registry at
render time:

| Surface | When unavailable |
|---|---|
| Palette | The action's entry carries a visible "unavailable in this browser/device" marker; it remains clickable/addable (FR-045) |
| Inspector, on a placed clip of that type | A persistent notice distinct from a validation error — "this environment cannot run this action," not "this value is invalid" |

## Verification

1. **Detection test**: a `PersonSegmenter` construction failure (simulated) yields
   `capabilities.has(PERSON_SEGMENTATION) === false` and a `warn`-level log entry, never a thrown
   error past the composition root.
2. **Runtime test** (extends `test/domain/capabilities.test.ts`): with the capability `true`, a
   `person_visibility` playback emits a `maskedErase` command; with it `false`, it emits nothing
   and one `capability_unavailable` diagnostic — same assertion shape Milestone 1 already has, now
   exercised on both branches instead of only the always-`false` one.
3. **Editor test**: with the capability `false`, the palette entry and a placed clip's inspector
   both assert the unavailable marker is present; with it `true` (a fake registry reporting `true`
   in a jsdom adapter test), neither marker appears and the clip's properties are editable exactly
   like any other action's.
4. **No-fake-compositing test**: source-scans `person_visibility` (and any future
   segmentation-dependent action) for a full-frame `fillScreen`/image-over-camera pattern used as a
   stand-in for masking — the existing `background_wash` action is the documented, deliberate
   full-frame case (Milestone 1) and segmentation-dependent actions must never reuse that shape as
   a substitute for `maskedErase`.
