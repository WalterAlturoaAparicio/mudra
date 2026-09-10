# Future work, deliberately deferred

Written during the editor UX/capability pass that followed Milestone 2. Everything here is
**out of scope** for that pass and is not implemented. It is recorded so the next milestone
starts from an assessment rather than a guess, and so the current architecture can be judged
on whether it makes these possible — not on whether it anticipates them.

Two rules govern this document:

- **No dependency was added for anything below.** Not MediaPipe Face Landmarker, not a mesh
  renderer, not a capture schema. The constitution's scope discipline is explicit that a
  dependency introduced to support a placeholder is exactly backwards, and Milestone 1 already
  set the precedent by declaring `person_segmentation` unavailable rather than half-building it.
- **Nothing here is quietly half-present.** There is no dormant face-landmark port, no unused
  face-region command in the render vocabulary, and no disabled capture button. If a reader
  finds one later, it is a bug against this document.

---

## A. Face tracking and face effects

The eventual goal: face landmarks, eye tracking, eye-colour effects, stylized deformation,
animal-like transformations, playful face filters, and localized warping around facial regions.

### What would actually be required

**1. A face-landmark capability, probed exactly like the existing two.**

`domain/runtime/capabilities.ts` already models this correctly and generically:
`probeCapabilities()` determines availability by *attempting to construct* what a capability
needs, and reports failure rather than assuming. A `face_landmarks` capability is one more
attempted construction and one more registry entry — deliberately **not** a branch keyed to what
the capability is for.

The backend would almost certainly be **MediaPipe Tasks Vision `FaceLandmarker`**, which is the
same package (`@mediapipe/tasks-vision`) the hand detector and the person segmenter already use,
so no second ML runtime enters the repository. Its model would be a repository-level shared
binary asset under `assets/`, served by `vite.config.ts`'s existing shared-asset plugin, and
absent by default — the same "fetch-if-missing, unavailable if absent" arrangement
`selfie_segmenter.tflite` has now.

**2. A `FaceLandmarker` port, mirroring `HandDetector`/`PersonSegmenter`.**

```
domain/ports/face-detector.ts     FaceDetector { detect(surface, timestampMs): FaceFrame | null; close(): void }
domain/landmarks/face.ts          FaceFrame — 468 (or 478, with irises) points, blendshapes optional
```

The existing ports are the template, including the part that matters most: the domain gets a
value object, never a MediaPipe type. `test/architecture/layering.test.ts` already fails the
build if a MediaPipe symbol appears anywhere under `src/domain/`.

**3. Anchors, extended — not a new positioning mechanism.**

`domain/effects/anchor-resolver.ts` resolves anchors centrally so that no action contains its own
code to find a hand (FR-058–FR-060). A face landmark is one more `Anchor` kind:

```ts
| { kind: 'faceLandmark'; index: number }
| { kind: 'faceRegion'; region: 'leftEye' | 'rightEye' | 'mouth' | ... }
```

Every existing action — particles, trails, flashes — gains face anchoring for free the moment
that resolves, which is precisely the payoff the central anchor design was for. **This is the
single highest-value, lowest-risk piece of the whole face story**, and it needs no renderer work
at all.

**4. Face-region masks reuse the region-compositing seam this pass built.**

Items 2 and 3 of this pass added `fillMaskedRegion` and `drawMaskedImage`, both of which name a
*region* and let the renderer clip with an out-of-band mask. A face-region mask is the same
shape: the vocabulary would gain region names, not a new command family, and
`Canvas2DRenderer`'s offscreen `RegionBuffer` (which inverts a mask by compositing rather than by
reading pixels back) already does the hard part. Recolouring an iris is a masked fill.

**5. Deformation is where Canvas2D genuinely runs out — and where the real cost is.**

Warping, stylized reshaping, and animal-like transformation are **mesh** operations: a triangulated
face mesh whose vertices are moved and whose texture coordinates are sampled from the camera
image. Canvas2D can approximate this only by drawing many small triangles with clipping and
transforms, which is slow and visibly seamed. The honest options are:

- **WebGL** (or WebGPU) as a *second renderer* implementing the same command vocabulary. This is
  what the vocabulary was designed for — FR-068's whole point is that the command list must be
  implementable by a renderer that is not Canvas2D — and it would need a new command family
  (`drawMesh` with vertices, indices, UVs, and a source), not a change to any existing one.
- A restricted, **non-mesh** subset first: eye-colour tinting, region masks, landmark-anchored
  decals, blendshape-driven overlays. All of these are expressible in the current vocabulary plus
  face anchors, and would deliver most of the recognizable "face filter" feeling for a fraction
  of the work.

The staged order is therefore: capability + port + face anchors → region masks → decals/tints →
*only then* a mesh renderer, if warping is still wanted.

### What must not happen

- No face imagery may be persisted, read back, or transmitted. `test/architecture/privacy.test.ts`
  already prohibits `getImageData`, `toDataURL`, `toBlob`, `captureStream`, `MediaRecorder`, and
  `createImageBitmap` **everywhere**, and face data is the last thing that should earn an
  exemption. A mesh renderer must sample the camera texture on the GPU, never read it back.
- Face landmarks must not become a second recognition system. Milestone 1's pose recognition is
  hand-based and its thresholds, weights, and hold semantics are explicitly out of the editor's
  reach (FR-021, FR-022). A face capability supplies *anchors and masks*, not new triggers,
  unless a future spec authorizes face-driven triggers on their own merits.
