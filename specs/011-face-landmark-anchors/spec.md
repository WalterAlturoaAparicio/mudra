# Feature Specification: Face Landmark Anchors

**Feature Branch**: `011-face-landmark-anchors` (no branch was created; the spec directory is what downstream commands resolve via `.specify/feature.json`)

**Created**: 2026-09-21

**Status**: Draft — Amendment A (browser-validation slice) added 2026-09-21; amended earlier (analysis corrections I1–I5, D1, E1–E2, B1, G1, then U1–U3 folded in; this spec is the single authoritative source — `plan.md` and `tasks.md` must agree with it, never override it)

**Input**: User description: "Spec 011: specify the first viable slice of Mudra Web's Face Tracking and Face Effects milestone, under constitution v1.10.0 (Principle VI, Milestone 4), as the smallest coherent slice, creating no dormant infrastructure, and resolving every open decision the constitution delegated to the specification."

**Governing authority**: `.specify/memory/constitution.md` v1.10.0, Principle VI, "Mudra Web — Milestone 4: Face Tracking and Face Effects (authorized in stages)", with Principle II binding without exception. Every requirement below either preserves a rule stated there or resolves a decision it explicitly delegated here.

---

## Why this feature exists

Mudra Web's effects follow a hand: a trail can chase a fingertip, a particle burst can leave a landmark. Authors have asked for the same with a face — a trail from the tip of the nose, sparkles from the corner of an eye. The constitution now authorizes face tracking in stages (capability → domain abstraction → anchors/regions → simple effects → mesh evaluated separately) and requires the first specification to be the **smallest viable vertical slice**.

The smallest slice that is *not dormant* is this one: **an author can anchor an existing effect action to a numbered landmark on a tracked face, and see it follow the face in the editor preview.** It needs, and only needs, the first two stages in full and the point-anchor half of the third:

| Stage | Covered by Spec 011? | Why |
|---|---|---|
| 1. `face_landmarks` capability | **Yes** | Nothing can be gated, reported or run without it. |
| 2. Face-landmark domain abstraction | **Yes** | The capability's product needs a framework-free type and port. Building either without a consumer would be dormant infrastructure, so they are delivered together with stage 3's point anchor, not before it. |
| 3. Anchors / regions | **Point anchors only** | A landmark-index anchor is what makes the two stages above *do* something, and it reuses the existing anchor mechanism and the existing anchor-taking actions unchanged. **Regions, and any region geometry/masking representation, are deferred** — no part of this slice needs them. |
| 4. Simple face effects (tints, eye colour, decals, blendshape overlays, masks) | **No** | Each needs region geometry or a new render command or a blendshape channel. None is needed to prove the slice. Deferred to Spec 012 and later. |
| 5. Mesh / deformation | **No** | Not authorized; needs its own amendment. |

This specification therefore adds **no new action, no new render command, no region vocabulary, no blendshape or transform-matrix output, and no change to the renderer.** The only new *visible* behaviour is that an existing anchor parameter can name a face landmark, and a face-tracking indicator appears while a face is being tracked.

---

## Clarifications

### Session 2026-09-21 (decisions delegated by constitution v1.10.0)

The constitution left these to the specification. Each is decided here and recorded once; the sections below refer back to this list.

- **D1 — Stages implemented**: Stage 1 (capability), Stage 2 (domain abstraction), and the **point-anchor part of Stage 3**. Not regions; not effects; not mesh. Rationale in "Why this feature exists".
- **D2 — Face model**: MediaPipe's published **Face Landmarker** bundle, float16, version path `1` (`face_landmarker/face_landmarker/float16/1/face_landmarker.task` on `storage.googleapis.com/mediapipe-models/`). Justification against the constitution: it is the only Face Landmarker bundle published for the `FaceLandmarker` API of the already-installed `@mediapipe/tasks-vision` (so no second ML runtime, constitution item 2); it comes from the same publisher, host and version-path convention as the shared models already provisioned; float16 matches the existing segmentation model. Its licence and landmark count are **assumptions to verify at provisioning** (A-3, A-4), not facts established here.
- **D3 — Provisioning and provenance**: a new, separate, explicit script (not part of the existing `fetch-models`), pinned to the exact URL in D2, that verifies a recorded **SHA-256** and refuses to keep a file that does not match. Provenance (source URL, model name, precision, version path, SHA-256, licence, date fetched) is recorded in `assets/readme.md`. The model is absent by default and never committed.
- **D4 — Domain abstraction**: a framework-free immutable **`FaceFrame`** and a replaceable **`FaceDetector`** port — the anticipated names are confirmed. A `FaceFrame` is **one face's landmarks only**: an ordered list of points in the existing `Landmark` value shape (normalized, mirrored-surface space), the source timestamp, and the source surface size. **It carries no blendshapes, no transformation matrix, no confidence, no handedness-like label, and no image.** Exactly one face is tracked (the first the detector reports).
- **D5 — Absence**: `FaceDetector.detect` returns **`FaceFrame | null`**; `null` means "no face this frame". This follows the person-segmenter's precedent rather than the hand detector's "emit a frame every time", because the hand detector's empty frames exist for the stability tracker and pose events, and faces have neither (constitution item 1: faces never feed them). "No face this frame" and "the capability does not exist" stay distinct: the latter is the absence of a detector, decided once at probe time.
- **D6 — Regions**: **not required by this slice; deferred.** No region name, region geometry, mask, or `faceRegion` anchor is introduced. The existing `'person' | 'background'` region behaviour is untouched.
- **D7 — Capability lifecycle and failure**: `face_landmarks` is probed **independently**, by actually constructing the face detector; failure of that construction (model absent, unsupported browser, no compatible delegate) marks *only* `face_landmarks` unavailable, and failure of the segmenter's construction never affects it. Unavailable ⇒ face-anchored actions are **inert and reported**, never simulated. Full detail in FR-001–FR-008.
- **D8 — When face processing begins and ends**: a frame is analysed for a face **only when** (a) a camera has been attached by the explicit camera-start gesture, **and** (b) `face_landmarks` is available, **and** (c) on that frame, at least one action is *scheduled by the timeline scheduler* and its anchor is a face landmark (D15). Processing stops on the first frame where any of those is false, and always when the camera is detached. Nothing is analysed before camera start, when nothing playing needs a face, or in Capture Mode. Full detail in FR-016–FR-021.
- **D9 — Disclosure / opt-in**: **no separate opt-in beyond the camera-start gesture is required**; instead a **visible face-tracking indicator MUST be shown while face analysis runs and for a short fixed minimum hold after the last analysis frame (D24)**, and the editor's camera control MUST NOT run face analysis silently. Rationale: the data is transient geometry that is never stored, transmitted or read back; analysis runs only on frames where an action the author themselves authored is scheduled and needs a face point (D8, D15), on the author's own local session; and hand tracking — equally derived from the camera — is treated the same way today. Where the decision is represented: FR-019, FR-020 and the editor status indicator. If a later spec introduces face analysis in the public experience, it must revisit this (see Deferred).
- **D10 — Where face tracking exists**: **the editor's runtime only.** The public default experience does not probe, construct or run face tracking in this slice (its shipped catalog has no face-anchored action, so it would be dormant there); a face anchor that reaches it is inert and reported like any unavailable capability. Capture Mode has no face capability at all.
- **D11 — Existing actions**: `landmark_trail` and `particle_burst` — the two registered actions with an `anchor` parameter — become face-anchorable **with no change to either action**, because the anchor is resolved centrally and delivered to them as a point. No face-specific action is created.
- **D12 — Data isolation**: transient face data is confined to one narrow path (detector → face-frame argument of the runtime → the central anchor resolver) and is structurally absent from every other path (D14 lists the tests).
- **D13 — Blendshapes and transformation matrices**: **not requested from the model and not represented.** The constitution permits raw-numeric blendshape modulation of a running effect; this slice does not need it, so unrequested output cannot leak and no unused channel is built. Deferred.
- **D14 — Proof of boundaries**: see "Boundary-proving tests" under Requirements.

