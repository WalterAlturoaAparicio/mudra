# Contract: Render Commands

**Feature**: `007-mudra-web` | **Producer**: effect runtime (`domain/runtime/`) | **Consumer**: renderer (`presentation/`)

The seam constitution v1.6.0 mandates: *"The effect runtime MUST NOT draw. It produces declarative
render output that a separate renderer consumes."*

## The boundary

```
domain/runtime/   ──emits──▶   FrameOutput { commands, audioCues, diagnostics }
                                      │
presentation/     ──consumes──────────┘   (the ONLY place a drawing call exists)
```

The runtime is a pure function of `(playbacks, elapsedMs, frame)`. It holds no canvas, no context, no
`Image`, no `Audio`. This is what lets the entire milestone's scheduling logic be asserted in Node
with no browser (research D13).

## Vocabulary

Five commands. Deliberately small: every command is a commitment a future renderer must honour.

| Command | Payload | Used by |
|---|---|---|
| `clear` | — | frame setup |
| `drawCamera` | `opacity` | the live view layer |
| `fillScreen` | `color`, `alpha`, `blend` | `screen_flash`, `background_wash` |
| `drawCircles` | `points[]`, `radii[]`, `color`, `alpha` | `particle_burst` |
| `drawPolyline` | `points[]`, `width`, `color`, `alpha` | `landmark_trail` |

**Coordinates are in the mirrored display space** established by research D1 — the same space the user
sees — so the renderer applies no transform of its own.

`drawCircles` is batched: a 60-particle burst emits **one** command carrying 60 points, not 60
commands. Per-particle commands would make command-list length a function of visual density, which the
renderer would then have to optimize around.

## AudioCue

`{ asset, volume }`. Sound is not drawing, so it is not a render command — but letting the runtime call
`play()` would break the same rule for the same reason: an irreversible side effect inside a pure
scheduler, untestable headlessly. Cues are declarative and a separate audio sink consumes them
(research D6).

## Diagnostics

`FrameOutput.diagnostics` carries skipped actions with reasons, unresolved anchors, and the active
playback count. This is what makes FR-061 and FR-077 **observable** rather than aspirational — an
inert `person_visibility` action appears here, and therefore in the debug overlay, instead of quietly
producing nothing.

## What the vocabulary deliberately excludes

| Excluded | Why |
|---|---|
| Arbitrary path/bezier commands | Would let actions smuggle rendering logic into data, and make an alternative renderer's job unbounded |
| One command per action type | Couples the vocabulary to the action set, so a new action would force a renderer change — FR-073 forbids exactly this |
| Canvas2D-specific concepts (`globalCompositeOperation` strings, `Path2D`) | Would make the vocabulary un-implementable by a WebGL renderer, defeating FR-068. `blend` is a small closed enum the renderer maps to its own primitives |
| Transform/camera matrices | No requirement needs them; adding them now would be speculative surface |

## Enforcement

1. **Architecture test**: `src/domain/**` references no canvas, DOM, or MediaPipe symbol.
2. **Headless test**: the runtime produces a full `FrameOutput` sequence for a scripted effect with no
   browser present (FR-069).
3. **Renderer test**: given a fixed command list, the renderer issues the expected drawing calls
   against a recording fake context — proving the renderer consumes the vocabulary rather than
   reaching back into effect state.