- No face-shaped placeholder action may be added before the capability is real. The
  `person_visibility` precedent is instructive: it spent a milestone as a documented, reported,
  permanently-inert action, and that was the *correct* handling — but only because it was one
  action demonstrating the gating mechanism, not a family of them.

---

## B. Web capture mode

The eventual goal: collecting additional landmark samples directly from Mudra Web, rather than
only from Mudra Capture.

### The schema question is already answered

The constitution is unambiguous: *"The ONLY contract between independent applications is the
versioned pose-sample JSON schema (`schema_version`, currently 1)"*, and *"Datasets produced by
any application MUST be consumable by the engine with zero manual processing."* A web capture mode
would therefore write **exactly** that schema, or it is not a capture mode — a
web-specific variant would be the precise drift the single-schema rule exists to prevent.

Two consequences follow immediately:

- Web would need to *write* the pose-sample schema, having so far only consumed a derived export
  of it (`public/exemplars.bin` + manifest, produced by `scripts/export_web_exemplars.py`). The
  serializer would have to be verified against Engine's own, exactly as the normalization and
  matching ports already are — the constitution's cross-language golden-fixture rule
  (`scripts/export_web_fixtures.py`, `test/fixtures/*.json`) applies here without modification,
  and a port that cannot be checked against Engine's output *is not authorized*.
- The `dataset_fingerprint`/staleness machinery (`infrastructure/exemplars/bundle-loader.ts`)
  assumes the browser reads a build-time artifact. Samples captured at runtime would sit outside
  that fingerprint, so the relationship between "what this build was made against" and "what this
  browser has recorded" needs designing before any of it is written.

### The privacy question is not answered, and is the real blocker

The current rules are absolute, and they are enforced by a test rather than by intent:

- **Nothing is persisted.** `localStorage`, `sessionStorage`, `openDatabase`, `caches`,
  `navigator.storage`, `showSaveFilePicker`, and `FileSystemWritableFileStream` are prohibited
  everywhere. `indexedDB` has exactly one scoped exemption — `infrastructure/persistence/**`, for
  Milestone 2's local project documents — and that directory is separately asserted never to
  import camera- or segmentation-shaped data (FR-031).
- **No imagery leaves memory**, and **nothing is transmitted**: `fetch` is permitted for inbound
  GETs only.
- **No recording/capture/download/share affordance exists for the camera view** (FR-007, FR-057),
  checked as an API scan *and* a user-facing-label scan. Project export
  (`presentation/editor/project-panel.ts`) is the single authorized exception, and it exports
  effect data, never imagery.

A capture mode necessarily crosses the first of these: landmark samples are camera-derived data
and would be persisted. That is a **constitutional amendment**, not an implementation detail. It
would need to state, at minimum:

- **What exactly is stored.** Landmark coordinates are not images, and the distinction is the
  entire basis on which such an amendment could be reasonable. Storing normalized 21-point
  landmark arrays is a categorically different act from storing frames, and the amendment must say
  so explicitly and prohibit the latter as firmly as it is prohibited now.
- **Consent.** Mudra Capture obtains it in an application whose stated purpose is recording. The
  web experience's stated purpose is *not* recording, and FR-001's "explicit user action to start
  the camera" is consent to run an effect, not consent to contribute data. A capture mode needs
  its own, separate, unmistakable opt-in, and a visible indication while it is active.
- **Export format and destination.** Local-only export of pose-sample JSON, by explicit user
  action, is the only shape consistent with "no accounts, no cloud, no backend". Upload is a
  different feature and a much larger amendment.
- **Deletion.** Whatever is stored must be enumerable and removable by the person who recorded it.
- **The label scan.** FR-007's prohibition is specifically about the camera view and its effects
  output; a capture mode's controls would legitimately be labelled "record". The exemption must be
  written as narrowly as `project-panel.ts`'s is, and the architecture test updated deliberately
  rather than loosened.

### Relationship to Mudra Capture

Capture remains the primary recorder; a web capture mode is a convenience path, not a replacement.
The two exchange nothing directly — no import, no shared source, no runtime dependency — and both
write the same versioned schema onto disk for Engine to consume. That is the whole contract, and
nothing about a web capture mode should change it.

### Golden-fixture implications

Adding a writer means adding a direction that fixtures currently do not cover. `test/fixtures/`
holds Engine-generated cases for *normalization* and *matching*; a serializer would need its own
Engine-generated round-trip fixtures, regenerated whenever Engine's schema handling changes, with
a resulting diff treated as a cross-application event to be handled deliberately.

---

## C. Smaller things noted but not built

- **Drag-and-drop panel docking and tabs.** The panel system now registers panels by id into
  named regions (`presentation/editor/dock-layout.ts`), which is the structure a docking system
  would build on. A fragile drag-target implementation was explicitly not worth this pass.
- **Undo/redo.** Every authoring edit is already a pure `Project → Project` function
  (`domain/editor/project-edits.ts`), so an undo stack is a list of snapshots and a pair of
  commands rather than a redesign. It was not in scope; the shape is ready for it.
- **Multi-select on the timeline.** The selection model is deliberately one clip, and every
  surface agrees on that one clip. Widening it touches the tree, the timeline, the inspector, and
  Play Selected together.
- **Per-particle textures / sprite particles.** `drawCircles` carries points, radii, colour and
  optional per-point opacity. Sprites would mean a texture-aware command and the image-loading
  seam `drawMaskedImage` introduced; possible, not free.