### Session 2026-09-21 (analysis corrections — promoted from `plan.md` so the spec is self-contained)

The analysis pass found decisions living only in the plan/tasks. Each is now normative here.

- **D15 — "Needs a face" is per frame and per scheduled action** *(was plan SC-1; supersedes the earlier "currently playing" wording)*: an action *needs a face* on a frame iff the timeline scheduler schedules it on that frame **and** its anchor parameter is a face-landmark anchor. This covers a continuous action anywhere inside its window **and** an instantaneous action on the single frame it fires; detection for that frame happens in the same evaluation that fires it, so an instantaneous action at offset 0 fires *with* a face available rather than one frame too early. A face anchor that merely exists in a project or effect configuration — on an effect that is not playing, or on an action not scheduled on this frame (e.g. waiting for a later offset, or already finished) — creates **no** need and MUST NOT cause face analysis. The *analysis* lifetime defined here is independent of the *indicator* lifetime (D24): analysis is never prolonged to keep an indicator visible.
- **D16 — Detector lifecycle: construction, processing, release are three different things** *(was plan SC-2)*: (1) *construction* of the face detector/model may happen independently of camera attachment (at the editor's capability probe); constructing does not analyse anything. (2) *Processing* (running detection on a frame) happens only under FR-016 and stops immediately when the camera is turned off or any condition fails. (3) *Release* — the terminal `close()` — happens only at editor/page teardown. Turning the camera off **stops processing; it does not release the detector**, so the same instance is reused across camera off/on cycles and across closing and reopening projects. A camera restart MUST NOT hand out a detector that has already been terminally closed.
- **D17 — Capability identity vs prober vs probed result** *(was plan SC-3)*: three things are kept distinct. (a) The capability's **identity** is a named constant, `face_landmarks`, defined once. (b) Whether a **prober** exists in a given runtime: only the editor supplies one; the public experience, Capture Mode and every existing call site and test supply none. (c) The **probed result**: with a prober supplied, `face_landmarks` is reported available only if actually constructing the detector succeeded, unavailable if it failed. With no prober supplied, no `face_landmarks` entry is reported at all (the runtime is exactly what it was before this feature) and `has('face_landmarks')` is `false`. `person_segmentation` is unchanged in every case. This is not a generic capability framework: it is one optional extra probe.
- **D18 — Project schema compatibility** *(was plan SC-4 / assumption A-5; repository evidence checked)*: `PROJECT_SCHEMA_VERSION` stays **1** and the shipped catalog's own version stays 1. Evidence: the project loader requires the version to equal the build's own (strict equality) and there is no migration mechanism, so bumping would make the new build reject **every existing project**. Adding a new anchor `kind` is therefore an additive change inside version 1: all existing projects load unchanged; a project containing a face anchor is saved as version 1 with `params.anchor = {"kind":"faceLandmark","index":N}`. An **older build rejects** such a project (its anchor parser rejects the unknown kind and the whole project fails to open with its existing "catalog is invalid" error) — it never silently ignores or misruns it. See FR-015d.
- **D19 — Timestamps** *(was plan SC-5)*: the editor can call the face detector from more than one place per moment (a live tick, Test Trigger, Play Timeline), with timestamps that need not be increasing. The detector adapter therefore guarantees strictly increasing timestamps to the underlying library. See FR-022a.
- **D20 — No synthetic face** *(was plan SC-6)*: the editor supplies a stand-in *hand* when no camera is attached so hand effects can be previewed. No stand-in **face** is ever supplied: with no camera a face anchor is unresolved and reported, as with an unavailable capability, because substituting fixed geometry for a face that cannot be tracked is forbidden (FR-005). See FR-018a.
- **D21 — Landmark-count validation ordering** *(resolves analysis finding D1)*: the model's landmark count (assumed 478) has **not** been verified — nothing was downloaded or run — so it is **provisional** until the model verification of the Definition of Done is recorded. Persisted data must never depend on an unverified model fact. Therefore: **loading** a project or catalog checks only that a face-landmark anchor's `index` is a **non-negative integer** (structure); **model-specific range** is enforced at the **authoring** boundary (the Inspector) and at the **runtime resolution** boundary, where an out-of-range index fails safely — no point is resolved, the existing unresolvable-anchor rule applies, and it is reported — and is never clamped, remapped, wrapped or fabricated. Once the count is verified against the pinned model, that verified count becomes the boundary at authoring, at runtime, and in the detector's count guard. See FR-013, FR-015a, FR-015c.
- **D22 — Completion is not "tests pass"** *(resolves analysis finding E1)*: the feature is complete only when the Definition of Done below is satisfied, including a verified model hash and landmark count.
- **D23 — The model is absent by default; that is expected** *(resolves analysis finding G1)*: until a developer runs the explicit provisioning script, the model file does not exist, the editor's eager capability probe finds no model and reports `face_landmarks` unavailable (a failed same-origin fetch and a logged warning at editor load are expected in this state). This is a normal development/setup state, **not** a fault and **not** a trigger for any fallback: neither the editor nor any other code may try to download a model at run time. The existing logging conventions are not changed by this spec.
- **D24 — Analysis lifetime vs disclosure-indicator lifetime** *(resolves analysis finding U1)*: a very short face-anchored action (e.g. a `particle_burst` with a window of a few tens of milliseconds) legitimately triggers analysis on only a frame or two, and an indicator visible for ~16 ms is not meaningful disclosure. The two lifetimes are therefore separate. **Analysis lifetime** is exactly FR-016/FR-017 and is never extended. **Indicator lifetime** is the analysis frames plus a fixed minimum hold, `FACE_INDICATOR_HOLD_MS` = **500 ms** (a single named constant, defined once, measured on the editor's frame clock from the *last frame on which analysis ran*). During the hold no detection or face processing occurs, and the indicator shows a distinct *finished* state so it cannot be mistaken for active processing. An analysis frame arriving during the hold restarts the hold from that frame (one deadline, no second timer). Once the hold elapses with no further analysis the indicator is hidden. The indicator is never shown merely because a face anchor exists in configuration. 500 ms is a disclosure-perceptibility choice for a text indicator, not a performance figure. See FR-019, FR-019a.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Anchor an existing effect to a point on my face (Priority: P1)

An author working in the editor has an effect whose action follows an anchor (a landmark trail, or a particle burst). They set that action's anchor to a **face landmark** by number, turn the camera on, trigger the effect, and see it follow the corresponding point on their face in the preview.

**Why this priority**: it is the whole slice. Without it the capability and the domain type would be dormant.

**Independent Test**: with a fake face detector supplying a deterministic face frame (no camera, no model), run an effect with a face-anchored `landmark_trail` and assert its rendered points follow the supplied landmark's position scaled to the surface. Then, in a real browser (manual, see below), confirm it follows a real face.

**Acceptance Scenarios**:

1. **Given** the editor with an effect whose `landmark_trail` anchor is face landmark N and a face detector that reports a face, **When** the effect plays, **Then** the trail's points are at that landmark's position on the surface, and follow it as the face moves.
2. **Given** the same effect and a face at the left of the image, **When** it plays, **Then** the trail is at the left of the surface — the orientation of the surface the author is looking at is preserved, not mirrored again.
3. **Given** a face-anchored `particle_burst`, **When** it fires, **Then** particles originate at the landmark, using the same action as for hands with no face-specific variant.
4. **Given** the face is lost mid-effect, **When** subsequent frames have no face, **Then** the action holds its last resolved position (existing behaviour), and if it never had a face it is skipped and the reason is reported.

---

### User Story 2 - Nothing runs, and nothing is reported as running, unless a face is actually needed (Priority: P1)

The author opens the editor, turns the camera on and works on hand-anchored effects. No face is analysed. Only on frames where a face-anchored action is *scheduled* (D15) does face analysis run, and the editor shows that it is on.

**Why this priority**: it is the constitution's privacy condition for this milestone (Principle II restated, and the "when detection runs and what the user is told" requirement).

**Independent Test**: with a fake detector that counts calls, assert zero calls before a camera is attached, zero while only hand-anchored effects play, at least one per frame while a face-anchored action is scheduled, and zero again once none is scheduled, after the camera is detached, and in a Capture Mode session.

**Acceptance Scenarios**:

1. **Given** the camera is on and only hand-anchored effects are playing, **Then** the face detector is never invoked and no indicator is shown.
2. **Given** a face-anchored action is scheduled on a frame (including the single frame an instantaneous action fires, if an anchor-taking instantaneous action is ever registered — none of the six shipped ones is: `landmark_trail` is continuous and `particle_burst` has a duration window, so a zero-duration burst is never scheduled at all), **Then** the detector is invoked once on that frame, the indicator appears, and this repeats each frame while one is scheduled.
3. **Given** no face-anchored action is scheduled on a frame, **Then** the detector is not invoked on it — even if a face anchor exists elsewhere in the project. The indicator shows its *finished* state until `FACE_INDICATOR_HOLD_MS` has elapsed since the last analysis frame, then disappears; during that hold no additional face analysis occurs.
4. **Given** the camera is turned off while face analysis is running, **Then** analysis stops on that frame and does not resume until the camera is turned on again *and* conditions (b) and (c) hold. The detector is not released.
5. **Given** the author turns the camera off and on repeatedly, **Then** face-anchored effects work after each cycle (no dead detector after the first detach).

---

### User Story 3 - It degrades honestly when face tracking is unavailable (Priority: P1)

The face model file is not present (the default checkout state), or the browser cannot run it. The author can still author a face anchor, and is told plainly that it will not run, exactly as for any other unavailable capability.

**Why this priority**: the constitution requires inert-and-reported, never simulated; and "absent by default" is the normal state.

**Independent Test**: probe with a face constructor that rejects; assert the registry reports `face_landmarks` unavailable, the segmentation capability is unaffected, a face-anchored action produces no commands and a `capability_unavailable` diagnostic naming `face_landmarks`, and the action's status badge reads as capability-unavailable — with no exception and no fake output.

**Acceptance Scenarios**:

1. **Given** the model is absent, **When** the editor starts, **Then** the editor loads normally, `face_landmarks` is reported unavailable, and person segmentation's availability is exactly what it would have been without this feature.
2. **Given** `face_landmarks` is unavailable, **When** a face-anchored action's effect plays, **Then** it produces nothing, the runtime records a diagnostic naming the capability, and the inspector/timeline/project-tree show the existing "capability unavailable" state for that action.
3. **Given** `face_landmarks` is unavailable, **Then** face analysis never runs and no indicator is shown.
4. **Given** the default (public) experience, **Then** it behaves as before: no face model is requested, and a face-anchored action reaching it is inert and reported.

---

### User Story 4 - Face data can never leak into recognition, storage, Capture Mode or the network (Priority: P1)

A maintainer (or a future contributor) must be unable to make face landmarks reach the pose matcher, pose events, a saved project, the Capture Mode store or export, or any transmission path without a test failing.

**Why this priority**: it is what the constitution's restated Principle II and recognition boundary require, and it is the risk that makes faces different from hands.

**Independent Test**: the boundary-proving tests below. Each is deliberately a *negative* assertion that fails if a leak path is introduced, not a happy-path test.

**Acceptance Scenarios**:

1. **Given** a face frame with distinctive sentinel coordinates run through the runtime with a face-anchored effect, **When** the project is serialized, **Then** the output contains the anchor's `{kind, index}` and none of the sentinel values.
2. **Given** the source tree, **Then** no module in recognition, pose-event or stability code, in Capture Mode (domain, application, infrastructure, presentation, entry point) or in persistence names a face type.
3. **Given** the source tree, **Then** the existing readback/upload/storage scans pass unchanged over every new file.

---

### User Story 5 - Author and load a face anchor safely (Priority: P2)

An author sets a face-landmark anchor in the Inspector, saves the project and reopens it. Invalid input is rejected with a clear message rather than producing a broken effect.

**Why this priority**: a new anchor kind is authored data and must validate everywhere anchors already validate; it is secondary only because User Story 1 can be exercised with hand-built data first.

**Independent Test**: catalog and project round-trip tests for the new anchor kind; validation tests for out-of-range and non-integer indexes.

**Acceptance Scenarios**:

1. **Given** the Inspector for an anchor parameter, **When** the author chooses the face-landmark kind and an index, **Then** the value is stored as data in the action's parameters like any other anchor.
2. **Given** the author types an index outside the model's landmark range in the Inspector, **Then** it is rejected at authoring with a message naming the valid range (provisional until the model count is verified, D21); a negative or non-integer index is rejected everywhere.
3. **Given** a saved project whose face anchor has a non-negative integer index that is beyond the (currently provisional) landmark range, **When** it is opened, **Then** it **loads** (persisted data does not depend on the unverified model count), and at runtime that anchor resolves to no point and is reported.
4. **Given** a saved project with a face anchor, **When** it is reopened, **Then** the anchor is restored exactly.
5. **Given** an author undoes and redoes the anchor edit, **Then** it behaves like any other parameter edit (existing history; no change to it).

---

### Edge Cases

- **Face and hand anchors in one effect**: each action resolves its own anchor independently; a lost face never disturbs a hand-anchored action (and vice versa).
- **Two faces in frame**: only the first the detector reports is tracked (D4). Which one is "first" is not guaranteed stable between frames; this is an accepted limitation of the slice, recorded as deferred.
- **Landmark index valid for the model but the detector returns a different count**: the adapter treats a result with the wrong point count as no face for that frame and reports it once (FR-011), the same defensive rule the hand detector applies to non-21-point results.
- **Detector throws on one frame**: the frame loop continues; the frame is treated as "no face" and the failure is logged once per streak, not per frame.
- **Camera resolution changes mid-session**: anchors resolve against the frame's own surface size, exactly as hand anchors already do.
- **Face-anchored action in a catalog loaded by the public experience**: inert and reported (User Story 3, scenario 4).
- **Effect authored in this version, opened by an older build**: the older build rejects the unknown anchor kind with its existing anchor-validation message; no silent misbehaviour (D18, FR-015d).
- **Camera turned off and on**: processing stops when it is turned off; the same detector instance is reused on the next start (D16, FR-021).
- **A face anchor exists but nothing scheduled uses it** (effect not playing, action waiting for a later offset, or already finished): no face analysis, no indicator (D15).
- **A very short face-anchored action** (a window of only a frame or two): analysis runs on those frames; the indicator (*on*) then remains visible in its *finished* state for `FACE_INDICATOR_HOLD_MS`, with no further analysis (D24).
- **Index beyond the model's range at runtime**: no point resolved, reported, never clamped or fabricated (D21, FR-015c).
- **The real model's landmark count differs from the provisional 478**: the detector's count guard treats every frame as "no face" and reports it, so nothing is misanchored; the constant is corrected as part of model verification (Definition of Done).
- **No camera attached**: a face anchor is unresolved and reported; no stand-in face is supplied (D20).
- **Author edits a face anchor while its effect is playing**: a running playback keeps the definition it started with (existing behaviour, unchanged); the edit takes effect the next time the effect plays, and from then on the indicator follows condition (c).

---

## Requirements *(mandatory)*

### Functional Requirements — new behaviour

**Capability (Stage 1)**

- **FR-001**: A `face_landmarks` capability MUST have a single named identity, and — wherever a face prober is supplied — its availability MUST be determined by actually attempting to construct the face detector, never assumed and never hardcoded (D17).
- **FR-002**: Each capability MUST be probed independently: failure to construct the face detector MUST NOT make `person_segmentation` unavailable, and failure to construct the segmenter MUST NOT make `face_landmarks` unavailable. The probe MUST return each successfully constructed backend.
- **FR-003**: A runtime that supplies **no** face prober — the public experience, Capture Mode, and every existing call site and existing test — MUST report exactly the capabilities it reported before this feature (no `face_landmarks` entry), and `has('face_landmarks')` MUST be `false` there. A runtime that supplies a prober MUST report `face_landmarks` available only if construction succeeded and unavailable if it failed. The shipped default registry (`defaultCapabilities()`) MUST be unchanged. `person_segmentation` availability, reporting and gating MUST be behaviourally unchanged in every case (D17).
- **FR-004**: When `face_landmarks` is unavailable, an action whose anchor parameter names a face MUST produce no render commands and MUST be recorded as skipped with reason `capability_unavailable` and the capability name `face_landmarks` in the runtime's diagnostics.
- **FR-005**: An unavailable `face_landmarks` MUST NOT be simulated: no fixed position, default face shape, or last-known-good geometry is ever substituted for a face that cannot be tracked.
- **FR-006**: The status shown for an authored action in the inspector, timeline and project tree MUST reflect FR-004 through the existing "capability unavailable" status, derived from the action's parameters, with no branch keyed to a specific action type.
- **FR-007**: Authoring MUST NOT be gated by availability: an author can set a face anchor when the capability is unavailable and is told (FR-006) that it will not run here.
- **FR-008**: The default (public) experience MUST NOT probe, construct or run face tracking in this slice, and MUST behave exactly as before.

**Domain abstraction (Stage 2)**

- **FR-009**: The domain MUST define a framework-free, immutable, validated `FaceFrame` (per D4), constructible in a plain test with no browser, camera or model. A frame with the wrong number of points or a non-finite coordinate MUST be rejected at construction.
- **FR-010**: The domain MUST define a replaceable `FaceDetector` port whose `detect` returns `FaceFrame | null` (D5) and which can be closed idempotently.
- **FR-011**: The only code allowed to name the MediaPipe face symbols is one infrastructure adapter. It MUST convert the library's result into a `FaceFrame`, treat a result with a point count other than the domain's face-landmark count as "no face" (reporting it once), and MUST NOT request blendshape or transformation-matrix output (D13).
- **FR-012**: MediaPipe types MUST NOT appear anywhere under `src/domain/`. The existing layering test MUST be extended so that the face symbols (at minimum `FaceLandmarker` and the library's face-result and normalized-landmark type names) are rejected there, not only the package name.
- **FR-013**: The face-landmark count is a named domain constant, defined once and never repeated as a literal elsewhere. Its initial value, **478**, is **provisional and unverified** (A-4, D21). It MUST be set to the count observed against the pinned model as part of the Definition of Done, and until then it is used only as a *runtime and authoring* boundary (FR-015a, FR-015c, FR-011) — **never** as a project-load or persistence validation boundary.

**Anchors (point anchors of Stage 3)**

- **FR-014**: The anchor vocabulary MUST gain exactly one new kind: a landmark of the tracked face, identified by integer index. Existing anchor kinds and their semantics, including the hand `landmark` kind, MUST be unchanged.
- **FR-015**: The central `AnchorResolver` MUST remain the only component that turns an anchor into a point. It MUST resolve the face anchor from the face frame it is given, scaling normalized coordinates by the surface size exactly as hand anchors are scaled, in the same mirrored space, with **no additional flip**. When there is no face this frame it MUST apply the existing unresolvable-anchor rule unchanged (hold the last resolved position; if none, skip and report a reason). No action MAY contain its own landmark lookup.
- **FR-015a**: Face anchors MUST be accepted and validated wherever anchors already are — action-parameter validation, catalog loading and serialization, the project document round-trip, and the Inspector's anchor control — as follows. *Structural validation* (everywhere, including load): `index` MUST be a **non-negative integer**; otherwise it is rejected with a message stating that. *Model-range validation* (authoring only): the Inspector MUST reject an index outside `[0, FACE_LANDMARK_COUNT − 1]` with a message naming that range. Load-time validation MUST NOT reject an otherwise structurally valid anchor because of the model's landmark count (D21).
- **FR-015b**: `landmark_trail` and `particle_burst` MUST be usable with a face anchor with **no modification to either action** and no face-specific variant of any action MUST be created.

- **FR-015c**: At runtime, a face anchor whose index is not present in the detected face MUST resolve to **no point** and be reported by the existing unresolvable-anchor rule (hold the last resolved position if one exists, otherwise skip and report). It MUST NOT crash, clamp, wrap, remap to another landmark, fabricate a point, or engage any recognition. A non-negative index that is currently outside the model range (for example in imported or previously saved project data) is **structurally valid project data**: it may remain in the project unchanged and MUST NOT be rewritten, dropped or rejected at load (D21). It simply cannot resolve while outside the range. Entering such an index in the Inspector is rejected (FR-015a) using the verified count once it is available (the provisional constant until then) (D21).
- **FR-015d**: **Project schema compatibility** (D18). The project schema version MUST NOT change; the shipped catalog version MUST NOT change. A project without face anchors MUST load exactly as before. A project with a face anchor MUST serialize as schema version 1 with `params.anchor = {"kind":"faceLandmark","index":N}` and no other face-related field, and MUST round-trip exactly. Older builds are expected to **reject** such a project with their existing catalog-invalid error, not ignore it.

**Face processing lifecycle**

- **FR-016**: The face detector MUST be invoked on a frame if and only if all of: (a) a camera has been attached by the editor's explicit camera control; (b) `face_landmarks` is available; (c) on that frame at least one action is scheduled by the timeline scheduler whose anchor is a face landmark (D15) — a continuous action inside its window, or an instantaneous action on the frame it fires. It MUST be invoked at most once per frame. A face anchor present in configuration but belonging to no action scheduled on that frame MUST NOT cause face analysis.
- **FR-017**: Face analysis MUST stop on the first processed frame on which any of (a)–(c) is false, and MUST NOT resume until all are true again.
- **FR-018**: Face analysis MUST NOT run in Capture Mode, in the public default experience, before the camera-start gesture, or while the editor has no camera attached.
- **FR-018a**: No synthetic, stand-in, default or last-known-good face is ever supplied (D20). With no camera attached, a face anchor is unresolved and reported.
- **FR-019**: The editor MUST show a visible face-tracking indicator beside the camera control with exactly three states: **hidden**; **on** (text "Face tracking on") on any frame on which face analysis ran; and **finished** (text "Face tracking finished") during the post-analysis hold of FR-019a. The wording MUST NOT use any word the existing capture/recording affordance scan forbids, and the *on* state MUST NOT be shown on a frame where analysis did not run. Analysis that runs outside a live tick (Test Trigger, Play Timeline) is reported on the **next tick's** frame, so a one-frame analysis there is still disclosed. No animation or other UI change is introduced.
- **FR-019a**: *Indicator lifetime is separate from analysis lifetime (D24).* Face analysis stops per FR-017 and MUST NOT be kept running, or requested, to keep the indicator visible. The indicator MUST remain visible for a minimum hold of `FACE_INDICATOR_HOLD_MS` (500 ms; a single named constant, no other literal) after the last frame on which analysis ran, measured on the editor's frame clock. During the hold: (i) no face detection or face processing occurs; (ii) the indicator shows the *finished* state, which MUST NOT claim analysis is occurring; (iii) an analysis frame during the hold shows *on* again and restarts the hold from that frame using the same single deadline (no independent timer); (iv) when the hold has elapsed and no analysis is running the indicator is hidden. The indicator MUST NOT be shown merely because a face anchor exists in project configuration.
- **FR-020**: No additional opt-in step is required beyond the camera-start gesture (D9). This decision is represented by FR-019 and MUST be stated in the editor's user-facing help for the camera control.
- **FR-021**: Face detector lifecycle (D16). (i) Construction of the detector/model MAY occur independently of camera attachment but MUST NOT analyse any frame; (ii) face processing MUST stop when the camera is turned off, on that frame; (iii) the detector instance MUST remain available and MUST be reused across any number of camera off/on cycles and across closing and reopening projects; (iv) the terminal close/release MUST occur only at editor/page teardown; (v) a camera restart MUST NOT obtain a detector that has already been terminally closed. "Stop processing" and "release the detector" are distinct: camera-off does the former only.
- **FR-022**: A per-frame detector failure MUST NOT end the frame loop; the frame is treated as "no face" and the failure is logged once per consecutive streak.
- **FR-022a**: The face detector adapter MUST present strictly increasing timestamps to the underlying library regardless of the timestamps its callers supply (D19).

**Model provisioning (D2, D3)**

- **FR-023**: The face model MUST be a repository-level shared asset under `assets/`: referenced from there, never copied into `apps/web/`, never committed, absent by default, and served from the application's own origin at one URL in development and build alike.
- **FR-024**: The model MUST be obtainable only through a new explicit script pinned to the source in D2, separate from and not run by the existing model-fetch command. The script MUST verify the file's SHA-256 against the recorded value and MUST NOT leave a mismatching or partial file in place.
- **FR-025**: `assets/readme.md` MUST record the provenance of the face model: source URL, model name, precision, version path, SHA-256, licence, and the date it was fetched.
- **FR-026**: An absent model MUST NOT be a build, startup or test failure; it is the normal, expected state until a developer runs the explicit provisioning script, and yields `face_landmarks` unavailable (FR-001, User Story 3, D23). The editor MUST NOT attempt any run-time model download as a fallback (FR-027).
- **FR-027**: No model may be fetched at run time from any origin other than the application's own; no user-supplied model is accepted; no new dependency is added.

### Functional Requirements — Boundary-proving tests (D14)

These are requirements on the *test suite*, because the constitution's guarantees are only real if a regression fails a build. Each MUST be a negative or structural assertion, not only a happy path.

- **FR-028** *(recognition isolation)*: an architecture test MUST fail if any module in recognition, pose-event, hold/stability code, or the hand-frame type itself names a face type, and a structural test MUST show that `LandmarkFrame`, the matcher and the pose-event emitter have no face input.
- **FR-029** *(no action access)*: a test MUST fail if the object handed to an action contains face data. Actions receive only a resolved point.
- **FR-030** *(persistence isolation)*: a sentinel test MUST run distinctive face coordinates through the runtime, serialize a project containing a face anchor, and assert the sentinels are absent from the serialized output; an architecture test MUST fail if persistence, project-schema code, or the effect-catalog serializer names a face frame or detector type.
- **FR-031** *(Capture Mode)*: an architecture test MUST fail if any Capture Mode module or its entry point names a face type, imports the face adapter, or the face-model URL.
- **FR-032** *(public experience)*: a test MUST fail if the default experience's entry point imports the face adapter, and a test MUST assert the shipped default catalog contains no face anchor.
- **FR-033** *(transmission and readback)*: the existing storage, readback (including the `readPixels`/`convertToBlob` entries added 2026-09-21), upload and inbound-GET-only scans MUST pass over every new file with **no exemption added**.
- **FR-034** *(lifecycle)*: tests MUST prove the detector is never invoked before a camera is attached, while only hand-anchored effects play, after the last face-anchored action ends, after detach, or in Capture Mode; MUST prove it is invoked while a face-anchored action plays; and MUST prove the off/on/off cycle of FR-021.
- **FR-035** *(independence and inertness)*: tests MUST prove the independent probing of FR-002 in both failure directions and the inert-and-reported behaviour of FR-004–FR-006.
- **FR-036** *(orientation)*: a test using an **asymmetric** deterministic face fixture (a landmark left of centre stays left of centre, another right of centre stays right, and the vertical order is preserved) MUST prove the anchor resolves without a flip — the same discipline as `capture-orientation.test.ts`.
- **FR-037** *(no regression)*: the existing suite, including the person/background region and renderer tests, MUST pass unmodified in behaviour; no existing test MAY be weakened to accommodate this feature.

- **FR-037a** *(no new actions — mechanically checkable)*: the set of registered action types MUST remain exactly the six shipped before this feature (`background_wash`, `landmark_trail`, `particle_burst`, `person_visibility`, `play_audio`, `screen_flash`). This is verified by the existing registry-completeness and capability suites passing **unmodified**, plus one exact-list assertion on the registered action types added to the new boundary test file, which also makes any future placeholder face action fail the build.

### Existing constraints being preserved (not new behaviour)

- Constitution v1.10.0 Principle VI Milestone 4 and Principle II restated: no image readback, screenshot, recording, image serialization, upload or face-image persistence; face-derived data is transient and never persisted or transmitted.
- **Face tracking is not recognition**: face data MUST NOT reach the matcher, pose events or effect triggering; no recognition, identity, biometric, attribute or expression inference; no face-driven triggers.
- **Canvas2D remains the required renderer**; no WebGL/WebGPU/3D stack; no mesh deformation.
- The renderer-independent command vocabulary is unchanged: this slice adds no command.
- Person/background region behaviour is unchanged.
- The versioned pose-sample schema, Web Capture, docking/tabs, Inspector lock/collapse, and undo/redo are unchanged.
- `@mediapipe/tasks-vision` (locked at 0.10.35) is the only ML runtime; no dependency is added.
- `src/domain/` stays framework-free and free of Node built-ins; MediaPipe types stay in infrastructure.
- Actions never look up anchors themselves; hand tracking, matching, thresholds and hold semantics are untouched.

### Key Entities

- **FaceFrame**: one face's ordered landmark points (existing normalized `Landmark` values in mirrored surface space), the source timestamp, and the source surface size. Immutable and validated. Transient: never stored. Holds nothing derived (no blendshape, matrix, score, label, image).
- **FaceDetector**: the replaceable port that turns the camera surface into a `FaceFrame` or nothing, and can be closed.
- **`face_landmarks` capability**: one registry entry, available only when the face detector was actually constructed.
- **Face-landmark anchor**: authored data `{kind, index}` in an action's parameters, resolved centrally to a point. It is the only face-related thing that is ever saved, and it contains no face data.
- **Face-tracking indicator**: the editor's visible statement that face analysis is running.
- **Face model asset**: the provisioned shared model, with recorded provenance and an integrity hash.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An author can set a face-landmark anchor on an existing trail or burst action and, with a face in view, see the effect follow that point — using the same actions as for hands. The number of registered action types is unchanged (FR-037a), so the palette gains **zero** actions.
- **SC-002**: With no face-anchored effect playing, zero frames are analysed for a face over any length of session, and no face indicator is shown (verified by call-count tests).
- **SC-003**: While a face-anchored action is scheduled, the indicator is in its *on* state; within one processed frame of the last such action leaving its window or the camera being turned off, face analysis stops (FR-017); the indicator then shows *finished* for `FACE_INDICATOR_HOLD_MS` and disappears, with **zero** face-analysis calls during that hold (verified by call-count and frame-clock tests).
- **SC-004**: With the face model absent, the editor starts and behaves exactly as it does today for every existing feature, and every face-anchored action is reported inert; segmentation's availability is identical to before.
- **SC-005**: A saved project containing a face anchor contains no face-derived value: across the sentinel test's full serialized output, the number of face coordinates found is zero.
- **SC-006**: The number of modules in recognition, pose-event, Capture Mode and persistence code that reference a face type is zero, enforced by a failing build rather than by review.
- **SC-007**: The number of new exemptions to the storage, readback, upload or capture-label privacy scans is zero.
- **SC-008**: Turning the camera off and on ten times in a row leaves face-anchored effects working after each cycle.
- **SC-009**: Full test suite, typecheck, lint and production build pass, with no existing test modified to weaken an assertion.
- **SC-010** *(manual, real browser — a qualitative check, not an automated performance guarantee)*: with the model provisioned, a face-anchored trail visibly follows a real face and the editor remains visibly smooth in both a hands-only and a hands-and-face session on the verification machine. **No numeric frame-rate threshold is set**, because the repository has no existing threshold or measurement convention for the editor to anchor one to; the verifier MAY note the editor's existing frame-rate readout for the record. **This is the only claim that requires a browser and it MUST NOT be recorded as verified until someone has run it.**

---

## Definition of Done *(normative — Spec 011 is not complete merely because automated tests pass)*

Spec 011 is complete only when **all** of the following hold. None may be satisfied by a placeholder.

Two states are deliberately distinct. **"Automated gates pass" (DoD-1)** must hold in the ordinary development repository, where the model is intentionally absent, and the standard suite MUST NOT fail merely because the model or its pinned hash is missing. **"Spec 011 is complete" (DoD-2…DoD-8)** additionally requires the pinned model to have been manually provisioned, its integrity identifier verified and recorded, and the count/indexing verified; those items are **human-enforced completion criteria**, not automated gates, and no new gating script is introduced for them.

- **DoD-1**: The automated gates pass — typecheck, lint, the full test suite, and the production build — with the model absent, with no existing assertion weakened, and with every boundary-proving test (FR-028–FR-037a) present and green.
- **DoD-2**: The pinned model source is recorded (source URL, model name, precision, version path) in `assets/readme.md`, and the provisioning script pins exactly that source.
- **DoD-3**: The model's **SHA-256** has been independently verified and recorded, and pinned in the provisioning script. **No `EXPECTED_SHA256 = null` (or any other unverified placeholder) remains.**
- **DoD-4**: The licence has been confirmed against the model's official card and recorded with the date.
- **DoD-5**: The **actual landmark count and indexing** have been verified against the pinned model artifact, and `FACE_LANDMARK_COUNT` equals the verified value (correcting the provisional 478 if it differs). Only then does the verified count serve as the authoring, runtime and detector-guard boundary (D21).
- **DoD-6**: All of plan verification steps **V1–V7** (source/URL, integrity hash, licence, landmark count and indexing, orientation and surface size, timestamp behaviour, runtime privacy) are recorded as **performed**, with their results, in `assets/readme.md` and this spec's assumptions A-3/A-4.
- **DoD-7**: The manual real-browser check SC-010 **and** the browser-validation checklist BV-1…BV-12 (Amendment A, `checklists/browser-validation.md`) have actually been run and recorded — including BV-12 against the production build.
- **DoD-8**: The constitutional privacy and boundary requirements hold: no image readback/persistence/transmission, no scan exemption added, face data absent from every persisted or exported artifact, recognition/Capture/public paths free of face types, Canvas2D unchanged.

Implementation MUST NOT depend on the model being downloaded at run time (FR-027), and none of DoD-2…DoD-7 is met by any code path that fetches a model in the browser.

---

## Assumptions

- **A-1**: Single subject. Exactly one face is tracked (the first reported); multi-face selection or stability is out of scope.
- **A-2**: The editor's existing camera control is the "explicit camera-start gesture" the constitution refers to, exactly as for hand tracking.
- **A-3**: The Face Landmarker bundle's licence is compatible with project use (MediaPipe model cards state Apache-2.0). **Not verified in this specification**; the provisioning change MUST confirm it against the model card and record it (FR-025) before the file is used.
- **A-4**: The bundle returns **478** points per face (468 mesh + iris points). **Provisional and unverified** — nothing was downloaded or run. It is not a persistence/validation boundary (D21); the constant (FR-013) MUST be set to the observed value as part of the Definition of Done (DoD-5), and until then the detector's count guard (FR-011) makes a wrong assumption fail safe ("no face", reported) rather than misanchoring or unloading saved projects.
- **A-5** *(resolved — no longer an assumption)*: adding the new anchor kind does not bump the project schema version; this was checked against the loader's strict-equality version rule and absence of migration and is now normative in D18 and FR-015d.
- **A-6**: The installed `@mediapipe/tasks-vision` 0.10.35 exposes the `FaceLandmarker` API with `numFaces` and video running mode (verified from its type declarations on 2026-09-21); nothing about it has been run.
- **A-7**: Performance cost of running hand and face analysis together is unmeasured. The demand-gating of FR-016 exists so that the cost is paid only while needed.
- **A-8**: Eager construction of the face detector during the editor's capability probe (which is how segmentation already works) is *model loading, not detection*, and does not violate "detection must not begin before the camera-start gesture" because no camera surface exists to analyse. The plan MAY choose lazy construction instead, provided FR-001's "actually attempt to construct" holds.
- **A-9**: The editor's existing "capability unavailable" status and diagnostics are the right places to report face unavailability; no new reporting surface is created.

---

## Technical Constraints *(given, not derived — verified against the repository on 2026-09-21)*

These are facts about the current tree the plan must respect; they are recorded so `/speckit-plan` does not re-derive or contradict them.

- **Capability registry**: `src/domain/runtime/capabilities.ts` holds string-constant capabilities in `MapCapabilityRegistry`; `probeCapabilities(trySegmenter, logger)` takes **one** hard-coded constructor and returns `{capabilities, segmenter}`; `defaultCapabilities()` hard-codes one entry. Call sites: `src/main.ts`, `src/editor-main.ts`. Tests: `test/domain/capabilities.test.ts`, `capability-segmentation.test.ts`.
- **Runtime plumbing precedent**: segmentation reaches the runtime as an extra argument — `EffectRuntime.advance(events, frame, nowMs, segmentation)` — and the editor's `EditorRuntimeController` and the public `Session` each construct/close it. A face frame is to be threaded the same way: as its own argument, **not** as a member of `LandmarkFrame`, so the matcher-facing frame type cannot carry it.
- **Anchor resolution**: `src/domain/effects/anchor-resolver.ts` resolves `screen | handCentroid | landmark` against a `LandmarkFrame` and is called from `effect-runtime.ts`. Anchor kinds are validated in `src/domain/runtime/param-schema.ts` (hand-landmark index in `[0,20]`), parsed/serialized in `src/infrastructure/effects/catalog-loader.ts`, and authored in `src/presentation/editor/inspector-controls.ts`. Action status is evaluated by `src/domain/editor/action-status.ts`.
- **Capability requirement is currently per action type** (`ActionDescriptor.requiresCapability`); a face anchor is a **parameter value**, so the requirement here is per authored action instance. This is the one genuine structural extension in the slice.
- **Existing anchor-taking actions**: `landmark_trail`, `particle_burst` (both declare a param of kind `anchor`; `screen_flash`, `background_wash`, `play_audio`, `person_visibility` do not). No action reads `frame.hands`.
- **Domain layering test** `test/architecture/layering.test.ts` currently rejects `@mediapipe|HandLandmarker|FilesetResolver|WasmFileset` under the domain.
- **Shared assets**: `assets/hand_landmarker.task`, `assets/selfie_segmenter.tflite`; served by the `SHARED_MODELS` list in `apps/web/vite.config.ts`; `assets/readme.md` documents provenance style; `apps/web/tools/fetch-selfie-segmenter.mjs` is the provisioning precedent (it has no integrity check — FR-024 is deliberately stricter for the face model and does not retrofit the older script). `test/architecture/boundaries.test.ts` asserts exactly one shared copy of the segmentation model.
- **Renderer/regions**: Canvas2D only; `maskedErase`/`fillMaskedRegion`/`drawMaskedImage` take `region: 'person' | 'background'` with a single out-of-band person mask. **Untouched** by this spec.
- **Privacy scan** `test/architecture/privacy.test.ts`: storage, readback (now including `readPixels`, `convertToBlob`), upload and inbound-GET-only scans, plus two named label/download exemptions for project export and Capture. **No change** other than that the new files are scanned.
- **Capture Mode boundary**: `src/capture-main.ts` constructs its own hand detector and its controller injects no matcher/runtime; `test/architecture/capture-boundary.test.ts` gates the entry point on a build flag.
- **Camera lifecycle**: the editor's camera is toggled by the camera control in `src/editor-main.ts` (`attachCamera`/`detachCamera` on `EditorRuntimeController`); `detachCamera()` currently closes the hand detector *and the segmenter*, and `editor-main.ts` passes the same segmenter object again on the next attach (see the ambiguity report — FR-021 must not inherit this).

---

## Amendment A — Browser-validation slice (added 2026-09-21)

**Why an amendment to Spec 011, not a new spec.** The implementation is complete and unit-tested, but Spec 011 cannot be *complete* (Definition of Done: V1–V7, SC-010) until a person can run the feature in a real browser and understand what they see. This slice adds no architecture, no action, no anchor kind, no render command and no renderer change; it only makes the existing pipeline **observable**. A new spec would have to re-state the whole constitutional mapping for what is really the verification half of this one, and Spec 012 is reserved for regions. So this is an extension of 011, delivered as tasks T041–T048.

**What already exists (verified in the repository — nothing to build):**

- *A face-anchored action can already be authored with no new UI.* The Palette lists every registered action, so `landmark_trail` and `particle_burst` are addable; the Inspector's anchor control offers `faceLandmark` with a numeric index. **`landmark_trail` is the validation action**: it is continuous, so it visibly follows the landmark every frame, which a burst (a one-shot cloud) does not. No face-specific action is created (FR-015b stands).
- *A diagnostics mechanism already exists* — the editor's Diagnostics panel (frame rate, runtime diagnostics such as `face is not in frame`, unavailable capabilities) and the editor's debug toggle. Diagnostics are extended, not duplicated (D25).

**What is missing:** the panel shows only *failures*. It cannot say the detector is ready, that a face was found, how many landmarks the model actually returned, or that the requested index resolved this frame. Worse, if the real model returns a different landmark count than the provisional 478, the adapter's guard drops every frame and the author sees only "face is not in frame" — indistinguishable from "no face".

### Decisions

- **D25 — Extend the existing Diagnostics panel; no second surface.** A "Face tracking" group is added to the editor's existing Diagnostics panel, shown **only while the editor's existing debug toggle is on** (off by default) and only where a face prober was supplied (the editor). The repository has no build-time "development-only" pattern (`import.meta.env` is not used anywhere) and this spec introduces none: the editor is an author tool, the panel already exists, and gating on the existing debug toggle keeps it out of the normal editing experience. The public experience and Capture Mode have no such panel section.
- **D26 — Diagnostics are passive.** They report the *last observed* state of the pipeline. Rendering them MUST NOT call the detector, MUST NOT request a face source, and MUST NOT cause analysis; they read a status the adapter recorded during a genuine analysis (D15) and a per-frame summary the runtime already computed. There is deliberately **no** "manual inspection mode" that runs the detector on demand: to observe the pipeline, the author schedules a face-anchored action, exactly as in normal use. (A manual probe would need its own specification and its own disclosure decision.)
- **D27 — What diagnostics may carry.** Booleans, counts, indexes, ages and rates only. Never a coordinate, a point, a `FaceFrame`, or an image. Nothing is persisted or transmitted.
- **D28 — Landmark selection stays numeric.** No friendly names. The Inspector's range remains `FACE_LANDMARK_COUNT − 1`, provisional until T040/V4 verifies it; this amendment hard-codes nothing beyond that constant. Suggested indexes for the browser test (canonical face mesh: 1 nose tip, 33 and 263 eye outer corners, 152 chin) are **assumptions to be confirmed by V5**, recorded in the runbook, not in code.
- **D29 — Production parity is a build-order requirement, not a code change.** The same-origin model URL and the shared-asset plugin already emit a present model into `dist/`. The production build MUST be produced by a build that has the pinned, verified model provisioned, or the capability is (correctly) unavailable there. See FR-046.

### Functional requirements (Amendment A)

- **FR-038** *(status recorded by the adapter)*: The face detector MUST record, on each **genuine analysis**, a small status: the outcome of the latest analysis (**face found**, **no face**, **landmark count mismatch**, or **error**), the landmark count the model actually returned on that analysis, and when it happened on the frame clock; and MUST expose it read-only through an **optional** member of the detector port. It records nothing about coordinates. Its absence (a detector without it) MUST be tolerated.
- **FR-039** *(runtime summary)*: Each runtime frame MUST additionally report, for every face-anchored action scheduled on that frame, its effect id, action type, requested index, and whether it **resolved to a point** (a boolean) — and nothing derived from the face. It is empty on a frame with no scheduled face-anchored action.
- **FR-040** *(the Face tracking diagnostics group)*: While the editor's debug toggle is on, the existing Diagnostics panel MUST show a "Face tracking" group containing at least: **capability** (available / unavailable); **detector** (ready / not constructed); **last analysis** (none yet / face found / no face / count mismatch — with received and expected counts / error) and **its age**; **landmark count** last returned; **requested landmarks this frame** (index and resolved / not resolved, per scheduled action); **analyses in the last second**; and the existing frame rate. Every failure state MUST say which stage failed (capability, detector, face, count, index).
- **FR-041** *(diagnostics never cause analysis)*: Constructing, updating, showing or hiding the Face tracking group MUST NOT invoke the detector or any face source, and the number of detector calls MUST be identical with the group hidden and shown. While no face-anchored action is scheduled the group MUST show **0 analyses in the last second**.
- **FR-042** *(no geometry in diagnostics)*: Nothing the group displays or receives MAY contain a coordinate, point, `FaceFrame` or image (D27). Architecture tests MUST prove the diagnostics module and the status type have no such member.
- **FR-043** *(no new actions)*: The browser-validation flow MUST use only the six already-registered action types (FR-037a stands); `landmark_trail` is the documented validation action.
- **FR-044** *(scope of the group)*: The group MUST NOT appear in the public experience or Capture Mode, and MUST NOT appear in the editor unless the debug toggle is on.
- **FR-045** *(unchanged constraints)*: Face processing still occurs only per FR-016/017; the indicator (FR-019/019a) is unchanged; capability gating remains authoritative; nothing is persisted or transmitted.
- **FR-046** *(production parity)*: The documented production validation MUST build with the model provisioned (`npm run fetch-face-model`, pinned and hash-verified, before `npm run build`) and MUST verify that `dist/face_landmarker.task` exists in the artifact under test; running the same runbook against the deployed origin is the production check.

### Manual browser-validation acceptance criteria (Amendment A)

These are **human** checks, recorded in `checklists/browser-validation.md`, unticked until actually performed. They are not automated tests and are never claimed as verified by the automated suite.

- **BV-1** *Capability available*: with the model provisioned, the editor loads and the Face tracking group shows capability **available** and detector **ready**; with the model absent it shows **unavailable** and says the model could not be loaded (the expected default state).
- **BV-2** *Face detected*: with the camera on and a face-anchored action scheduled, last analysis reads **face found**.
- **BV-3** *Valid FaceFrame produced*: the landmark count returned equals `FACE_LANDMARK_COUNT`; if it does not, the group shows **count mismatch (received N, expected M)** — which is the trigger to correct the constant per V4, not a pass.
- **BV-4** *Selected landmark resolved*: the requested index shows **resolved** on frames where a face is found.
- **BV-5** *Action receives the anchor*: the anchored `landmark_trail` draws (its runtime diagnostic list contains no `anchor_unresolved` for it).
- **BV-6** *Visible effect at the expected landmark*: the trail sits on the real feature the index names (V5 records which feature; a horizontal or vertical inversion is a failure).
- **BV-7** *Follows movement*: moving the head moves the trail's head with it, on the mirrored view, without lag that reads as tracking a stale position.
- **BV-8** *Lazy analysis*: with only hand-anchored or no effects scheduled, "analyses in the last second" reads 0 and the indicator is hidden; opening or closing the diagnostics group does not change that.
- **BV-9** *Indicator*: on while analysing, "finished" for about half a second after, then hidden.
- **BV-10** *Public experience and Capture Mode unaffected*: neither shows the group, requests `face_landmarker.task` (DevTools Network), nor shows the indicator.
- **BV-11** *Failures are understandable*: deliberately (a) remove the model, (b) turn the camera off, (c) step out of frame, (d) enter an index beyond the range — each is shown at the correct stage in the group.
- **BV-12** *Production*: BV-1…BV-9 pass against the production build (`dist/` served by `vite preview`, then the deployed origin), with `dist/face_landmarker.task` present.

### What must be true before browser testing can start (T040, kept open)

T040 is **not** marked complete by this amendment. Before BV-1 can pass, a person must, in order:

1. Run `npm run fetch-face-model`. While `EXPECTED_SHA256` is `null` it installs nothing and prints the URL, HTTP status, size and computed SHA-256 (**V1**).
2. Independently confirm that hash (a separate manual download of the same URL and `sha256sum`) (**V2**), then pin it in `tools/fetch-face-landmarker.mjs` as a reviewed change, and re-run — it now installs `assets/face_landmarker.task`.
3. Read the official model card for this exact model/version, record the licence and date in `assets/readme.md` (**V3**). If it does not permit project use, stop.
4. Start the editor with the diagnostics group on; the group's **landmark count** line is the practical instrument for **V4** (observed count). If it differs from 478, correct `FACE_LANDMARK_COUNT`, record it, and update the readme.

Still unverified today, and only these browser runs can settle: the model's licence, its SHA-256, the real landmark count and indexing, output orientation (V5), timestamp behaviour (V6), and runtime privacy (V7).

### Out of scope for Amendment A

Regions, blendshapes, transform matrices, expression or attribute inference, face meshes, a face-landmark overlay drawing all points (it would carry geometry into presentation), anatomical names, a manual/probe analysis mode (D26), any change to `landmark_trail`/`particle_burst`, any change to Capture Mode or the public experience, a dev-only build flag pattern, and any change to `future-work.md`.

---

## Amendment B — FaceMark debug surface and pipeline telemetry (added 2026-09-21)

**Why.** Amendment A made the pipeline observable with booleans and counts only. Developing face *effects* needs to answer "is landmark 33 where I expect it on my face, and does it follow me?", which a text panel cannot. The performance question ("three models on one camera") also needs numbers that separate **render cadence** from **inference cadence**. Both are development tooling for the editor; neither changes what the product does.

**Supersedes, narrowly:** Amendment A **D27/FR-042** ("no coordinate, point or `FaceFrame` in diagnostics") and its out-of-scope line "a face-landmark overlay drawing all points". The reasons they existed (nothing persisted, transmitted, read back, and no geometry leaking into recognition or Capture Mode) all still hold and are restated below; what is relaxed is only that the **editor-only, debug-toggled** surface may show *transient* geometry: the resolved anchor point(s) and the mesh of the face the pipeline already analysed.

### Decisions

- **D30 — A second debug toggle, "FaceMark Debug" (View menu), beside "Debug Overlay".** The Diagnostics panel's pipeline/FaceMark section is shown while **either** toggle is on (this supersedes FR-044's "the debug toggle" by adding the second). Off by default.
- **D31 — Passive, still.** (D26 stands.) The overlay draws only (a) the face the pipeline analysed within the last 500 ms and (b) the anchor points `AnchorResolver` resolved within the last 500 ms; older data is dropped, never drawn frozen. There is no on-demand inference. Opening the section or overlay changes the detector call count by exactly zero.
- **D32 — What may carry geometry, and no further.** `RuntimeFrame.faceAnchors[]` carries, per face-anchored action, `{ effectId, actionType, landmarkIndex, resolved, point }` where `point` is the one anchor point in surface pixels (already the resolver's output). `EditorRuntimeController.lastFaceAnalysis` holds the last `FaceFrame` in memory for the overlay. Neither is stored, serialised, transmitted, read back from a canvas, or passed to recognition; both are cleared when the camera detaches. `EditorFrameSnapshot.face` and the section's text carry statuses and counts only.
- **D33 — Telemetry is measurement, not control.** `PipelineTelemetry` records durations around calls the pipeline already makes (hand, segmentation, face) and the tick timestamps. It never schedules, throttles or triggers.

### Functional requirements (Amendment B)

- **FR-047**: The editor MUST expose, per model (hand, segmentation, face) — runs, last/mean/max duration over a 2 s window, inference Hz over that window, ticks on which it did not run, age of last run — **and** the editor tick rate as a separate figure, so a 15 Hz model is never conflated with a 15 FPS render.
- **FR-048**: FaceMark status MUST show: `face_landmarks` capability, detector present/absent, last analysis (none yet / face found + count + age / no face / **count mismatch with received and expected** / error), and per scheduled face-anchored action: landmark index and resolved point in pixels or "unresolved". (Implements Amendment A FR-038–FR-040 for the adapter status; the panel layout is Amendment B's.)
- **FR-049**: With FaceMark Debug on, the stage MUST draw the mesh points of a fresh face and a crosshair + ring at each resolved anchor, on the same Canvas2D overlay slot the hand overlay uses (existing `drawCircles`/`drawPolyline` commands only).
- **FR-050**: None of it may appear in the public experience or Capture Mode; no face processing occurs there; no new persistence; Domain stays framework-free; `AnchorResolver` remains the only resolver; `FaceDetector` lifecycle and lazy analysis are unchanged. Proven by `test/architecture/facemark-debug-boundary.test.ts` and `test/adapters/facemark-diagnostics.test.ts` (including: detector call count 0 while nothing face-anchored is scheduled, however often observed).

### Performance investigation (findings in `research.md` R15) — no optimisation is part of this amendment

The investigation's deliverable is a measured baseline and a recommended strategy, not code. **Cadence/worker/resolution changes are deliberately NOT implemented**: they must be justified by numbers recorded from a real browser using this telemetry (task T057), and each needs its own decision.

---

## Out of Scope / Non-Goals

Not built by this spec, and each — where the constitution requires it — needs its own specification or amendment:

- **Face regions, region geometry, region masks, a `faceRegion` anchor, named facial regions** (D6). Deferred to Spec 012, together with the generalized geometry/masking representation the constitution left to the specification that needs it.
- **Face effects**: region tinting, eye-colour effects, decals/overlays needing region or transform support, localized masks. Deferred.
- **Blendshapes and the facial transformation matrix**: not requested, not represented (D13). Deferred; a later spec that wants blendshape-modulated overlays adds them then.
- **New actions, new render commands, renderer changes.** None.
- **Named landmark points** (e.g. "nose tip") and any authoring convenience beyond a numeric index — the hand `landmark` anchor is authored by number today and this follows suit.
- **Multiple faces / face selection / face stability tracking.**
- **Face tracking in the public default experience** and any shipped face effect.
- **Mesh deformation, warping, animal-like transformation, WebGL/WebGPU/3D stacks** — not authorized; require their own amendment with demonstrated Canvas2D incapability.
- **Face recognition, identity matching, biometrics, attribute or expression inference, face-driven triggers, feeding face data to the matcher** — outside the authorization.
- **Face data in any persisted or exported form, any second (face) capture schema, any face capability in Capture Mode.**
- **A second ML runtime, runtime model downloading, user-supplied models.**
- **Retrofitting integrity verification to the existing segmentation fetch script**, and fixing the existing segmenter-after-detach behaviour (see ambiguity report) — related, separate.
- **Updating `future-work.md` Section A.9** ("authorization blocked" is stale) — a documentation follow-up, not part of this implementation scope.

## Unresolved items that need a future spec or amendment

- **Face effects and region representation** (Spec 012+): what a "region" is once it carries geometry; how it composes with the existing person/background mask; the mask-source abstraction.
- **Whether face tracking enters the public experience**, and if so whether D9's "no separate opt-in, visible indicator" still suffices there.
- **Blendshape channel design** for modulating a running effect.
- **Mesh renderer**: needs an amendment; not decided.
- **Model-dependent facts** — hash, licence, landmark count and indexing, orientation, timestamp behaviour: cannot be resolved without downloading and running the pinned model; they are gated by the Definition of Done, not decided here.

## Dependencies

- Constitution v1.10.0 (in place).
- `@mediapipe/tasks-vision` 0.10.35 (installed; no change).
- Existing: capability registry/probe, `EffectRuntime`, `AnchorResolver`, param-schema, catalog loader/serializer, project persistence, Inspector anchor control, action status, `EditorRuntimeController`, layering/privacy/capture-boundary/boundaries architecture tests.
- A human, browser-based verification pass (SC-010) with the model provisioned — cannot be automated and is not part of the automated gates.
- Explicitly **not** touched: Web Capture (spec 009), docking/tabs/undo-redo (spec 010), `apps/capture/mudra-web-capture-2026-09-21.zip`, `specs/010-editor-workspace-refinements/quickstart.md`.
