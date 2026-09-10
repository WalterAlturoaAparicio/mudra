# Contract: Render Commands — Extension

**Feature**: `008-effect-editor` | **Extends**: `specs/007-mudra-web/contracts/render-commands.md`

Milestone 1's render-command vocabulary (`clear`, `drawCamera`, `fillScreen`, `drawCircles`,
`drawPolyline`) is unchanged and fully retained. This contract adds **three** commands, **one
optional field**, and **three** out-of-band inputs, all additive.

The three commands arrived in two stages, and the second stage is the one this contract
anticipated: `maskedErase` came with the capability itself, and `fillMaskedRegion`/
`drawMaskedImage` came with the editor UX pass, when `person_visibility` gained the two things a
segmentation mask is actually *for*. The earlier revision of this document said a later action
"may add a `region` value or a sibling command"; both happened, and neither required redesigning
what was already here.

## Region-scoped commands

All three name a **region**, not points. The region comes from a per-pixel mask the renderer holds
out-of-band, not from data the command carries — which keeps every command small and comparable in
a test fixture, with no per-frame pixel payload to construct.

| Command | Payload | Used by |
|---|---|---|
| `maskedErase` | `region`, `alpha` | `person_visibility` mode `opacity` |
| `fillMaskedRegion` | `region`, `color`, `alpha` | `person_visibility` modes `replace_person`, `replace_background` (no image chosen) |
| `drawMaskedImage` | `region`, `source`, `alpha`, `fit` | `person_visibility` modes `replace_person`, `replace_background` (image chosen) |

```ts
type MaskRegion = 'person' | 'background';

interface MaskedEraseCommand {
  readonly kind: 'maskedErase';
  readonly region: MaskRegion;
  readonly alpha: number; // 0 = no effect, 1 = fully erased within the region
}

interface FillMaskedRegionCommand {
  readonly kind: 'fillMaskedRegion';
  readonly region: MaskRegion;
  readonly color: string;
  readonly alpha: number;
}

interface DrawMaskedImageCommand {
  readonly kind: 'drawMaskedImage';
  readonly region: MaskRegion;
  /** An already-resolved URL — never a logical `@image/…` reference, never a filesystem path. */
  readonly source: string;
  readonly alpha: number;
  readonly fit: 'cover' | 'contain' | 'stretch';
}
```

### Why `drawMaskedImage` carries a resolved URL

The action resolves its own logical `@image/…` reference through `ActionContext.resolveAsset`
(FR-062) and reports `asset_unresolved` when that fails (FR-064) — exactly as `play_audio` already
does for sound. The renderer therefore never learns what a logical reference is, and an
unresolvable image is a diagnostic rather than a drawing decision. How a URL becomes something
drawable is the renderer's own business, the same division `drawCamera` already draws.

### Why `region: 'background'` is now real

It was previously a documented no-op: Canvas2D has no native mask inversion, and producing one by
hand would mean reading pixels back (`getImageData`) — the exact imagery-readback surface
`test/architecture/privacy.test.ts` prohibits everywhere, for reasons unrelated to this feature.

The region buffer (below) inverts by **compositing** instead: paint the region's content, then
`destination-out` the mask, leaving coverage everywhere the person is *not*. That reads nothing.
`maskedErase`'s `person` region still composites straight onto the destination, because it can.

## Optional per-point opacity on `drawCircles`

```ts
interface DrawCirclesCommand {
  // …unchanged fields…
  /** Optional per-point opacity, multiplied by `alpha`. */
  readonly alphas?: readonly number[];
}
```

Present **only** when the points in a batch genuinely differ — which staggered particle emission
introduced and nothing before it needed. Absent, the command and the renderer's single-path batch
are byte-identical to Milestone 1's. This preserves the batching promise (`one command per burst,
not one per particle`), which is about command-*list* length: that is what a renderer would
otherwise have to optimize around, and what an alternative renderer would inherit.

## Out-of-band inputs

Each is set once per frame by the stage, exactly parallel to how `drawCamera` already depends on
`Canvas2DRenderer.setCameraImage`.

| Input | Setter | Supplied by | When absent |
|---|---|---|---|
| Person mask | `setPersonMask(image \| null)` | `ActionContext.segmentation` | Every region-scoped command draws **nothing** — never a full-frame substitute |
| Region buffer | `Canvas2DRenderer` constructor option | `Stage`, a reusable offscreen canvas | Region compositing is a no-op |
| Image provider | `setImageProvider(fn)` | `Stage`'s `ImageCache`, lazily decoding by URL | `drawMaskedImage` draws nothing that frame, the same "not ready yet" `drawCamera` has before the first camera frame |

The region buffer is a **second** offscreen surface, separate from camera treatment's: both are
live within a single frame (a treated camera image beneath a masked region fill), so one shared
canvas would have each overwrite the other.

## Why this shape, and not the alternatives

| Alternative | Rejected because |
|---|---|
| Embed the mask's pixels in the command | Breaks the small-comparable-command-list property the renderer tests rely on; a per-frame `ImageData` payload is not a value a test should need to construct |
| A Canvas2D `globalCompositeOperation` string in the command | Would make the vocabulary un-implementable by a non-Canvas2D renderer — what Milestone 1's `BlendMode` enum already avoids for `fillScreen`. These commands state intent (paint *within* this region, by this much), leaving the technique to the renderer |
| A generic `mask` field on every command | Speculative surface no other command needs |
| Let `fillScreen`/`drawCamera` take a region | Would make the full-frame and masked cases indistinguishable at the type level — and telling them apart is precisely what the no-fake-segmentation guard depends on |
| One command per particle, for per-point opacity | Command-list length would become a function of visual density |

## What this deliberately does not add

No command generalizes "draw anything using a mask". A face-region mask (deferred; see
`future-work.md`) would add **region values**, not a command family — the shape here is already
the one that extension wants.

## Enforcement

1. **Architecture test**: `domain/**` references no canvas/DOM/MediaPipe symbol — the runtime only
   ever constructs these values, never executes them.
2. **No-fake-segmentation test**: every render command a segmentation-dependent action emits must
   be one of the three region-scoped kinds. A `fillScreen`, `drawCamera`, `drawCircles` or
   `drawPolyline` in such a file fails the build — a full-frame image over the camera is the same
   shortcut as a full-frame fill, wearing different clothes.
3. **Headless test**: `person_visibility`'s `update()` returns the expected command per mode for a
   scripted `ActionContext` with a fake `SegmentationFrame`, with no browser present.
4. **Renderer test**: given each command and a fake mask, the renderer issues the expected
   `destination-in` (person) / `destination-out` (background) buffer sequence against a recording
   fake context — including that it draws *nothing at all* with no mask, and nothing while an
   image is still loading.
