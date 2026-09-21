---

description: "Task list for Face Landmark Anchors (Spec 011)"
---

# Tasks: Face Landmark Anchors

**Input**: `specs/011-face-landmark-anchors/` — [spec.md](./spec.md), [plan.md](./plan.md) (**authoritative** — the plan's former "Spec corrections" SC-1…SC-6 were promoted into the spec as D15–D20 and FR-015c/d, FR-018a, FR-022a, FR-037a and the Definition of Done), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Governing authority**: `.specify/memory/constitution.md` v1.10.0 (Principle VI Milestone 4; Principle II).

**Tests**: INCLUDED. The plan's test plan is a completion criterion (FR-028–FR-037), so tests are tasks, not options.

**Working directory**: all paths are relative to the repository root; the application is `apps/web/`. Test commands run from `apps/web/`.

**Hard rules for every task** (do not restate in commits; violate none):
- Never weaken or edit an existing assertion; new tests are additive. Baseline: **1177 tests / 92 files** green.
- No new dependency, no model download, no renderer/command change, no new action, no synthetic face, no edit to `future-work.md`, `src/main.ts`, `src/capture-main.ts`, the segmenter files, `Stage`, `LandmarkFrame`, recognition, persistence, docking/undo code, `apps/capture/mudra-web-capture-2026-09-21.zip`, or `specs/010-*`.
- `src/domain/` stays framework-free (no MediaPipe symbol, no Node built-in). Every public module/type/function gets a doc comment in the surrounding style. Match surrounding comment density and naming.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- **[Story]**: US1–US5 (spec user stories). Setup/Foundational/Provisioning/Polish carry none.

## User-story map

| Story | Priority | Deliverable |
|---|---|---|
| US1 | P1 | A face-anchored existing action follows a face landmark in the editor preview |
| US2 | P1 | Detection runs only when needed; indicator shown exactly then; camera off/on safe |
| US3 | P1 | Unavailable capability degrades honestly (inert + reported) |
| US4 | P1 | Face data provably cannot leak into recognition, storage, Capture, public entry, network |
| US5 | P2 | Author/load a face anchor safely (validation, round-trip, schema v1) |

---

## Phase 1: Setup

- [X] T001 From `apps/web/`, run `npm run typecheck && npm run lint && npm test` and record the baseline (expect 1177 tests / 92 files, all green) in the commit description of the first implementation commit. No file change. *(FR-037 baseline)*
- [X] T002 Read, and do not modify, the files whose conventions later tasks must mirror: `apps/web/src/infrastructure/detection/mediapipe-detector.ts`, `apps/web/src/infrastructure/segmentation/mediapipe-person-segmenter.ts`, `apps/web/test/adapters/mediapipe-person-segmenter.test.ts`, `apps/web/src/domain/landmarks/types.ts`, `apps/web/src/domain/ports/segmenter.ts`, `apps/web/test/architecture/layering.test.ts`, `apps/web/test/support/effects.ts`, `apps/web/test/support/source-scan.ts`. Note the injection style the segmenter test uses (needed by T013) and the `DetectorError` reason kinds.

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the domain type, capability probe, anchor kind, validation/wire form, and resolver. Nothing user-visible yet.

- [X] T003 [P] Create `apps/web/src/domain/landmarks/face.ts` exporting `FACE_LANDMARK_COUNT` (named constant; value **478**, an *unverified assumption* pending V4 — say so in its doc comment; it is a runtime/authoring boundary only and is **never** a project-load validation boundary, D21/FR-013), `FaceFrame` (`points: readonly Landmark[]`, `timestampMs`, `width`, `height`), `faceFrame(points, timestampMs, width, height)` validating exact count / finite coordinates / positive size and throwing `FaceFrameError`, and `type FaceFrameSource = () => FaceFrame | null`. Create `apps/web/src/domain/ports/face-detector.ts` exporting `FaceDetector { detect(surface: MirroredSurface, timestampMs: number): FaceFrame | null; close(): void }`. Reuse the existing `Landmark` type. **No** blendshape, matrix, score, label or image field. *(FR-009, 010, 013; data-model)*
- [X] T004 [P] Create `apps/web/test/domain/face-frame.test.ts`: wrong count, `NaN`, `±Infinity`, zero/negative size rejected with `FaceFrameError`; a valid frame accepted; a fake `FaceDetector` returns `FaceFrame | null` and `close()` is idempotent; within `src/domain/landmarks/face.ts` and the adapter's count guard, the count is referenced only through `FACE_LANDMARK_COUNT` (no bare numeric literal equal to its value except its single definition). **No repository-wide literal scan** (brittle). *(FR-009, 010, 013)*
- [X] T005 Edit `apps/web/src/domain/runtime/capabilities.ts`: export `FACE_LANDMARKS = 'face_landmarks'`; extend `probeCapabilities(trySegmenter, logger = new Logger(), tryFace?)` per `contracts/runtime-and-probe.md` §1 — each constructor in its **own** `try/catch` with its own `logger.warn` naming its capability; return `{ capabilities, segmenter, faceDetector }`; the registry contains **no** `face_landmarks` entry when `tryFace` is omitted (so `all()` is byte-identical to today) and one entry (`true`/`false`) when supplied; never call `detect`. **Do not touch** `defaultCapabilities()` or `src/main.ts`. Depends on T003. *(FR-001, 002, 003; research R2)*
- [X] T006 Create `apps/web/test/domain/capability-face-probe.test.ts`: (seg rejects, face resolves) → seg false / face true / `faceDetector` set / `segmenter` null; (face rejects, seg resolves) → seg true / face false / `faceDetector` null; both reject → both false, no throw, each failure logged with its own capability name; both resolve; `tryFace` omitted → `all()` equals `[{ name: 'person_segmentation', available: <as before> }]` and `faceDetector === null`; fake detector's `detect` call count is **0** after probing. Confirm the pre-existing `apps/web/test/domain/capabilities.test.ts` and `capability-segmentation.test.ts` pass **unmodified**. Depends on T005. *(FR-001–003, 035)*
- [X] T007 Edit `apps/web/src/domain/effects/types.ts`: add `| { readonly kind: 'faceLandmark'; readonly index: number }` to `Anchor` (doc comment: authored data, not face data). Create `apps/web/src/domain/effects/anchor-capability.ts` exporting pure `requiredCapabilityOf(anchor: Anchor): string | undefined` returning `FACE_LANDMARKS` for `faceLandmark` and `undefined` for every other kind. Then run `npm run typecheck` and use the compile errors plus `git grep handCentroid -- apps/web/src` to confirm the anchor union is matched **only** in: `types.ts`, `anchor-resolver.ts`, `param-schema.ts`, `catalog-loader.ts`, `inspector-controls.ts` (record any other site found in the PR description). Depends on T003, T005. *(FR-014; research R3, R14)*
- [X] T008 [P] Edit `apps/web/src/domain/runtime/param-schema.ts`: in `isAnchor` accept `faceLandmark`; in `validateAnchor` handle it **before** the `hand`-selector check (this kind has no `hand`) requiring only that `index` be a **non-negative integer** (structure). **No model-range check here**, so project/catalog loading never depends on the unverified landmark count; the message says "non-negative integer". Depends on T007. *(FR-015a, 015d; D21)*
- [X] T009 [P] Edit `apps/web/src/infrastructure/effects/catalog-loader.ts`: `parseAnchor` reads `{kind:'faceLandmark', index}` via the existing `number` helper; `serializeAnchor` emits exactly `{ kind: 'faceLandmark', index }`; extend the "kind must be …" error text to list `faceLandmark`. Load-time validation is structural only (non-negative integer index; no model-range check, D21). If an existing test pins the old error text, make an **additive** test edit only and note it in the PR. Depends on T007. *(FR-015a; research R4)*
- [X] T010 Edit `apps/web/src/domain/effects/anchor-resolver.ts`: `resolve(key, anchor, frame, face: FaceFrame | null = null)`. Add the `faceLandmark` branch **before** the existing `selectHand(frame, anchor.hand)` line: `face === null` → existing `fallback(key, 'face is not in frame')`; `face.points[index]` undefined → `fallback(key, 'face landmark N does not exist')`; else `{ x: p.x * face.width, y: p.y * face.height }` stored in `lastKnown`. Use the **face's** own `width/height`. **No flip.** Existing branches unchanged. Depends on T003, T007. *(FR-014, 015; research R9)*
- [X] T011 [P] Create `apps/web/test/domain/face-anchors.test.ts`: the **asymmetric fixture** from research R9 — a `FaceFrame` 1280×720 with index 1 at `(0.25, 0.60)` and index 2 at `(0.80, 0.30)` (other points distinct, finite): expect anchor 1 → `(320, 432)`, anchor 2 → `(1024, 216)`; assert `x(1) < x(2)` and `y(1) > y(2)` (detects a horizontal or vertical flip); result identical whether the `LandmarkFrame` argument is empty or populated; `face = null` → holds last resolved position, else `unresolvedDetail === 'face is not in frame'`; index ≥ points length → `'face landmark N does not exist'` with **no point resolved** — never clamped, wrapped or remapped (FR-015c); two anchors keep separate memories. Confirm existing `apps/web/test/domain/anchors.test.ts` passes **unmodified**. Depends on T010. *(FR-014, 015, 036)*

**Checkpoint**: `npm run typecheck && npx vitest run test/domain` green. No user-visible change yet.

---

## Phase 3: User Story 1 — A face-anchored action follows a face landmark (Priority: P1) 🎯 MVP

**Goal**: with a camera attached, a scheduled face-anchored `landmark_trail`/`particle_burst` resolves to the landmark's pixel position, using the existing actions unmodified.

**Independent Test**: drive the runtime with a fake face source and assert rendered points equal the landmark's scaled position; drive the editor controller with a fake camera and fake detector and assert the same end to end. (Real-face check is manual, quickstart §D.)

- [X] T012 [US1] Edit `apps/web/src/domain/runtime/effect-runtime.ts`: (a) `advance(events, frame, nowMs, segmentation = null, faces: FaceFrameSource | null = null)`; thread `faces` into `render`; (b) in `render`, a memoized `faceNow()` that calls `faces?.()` at most once per call and records `faceCalled`; (c) after `resolveParams` and **before** `resolveAnchor`, apply the per-instance gate: `const need = requiredCapabilityOf(anchor)`; if `need !== undefined && !this.capabilities.has(need)` push `{ effectId, actionType, reason: 'capability_unavailable', detail: need }` and `continue` (so `faceNow` is never reached); (d) `resolveAnchor` obtains `faceNow()` **only** for a `faceLandmark` anchor and passes it to `playback.anchors.resolve(key, anchor, frame, face)`; (e) `RuntimeFrame` gains `faceTracking: boolean` = `faceCalled && faces !== null`. Non-face anchors and actions without an `anchor` param take no new path. The `FaceFrame` must not be stored on the runtime, a `Playback`, `ActionContext`, or `RuntimeFrame`. Depends on T005, T007, T010. *(FR-004, 005, 016, 017, 029; research R3, R7)* **Repo-check**: confirm `startEffect` and `advance` are the only entry points and that no other code constructs a `RuntimeFrame` literal (grep `activePlaybacks` / `firstCommands`).
- [X] T013 [P] [US1] Create `apps/web/src/infrastructure/detection/mediapipe-face-detector.ts`: `FACE_MODEL_URL = '/face_landmarker.task'`; `DEFAULT_FACE_DETECTOR_CONFIG` (`maxFaces: 1`, the three confidence thresholds at 0.5); a class implementing `FaceDetector` over a minimal structural landmarker interface (`detectForVideo`, `close`) so tests inject a fake (**follow the injection style noted in T002**); per frame: pass `surface.image` and timestamp `max(ts, last + 1)`, take `faceLandmarks[0]` only, point count ≠ `FACE_LANDMARK_COUNT` → `null` + **one** `Logger.warn`, any throw → `null` + one warn per consecutive-failure streak (reset after a success), read **only** `faceLandmarks`, `close()` idempotent and afterwards `detect` returns `null`; `createMediaPipeFaceDetector({ wasmPath, modelUrl? })` mirrors the hand adapter's `FilesetResolver`/`createFromOptions` and `DetectorError` mapping with `outputFaceBlendshapes: false`, `outputFacialTransformationMatrixes: false`, `numFaces: 1`, `runningMode: 'VIDEO'`. This is the **only** file allowed to name MediaPipe face symbols. Depends on T003. *(FR-011, 022, 022a, 027; contracts/face-model-provisioning.md)*
- [X] T014 [P] [US1] Create `apps/web/test/adapters/face-detector-adapter.test.ts` (jsdom, fake landmarker): wrong count → `null` + exactly one warn; takes index 0 only when the fake returns two faces; requested options are exactly `numFaces 1`, blendshapes false, matrices false, VIDEO mode (assert on the options passed to a stubbed factory or the constructor's recorded config); the fake result's other properties throw on access (proves only `faceLandmarks` is read); a throwing landmarker → `null`, no exception, one warn per streak, streak resets after a success; timestamps `[100, 100, 90, 250]` reach the fake strictly increasing; `close()` idempotent and `detect` → `null` afterwards; output `width/height` equal the surface's. Depends on T013. *(FR-011, 022, 022a)*
- [X] T015 [US1] Edit `apps/web/src/application/editor-runtime-controller.ts`: add `faceDetector?: FaceDetector | null` to `EditorRuntimeControllerOptions` (doc: **borrowed**, never closed by the controller); add private `faceSourceFor(nowMs): FaceFrameSource | null` returning `null` if `this.camera === null || this.faceDetector == null`, else `() => this.faceDetector.detect(this.camera.session.surface, nowMs)`; pass `this.faceSourceFor(nowMs)` as the fifth argument at **all three** `runtime.advance` call sites (`tick`, `testTrigger`, `advanceAndPresent`). **Do not change** `AttachedCamera`, `attachCamera`, `detachCamera`, or `stop()` beyond what is stated here (`stop()` must NOT close the face detector). Depends on T012. *(FR-016–018, 021; research R1, R7)* **Repo-check**: re-read the three call sites before editing; capture the camera reference into a local so the closure cannot observe a later `null`.
- [X] T016 [US1] Edit `apps/web/src/editor-main.ts`: change the probe call to `probeCapabilities(() => createMediaPipePersonSegmenter({ wasmPath: WASM_PATH }), undefined, () => createMediaPipeFaceDetector({ wasmPath: WASM_PATH }))` and destructure `faceDetector`; pass `faceDetector` into `new EditorRuntimeController({...})`; in the existing `pagehide` listener call `faceDetector?.close()` **after** `runtimeController.stop()`. **Do not modify** any segmenter line, `onToggleCamera`, or `attachCamera(...)`. Depends on T005, T013, T015. *(FR-001, 008, 018, 021; research R1, R6)* **Repo-check**: the `pagehide` listener is registered once per page (not per `mountEditor`) — attach the close there.
- [X] T017 [P] [US1] Create `apps/web/test/domain/face-runtime.test.ts` (node; use `apps/web/test/support/effects.ts` helpers, `allCapabilities()`/a registry with `face_landmarks` true): an effect with a face-anchored `landmark_trail` yields draw commands at the landmark's pixel position via a fake `FaceFrameSource`; the same for `particle_burst` (instantaneous at 0 ms — its single `justFired` frame **has** the face because `faces()` is called inside that same `advance`); `faces()` called **at most once** per `advance` even with several face-anchored entries; `faces()` **not** called when only hand/screen anchors are scheduled, when the effect has no anchor param, or when nothing is scheduled; `faces === null` → face anchor unresolved with `face is not in frame` and no exception; `RuntimeFrame.faceTracking` true iff the source was invoked; non-face effects with `faces = null` produce output identical to a run without the fifth argument. Depends on T012. *(FR-015b, 016, 017, 034; SC-1)*
- [X] T018 [US1] In `apps/web/test/adapters/editor-face-lifecycle.test.ts` (new; jsdom; **real** `EditorRuntimeController` + real `EffectRuntime` + fake `CameraSession`/`HandDetector`/`FaceDetector`, modelled on the existing `apps/web/test/adapters/editor-*.test.ts` and `test/support/fake-session.ts`), add the US1 end-to-end case: camera attached, face-anchored trail scheduled → the stage receives commands at the fake face's landmark pixel position; a face at the left of the fake frame yields commands at the left (no re-mirroring). Depends on T015. *(FR-015, 036)*

**Checkpoint**: `npx vitest run test/domain/face-runtime.test.ts test/adapters/face-detector-adapter.test.ts test/adapters/editor-face-lifecycle.test.ts` green; existing suites unmodified and green.

---

## Phase 4: User Story 2 — Detection runs only when needed; the author is told (Priority: P1)

**Goal**: analysis begins/ends exactly per FR-016/017; indicator mirrors it; camera off/on and Close Project → reopen are safe.

**Independent Test**: call-count tests on the fake detector across the full lifecycle table in research R7.

- [X] T019 [US2] Extend `apps/web/test/adapters/editor-face-lifecycle.test.ts` with the lifecycle cases, each asserted **per tick** (not in aggregate) with a call-counting fake `FaceDetector`: **0** calls after the probe and before `attachCamera`; **0** while only hand-anchored effects play; **≥1 per tick, ≤1 per `advance`** while a face-anchored action is scheduled; **0** on the first tick after that action leaves its window and its playback ends; **0** immediately after `detachCamera()` even while an effect keeps playing; **0** when the capability registry lacks `face_landmarks`; **0** after `stop()`; anchor edited face→hand mid-playback stops calls next tick, hand→face starts them next tick; Test Trigger and Play Timeline invoke the same source builder (assert calls occur on those paths too when a camera is attached and none when not); **10 attach/detach cycles**: the **same** detector instance still yields anchored output after each and its `close` count is **0** until the test's explicit teardown; a **second controller** constructed with the same detector (Close Project → reopen) works; in the same harness `detachCamera()` closes the segmenter fake **exactly once per detach** (the documented current behaviour — assert exactly that, do not fix it, and make no generic "pre-change equality" claim); assert the face detector is never handed out after a terminal `close()` (FR-021 v). Depends on T015, T018. *(FR-016, 017, 018, 018a, 021, 034; SC-002, SC-003, SC-008)*
- [X] T020 [US2] Edit `apps/web/src/presentation/editor/editor-shell.ts`: export `FACE_INDICATOR_HOLD_MS = 500` (one named constant beside the indicator; no other literal for it anywhere) and add one status element beside the camera control with three states — hidden; **on** ("Face tracking on") on a frame where analysis ran; **finished** ("Face tracking finished") during the hold. Add `reflectFaceTracking(snapshot: Pick<EditorFrameSnapshot, 'nowMs' | 'runtime'>)`: state derives purely from the frame clock — if `snapshot.runtime.faceTracking` set `lastAnalysisAtMs = nowMs` and show *on*; else show *finished* while `nowMs − lastAnalysisAtMs < FACE_INDICATOR_HOLD_MS`, otherwise hidden. A later analysis frame simply overwrites `lastAnalysisAtMs` (one deadline; **no `setTimeout`/interval, no second timer**). It never causes or requests analysis, never shows *on* unless analysis ran that frame, and is never shown merely because a face anchor exists. No animation. Also add one sentence to the camera control's help text stating that face tracking runs only while a face-anchored effect needs it and nothing is stored or sent. Wording must not contain `record|recording|capture|screenshot|save|download|share`; no `requestAnimationFrame` under `presentation/editor/**`. Depends on T012. *(FR-019, 019a, 020; D24)* **Repo-check**: find where the camera control and its help text are built (`setCameraOn`, near line 678) and reuse the existing status/label conventions.
- [X] T021 [US2] Edit `apps/web/src/editor-main.ts`: in the per-mount frame listener registered through `runtimeController.addFrameListener` (disposed with the mount like the other listeners) call `shell.reflectFaceTracking(snapshot)` — one line, nothing else. Depends on T016, T020. *(FR-019, 019a)*
- [X] T022 [US2] Create `apps/web/test/adapters/editor-face-indicator.test.ts` (jsdom; **real** `EditorRuntimeController` + `EffectRuntime` + fake camera/`HandDetector`/call-counting `FaceDetector`, same harness as T019; the test itself registers `controller.addFrameListener((s) => shell.reflectFaceTracking(s))` because jsdom tests do not run `editor-main.ts`; use `vi.useFakeTimers()` only to assert no timers are created). Assert: (a) hidden initially; (b) an **instantaneous** face-anchored action fires at t0 → the detector is called **exactly once** in total and the indicator shows *on* ("Face tracking on") at t0; (c) for **every** subsequent tick with `nowMs < t0 + FACE_INDICATOR_HOLD_MS` the detector call count is **unchanged** (no extra analysis during the hold) and the indicator is visible showing *finished* ("Face tracking finished"), never *on*; (d) at the first tick with `nowMs ≥ t0 + FACE_INDICATOR_HOLD_MS` it is hidden — so it stays perceptible for the full defined minimum, measured from the last analysis frame, imported from the exported constant (no literal in the test); (e) a second analysis frame inside the hold shows *on* again and the hold restarts from that frame, with `vi.getTimerCount() === 0` throughout (one deadline, no independent timer); (f) a face anchor present in the project but nothing scheduled → the indicator stays hidden across a long run of ticks and the detector is never called; (g) the help-text sentence is present and every new user-facing string passes the capture-label regex `/\b(record|recording|capture|screenshot|save|download|share)\b/i`. Depends on T015, T018, T020. *(FR-019, 019a, 020; SC-003)*

**Checkpoint**: lifecycle + indicator tests green.

---

## Phase 5: User Story 3 — Honest degradation when face tracking is unavailable (Priority: P1)

**Goal**: missing model / unsupported browser ⇒ inert, reported, never simulated; badges reflect it; authoring still works; public experience unchanged.

**Independent Test**: registry with `face_landmarks` false; face-anchored action produces nothing and a `capability_unavailable` diagnostic; status badge matches.

- [X] T023 [US3] Edit `apps/web/src/domain/editor/action-status.ts`: after params resolve, `requiredCapabilityOf(anchor)` unavailable in `input.capabilities` → status `capability_unavailable` (existing label/detail vocabulary; detail names `face_landmarks`). Precedence follows the existing worst-first order. **No branch keyed to an action type.** Depends on T007. *(FR-006; research R3)*
- [X] T024 [P] [US3] Create `apps/web/test/domain/face-action-status.test.ts`: the **same** action type (`landmark_trail`) is `capability_unavailable` with a face anchor and `ready` with a hand or screen anchor when `face_landmarks` is false; `ready` with a face anchor when it is true; a source scan of `action-status.ts` finds no literal `landmark_trail`/`particle_burst`. Confirm existing `apps/web/test/domain/action-status.test.ts` passes **unmodified**. Depends on T023. *(FR-006, 007)*
- [X] T025 [US3] Extend `apps/web/test/domain/face-runtime.test.ts`: with `face_landmarks` unavailable, a face-anchored effect emits **no commands**, exactly one `{ reason: 'capability_unavailable', detail: 'face_landmarks' }` diagnostic per scheduled entry, no exception, and the face source is **never** called; `person_visibility` behaviour and its existing tests unchanged; no fixed/default position is ever substituted. Depends on T012, T017. *(FR-004, 005, 035)*
- [x] T026 [US3] *(withdrawn — duplicate of T006; not a task. The editor-shaped independence case, a rejecting face constructor leaving segmentation availability unchanged, is asserted in T006 in both failure directions. Number retained only so later task ids stay stable; do not implement.)* *(FR-002, 035 → T006)*

**Checkpoint**: degradation tests green.

---

## Phase 6: User Story 4 — Face data cannot leak (Priority: P1)

**Goal**: boundaries are enforced by failing builds, not by review.

**Independent Test**: the architecture and sentinel tests below.

- [X] T027 [US4] Edit `apps/web/test/architecture/layering.test.ts`: extend the domain MediaPipe-symbol pattern to also reject `FaceLandmarker`, `FaceLandmarkerResult` and `NormalizedLandmark`; add a mutation check that a synthetic source string containing `FaceLandmarker` is flagged by the same matcher (guards against a silently broken regex). Additive only. Depends on T003. *(FR-012)*
- [X] T028 [P] [US4] Create `apps/web/test/architecture/face-boundary.test.ts` using `readSources`/`findMatches` from `test/support/source-scan.ts`, asserting (each with a "has sources to scan" guard so nothing passes vacuously): (1) `domain/recognition/**`, `domain/events/**`, `domain/normalization/**`, `application/session.ts`, `application/capture-controller.ts`, `domain/landmarks/types.ts` contain no `Face`/`face_landmarks` token; (2) `LandmarkFrame`'s property names equal exactly `hands, timestampMs, width, height`; (3) the `ActionContext` interface text contains no `face`/`Face`, plus a `// @ts-expect-error` line proving `context.face` does not compile; (4) `domain/runtime/actions/**` contain no `.hands`, `faceLandmark` or `FaceFrame`; (5) every path in the Capture list (copy `CAPTURE_PATHS` from `capture-boundary.test.ts`) contains no `Face`, `face_landmarks`, `face-detector` or `FACE_MODEL_URL`, and `capture-main.ts` does not import `mediapipe-face-detector`; (6) `src/main.ts` and `src/application/session.ts` import no face module; (7) `infrastructure/persistence/**` and `infrastructure/effects/catalog-loader.ts` name no `FaceFrame`/`FaceDetector`; (8) apart from comments (use the existing comment-stripping scanner), the identifier `FaceLandmarker` appears in **no** `src/` file other than `src/infrastructure/detection/mediapipe-face-detector.ts`; (9) the shipped default catalog `apps/web/config/effects.json` contains no `faceLandmark`; (10) the adapter contains no `http` literal or `fetch(`; (11) the registered action types (`SHIPPED_ACTIONS.map((a) => a.type).sort()`) equal exactly `['background_wash','landmark_trail','particle_burst','person_visibility','play_audio','screen_flash']` (FR-037a, SC-001 — also makes any placeholder face action fail the build). Depends on T003, T007, T012, T013, T015. *(FR-008, 012, 015, 028–032)*
- [X] T029 [P] [US4] Create `apps/web/test/domain/project-face-anchor.test.ts` **sentinel section**: build a project with a face-anchored effect, run the runtime with a `FaceFrame` whose coordinates are sentinels (e.g. `0.123456789`, `0.987654321`), then `JSON.stringify` the result of `serializeProject(project)` **and** every returned `RuntimeFrame` and diagnostic — assert no sentinel digit string appears anywhere, while the anchor `{"kind":"faceLandmark","index":N}` does. Depends on T012, T009. *(FR-030; SC-005)*
- [X] T030 [US4] Verify (no edit) that `apps/web/test/architecture/privacy.test.ts` and `capture-boundary.test.ts` pass **unmodified** with the new files present, and that `DOWNLOAD_EXEMPTIONS` and `LABEL_EXEMPTIONS` still have length 2; record the result. If either fails, fix the **new code**, never the test. Depends on T028. *(FR-033; SC-007)*

**Checkpoint**: `npx vitest run test/architecture` green.

---

## Phase 7: User Story 5 — Author and load a face anchor safely (Priority: P2)

**Goal**: Inspector authoring, validation, persistence round-trip at schema v1.

**Independent Test**: validation + round-trip tests; inspector jsdom test.

- [X] T031 [US5] Edit `apps/web/src/presentation/editor/inspector-controls.ts`: add `'faceLandmark'` to `ANCHOR_KINDS`; the kind-change default for it is `{ kind: 'faceLandmark', index: 0 }`; in `renderFields` show **only** an index number field for it (no hand selector — this kind has no `hand`); index edits are `Math.round`ed like the hand landmark index. **Authoring range check**: reject an index outside `[0, FACE_LANDMARK_COUNT − 1]` with a message naming the range (this is the model-range boundary at authoring, FR-015a; provisional until DoD-5), and reject negative/non-integer input. Depends on T007. *(FR-015a, 007)* **Repo-check**: current code reads `anchor.hand` for every non-`screen` kind — branch before that.
- [X] T032 [P] [US5] Extend `apps/web/test/adapters/inspector.test.ts` (additive): choosing `faceLandmark` shows an index field and no hand select; editing the index calls `onChange` with `{ kind: 'faceLandmark', index }`; authorable with `face_landmarks` unavailable; an index beyond `FACE_LANDMARK_COUNT − 1` is rejected with a message naming the range and `onChange` is not called. Depends on T031. *(FR-007, 015a)*
- [X] T033 [P] [US5] Extend `apps/web/test/domain/project-face-anchor.test.ts` (**schema section**): `PROJECT_SCHEMA_VERSION === 1` (unchanged); a face-anchored project serializes with `project_schema_version: 1` and `params.anchor === { kind: 'faceLandmark', index }`; `parseProject(serializeProject(p))` equals `p`; existing v1 fixtures still parse; a document with an unknown anchor kind (`faceRegion`) is rejected with a message listing the valid kinds (the property that makes old-build rejection real); `param-schema`/catalog load rejects `index` of `-1`, `1.5`, `'3'` (structural) but **accepts** `FACE_LANDMARK_COUNT` and `100000` — a project holding such an anchor **loads and round-trips**, because persisted data must not depend on the unverified count (D21); at runtime such an index resolves to no point (T011/T017). Also add a catalog round-trip case to `apps/web/test/domain/config-driven-effects.test.ts` (additive). Depends on T008, T009. *(FR-015a; research R4; SC-4)*

**Checkpoint**: authoring + schema tests green.

---

## Phase 8: Model provisioning (supports US1 in a real browser; not required by automated gates)

- [X] T034 [P] Create `apps/web/tools/fetch-face-landmarker.mjs` per `contracts/face-model-provisioning.md`: constants `SOURCE_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'` and `EXPECTED_SHA256 = null`; stream to `assets/face_landmarker.task.part` while hashing; while `EXPECTED_SHA256 === null` install **nothing**, delete the `.part`, print URL/HTTP status/size/computed hash for human review and exit non-zero with an explanatory message; on mismatch delete `.part` and exit non-zero; on match atomic rename; an existing target is re-verified and a mismatching one deleted; no arguments, no environment override, no local-file option; export a pure `verifySha256(filePath, expectedHex)` helper for the test. Add `"fetch-face-model": "node tools/fetch-face-landmarker.mjs"` to `apps/web/package.json` and **leave `fetch-models` byte-identical**. Do **not** run the script. *(FR-023, 024, 027; research R10)* **Repo-check (do not lose — resolve before T037 is written) — RESOLVED at implementation: a `.d.mts` sidecar next to the `.mjs` (no `tsconfig` change, no `allowJs`)**: decide how the test imports the `.mjs` under strict `tsc --noEmit` (a `.d.mts` sidecar or a `child_process` invocation) **without loosening `tsconfig`**.
- [X] T035 [P] Edit `apps/web/vite.config.ts`: add `{ file: 'face_landmarker.task', url: '/face_landmarker.task' }` to `SHARED_MODELS`, and export `FACE_MODEL_URL = '/face_landmarker.task'` beside `MODEL_URL`/`SEGMENTER_MODEL_URL`. Do not change plugin logic. *(FR-023, 026)*
- [X] T036 [P] Edit `assets/readme.md`: add a table row for `face_landmarker.task` (`cd apps/web && npm run fetch-face-model`), and a "Face Landmarker provenance" block with the fields **source URL, model name, precision, version path, SHA-256, licence (with model-card link), date fetched, observed landmark count** — each currently reading "not yet provisioned (see specs/011-face-landmark-anchors/plan.md V1–V7)"; note that a present model is emitted into every build's `dist/` (research R10). *(FR-025)*
- [X] T037 Create `apps/web/test/tools/fetch-face-landmarker.test.ts` (node) and extend `apps/web/test/architecture/boundaries.test.ts` (additive): hash helper accepts a matching temp file, rejects one flipped byte and a truncated file and removes them, a `.part` never survives; script source has `EXPECTED_SHA256` declared and no `process.env`/`argv` read, no local-file option; `package.json` has `fetch-face-model` and `fetch-models` still equals its current string; `vite.config.ts` contains the `face_landmarker.task` entry and `resolve(REPO_ROOT, 'assets'`; `apps/web/public/` and `apps/web/assets/` contain **no** `face_landmarker.task`; the adapter's `FACE_MODEL_URL` equals the config URL; readme contains every provenance field name; `package.json` `dependencies` deep-equals `{ "@mediapipe/tasks-vision": "^0.10.14" }`. **Must not assert the model file exists**, and must not assert a non-null pinned hash (the model is intentionally absent by default; the pinned-hash state is a human completion criterion, DoD-3, not an automated gate). **Repo-check carried from T034 — resolve before writing this test:** how a `.mjs` module is imported under strict `tsc --noEmit` (a `.d.mts` sidecar or a `child_process` invocation) **without loosening `tsconfig`**; do not invent a workaround before checking the repository's existing conventions. Depends on T013, T034, T035, T036. *(FR-023–027)*

---

## Phase 9: Polish & Cross-Cutting

- [X] T038 (DoD-1) Run from `apps/web/`: `npm run typecheck`, `npm run lint` (eslint + prettier), `npm test`, `npm run build` — **with the face model absent**. All must pass; the build may emit the existing "Shared model not found" style warning for the face model only. Review `git diff` of pre-existing test files: additions only. Test count must exceed the 1177 baseline. *(FR-026, 037; SC-004, SC-009)*
- [X] T039 Confirm scope discipline with `git status`/`git diff --stat`: no change under `src/main.ts`, `src/capture-main.ts`, `src/application/session.ts`, `src/application/capture-*`, `src/infrastructure/persistence/**`, `src/infrastructure/segmentation/**`, `src/presentation/stage/**`, `src/presentation/renderer/**`, recognition/events/normalization domain code, `future-work.md`; `landmark_trail` and `particle_burst` source files show an **empty diff**. Record the confirmation. *(SC-006; plan "Explicitly not in this plan")*
- [ ] T040 **Manual, human, NOT automated** — provision and verify the model, then execute `quickstart.md` §C and §D and plan protocol **V1–V7**: pin `EXPECTED_SHA256` in `tools/fetch-face-landmarker.mjs` (a separate reviewed change), fill the `assets/readme.md` provenance block, set `FACE_LANDMARK_COUNT` to the observed value if V4 differs, record V5 orientation (x of landmark 33 vs 263 on the mirrored view), V6/V7 results, and perform the SC-010 smoothness check. **This task is a human-enforced completion criterion, not part of the ordinary no-model automated gate run (T038 must pass with the model absent and `EXPECTED_SHA256 = null`; no automated test may fail for that). It is the spec's Definition of Done (DoD-2…DoD-8): the feature is NOT complete while `EXPECTED_SHA256 = null`, the landmark count is unverified, the licence is unrecorded, or any V-item is unperformed.** **Do not tick any V-item or SC-010 until actually performed**; update `specs/011-face-landmark-anchors/spec.md` A-3/A-4 and `checklists/requirements.md` notes with the results. Depends on T034, T038. *(SC-010; plan V1–V7)*

---

## Dependencies & execution order

```text
Phase 1 (T001–T002)
   └─► Phase 2 Foundational: T003 ─┬─► T004
                                   ├─► T005 ─► T006
                                   └─► T007 ─┬─► T008
                                             ├─► T009
                                             └─► T010 ─► T011
Phase 3 US1: T012 (needs T005,T007,T010) ─► T015 ─► T018 ; T015 ─► T016  (T016 and T021 both edit editor-main.ts — sequential)
             T013 (needs T003) ─► T014           T017 (needs T012)
Phase 4 US2: T019 (needs T015,T016,T018) · T020 (needs T012) ─► T021 (needs T016) ─► T022
Phase 5 US3: T023 (needs T007) ─► T024 · T025 (needs T012,T017) · T026 withdrawn (covered by T006)
Phase 6 US4: T027 (needs T003) · T028 (needs T003,T007,T012,T013,T015) · T029 (needs T009,T012) · T030 (needs T028)
Phase 7 US5: T031 (needs T007) ─► T032 · T033 (needs T008,T009)
Phase 8:     T034 ∥ T035 ∥ T036 ─► T037 (also needs T013)
Phase 9:     T038 (all code + tests) ─► T039 ─► T040 (manual)
```

**Story independence**: US1 is the MVP and depends only on Foundational. US2 builds on US1's controller wiring. US3, US4, US5 each depend only on Foundational plus the runtime task T012 where noted, and can proceed in parallel with US2 once T012 lands.

### Parallel opportunities

- After T003: T004 ∥ T005 ∥ T007 ∥ T013 ∥ T034 ∥ T035 ∥ T036.
- After T007: T008 ∥ T009 ∥ T010 ∥ T023 ∥ T031 ∥ T027.
- After T012: T017 ∥ T020 ∥ T025.
- Test files in different paths (T011, T014, T017, T022, T024, T028, T029, T032, T033) are mutually parallel once their dependencies are done. Tasks that extend the **same** file (`face-runtime.test.ts`: T017→T025; `editor-face-lifecycle.test.ts`: T018→T019; `capability-face-probe.test.ts`: T006 only (T026 withdrawn); `project-face-anchor.test.ts`: T029→T033) are sequential.

## Implementation strategy

1. **MVP** = Phases 1–3 (T001–T018): a face-anchored existing action follows a landmark in the editor, proven with fakes; nothing about the real model is claimed.
2. Add **US2** (lifecycle + indicator) before anything is shown to a user — it carries the privacy conditions, so treat US1+US2 as the shippable minimum.
3. **US3/US4/US5** in any order; US4 must land before the branch is considered complete.
4. **Phase 8** can start any time after T003 but its manual outcome (T040) is the only path to a real-browser claim.
5. Stop and re-run the gates at each checkpoint; never mark a task done by editing a test to pass.

## Requirement coverage (spec → tasks)

FR-001–003, 035: T005, T006, T016, T025 · FR-004–005: T012, T025 · FR-006: T023, T024 · FR-007: T031, T032 · FR-008: T016, T028 · FR-009–010, 013: T003, T004 · FR-011, 022, 022a: T013, T014 · FR-012: T027 · FR-014–015b: T007–T011, T017 · FR-015c: T011, T017 · FR-015d: T033 · FR-015a: T008, T009, T031–T033 · FR-016–018, 018a, 021, 034: T012, T015, T017, T019 · FR-019, 019a, 020: T020–T022 · FR-023–027: T013, T034–T037 · FR-028–033: T028–T030 · FR-036: T011, T018 · FR-037, 037a: T001, T028, T038 · SC-001: T028 (11) · SC-005: T029 · SC-006: T028, T039 · SC-007: T030 · SC-004, SC-009: T038 · SC-010 and DoD-2…DoD-8: T034, T036, T040

## Notes

- **Not created here**: no source file, model, or dependency exists yet; every path above is to be created/edited during `/speckit-implement`.
- The spec now states, normatively, everything these tasks rely on: scheduled-this-frame detection (D15/FR-016), detector lifecycle (D16/FR-021), capability identity/prober/probed result (D17/FR-001–003), schema v1 (D18/FR-015d), timestamp clamp (D19/FR-022a), no synthetic face (D20/FR-018a), landmark-count validation ordering (D21/FR-013/015a/015c), Definition of Done (D22), expected absent-model state (D23/FR-026). No task references a requirement that exists only in `plan.md`.

## Implementation notes (2026-09-21)

- T001–T039 are implemented and ticked; **T040 is a human-enforced completion step and remains open** (the model has not been provisioned, `EXPECTED_SHA256` is `null`, `FACE_LANDMARK_COUNT = 478` is provisional, V1–V7 and SC-010 are unperformed). The automated gates pass with the model absent, as designed.
- Found while implementing (spec corrected accordingly): no shipped anchor-taking action is instantaneous, so a zero-duration `particle_burst` is never scheduled — the indicator hold (D24) matters for very *short* windows instead; a running playback keeps the definition it started with, so anchor-switching is exercised via staggered timeline entries (T019), not by editing mid-playback.
- Found while implementing (code fix, in scope): analysis that ran outside a tick (Test Trigger, Play Timeline) was invisible to the indicator; the controller now folds it into the next tick's snapshot (`faceRanOutsideTick`).
- Found while implementing (code fix, in scope): an empty index field in the Inspector became index 0 — now rejected.
- The `pagehide` listener in `editor-main.ts` is registered per mounted editor, not once per page as the plan's repo-check assumed; closing the (idempotent) detector there is still correct, since it only ever fires at real page teardown.

---

## Phase 10: Amendment A — Browser-validation slice (Spec 011, Amendment A)

**Goal**: make the completed pipeline *observable* in a real browser so V1–V7, SC-010 and BV-1…BV-12 can be performed. No new action, anchor, command or renderer change. All of it is passive: nothing here may cause face analysis (D26).

- [ ] T041 [P] Add `FaceDetectorDiagnostics` and the **optional** `diagnostics?(): FaceDetectorDiagnostics` to `apps/web/src/domain/ports/face-detector.ts`; in `apps/web/src/infrastructure/detection/mediapipe-face-detector.ts` record, inside `detect()`, the outcome (`face` / `no-face` / `count-mismatch` / `error`), the **landmark count actually received (recorded before the count guard decides)**, and the frame-clock time — three scalars, no points. Extend `apps/web/test/adapters/face-detector-adapter.test.ts` (additive): a mismatching count records the received count and `count-mismatch`; `no-face`; `error`; the status object has no member holding points. *(FR-038, FR-042)*
- [ ] T042 [P] Add `faceAnchors: readonly { effectId; actionType; index; resolved }[]` to `RuntimeFrame` in `apps/web/src/domain/runtime/effect-runtime.ts`, filled in `render()` for each scheduled `faceLandmark` anchor from whether it resolved (`resolution.point !== null`), empty otherwise; no coordinates. Update `apps/web/test/domain/face-runtime.test.ts` (its key-list assertion, additively) and add cases: resolved true with a face, false with none / out-of-range index, empty when nothing face-anchored is scheduled. *(FR-039, FR-042)*
- [ ] T043 Extend `apps/web/src/presentation/debug/diagnostics-panel.ts` with an optional `face` option and a "Face tracking" group per plan Addendum A item 3 (capability, detector, last analysis + age, landmark count with received/expected on mismatch, requested landmarks this frame, analyses in the last second from a sliding count of `faceTracking` frames on the frame clock, frame rate), rendered only when `face.enabled()` is true; every failure line names its stage. **Reading status never calls the detector.** Depends on T041, T042. *(FR-040, 041, 044)* **Repo-check**: find how the editor's debug toggle (`setDebug`, View menu) is exposed so `enabled()` reads it; reuse, do not add a second flag.
- [ ] T044 Wire it in `apps/web/src/editor-main.ts` only: supply the `face` option (capabilities, `faceDetector` presence, `faceDetector?.diagnostics?.()`, the existing debug flag) and pass `snapshot.runtime.faceAnchors` / `faceTracking` into the panel update. Do **not** touch `apps/web/src/main.ts`. Depends on T043. *(FR-040, 044, 045)*
- [ ] T045 [P] Create `apps/web/test/adapters/face-diagnostics-panel.test.ts` (jsdom): each state reads correctly (unavailable / not constructed / ready + none-yet / face found + count / no face / count mismatch with both numbers / error / requested index resolved and not resolved); hidden when debug is off and when no `face` option is given; **the detector's call count is identical with the group hidden vs shown, across ticks, and 0 analyses/s while nothing face-anchored is scheduled**; the sliding "analyses in the last second" rises only on analysis frames. Depends on T043, T044. *(FR-040, 041, 044; BV-8)*
- [ ] T046 [P] Extend `apps/web/test/architecture/face-boundary.test.ts` (additive): the diagnostics panel source and the `FaceDetectorDiagnostics` type contain no coordinate/point/`FaceFrame` member; `main.ts` does not pass the `face` option; the panel's face group is not reachable from Capture Mode. Depends on T041, T043. *(FR-042, 044)*
- [ ] T047 Author-facing runbook and checklist are the deliverables of the spec amendment (`quickstart.md` §G, `checklists/browser-validation.md`); confirm they match the shipped panel labels once T043 is done and correct any drift. Depends on T043. *(FR-043, FR-046)*
- [ ] T048 **Manual, human, NOT automated — after T040's prerequisites (V1–V3) and using the T043 panel for V4**: perform `checklists/browser-validation.md` (BV-1…BV-12, including the production build and the deployed origin), record results, and only then tick T040 and DoD-2…DoD-8. **Do not tick any BV item, V-item, T040 or SC-010 until actually performed.** Depends on T040 prerequisites, T044.


---

## Phase 11: Amendment B — FaceMark debug surface, pipeline telemetry, performance baseline

Also completes Amendment A's T041–T046 in a **different shape** (recorded, not silent): a separate `PipelineSection` under the Diagnostics panel instead of a `face` option inside `DiagnosticsPanel`; a second toggle (D30); resolved points and the mesh are carried (D32) — which supersedes FR-042/D27. T041's adapter status is implemented as specified.

- [X] T049 `FaceDetectorDiagnostics` + optional `diagnostics?()` on the port; `MediaPipeFaceDetector` records outcome / **received count before the guard** / time (three scalars). Tests in `face-detector-adapter.test.ts`. *(= T041, FR-038, FR-048)*
- [X] T050 `RuntimeFrame.faceAnchors` (`FaceAnchorTrace`), filled from what `resolveAnchor` already computes; key-list guard in `face-runtime.test.ts` extended with a shape assertion. *(= T042 + D32)*
- [X] T051 `application/pipeline-telemetry.ts` (`PipelineTelemetry`, tick Hz vs per-stage Hz/ms/skipped); `EditorRuntimeController` times hand, segmentation and face calls it already makes, exposes `snapshot.pipeline`, `snapshot.face`, `lastFaceAnalysis`; cleared on camera detach. *(FR-047, D33)*
- [X] T052 `presentation/debug/pipeline-section.ts` (rate-limited; capability, detector, last analysis incl. count mismatch, per-action landmark → px, per-model cadence) and `face-overlay.ts` (mesh + crosshair at resolved anchor, stale-dropped); `editor-main.ts` wiring, View → "FaceMark Debug", section hidden unless a debug toggle is on. *(FR-048, FR-049, D30, D31; = T043/T044)*
- [X] T053 `test/adapters/facemark-diagnostics.test.ts`: telemetry separates tick Hz from model Hz; **0 detector calls while nothing face-anchored is scheduled however often observed**; resolved landmark px equals the face point × surface size; count mismatch reported with received count; section renders without calling the detector; cleared on detach. *(FR-050, = T045)*
- [X] T054 `test/architecture/facemark-debug-boundary.test.ts`: `main.ts`/`capture-main.ts` never import the debug modules; the domain runtime does not; the section/overlay never call `.detect(`. *(FR-050, = T046)*
- [X] T055 Performance investigation recorded in `research.md` R15 (code-verified facts; strategy proposed, nothing optimised).
- [ ] T056 **Manual, human**: with the model provisioned, follow spec 011's browser runbook with FaceMark Debug on: landmark 33 sits on the expected feature; it follows head movement without a stale lag; File/Edit/View never obstructed; unrelated models unaffected. Not ticked until performed.
- [ ] T057 **Manual, human**: record the R15 [measure] numbers (tick Hz, per-model ms/Hz, with/without a face action, with/without segmentation) and decide which of R15's strategy items 2–5 are justified; each justified item becomes its own task/decision. Not ticked until performed.

