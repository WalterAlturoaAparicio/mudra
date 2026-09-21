# Research: Face Landmark Anchors

**Feature**: `011-face-landmark-anchors` | **Date**: 2026-09-21 | **Plan**: [plan.md](./plan.md)

Every decision below was made after reading the current code (paths given). Each states its evidence, what is *verified in the repository*, and what is *not* verified. Nothing was downloaded or run in a browser.

---

## R1 — Segmenter / camera lifecycle: what actually happens, and how face avoids it

**Evidence** (`src/application/editor-runtime-controller.ts`, `src/editor-main.ts`, `src/infrastructure/segmentation/mediapipe-person-segmenter.ts`):

- `probeCapabilities(...)` runs **once per page load** in `editor-main.ts` (line ~152) and yields one page-scoped `segmenter` object.
- `mountEditor(project)` (line 177) builds a **new** `EditorRuntimeController` each time a project is opened (line 233), but reuses the page-scoped `segmenter`.
- The camera control (`onToggleCamera`, line ~355) creates a **new** `GetUserMediaCamera` session and a **new** hand detector on every "on", then calls `attachCamera(cameraSession, detector, segmenter)` with the *same* page-scoped `segmenter`.
- `detachCamera()` (controller, line ~248) closes the session, the hand detector **and `this.camera.segmenter?.close()`**. `MediaPipePersonSegmenter.close()` sets its inner `segmenter` to `null`, and `segment()` returns `null` when that is `null`.
- `stop()` calls `detachCamera()`; `stop()` runs on Close Project (`editor-main.ts` line 392) and on `pagehide` (line 617).

**Consequence (verified by reading, not by running)**: after the first camera-off, or after Close Project with a camera attached, the reused page-scoped segmenter is permanently a no-op, so segmentation silently stops for the rest of the page. The defect is broader than "off/on" — it also covers Close Project → reopen — but it is **outside Spec 011**. It is recorded as a separate follow-up and is **not fixed here**.

**Decision**: the face detector is **page-scoped and controller-*borrowed***, never owned by the camera attachment.

- It is passed to `EditorRuntimeController` as a constructor option (like `runtime`, `matcher`), **not** through `attachCamera(...)`; `AttachedCamera`, `attachCamera`, and `detachCamera` are **unchanged**, so segmentation semantics are byte-for-byte what they are today.
- `detachCamera()` and `stop()` **never** close the face detector; they only make it unreachable (the face source is `null` whenever `this.camera === null`).
- `editor-main.ts` closes the face detector exactly once, on `pagehide`, after `runtimeController.stop()` — the only real end of its life.
- Nothing is "recreated"; a single instance survives any number of camera off/on cycles and any number of Close Project → reopen cycles (each new controller is handed the same detector).

**Why this satisfies the constitution**: processing stops *immediately* when the camera detaches because the face source is derived from `this.camera` on every frame (R7) — stopping does not depend on closing anything.

**Alternatives rejected**: (a) recreate the face detector per attach like the hand detector — needs the probe factory retained and a second model load per toggle, and re-probing would make availability non-deterministic mid-session; (b) close on detach and reopen — the detector's `close()` is terminal (as the segmenter shows) and a reopen protocol would be new lifecycle machinery; (c) fix the segmenter — unrelated scope, and the plan's isolation makes it unnecessary.

**Verification still required**: read `test/adapters/mediapipe-person-segmenter.test.ts` and `test/adapters/editor-*` for tests that pin the current detach behaviour, so the plan's "unchanged" claim is checked by them still passing (a required gate, not a new test).

---

## R2 — `probeCapabilities` generalization

**Evidence** (`src/domain/runtime/capabilities.ts`, `src/main.ts:96`, `src/editor-main.ts:152`, `test/domain/capabilities.test.ts`, `capability-segmentation.test.ts`, `test/support/effects.ts`):

