# Future work, deliberately deferred

Originally written during the editor UX/capability pass that followed Milestone 2, and
**reconciled against the repository on 2026-09-21** (after specs 009 and 010). It is now a
current roadmap: what has shipped is recorded once, briefly, with a pointer to where the
evidence lives, and what is still unbuilt stays visible. It exists so the next milestone starts
from an assessment rather than a guess, and so the architecture can be judged on whether it makes
this work possible — not on whether it anticipates it.

Status legend: **Done** (implemented and covered by automated tests), **Partial** (part shipped,
remainder listed), **Deferred** (not started), **Superseded** (replaced by a different design).
"Manual verification outstanding" means a human has not recorded a real-browser pass; it is never
presented as automated verification.

Two rules govern this document:

- **No dependency is added for anything still deferred below.** Not a Face Landmarker model, not a
  mesh renderer. The constitution's scope discipline is explicit that a dependency introduced to
  support a placeholder is exactly backwards, and Milestone 1 set the precedent by declaring
  `person_segmentation` unavailable rather than half-building it.
- **Nothing here is quietly half-present.** There is no dormant face-landmark port, no unused
  face-region command in the render vocabulary, and no disabled face capability. If a reader finds
  one later, it is a bug against this document. (Verified 2026-09-21: `grep -riw "face|faces|FaceLandmarker" apps/web/src`
  finds no match.)

---

## Status summary

| Item | Status | Where the evidence is |
|---|---|---|
| A. Face tracking and face effects | **Deferred** — readiness verified, nothing built | Section A |
| B. Web capture mode | **Done** (automated); manual browser pass outstanding | Section B |
| C1. Panel docking | **Done** (automated); manual browser pass outstanding | spec 010 |
| C2. Tabs | **Done**, explicit by design | spec 010 |
| C3. Undo/redo | **Done**, including per-effect context scoping | specs 009 (US4) and 010 (US7) |
| C4. Timeline multi-select | **Deferred** | Section C |
| C5. Per-particle textures / sprite particles | **Deferred** | Section C |
| C6. Unified toast/notification system | **Deferred** | Section C |
| D. Follow-ups discovered during reconciliation | **New** | Section D |

---

## A. Face tracking and face effects — Deferred

The eventual goal: face landmarks, eye tracking, eye-colour effects, stylized deformation,
animal-like transformations, playful face filters, and localized warping around facial regions.

Nothing of this is implemented. What follows was verified against the repository and the
installed package on 2026-09-21; each claim is labelled **[verified]** (read from source or the
installed `.d.ts`), **[assumption]** (believed, not checked), or **[decision]** (open).

### A.1 Readiness assessment

| Area | Status | Basis |
|---|---|---|
| ML runtime (`@mediapipe/tasks-vision`) | **Already available** | Installed at 0.10.35 (`package-lock.json`; `package.json` ranges `^0.10.14`). Already used by `infrastructure/detection/mediapipe-detector.ts` and `infrastructure/segmentation/mediapipe-person-segmenter.ts`. Its `vision.d.ts` exports `FaceLandmarker` and `FaceLandmarkerOptions/Result`, and the WASM runtime it ships is shared. **No second ML runtime and no new npm dependency is needed.** [verified] |
| Face model asset | **Requires a new model asset** | The package ships WASM, not models. `assets/` holds only `hand_landmarker.task` and `selfie_segmenter.tflite`; there is no face model. [verified] It would be `assets/face_landmarker.task`, added to `SHARED_MODELS` in `vite.config.ts` (one line: dev streaming and build emission are both driven by that list) and fetched by a script mirroring `tools/fetch-selfie-segmenter.mjs` (fetch-if-missing, never committed, absence ⇒ capability unavailable). [verified for the mechanism]. The download URL follows the storage convention of the existing script but **was not fetched or checked in this pass**. [assumption] |
| Capability probing | **Reusable, small change** | See A.2. |
| Domain ports | **Reusable pattern, new files** | See A.3. |
| Anchor resolution | **Requires an architectural change** (bigger than the older text of this document claimed) | See A.4. |
| Region masking | **Partly reusable; needs a geometry source** | See A.5. |
| Renderer | **Canvas2D suffices for non-mesh effects; mesh needs a second renderer** | See A.6. |
| Face Landmarker outputs | **Available in the installed version** | See A.7. |
| Privacy | **Compatible, one guard added** | See A.8. |
| Constitutional authorization | **Blocked on an unresolved decision** | See A.9. |

