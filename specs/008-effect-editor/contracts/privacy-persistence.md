# Contract: Privacy, Extended to Persistence and Preview

**Feature**: `008-effect-editor`

`specs/007-mudra-web/contracts/privacy.md` established the guarantee and its enforcement
mechanism for Milestone 1: an automated scan of `apps/web/src/**` for a prohibited API surface,
plus manual verification via quickstart. This contract does not replace that one — it **extends
its scope** to the code this milestone adds, and records the one deliberate, narrow change to the
original prohibited list.

## What stays exactly as it was

Every guarantee in `contracts/privacy.md` holds, unmodified, including inside the editor, inside
preview, and inside test-trigger playback (FR-056). The prohibited-API scan's existing entries —
`toDataURL`, `toBlob`, `captureStream`, `MediaRecorder`, `fetch` with a non-GET method,
`XMLHttpRequest`, `sendBeacon`, `WebSocket`, `RTCPeerConnection` — remain prohibited everywhere,
including the new `presentation/editor/**`, `infrastructure/persistence/**`, and
`infrastructure/segmentation/**` trees (FR-057).

## What is deliberately added to the storage allowlist, and why it is safe

Milestone 1's scan prohibited `localStorage`, `sessionStorage`, `indexedDB`, `caches`,
`navigator.storage`, and `showSaveFilePicker` outright, because Milestone 1 had **no** legitimate
reason to write anything. Milestone 2 does: local project persistence is the feature (FR-028).

| API | Now permitted for | Still prohibited for |
|---|---|---|
| `indexedDB` | `infrastructure/persistence/**` only — projects, the asset library, the active-project pointer | Any other directory. `test/architecture/privacy.test.ts` asserts `indexedDB` appears in exactly one directory's file set. |
| A `Blob` download / `<input type="file">` | Project export/import only (`project-schema.md`) | Camera imagery, canvas readback, or anything sourced from `getImageData`/`toDataURL`/`toBlob` on the stage's canvas — those remain fully prohibited (see below) |

`localStorage`, `sessionStorage`, `caches`, `navigator.storage`, and `showSaveFilePicker` remain
**fully prohibited**, everywhere — this milestone's persistence need is met entirely by IndexedDB
(research D2), so nothing widens further than the one line above.

## What remains absolutely prohibited, restated for the new capabilities this milestone adds

| Guarantee | Requirement |
|---|---|
| A project file never contains a camera frame, image, video, or derivative of captured imagery | FR-031 |
| Person segmentation's mask data (`SegmentationFrame`) is never written to a project, to IndexedDB, or exported | Extends FR-005/FR-031 to the new `ActionContext.segmentation` field |
| Preview and test-trigger playback persist nothing beyond what a real pose trigger would | FR-056 |
| No new recording, capture, screenshot, or sharing affordance exists anywhere in the editor | FR-057 |

`SegmentationFrame.mask` is an `ImageBitmap` handle threaded through `ActionContext` for exactly
one frame (research D8) and is never a candidate for `AssetLibraryEntry.storage_key` — the asset
library's write path only accepts a file the author explicitly picked (`project-schema.md`), which
structurally excludes anything sourced from the live pipeline.

## Verification

1. **Automated**: `test/architecture/privacy.test.ts`'s scan extends to every new source directory
   this milestone adds, with the one allowlist change above encoded as an explicit exception,
   not a blanket relaxation.
2. **Manual** (quickstart, extending Milestone 1's session-8 scenario): after a full editor
   session — build effects, save, load, duplicate, export, import, preview with and without
   segmentation available — confirm IndexedDB contains only project/asset/active-pointer records
   (inspectable, human-legible JSON and small binary asset blobs the author added), Local/Session
   Storage remain empty, Cache Storage remains empty, and the Network tab shows no non-GET request
   and no request to any destination outside the same origin.
3. **Negative test**: attempting to place a value sourced from `MirroredSurface` or
   `SegmentationFrame` into an `AssetLibraryEntry` is not merely undocumented — there is no code
   path that accepts one, verified by the asset-library write path's own type signature accepting
   only a `File`/`Blob` the author selected.