- Registration: string constant `PERSON_SEGMENTATION`; `MapCapabilityRegistry(Map<string, boolean>)`; `defaultCapabilities()` returns a single hard-coded entry, and `capabilities.test.ts` asserts `all()` equals **exactly** `[{ person_segmentation, false }]`.
- Probe: `probeCapabilities(trySegmenter, logger = new Logger())` → one `try` around the segmenter constructor, `warn` on failure, returns `{ capabilities, segmenter }`. What is constructed: an `ImageSegmenter` created from the model (a real model load + WASM init), and *nothing else* — no camera, no frame.
- Callers: `main.ts` (public experience) and `editor-main.ts`, both destructure `{ capabilities, segmenter }`.

**Decision — the smallest extension**:

```ts
probeCapabilities(
  trySegmenter,
  logger = new Logger(),
  tryFace?: () => Promise<FaceDetector>,   // NEW, optional, third
): Promise<{ capabilities; segmenter; faceDetector: FaceDetector | null }>
```

- Each constructor runs in **its own** `try/catch` (two independent probes; sequential or `Promise.allSettled` — implementer's choice, results identical). A failure logs its own `warn` naming its own capability and affects only its own entry.
- When `tryFace` is **omitted** (public experience, all existing tests and call sites), the registry contains **no `face_landmarks` entry at all** and `faceDetector` is `null` — so `all()` for every existing caller is byte-identical to today. `has('face_landmarks')` is `false` either way (`Map.get` → `undefined`).
- When `tryFace` is supplied (editor only), the entry is present: `true` if construction resolved, `false` if it rejected.
- `defaultCapabilities()` is **not touched** (its test asserts a single entry).
- New constant `FACE_LANDMARKS = 'face_landmarks'` exported from the same file.

**Why not a generic table/registry-of-probes**: two capabilities, one probe with a third optional argument is the least change; a generic framework has no second consumer.

**Failure isolation, proven by** `test/domain/capability-face-probe.test.ts`: (segmenter rejects, face resolves) → segmentation false / face true / `faceDetector` non-null / `segmenter` null; (face rejects, segmenter resolves) → segmentation true and **exactly as in the pre-existing test** / face false / `faceDetector` null; both reject; both resolve; and "omitted `tryFace`" → `all()` equals the pre-change result.

**Constitution wording**: "each capability MUST be probed independently" — satisfied; "attempting to construct" — satisfied (R6).

---

## R3 — Per-instance capability requirement (the one structural extension)

**Evidence**: `ActionDescriptor.requiresCapability?: string` is read in `EffectRuntime.render()` before `resolveParams`; on miss it pushes `{ reason: 'capability_unavailable', detail: capability }` and `continue`s. `action-status.ts` mirrors that using the descriptor. A face anchor is a **parameter value** (`params.anchor = { kind: 'faceLandmark', index }`), so the descriptor cannot know.

**Decision**: one pure, domain-level function keyed on the *anchor kind*, not on the action type:

```ts
// src/domain/effects/anchor-capability.ts (new)
requiredCapabilityOf(anchor: Anchor): string | undefined   // 'face_landmarks' for faceLandmark, else undefined
```

Used at exactly two places, both of which already exist and already read the anchor:

1. `EffectRuntime.render()` — after `resolveParams` (which yields the resolved `anchor` param) and **before** `resolveAnchor`: if `requiredCapabilityOf(anchor)` is defined and the registry lacks it → push the *same* `capability_unavailable` diagnostic (detail = the capability), `continue`. Runs after the descriptor-level check, so an action with both is handled once.
2. `action-status.ts` — after params resolve: same check → status `capability_unavailable` (the existing badge and inspector text).

**Runtime flow** (action configuration → … → execution):

```
TimelineEntry.action.params.anchor
  → resolveParams()                                   (existing)
  → requiredCapabilityOf(anchor)                      (new, pure; undefined for screen/hand anchors)
       ├─ defined & registry.has? no  → diagnostic 'capability_unavailable', skip   (FR-004/005)
       └─ undefined, or available     → continue
  → resolveAnchor(): AnchorResolver.resolve(key, anchor, frame, faceOrNull)        (sole resolver)
       └─ face anchor: obtain face lazily (R7) → point, or hold/skip/report as for hands
  → ActionContext.anchor = Point | null                (actions see only a point)
  → descriptor.update(context)
```

**Non-face actions**: `requiredCapabilityOf` returns `undefined` for `screen`, `handCentroid` and `landmark`, and for actions with no `anchor` param the code path is not entered. So every existing action instance behaves identically, and `person_visibility`'s descriptor-level gating is untouched.

**Rejected**: (a) a face-specific `landmark_trail_face` action (forbidden); (b) `requiresCapability` becoming a function of params (changes a public descriptor shape used by the palette and status); (c) a capability-dependency graph (no second use); (d) putting the check inside `AnchorResolver` (it would then own capability policy and report reasons the diagnostics contract already defines elsewhere).

---

## R4 — Project schema compatibility

**Evidence** (`src/domain/editor/types.ts:70`, `src/infrastructure/persistence/project-schema.ts`, `src/infrastructure/effects/catalog-loader.ts`):

- `PROJECT_SCHEMA_VERSION = 1`. `parseProject` requires `project_schema_version === PROJECT_SCHEMA_VERSION` (strict equality; message "saved by an incompatible version of the editor"). There is **no migration mechanism**; any version other than the build's own is rejected wholesale.
- The catalog inside a project is parsed by `parseCatalog`, which validates each action's params against the registered descriptor's schema and parses anchors with `parseAnchor` (`kind` must be `screen`, `handCentroid` or `landmark`, otherwise `CatalogError` "kind must be screen, handCentroid, or landmark", wrapped by `parseProject` as "project.catalog is invalid — …").
- The anchor wire shape equals the domain shape (no snake_case translation).

**Decision — NO schema version bump** (former spec assumption A-5, **now promoted to spec D18/FR-015d**, confirmed and firmed up by this evidence):

- A bump would make the new build reject **every existing v1 project** (strict equality, no migration) — a strictly worse outcome than the alternative.
- Old projects (no face anchors) parse unchanged in the new build: the change only *adds* an accepted `kind`.
- A project containing a face anchor is saved as `project_schema_version: 1` with `params.anchor = { "kind": "faceLandmark", "index": N }`.
- **Older application versions will reject such a project** (not ignore it): `parseAnchor`'s default branch throws, so the whole project fails to open with the catalog-invalid message. Rejection is the safe behaviour — an old build must never run an effect it cannot understand. This is an accepted, documented forward-compatibility limit, identical in kind to how any new action type has always behaved in an older build ("unknown action type is a load error").
- The shipped effect catalog's own `version: 1` follows the same rule and is not bumped.

**Proved by**: `test/domain/project-face-anchor.test.ts` — round-trip at `schemaVersion === 1`; existing v1 fixture projects still parse (regression); `PROJECT_SCHEMA_VERSION` is asserted `=== 1`; a doc with an unknown anchor kind is rejected with a message naming valid kinds (the property that makes old-build rejection real, exercised by using a genuinely unknown kind such as `faceRegion`).

**No contradiction with the spec.** Former A-5 / plan SC-4 is now normative: spec **D18 / FR-015d**.

---

## R5 — Model verification: verified vs. must-verify vs. guarded

| Item | Repository-verified? | Where verified |
|---|---|---|
| `@mediapipe/tasks-vision` installed at 0.10.35 | **Yes** (lockfile) | now |
| `FaceLandmarker`, `createFromOptions`, `detectForVideo`, options `numFaces` / `minFaceDetectionConfidence` / `minFacePresenceConfidence` / `minTrackingConfidence` / `outputFaceBlendshapes` / `outputFacialTransformationMatrixes`; result `faceLandmarks: NormalizedLandmark[][]` | **Yes** (`vision.d.ts`) | now |
| Source URL exists and serves the file | **No** | V1 at provisioning |
| SHA-256 of the artifact | **No** (nothing downloaded) | V2 |
| Licence | **No** (spec says Apache-2.0 per model card — assertion, unread) | V3 |
| Landmark count (478? 468?) and indexing | **No** | V4 |
| Output orientation/coordinate convention (mirrored-surface pass-through) | **No** for the model; **Yes** for how the surface is mirrored for hands | V5 |
| Timestamp semantics (strictly increasing per instance) | **No** (MediaPipe behaviour recalled, unverified) | V6 |
| Surface-size interpretation (normalized to input canvas w×h) | **No** for faces; hand adapter uses `surface.width/height` | V5 |

**Landmark-count ordering (spec D21)**: `FACE_LANDMARK_COUNT = 478` is provisional; project/catalog **load** validates only a non-negative integer index, the model range is enforced at authoring and at runtime resolution, and the verified count (V4/DoD-5) becomes the boundary afterwards — so saved projects can never become unloadable because of an unverified model fact.

**Deterministic runtime guards** (safe failure — *not* a substitute for V1–V6): (a) point count ≠ `FACE_LANDMARK_COUNT` ⇒ treat as no face + one warn (FR-011); (b) per-frame throw ⇒ no face + warn once per streak (FR-022); (c) timestamps clamped strictly increasing (R11); (d) the SHA-256 check in the provisioning script (FR-024); (e) `numFaces: 1` and both blendshape/matrix outputs off.

**Verification protocol (executed by a human at provisioning; results recorded in `assets/readme.md` and the spec's A-3/A-4)**: see plan §"Model verification protocol (V1–V7)". The implementation is **not complete** until V1–V7 are recorded; the automated gates pass without them because the model is absent by default.

---

## R6 — Eager vs lazy detector construction → **eager (retained)**

**What "probe" is today**: `createMediaPipePersonSegmenter` performs `FilesetResolver.forVisionTasks` + `ImageSegmenter.createFromOptions` (model fetch + WASM init) at page load. It touches no camera and analyses no frame.

**Decision**: keep eager, following segmentation.

- *Deterministic availability*: the inspector/timeline badges (FR-006) and runtime gating need `has('face_landmarks')` to be correct **at load**, before any effect plays. Lazy construction would make availability unknown until first use and would let an action start race a still-loading detector — the very "race" the constitution wants absent.
- *Not processing*: construction never calls `detectForVideo`. A test proves `detect` has zero calls after a probe.
- *No face data from probing*: the detector has no camera surface until a frame is requested through the face source (R7); there is no surface to analyse at probe time.
- *Cost*: when the model is absent (the default), the constructor's model fetch 404s and rejects quickly; the cost is paid only when the author provisioned the model.
- *Camera-start*: satisfied because detection requires `this.camera !== null` (set only by the camera control).

**Rejected**: lazy construction on first face-anchored action (availability non-deterministic; start race; needs a "loading" state in diagnostics and status that has no existing home).

---

## R7 — Face processing lifecycle: *where detection is invoked*

**Design — a lazy, memoized face source passed into `EffectRuntime.advance`.**

`advance(events, frame, nowMs, segmentation = null, faces: FaceFrameSource | null = null)` where
`type FaceFrameSource = () => FaceFrame | null` (domain, framework-free).

Inside `render()` (one call per `advance`):

```
let faceCalled = false, faceFrame: FaceFrame | null = null
faceNow = () => { if (!faceCalled) { faceCalled = true; faceFrame = faces?.() ?? null }; return faceFrame }
...
for each scheduled item:
    (capability checks — R3, may `continue` BEFORE faceNow is ever reached)
    anchor = anchorParam(params,'anchor')
    if anchor is a faceLandmark:  face = faceNow()          // <— the ONLY invocation site
    resolve(anchor, frame, face)
return { ..., faceTracking: faceCalled && faces !== null }
```

So the detector is invoked **iff, this frame**, a *scheduled* action (per `scheduleEntries`, i.e. genuinely playing or firing this frame) has a face anchor **and** `face_landmarks` is available **and** the controller supplied a source (camera attached). At most once per `advance`.

**Controller side** (`EditorRuntimeController`): a private `faceSourceFor(nowMs)` returns `null` if `this.camera === null || this.faceDetector === null`, else `() => this.faceDetector.detect(this.camera.session.surface, nowMs)`. It is the **same builder used at all three `advance` call sites** — `tick`, `testTrigger`, `advanceAndPresent` — so Test Trigger and Play Timeline behave identically to a live tick.

**Lifecycle table**:

| Event | What happens | Detector invoked? |
|---|---|---|
| Page load / probe | detector constructed (R6) | **No** |
| No camera attached (any time) | `faceSourceFor` → `null`; face anchor unresolved (reported "face not in frame"); no synthetic face | **No** |
| Camera start | `attachCamera` — unchanged; source becomes non-null | No (nothing scheduled needs it yet) |
| Only hand-anchored actions play | no face anchor reached | **No** |
| Face-anchored action starts (trigger, Test Trigger, Play Timeline) | reached in the same `advance` that starts it; instantaneous-at-0 entries fire *with* a face available | **Yes**, once per frame |
| Face anchor edited to a non-face anchor mid-playback | next `advance` reads new params; no face anchor reached | **No** from that frame |
| Non-face → face anchor mid-playback | next `advance` reaches a face anchor | **Yes** from that frame |
| Last face-anchored entry leaves its window / playback ends | nothing scheduled with a face anchor | **No** from the next frame (`faceTracking` false) |
| `face_landmarks` unavailable | descriptor/instance capability check `continue`s before `faceNow` | **No**, ever |
| Camera stop (`detachCamera`) | `this.camera = null` → source null next frame | **No** (immediately) |
| Repeated off/on | detector untouched (R1); source recomputed from `this.camera` each frame | Only per rows above |
| Project close / `stop()` | `stop()` → `detachCamera()` + `runtime.reset()`; detector not closed (reused by next controller) | **No** |
| Editor teardown (`pagehide`) | `editor-main` closes the detector after `stop()` | **No** |
| Capture Mode / public experience | neither constructs a face detector nor passes a source | **Never** (architecture tests) |

`RuntimeFrame.faceTracking` is the indicator's source of truth (R14), so "analysis running" and "indicator visible" cannot diverge.

**Rejected**: (a) detect every tick when `camera && capability` (violates FR-016(c)); (b) pre-scan playbacks before `advance` (one-frame lag ⇒ an instantaneous-at-0 action such as `particle_burst` would fire once with no face and never again — verified from `scheduleEntries`, where `fired` is true for exactly one frame); (c) put the detector call inside `AnchorResolver` (makes a pure resolver do I/O).

**"Currently playing" made precise**: an action is *currently playing* on a frame iff `scheduleEntries` returns it for that frame. This was a **refinement** of the original FR-016(c) (former plan SC-1 — **now promoted: spec D15/FR-016**) — the spec's prose ("currently playing effect action") is compatible but underspecified for instantaneous actions.

---

## R8 — Privacy / data-flow trace

`FaceLandmarker.detectForVideo(canvas)` → `FaceLandmarkerResult` (MediaPipe types) → **adapter** `mediapipe-face-detector.ts` (the only file naming MediaPipe face symbols) → `FaceFrame` (domain value: numbers only) → returned from the `FaceFrameSource` closure → held in a local variable inside `EffectRuntime.render()` → passed to `AnchorResolver.resolve(...)` → a `Point` → `ActionContext.anchor` → action → `RenderCommand[]` → `Stage.present`.

Where it **terminates**: the `FaceFrame` never leaves `render()`'s stack frame: it is not stored on the runtime, on a `Playback`, in `ActionContext`, in `RuntimeFrame`, in `EditorFrameSnapshot`, or in any listener payload. (`RuntimeFrame` gains only a boolean.) It is not a field of `LandmarkFrame`, so `classify`, the matcher, `PoseEventEmitter`, `HoldState` and the debug overlay's `LandmarkFrame` input cannot see it.

The only *saved* face-related datum is the anchor `{kind: 'faceLandmark', index}` — an integer authored by the user, not derived from any face.

No exemption is added to any privacy scan; the new adapter file is scanned by the existing global storage/readback/upload scans. `getAsFloat32Array`-style output reads (segmenter) are model output; the face adapter reads only `faceLandmarks` numbers.

---

## R9 — Orientation and coordinate correctness

**Existing conventions (verified)**: `CanvasMirroredSurface` mirrors the camera once, on pixels (`setTransform(-1,0,0,1,w,0)`); the hand detector reads that same canvas, so hand landmarks are normalized `[0,1]` in **mirrored surface space**, `y` down; `AnchorResolver` maps `x*frame.width, y*frame.height` with **no flip** (proved for capture by `capture-orientation.test.ts`, and for hands by `mirroring.test.ts`).

**Face**: the face detector is handed the **same** `surface.image` (the mirrored canvas), so its output is in the same mirrored, normalized, y-down space. The adapter and the resolver MUST NOT flip. This is stated as an expectation about MediaPipe's image-space output, **not verified for the face model** (V5).

**Mapping** used by the resolver: `point = { x: face.points[i].x * face.width, y: face.points[i].y * face.height }` where `face.width/height` are the surface size the detector was given.

**Asymmetric fixture** (`test/domain/face-anchors.test.ts`): a synthetic `FaceFrame` (size 1280×720) with, e.g., index 1 at `(0.25, 0.60)` and index 2 at `(0.80, 0.30)` and all others distinct. Expected: anchor 1 → `(320, 432)`, anchor 2 → `(1024, 216)`. Assertions: `x(1) < x(2)` (a horizontal flip would reverse it), `y(1) > y(2)` (a vertical flip would reverse it), exact equality with the stated pixels, and unchanged when the `LandmarkFrame` argument is empty vs. populated. This fixes the **code's** pass-through behaviour independent of any model.

**Model-semantics expectation (assumption, verified at V5, never asserted in an automated test)**: with a frontal face on the mirrored surface, canonical landmark 33 (the subject's right-eye outer corner in MediaPipe's canonical mesh) has larger `x` than landmark 263 (the subject's left-eye outer corner). If V5 shows otherwise, that is a spec/adapter issue — **not** something to "fix" by flipping in the resolver.

No new coordinate abstraction is introduced.

---

## R10 — Model provisioning

New files only; the existing `tools/fetch-selfie-segmenter.mjs` and the `fetch-models` npm script are **unchanged**.

- `apps/web/tools/fetch-face-landmarker.mjs` — pinned constants: `SOURCE_URL`, `EXPECTED_SHA256`, target `assets/face_landmarker.task`. Behaviour: if target exists, verify its hash (mismatch ⇒ delete + fail non-zero, so a stale/corrupt file cannot linger); else stream to `<target>.part`, compute SHA-256 while streaming, on mismatch delete `.part` and exit non-zero; on match rename atomically. Never run implicitly. `npm run fetch-face-model` in `package.json`.
- `EXPECTED_SHA256` is **`null` until V2** — in that state the script **refuses to install anything** and prints the computed hash for a human to review and pin (so the first fetch produces evidence, not an unchecked file). This makes the pin a reviewed change and avoids a placeholder hash.
- `vite.config.ts`: one `SHARED_MODELS` entry (`face_landmarker.task` at `/face_landmarker.task`), `FACE_MODEL_URL` constant beside the existing ones. A missing file already 404s in dev and is skipped with a warning in build (existing behaviour).
- `.gitignore`: `assets/*.task` already covers it — **verified**.
- `assets/readme.md`: a table row and a "Face Landmarker provenance" block with fields filled by V1–V3 (source, model name, precision, version path, SHA-256, licence, date). Until then the block says "not yet provisioned".

**Shipping note (decision, not a contradiction)**: `sharedModelPlugin.generateBundle` emits every *present* shared model into `dist/` for all builds. A provisioned face model would therefore be emitted into the public build's `dist/` even though no public code requests it (FR-008 holds — nothing loads it). Accepted, recorded in the readme, and noted as a future refinement if payload matters; narrowing the plugin per entry point is out of scope.

**Rejected**: hash verification retrofitted to the segmenter script; a `--from <local file>` option (an arbitrary-source path); a Node fetch-with-redirect to any host other than the pinned URL.

---

## R11 — Timestamp monotonicity (found during planning; not in the spec)

`detectForVideo` requires strictly increasing timestamps per landmarker instance (recalled MediaPipe behaviour; **unverified**, V6). The face detector is called from up to three `advance` sites: `tick` (timestamp from `requestAnimationFrame`, a frame-start `DOMHighResTimeStamp`), and `testTrigger`/`advanceAndPresent` (timestamp from `this.now()` = `performance.now()`, *later than* the frame's rAF time). A Test Trigger followed by the next tick can therefore present a **smaller** timestamp than the previous call.

The hand detector never sees this (it is only called from `tick`).

**Decision**: the face adapter keeps `lastTimestampMs` and passes `max(timestampMs, lastTimestampMs + 1)` to the library. Pure adapter behaviour, testable with a fake landmarker. **Spec addition** (former plan SC-5 — **now spec FR-022a/D19**): FR-022a.

---

## R12 — No synthetic face when no camera is attached

The editor supplies a *synthetic stand-in hand* when no camera is attached so hand-anchored effects can be previewed (item 15, `previewFrame`). **No synthetic face is provided.** With no camera, a face-anchored action is unresolved and reported, exactly as with an unavailable capability. Rationale: FR-005 forbids substituting fixed geometry for a face that cannot be tracked; a stand-in face would be the same substitution. The author is told plainly (existing diagnostic path). This is a decision the spec left implicit (FR-018 already forbids analysis with no camera).

---

## R13 — The indicator

*Updated 2026-09-21 (spec D24/FR-019a):* the indicator has three states — hidden, **on** (analysis ran this frame), **finished** (during a fixed `FACE_INDICATOR_HOLD_MS` = 500 ms hold after the last analysis frame). The hold is computed in the shell from the frame clock (`snapshot.nowMs`) — a single `lastAnalysisAtMs`, no timers — so it cannot cause or prolong analysis, and a fresh analysis frame naturally restarts it. `RuntimeFrame.faceTracking` is unchanged (true only when analysis ran).

`RuntimeFrame.faceTracking: boolean` (`faceCalled && source !== null`) rides the existing `EditorFrameSnapshot.runtime`. The editor shell subscribes through the existing `addFrameListener` and toggles one status element beside the camera control (`EditorShell`, near `setCameraOn`). No new event system. Wording: "Face tracking on" — checked against the capture-affordance label scan (`record|recording|capture|screenshot|save|download|share`): clear. The camera control's help text gains one sentence stating that face tracking runs only while a face-anchored effect is playing and nothing is stored or sent (FR-020).

---

## R14 — Repository facts for the plan (verified 2026-09-21)

- The Anchor union is matched in exactly five places: `domain/effects/types.ts`, `domain/effects/anchor-resolver.ts`, `domain/runtime/param-schema.ts` (`isAnchor`/`validateAnchor`), `infrastructure/effects/catalog-loader.ts` (`parseAnchor`/`serializeAnchor`), `presentation/editor/inspector-controls.ts` (`ANCHOR_KINDS`, `renderFields`, kind switch). TypeScript's exhaustive `serializeAnchor` switch turns a missed site into a compile error.
- `landmark_trail` and `particle_burst` are the only actions with an `anchor` param; neither reads `frame.hands`; `particle_burst` reads `context.anchor` (verified).
- `test/architecture/boundaries.test.ts` asserts the *segmentation model exists* on disk (a pre-existing, environment-dependent assertion). The face equivalent MUST NOT assert existence (absent by default).
- No `CLAUDE.md`/agent-context file and no `update-agent-context` script exist in this repository, so the plan workflow's "update agent context" step has nothing to update.


## R15 — Multi-model camera pipeline: performance baseline (2026-09-21, from the code; browser numbers pending)

Method: read the running architecture (`EditorRuntimeController`, the three MediaPipe adapters, `MirroredSurface`, `getUserMedia` camera) and instrument it (`PipelineTelemetry`, Diagnostics → pipeline section). The numbers below marked **[measure]** must be recorded from a real browser (T057); everything else is a code fact.

**What runs, when, how often**

| Model | When | Cadence | Input | Thread |
|---|---|---|---|---|
| Hand landmarker | **every tick while the camera is attached**, unconditionally (`captureFrame`) — needed by recognition/stability, so it cannot be made lazy without changing recognition | once per rAF tick (render-locked) | mirrored 1280×720 canvas | main, synchronous |
| Person segmenter | **every tick while attached, whenever a segmenter exists** (probed at page load) — regardless of whether any scheduled action uses segmentation | once per tick | same canvas | main, synchronous |
| Face landmarker | **lazily**: only when a *scheduled* face-anchored action needs a face, at most once per frame, never with no camera (FR-016/017) | ≤ once per tick, only while needed | same canvas | main, synchronous |

**Facts established**

- *Frame sharing:* `MirroredSurface.update()` draws the video into one canvas once per tick; all three models read that same canvas — **there is no per-model copy on our side**. MediaPipe then uploads the canvas as its own input per call, which we cannot share across tasks. Camera resolution is requested at 1280×720 and passed through unscaled; **no model is fed a reduced resolution** (MediaPipe resizes internally to each model's fixed input size, so the cost of the *upload* scales with 1280×720 while model compute does not).
- *Reconstruction:* segmenter and face detector are created once at page load (probe) and reused; **the hand detector is recreated on every camera toggle** (`createMediaPipeDetector` inside the camera handler) and closed on detach — per toggle, not per frame. Face/segmenter survive camera off/on by design.
- *Blocking:* all inference is synchronous on the main thread inside the rAF callback. Rendering is therefore blocked by inference *by construction*: tick time ≈ hand + segmentation + (face when active) + draw. There is no frame skipping, no cadence control, no worker, no async pipelining.
- *Redundant work (candidates):* (1) segmentation runs every tick even when no scheduled action needs it; (2) face, when active, could run below tick rate; (3) hand runs at render rate although a stability tracker needs far less than 60 Hz.
- *Not a problem (verified):* face analysis is not running when unneeded; models are not recreated per frame; the frame is not copied per model by our code.

**Measurements to take [measure] (T057)** — camera on, DevTools closed, Diagnostics + FaceMark Debug on: tick Hz and hand/segmentation ms/Hz with no effects; then with a face-anchored `landmark_trail` playing (face ms/Hz, tick Hz drop, max ms); with/without segmentation effect; on the slowest target device. Compare tick Hz against `budgets.targetFps`.

**Recommended strategy (proposal — implement only what the numbers justify, each behind its own decision):**

1. *Measure first* (done here): baseline before touching cadence.
2. *Conditional segmentation* (highest value, lowest risk): run the segmenter only on ticks where a scheduled/active action or the camera treatment needs the mask — same laziness principle as face. Must not regress segmentation effects; needs a "needs segmentation" signal analogous to `faceTracking`.
3. *Face cadence:* if face ms is significant, run it at a fixed cap (e.g. ~30 Hz) and reuse the last result between runs; its output is an anchor position, and last-known-position for one or two frames is tracking-correct for slow features. MediaPipe VIDEO mode requires strictly increasing timestamps (already clamped, D19), which permits skipping frames.
4. *Hand cadence:* leave as is unless measured; recognition stability is timing-sensitive (holds, cooldowns), so decimating it is a correctness change, not a tuning.
5. *Resolution:* try feeding a ≤640-wide surface to segmentation/face (anchor accuracy needs to be checked against V5); only if upload cost shows in the numbers.
6. *Workers/OffscreenCanvas:* **not recommended now.** They add a copy (ImageBitmap transfer) and async latency to a pipeline that today has none, complicate the lazy/lifecycle guarantees, and MediaPipe's own docs' worker path needs separate setup. Revisit only if measured tick time stays over budget after 2–3.

Constraints preserved by every option above: `FaceDetector` reusable and lifecycle-safe; face analysis lazy; `AnchorResolver` sole resolver; no face data persisted or transmitted; nothing in Capture Mode; Domain framework-free; Canvas2D only.