### A.2 Capability architecture

`domain/runtime/capabilities.ts` [verified]:

- Capabilities are string constants (`PERSON_SEGMENTATION = 'person_segmentation'`), held in a
  `MapCapabilityRegistry`. An action declares `requiresCapability` (`action-registry.ts`); the
  runtime skips it, with a reported reason, before `update` runs.
- `probeCapabilities(trySegmenter, logger)` takes **one hard-coded parameter** and returns
  `{ capabilities, segmenter }`; `defaultCapabilities()` hard-codes exactly one entry.

So a `face_landmarks` capability is *not* purely "one more registry entry": `probeCapabilities`
is shaped for a single capability. Required changes: a `FACE_LANDMARKS` constant; generalizing
`probeCapabilities` to attempt each capability independently (a face-model failure must not mark
segmentation unavailable, and vice versa) and return each constructed backend; adding the entry to
`defaultCapabilities()`; and touching the three call sites — `main.ts`, `editor-main.ts`, and
(if faces were ever wanted there) `capture-main.ts`. `test/domain/capabilities.test.ts` and
`capability-segmentation.test.ts` pin the current shape and would be extended, not loosened.

### A.3 Domain boundary

Existing ports [verified]: `domain/ports/detector.ts` (`HandDetector.detect(surface, timestampMs):
LandmarkFrame`, `close()`), `domain/ports/segmenter.ts` (`PersonSegmenter.segment(...):
SegmentationFrame | null`). Value objects live in `domain/landmarks/types.ts` and are
framework-free, validated at construction.

The appropriate future shape, mirroring them:

```
domain/ports/face-detector.ts     FaceDetector { detect(surface, timestampMs): FaceFrame | null; close(): void }
domain/landmarks/face.ts          FaceFrame — per face: points (x,y,z normalized, mirrored space),
                                  optional blendshapes as a plain name→score record,
                                  optional 16-number transform. No MediaPipe type.
infrastructure/detection/mediapipe-face-detector.ts   the only file naming FaceLandmarker
```

`null` (segmenter-style) versus an empty frame (hand-detector-style) is a **decision**: the hand
detector emits a frame for every processed frame because "no hands" is a recognition outcome the
stability tracker must see; faces are anchors, not triggers, so the segmenter's `null` is the
closer fit — but say so in the spec.

MediaPipe types stay out of `src/domain/` [verified]: `test/architecture/layering.test.ts` rejects
`@mediapipe|HandLandmarker|FilesetResolver|WasmFileset` under the domain, so any `@mediapipe`
import — including `FaceLandmarker` — already fails. **Tighten it** by adding `FaceLandmarker` to
that pattern when the port lands, so a re-declared symbol is caught too.

### A.4 Anchor system

`domain/effects/anchor-resolver.ts` and `domain/effects/types.ts` [verified]:

- `Anchor` is `screen | handCentroid | landmark` (`{hand: HandSelector, index}`), and
  `AnchorResolver.resolve(key, anchor, frame: LandmarkFrame)` reads **only** `frame.hands`.
- The `LandmarkFrame` is also the `ActionContext.frame` actions receive.
- Anchor kinds are hard-validated in `domain/runtime/param-schema.ts` (`landmark` index must be
  in `[0, 20]`), parsed from JSON in `infrastructure/effects/catalog-loader.ts`, and authored in
  `presentation/editor/inspector-controls.ts`.

To support faces:

1. Add `faceLandmark` (`{index}`) and `faceRegion` (`{region}`) to `Anchor`. Region names resolve
   to a centroid (or bounding-box centre) of a fixed landmark index set — the index sets need to
   be defined once, in the domain.
2. **The resolver needs face data.** `resolve()` takes a `LandmarkFrame`; adding faces means either
   an optional `faces` on the frame or a second argument, and the runtime must pass the face
   frame through. This is the real architectural change; it is not "one more `Anchor` kind".
3. Extend `param-schema.ts` validation (index range is 0–477 for a 478-point face, **[assumption]**
   pending A.7), `catalog-loader.ts` parsing, and the inspector's anchor control.
4. `project-schema.ts` (persistence) only round-trips anchor params as data; confirm rather than
   assume it needs no change.
5. Unresolvable-face behaviour reuses the existing documented rule (hold last position; else skip
   and report) at no cost.

Actions that become face-anchorable **without modification** once the above lands, because they
take an `anchor` param and receive a resolved `Point`: `landmark-trail` and `particle-burst`
(the two actions with a `kind: 'anchor'` param) [verified]. `screen-flash`, `background-wash`,
`play-audio` and `person-visibility` take no anchor and are unaffected. Authoring it in the editor
also needs the face-index/region choice in the Inspector.

### A.5 Region masking and compositing

Existing vocabulary [verified, `domain/runtime/frame-output.ts`, `presentation/renderer/canvas2d-renderer.ts`]:
`fillMaskedRegion`, `drawMaskedImage` and `maskedErase` take `region: 'person' | 'background'`
and carry no pixels; the mask reaches the renderer **out-of-band**, once per frame
(`setPersonMask`), as an opaque `CanvasImageSource`. The renderer's `RegionBuffer` composites the
mask (including inverting it for `background`) without reading pixels back.

What this means for faces — a correction to this document's earlier optimism, which said the
vocabulary "would gain region names, not a new command family":

