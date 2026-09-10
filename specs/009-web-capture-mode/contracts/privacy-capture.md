# Contract: Privacy, Extended to Capture Mode

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

`specs/007-mudra-web/contracts/privacy.md` established the guarantee and its enforcement mechanism;
`specs/008-effect-editor/contracts/privacy-persistence.md` extended it to local project persistence.
This contract does not replace either. It **extends their scope** to the code this milestone adds and
records the two deliberate, narrow exemptions — the smallest change that lets Capture Mode exist.

The governing rule from the constitution (v1.8.0, Milestone 3) is that Capture Mode may persist
**normalized landmark samples and minimal session metadata**, and nothing else. Every other
prohibition is unchanged.

---

## What stays exactly as it was

Everything, everywhere, including inside `presentation/capture/**`, `domain/capture/**`,
`application/capture-*`, and `infrastructure/capture/**`:

| Prohibited | Scope |
|---|---|
| `getImageData`, `toDataURL`, `toBlob`, `captureStream`, `MediaRecorder`, `createImageBitmap` | Everywhere. **No exemption**, and Capture Mode needs none — it stores coordinates, not pixels |
| `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `RTCPeerConnection` | Everywhere. No exemption |
| `fetch` with a method, body, or non-GET init | Everywhere. Inbound GET remains the only network direction (FR-054) |
| `localStorage`, `sessionStorage`, `openDatabase`, `caches`, `navigator.storage`, `showSaveFilePicker`, `FileSystemWritableFileStream` | Everywhere, Capture Mode included. Capture's need is met entirely by the one permitted mechanism |
| `indexedDB` outside `src/infrastructure/persistence/**` | Unchanged. The permitted-directory list stays at **exactly one entry** — the capture repository lives inside it (FR-039) |
| Camera- or segmentation-shaped data in the persistence directory | Unchanged. The existing scan for `MirroredSurface \| LandmarkFrame \| SegmentationFrame.mask` continues to pass **without modification**, because the persistence layer only ever receives a `CaptureSample` |

The last row is worth stating twice: **the storage privacy assertion is not amended at all.** That was
a design goal, not a happy accident — the conversion from a detected frame to a stored sample happens
in the application layer precisely so the persistence directory never names a camera type.

---

## The two exemptions, and nothing else

The existing FR-007 affordance scan prohibits, outside the one already-exempted project-export file,
any `<a download>` and any user-facing control labelled `record` / `recording` / `capture` /
`screenshot` / `save` / `download` / `share`. Capture Mode legitimately needs both: exporting a
dataset *is* a download, and a control that records samples is correctly labelled "Capture".

| Check | Existing exemption | Added by this feature |
|---|---|---|
| `download=` / `.download` | `src/presentation/editor/project-panel.ts` | `src/presentation/capture/capture-export-panel.ts` |
| user-facing capture/record/save/download labels | `src/presentation/editor/project-panel.ts` | `src/presentation/capture/**` |

Both are expressed as named paths in the same short, reviewable list the project-export exemption
already uses. Neither is implemented by relaxing a pattern, removing an entry, or broadening a scope —
which is the distinction FR-057 draws and the reason the exemption cannot silently widen later.

**FR-058 remains fully in force**: the prohibition covers any recording, capture, screenshot, or
sharing affordance for the **camera view and its effects output**. The exemption above covers dataset
export controls and capture-session controls only. There is still no way, anywhere in the application,
to save or share what the camera sees.

---

## Compensating assertions

The exemptions are narrow, but narrowness is asserted rather than assumed. Three new checks are added
to `test/architecture/privacy.test.ts` alongside them:

1. **The capture tree calls no readback or upload API.** `src/**/capture/**` and `capture-main.ts` are
   scanned for the full readback and upload lists. (They are already covered by the global scan; this
   states it locally so a future exemption cannot quietly cover them too.)
2. **The capture tree names no camera or segmentation type.** No `MirroredSurface`,
   `SegmentationFrame`, or `ImageBitmap` appears in the capture serializer, the archive writer, the
   repository, or the schema module — the modules that build what is stored and exported. The capture
   *controller* legitimately receives a `MirroredSurface` and a `LandmarkFrame`, and is excluded from
   this particular assertion by name, exactly as the pipeline requires.
3. **The exemption lists are exhaustive.** The download exemption is asserted to be exactly two files
   and the label exemption exactly two entries, so adding a third is a deliberate edit to a test that
   fails first.

---

## What Capture Mode is permitted to persist

| Category | Permitted? | Where it is defined |
|---|---|---|
| Raw camera imagery, video, canvas pixels, screenshots, thumbnails | **Never** | Constitution category 1 |
| MediaPipe result objects, `MirroredSurface`, `SegmentationFrame`, `ImageBitmap` handles | **Never** | Constitution category 2 |
| 21 canonical-raw + 21 normalized landmarks per hand, handedness, confidence | Yes, inside the capture store only | Constitution category 3; [capture-storage.md](./capture-storage.md) |
| `pose_id`, contributor label, session and sample ids, capture timestamps, frame width/height, countdown context, application and detector versions | Yes, minimum only | Constitution category 4; [pose-sample-export.md](./pose-sample-export.md) |
| Consent state | **No** — consent is in-memory for the page's lifetime and is re-prompted after a reload | FR-006a |
| Any personally identifying value: name, email, account, device fingerprint, geolocation, network address | **Never** | FR-005, FR-031 |

---

## Verification

1. **Automated** — `test/architecture/privacy.test.ts` extends to every new source directory this
   milestone adds, with the two exemptions encoded as explicit named exceptions plus the three
   compensating assertions above. `test/architecture/capture-boundary.test.ts` covers the
   capture/project isolation and the build gating.
2. **Manual** (quickstart, extending the earlier milestones' scenarios) — after a full capture session
   (consent, collect, review, delete a sample, clear a session, export): IndexedDB contains only
   `mudra-capture` sessions and samples plus whatever `mudra-editor` held before; Local Storage,
   Session Storage and Cache Storage are empty; the Network tab shows no non-GET request and no
   request outside the origin; and the downloaded archive contains only JSON.
3. **Negative test** — there is no code path by which imagery could be stored or exported, because no
   type in the persisted or exported graph can hold one. This is verified by the type signatures
   themselves, not only by a scan.