- A region **name** carries no geometry. A face-region mask needs a per-frame shape. The
  consistent extension is the same out-of-band shape as the person mask: the stage builds a mask
  from face-landmark polygons on an offscreen canvas (path fills only — no pixel read) and hands it
  to the renderer, and the command's `region` union grows (`'leftEye' | 'rightEye' | 'lips' |
  'face' | …`). This needs a **mask source** abstraction generalizing today's single
  `personMask` field, so it is an architectural change to the renderer, not a vocabulary tweak.
- Fits the vocabulary once that mask source exists: eye-colour recolouring (`fillMaskedRegion`
  over an iris polygon), lip/skin tinting, and image decals clipped to a region
  (`drawMaskedImage`).
- Needs **no** mask: decals and overlays positioned by a face anchor using the existing
  `drawCircles` / `drawPolyline` commands (e.g. glasses outlines, markers).
- Needs a genuinely **new capability**: anything that samples or displaces camera pixels
  (warping, reshaping, animal transformation), and rotated/scaled image decals — `drawMaskedImage`
  has `fit` modes but no transform, so an oriented decal (hat on the head pose) needs a new
  command carrying a transform, or a `drawImage`-at-anchor command.

### A.6 Renderer limitations

The renderer is Canvas2D only [verified]; there is no WebGL/WebGPU code and the command vocabulary
was designed so another renderer could implement it.

Feasible in Canvas2D with face anchors plus the mask-source work above: face-region tinting; eye
colour; landmark-anchored decals (axis-aligned, or with a transform command); localized
masks; blendshape-driven overlays — where blendshape scores modulate an existing parameter such as
opacity, particle rate or colour, which requires exposing blendshape values to the action context
(`ActionContext` has no channel for them today).

Requires a mesh-capable renderer (WebGL/WebGPU): triangulated deformation, warping, stylized
reshaping, animal-like transformations. This needs a new command family (`drawMesh`: vertices,
indices, UVs, source) and a second renderer implementing the whole vocabulary. **Not started, and
not to be started before the non-mesh stages are shipped and judged insufficient.**

### A.7 Face Landmarker outputs (installed 0.10.35)

**[verified from `node_modules/@mediapipe/tasks-vision/vision.d.ts`]**

- `FaceLandmarker.createFromOptions(fileset, options)` with `baseOptions.modelAssetPath`,
  `runningMode: 'VIDEO'`, and `detectForVideo(frame, timestampMs)`, matching how the hand detector
  is built.
- Options: `numFaces` (default 1), `minFaceDetectionConfidence`, `minFacePresenceConfidence`,
  `minTrackingConfidence` (defaults 0.5), `outputFaceBlendshapes`,
  `outputFacialTransformationMatrixes` (both opt-in).
- Result: `faceLandmarks: NormalizedLandmark[][]` (normalized image coordinates),
  `faceBlendshapes: Classifications[]` (each holding `Category { categoryName, score }`), and
  `facialTransformationMatrixes: Matrix[]` (`{rows, columns, data: number[]}`, documented as
  transforming canonical-face landmarks to the detected face).
- Static connection sets: `FACE_LANDMARKS_LIPS`, `_LEFT_EYE`, `_RIGHT_EYE`, `_LEFT_EYEBROW`,
  `_RIGHT_EYEBROW`, `_LEFT_IRIS`, `_RIGHT_IRIS`, `_FACE_OVAL`, `_CONTOURS`, `_TESSELATION`. These
  are index-pair lists usable as the source of face-region index sets.

**[assumption — not visible in the type declarations, to be confirmed against the model when it is
added]**: the landmark count (478 with iris, 468 without; the presence of `_LEFT_IRIS`/`_RIGHT_IRIS`
connections implies the iris points exist), the blendshape count (52) and category naming, and
that the transform matrix is 4×4. The mirrored-input convention needs no handling for landmarks
(the surface is already mirrored, as for hands), but this is **untested** for faces.

Version note: the lockfile pins 0.10.35, which is what was inspected. Whether the lower bound
`^0.10.14` also exposes every option above was **not checked**; the lock makes it moot for builds,
but the spec should pin its minimum deliberately if it matters.

### A.8 Privacy

Face tracking is compatible with "coordinates, never images" as long as it stays that way:

- `FaceFrame` holds numbers only, exactly as `LandmarkFrame` does. Nothing persists it, records it,
  or transmits it; the existing scans for storage, readback and upload APIs apply to it unchanged.
- **Not persisted**: face landmarks, blendshapes and transform matrices are transient
  frame data. Capture Mode's persistable categories (constitution v1.8.0, categories 3 and 4)
  cover **hand** landmarks only; faces are not covered and must not be added by implication.
- A mesh renderer must upload the camera surface to a GPU texture (`texImage2D` from the mirrored
  canvas) and sample it in a shader, **never** reading pixels back. The privacy scan did not list
  WebGL's `readPixels`; **`readPixels` and `convertToBlob` were added to `READBACK_APIS` on
  2026-09-21** so that path is closed before it exists.
- No exemption to any privacy test is proposed or needed.

### A.9 Dependencies and risks

| Need | Category |
|---|---|
| `@mediapipe/tasks-vision` | Already available |
| WASM runtime, `FilesetResolver`, VIDEO-mode pattern, `MirroredSurface` | Reusable |
| Shared-asset serving (`SHARED_MODELS`, fetch script pattern) | Reusable |
| Anchor param plumbing, `landmark-trail`, `particle-burst` | Reusable once face data reaches the resolver |
| Face model file | **Requires a new model asset** (not present; URL unchecked) |
| Minimum `tasks-vision` version | **Requires a version decision** (lock pins 0.10.35) |
| Generalized `probeCapabilities` | **Requires an architectural change** (small) |
| Face data through `AnchorResolver`/`ActionContext` | **Requires an architectural change** |
| Region mask source generalization | **Requires an architectural change** |
| Blendshape channel for actions | **Requires an architectural change** (only if blendshape-driven effects are wanted) |
| Mesh renderer | **Requires an architectural change** (large); out of the first stages |
| Constitutional authorization | **Blocked on an unresolved decision** |

The blocker: Mudra Web's authorizations are per-milestone (v1.6.0–v1.9.0), and none covers face
tracking. Principle VI requires its own explicit amendment before any behaviour exists. That
amendment should decide, at minimum: whether face landmarks are permitted at all in the default
experience (a face is more sensitive than a hand), whether there is a separate opt-in beyond the
camera-start gesture, that they are never persisted, whether face-driven *triggers* are excluded,
and how the label scan treats any new user-facing wording.

Staged order, unchanged in spirit: amendment → capability + port + adapter + model asset →
face anchors → mask source and region tints → decals/blendshape overlays → *only then* a mesh
renderer, if warping is still wanted. First stages (anchors) need no renderer work at all.

### What must not happen

- No face imagery may be persisted, read back, or transmitted. Face data is the last thing that
  should earn a privacy exemption.
- Face landmarks must not become a second recognition system. Pose recognition is hand-based and
  its thresholds, weights and hold semantics are out of the editor's reach (FR-021, FR-022). A face
  capability supplies *anchors and masks*, not triggers, unless a future spec authorizes them.
- No face-shaped placeholder action, port, command or capability entry may be added before the
  feature is real. The `person_visibility` precedent applies: one action demonstrating the gating
  mechanism, not a family of them.

### Manual verification still required (for the eventual feature)

Everything above is repository/type-level reconnaissance. Nothing about Face Landmarker was run in
a browser: model loading, landmark counts, mirrored-space behaviour, frame-rate cost of running
hand + face + segmentation together, and the mask/decal visuals are all unverified.

---

## B. Web capture mode — Done (automated); manual browser pass outstanding

Implemented by **spec 009** (`specs/009-web-capture-mode/`, all 59 tasks ticked) under **constitution
v1.8.0**. The four questions the earlier version of this section posed as open are answered:

- **Schema** — Done. Web writes exactly the versioned pose-sample schema (`schema_version` 1);
  there is no web-specific schema. The serializer is checked against **Engine-generated** golden
  fixtures (`scripts/export_web_capture_fixtures.py` → `apps/web/test/fixtures/pose_sample_cases.json`,
  asserted in `test/domain/pose-sample-serializer.test.ts`), the same cross-language rule as
  normalization and matching. Additive fields (`mirrored_preview`, `countdown_enabled`,
  `session_uuid`, `contributor_label`) sit inside blocks Engine already reads. Normalization is
  the existing `normalize()`, not a second algorithm.
- **Coordinate convention** — Done, and re-verified 2026-09-21 (spec 009 FR-026/FR-026a,
  `test/adapters/capture-orientation.test.ts`): the camera is mirrored once, on pixels;
  `raw` is stored as detected; nothing flips a coordinate or handedness afterwards.
- **Persistence/storage** — Done. Samples live in IndexedDB, confined to
  `src/infrastructure/persistence/**` (still the one permitted directory), in a store separate
  from projects. Persisted types have no field an image could occupy (`domain/capture/types.ts`).
  Every other storage API remains prohibited everywhere, including inside capture. Sample review
  draws inline SVG from coordinates, never imagery.
- **Consent and gating** — Done. Capture is a build-time-gated third entry point
  (`VITE_MUDRA_CAPTURE=1`); an unflagged build contains no capture code
  (`test/architecture/capture-boundary.test.ts`). Its own consent step (`presentation/capture/consent-gate.ts`)
  is separate from camera-start, held in memory and **never persisted**, so it is asked again after
  a reload. Build-time gating is feature gating, not access control — no in-browser secret is used
  or presented as one (`contracts/capture-gating.md`).
- **Export and deletion** — Done. Local ZIP download only, by explicit action; samples and whole
  sessions are enumerable and deletable, and deletion removes rather than flags. Nothing is
  uploaded. The dataset fingerprint the build ran against is recorded in the export manifest.
- **Privacy/constitution** — Resolved by amendment, not by weakening. v1.8.0 permits exactly
  two persistable categories (hand landmarks; minimal session metadata) and forbids images,
  thumbnails of captured samples, detector/segmentation objects and camera handles. In
  `test/architecture/privacy.test.ts` the storage, readback, upload and inbound-GET-only assertions
  are **unchanged**; the only loosening is two named, narrow exemptions — the download scan
  (`capture-export-panel.ts`) and the label scan (`presentation/capture/`) — with the exemption
  lists asserted to be exactly two entries long, and the capture tree separately asserted to call
  no readback or upload API. (See `specs/009-web-capture-mode/contracts/privacy-capture.md`.)

Still open in this area:

- **Manual browser verification** of spec 009's quickstart scenarios is not recorded anywhere in the
  repository; the automated suite covers the logic, not a camera, a real IndexedDB quota, or the
  visual thumbnail.
- **Explicitly not authorized** (unchanged; each needs its own amendment): upload/sync, crowdsourced
  contribution, accounts, a second schema, sequence capture, in-browser dataset management, and any
  persistence of imagery.

Relationship to Mudra Capture is unchanged: complementary, no shared code, one shared contract.

---

## C. Smaller things

### Done

- **Drag-and-drop panel docking** — Done (spec 010, constitution v1.9.0). `DockNode` trees, held
  per layout and persisted as editor chrome in its own IndexedDB store
  (`indexeddb-layout-store.ts`, not in project documents); pointer drag plus a keyboard-operable
  relocation command; empty zones persist; panels can be closed and restored from View. Covered by
  `dock-tree`, `dock-layout`, `drop-region`, `split-resize` and related tests. Not delivered by
  design (spec 010 Out of Scope): floating/undocked windows, user-authored layout topologies, and a
  keyboard equivalent of the drag gesture itself. Manual browser pass outstanding
  (`specs/010-editor-workspace-refinements/quickstart.md` records it as not yet done).
- **Tabs** — Done, and **explicit, never automatic**: panels sharing a zone are stacked or split
  unless the author drags one onto another's tab/content area; a tab strip disappears when a group
  is down to one panel; tab order is author-reorderable.
- **Undo/redo** — Done. A bounded snapshot stack (`domain/editor/edit-history.ts`) wired to the Edit
  menu and `Ctrl+Z`/`Ctrl+Y` (spec 009 US4, FR-074–FR-077), and in spec 010 scoped per effect
  being edited so undo never crosses editing context. It is editor session state: never persisted,
  no field added to a project document.

### Deferred

- **Timeline multi-select.** The selection model is deliberately one clip and every surface agrees
  on that one clip. Widening it touches the tree, timeline, inspector and Play Selected together.
  Confirmed still out of scope in spec 010.
- **Per-particle textures / sprite particles.** `drawCircles` (`domain/runtime/frame-output.ts`)
  still carries points, radii, colour and optional per-point opacity only. Sprites mean a
  texture-aware command and the image-loading seam `drawMaskedImage` introduced; possible, not free.
- **A unified toast/notification system.** Still absent (no toast code exists in `apps/web/src`).
  `presentation/editor/project-panel.ts` still uses a persistent `statusText` line set by
  `setStatus()` with no lifecycle, so repeated saves can leave a stale message. The eventual fix
  is a small, centralized transient-message system that every feature reports through. Deliberately
  not part of spec 010 or of the 2026-09-21 pass.

---

## D. Follow-ups discovered during the 2026-09-21 reconciliation

- **Review thumbnail orientation (fixed).** The Capture Mode sample thumbnail plotted the
  wrist-relative `normalized` set, stacking every hand on one origin. It now plots `raw` (mirrored
  frame space) scaled by the frame size (spec 009 FR-026a). No stored or exported data changed.
- **Spec paths.** Specs 009 and 010 cite this file as `specs/008-effect-editor/future-work.md`; it
  lives at the repository root. Left untouched so historical spec text is not rewritten.
- **Manual browser passes** for specs 009 and 010 remain outstanding and are the main unclosed item
  for the shipped features.
