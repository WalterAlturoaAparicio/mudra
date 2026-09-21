# Implementation Plan: Face Landmark Anchors

**Branch**: none created (spec directory resolved via `.specify/feature.json`) | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/011-face-landmark-anchors/spec.md` and `checklists/requirements.md`, under `.specify/memory/constitution.md` v1.10.0 (Principle VI Milestone 4; Principle II).

**Status of this document**: plan only. Nothing was implemented, downloaded, installed or run in a browser. The plan's former "Spec corrections" SC-1…SC-6 have been **promoted into `spec.md`** (D15–D20, FR-015c/d, FR-018a, FR-022a) together with the landmark-count ordering (D21), the Definition of Done (D22) and the absent-model note (D23); **the spec is authoritative and this plan must agree with it**.

## Summary

One numbered face landmark becomes a legal anchor. An author sets an existing `landmark_trail` or `particle_burst` anchor to `{kind: 'faceLandmark', index}`; in the editor, with a camera on and the face model provisioned, the effect follows that point on the face.

Technical approach, all reusing what exists:

- **Capability**: `probeCapabilities` gains one optional third argument (`tryFace`) and returns `faceDetector`; each capability probes in its own `try/catch`; no `face_landmarks` entry unless `tryFace` is supplied. (R2)
- **Domain**: `FaceFrame` + `FaceDetector` + `FaceFrameSource` (framework-free); the face is **not** added to `LandmarkFrame`. (data-model)
- **Anchor**: one new `Anchor` kind, resolved only by `AnchorResolver`; a pure `requiredCapabilityOf(anchor)` supplies the *per-instance* capability requirement used in exactly two existing places (runtime gate, action status). (R3)
- **Lifecycle**: `EffectRuntime.advance(..., faces)` takes a lazy, memoized `FaceFrameSource`; the detector is invoked only when a **scheduled** face-anchored action needs a face, the capability is available, and the controller supplied a source (camera attached). (R7)
- **Detector ownership**: page-scoped, **borrowed** by `EditorRuntimeController`, closed only at `pagehide`; camera attach/detach code is unchanged, so segmentation is unaffected and the face detector cannot inherit the segmenter's reuse-after-close defect. (R1)
- **Model**: a separate, explicit, pinned, SHA-256-verifying script; absent by default; provenance in `assets/readme.md`; **verified by a human protocol (V1–V7) before the feature is considered complete**. (R5, R10)

## Technical Context

**Language/Version**: TypeScript (strict, `noUncheckedIndexedAccess`), Node ≥ 20 tooling, Vite build.

**Primary Dependencies**: `@mediapipe/tasks-vision` **0.10.35** (installed; sole ML runtime). **No dependency added.**

**Storage**: none new. The only persisted face-related datum is the anchor `{kind, index}` inside an existing project document (project schema version stays **1**).

**Testing**: Vitest 2.1.x — `test/domain` (node), `test/adapters` (jsdom), `test/architecture` (source scans). Baseline before this work: **1177 tests, 92 files** passing.

**Target Platform**: current evergreen desktop browsers, editor entry only.

**Project Type**: web application (`apps/web/`), clean-architecture layers (domain / application / infrastructure / presentation).

**Performance Goals**: cost paid only while a face-anchored action is scheduled (demand-gated); no numeric fps target is asserted by an automated test. Real-browser smoothness is manual (SC-010).

**Constraints**: constitution v1.10.0; Canvas2D only; no image readback; face data transient; `src/domain/` framework-free.

**Scale/Scope**: one face, one point anchor kind, two existing consuming actions, editor entry only. ~10 source files touched, ~5 added; ~11 test files added/extended.

## Verification status (what is known, what is not)

| Class | Items |
|---|---|
| **Repository-verified** (read from code/lockfile/`.d.ts` today) | MediaPipe 0.10.35 installed and exposes `FaceLandmarker` with the options/result in research R5 · probe/registry shape and tests · runtime advance/scheduler/diagnostics code · five anchor touch-points · `PROJECT_SCHEMA_VERSION = 1` with strict-equality check and no migration · editor camera/segmenter lifecycle · `assets/*.task` gitignored · `defaultCapabilities().all()` asserted single-entry · shared-plugin emits present models into `dist/` |
| **Must be verified against the pinned artifact (V1–V7)** | source URL validity · SHA-256 · licence · landmark count and indexing · face-model output orientation · timestamp strictness · surface-size interpretation for faces |
| **Assumptions guarded deterministically at runtime** | point count ≠ `FACE_LANDMARK_COUNT` ⇒ no face + warn · per-frame throw ⇒ no face + warn-once · non-increasing timestamps clamped · `numFaces: 1`, blendshape/matrix outputs off · missing model ⇒ capability unavailable. *These guards are safety nets; they do not replace V1–V7.* |

## Constitution Check

*GATE: passed before research; re-checked after design (below).*

| Constitution rule (v1.10.0) | Plan compliance | Gate |
|---|---|---|
| Item 1 — `face_landmarks` capability, probed by construction, independent, inert-and-reported, never simulated; not a recognition system | R2, R3; no synthetic face (R12); face absent from `LandmarkFrame`, matcher, emitter (FR-028) | ✅ |
| Item 2 — reuse the existing MediaPipe runtime; shared asset under `assets/`; provenance; deterministic acquisition; no runtime download; no placeholder dependency; model not pre-selected | Same runtime, no new dependency; separate pinned+hashed script; provenance block; R10 | ✅ |
| Item 3 — framework-free domain abstraction; MediaPipe outside `src/domain/`; layering test extended | `FaceFrame`/`FaceDetector`/`FaceFrameSource`; T01, T16 | ✅ |
| Item 4 — central anchors; actions do no lookup; reuse existing actions; generalized region representation only if needed | One anchor kind through `AnchorResolver`; `landmark_trail`/`particle_burst` unchanged; **no regions** (not needed) | ✅ |
| Item 5 — initial non-mesh family | Only the point-anchor consumer is delivered; the rest deferred | ✅ (subset) |
| Item 6 — mesh not authorized; Canvas2D required; renderer vocabulary unchanged | No renderer/command change | ✅ |
| Principle II restated — no readback/screenshot/recording/serialization/upload/persistence; face data transient; not among v1.8.0 categories; no detection before camera start; not in Capture; spec states when it runs and what the user is told | R7, R8, R13; sentinel + boundary tests; no scan exemption | ✅ |
| Recognition boundary | No face→matcher/events/triggers path exists; structural tests | ✅ |
| Nothing else moves (pose-sample schema, Web Capture, docking, undo/redo) | Untouched; Capture forbidden by test | ✅ |
| Staging — smallest slice, no dormant surface | No unused port/command/action; `faceTracking` flag and `FaceFrameSource` each have a consumer in this slice | ✅ |
| Web standards: typed immutable models, doc comments, config as data, domain tests mandatory, lint/typecheck clean | Applied in every task | ✅ |
| Layering: `requestAnimationFrame` forbidden under `presentation/editor/**`; drawing only via Renderer | Indicator uses `addFrameListener`; no drawing | ✅ |

**Note (2026-09-21)**: the work-breakdown table below uses the plan's original task ids (T01…T18); the executable, renumbered list is `tasks.md` (T001…T040), which follows the spec. Where they differ, `tasks.md` and the spec win.

**Post-design re-check**: no violation introduced. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/011-face-landmark-anchors/
├── spec.md
├── plan.md                                   # this file
├── research.md                               # decisions R1–R14 with evidence
├── data-model.md
├── quickstart.md                             # validation/run guide
├── contracts/
│   ├── runtime-and-probe.md
│   └── face-model-provisioning.md
├── checklists/requirements.md
└── tasks.md                                  # NOT created here (/speckit-tasks)
```

### Source code (`apps/web/`)

```text
src/
├── domain/
│   ├── landmarks/face.ts                     # NEW  FaceFrame, faceFrame(), FaceFrameError, FACE_LANDMARK_COUNT, FaceFrameSource
│   ├── ports/face-detector.ts                # NEW  FaceDetector
│   ├── effects/anchor-capability.ts          # NEW  requiredCapabilityOf(anchor)
│   ├── effects/types.ts                      # +Anchor member 'faceLandmark'
│   ├── effects/anchor-resolver.ts            # +face branch, +optional `face` argument
│   ├── runtime/capabilities.ts               # +FACE_LANDMARKS, +tryFace, +faceDetector
│   ├── runtime/param-schema.ts               # +faceLandmark validation
│   ├── runtime/effect-runtime.ts             # +faces param, per-instance gate, faceTracking
│   └── editor/action-status.ts               # +per-instance capability status
├── infrastructure/
│   ├── detection/mediapipe-face-detector.ts  # NEW  the only face-symbol importer
│   └── effects/catalog-loader.ts             # +parse/serialize faceLandmark
├── application/editor-runtime-controller.ts  # +faceDetector option, faceSourceFor(), 3 advance sites
├── presentation/editor/
│   ├── inspector-controls.ts                 # +faceLandmark kind, index field
│   └── editor-shell.ts                       # +face-tracking indicator, camera help sentence
└── editor-main.ts                            # +tryFace in probe, pass detector, close on pagehide
tools/fetch-face-landmarker.mjs               # NEW  pinned + SHA-256
vite.config.ts                                # +SHARED_MODELS entry, FACE_MODEL_URL
package.json                                  # +"fetch-face-model" script
../../assets/readme.md                        # +provenance row/block

test/
├── domain/  face-frame · capability-face-probe · face-anchors · face-runtime · face-action-status · project-face-anchor
├── adapters/  face-detector-adapter · editor-face-lifecycle · editor-face-indicator · inspector (extend)
├── architecture/  face-boundary (NEW) · layering (extend) · boundaries (extend) · privacy/capture-boundary (assert unchanged)
└── tools/  fetch-face-landmarker
```

**Structure Decision**: follow the existing four-layer layout; every new file has a sibling precedent (`detection/mediapipe-detector.ts`, `ports/segmenter.ts`, `landmarks/types.ts`). **Not touched**: `src/main.ts`, `src/capture-main.ts`, `src/session`, `Stage`/renderer, `LandmarkFrame`, recognition, persistence, docking/undo code, `future-work.md`.

## Spec corrections (found while planning — **PROMOTED into spec.md on 2026-09-21; retained as history**)

None of these expands scope. Mapping to the spec: SC-1 → D15/FR-016 · SC-2 → D16/FR-021 · SC-3 → D17/FR-001–003 · SC-4 → D18/FR-015d · SC-5 → D19/FR-022a · SC-6 → D20/FR-018a. The right-hand column below is the original proposal; the spec's wording governs. (Later: U1 → D24/FR-019a, U2 → FR-015c clarification, U3 → DoD intro/T040.)

| ID | Spec text | Finding | Correction |
|---|---|---|---|
| **SC-1** | FR-016(c) "currently playing effect action" | With `scheduleEntries`, an instantaneous action fires on exactly one frame; a pre-scan would miss it (research R7). | "A face-anchored action is *currently playing* on a frame iff the timeline scheduler schedules it on that frame; detection occurs in the same `advance` call." |
| **SC-2** | FR-021 "a detector *released* when the camera is turned off MUST be usable again" | The plan never releases it on camera off; releasing is terminal in this codebase. | "The face detector's lifetime is the page's; camera attach/detach MUST NOT close it; it is closed only at page teardown." |
| **SC-3** | FR-003 "additive registry entry" / Technical Constraints | `defaultCapabilities().all()` is asserted to be a single entry; and the public experience must not report a probe it never ran. | "The `face_landmarks` entry exists only in a registry built by a probe that was given a face constructor; `defaultCapabilities()` and the public experience's registry are unchanged." |
| **SC-4** | A-5 (assumption) | Confirmed and firmed by evidence: strict-equality version check, no migration ⇒ a bump would reject every existing project. | Promote to a normative requirement: "The project schema version MUST NOT change. A project with a face anchor is rejected by older builds with their existing catalog-invalid error." |
| **SC-5** | (absent) | Timestamps for `detectForVideo` can regress across the three `advance` call sites (research R11). | Add FR-022a: "The face detector adapter MUST present strictly increasing timestamps to the underlying library regardless of caller timestamps." |
| **SC-6** | FR-018 / edge "no camera" | The editor supplies a synthetic *hand* without a camera; the spec is silent on a face. | State: "No synthetic or stand-in face is ever supplied; with no camera a face anchor is unresolved and reported." (R12) |

## Face processing lifecycle — summary

Full table in [research R7](./research.md#r7--face-processing-lifecycle-where-detection-is-invoked). The three conditions are **evaluated per frame, from live state**, not latched, so any condition becoming false stops analysis on that frame:

1. *Camera attached* ⇔ `EditorRuntimeController.camera !== null` (unchanged field) → `faceSourceFor()` returns `null` otherwise.
2. *Capability available* ⇔ `capabilities.has('face_landmarks')`, checked by the runtime **before** the source can be reached.
3. *Face-anchored action scheduled* ⇔ the only place `faceNow()` is called.

Detection is invoked at exactly one site (`EffectRuntime.render()` → `faceNow()` → source → `FaceDetector.detect`). It is guaranteed **not** invoked: at probe/construction; with no camera; with only hand/screen anchors; with the capability missing; after the last face-anchored action leaves its window; after camera detach; in `stop()`/teardown; in Capture Mode and the public experience (they never construct or pass a face source).

## Data-flow / privacy summary

Full trace in [research R8](./research.md#r8--privacy--data-flow-trace). The `FaceFrame` never leaves the stack of `EffectRuntime.render()`; only a `Point` (in `ActionContext.anchor`) and a boolean (`RuntimeFrame.faceTracking`) leave it. It is not in `LandmarkFrame`, `ActionContext`, `RuntimeFrame`, `EditorFrameSnapshot`, `Project`, any repository record, any export, or any network call. **No privacy-scan exemption is added**, and the existing exemption-count assertions (`DOWNLOAD_EXEMPTIONS`/`LABEL_EXEMPTIONS` length 2) must still pass unmodified.

## Test plan (requirement → layer → invariant)

New test files unless noted. "Sentinel" = distinctive coordinates that cannot occur by accident (e.g. `0.123456789`).

| Req | Test file (layer) | Invariant proved |
|---|---|---|
| FR-001, FR-002 | `domain/capability-face-probe` (node) | Probing constructs the face detector; **(seg rejects, face resolves)** → seg false, face true; **(face rejects, seg resolves)** → seg true with the *same* result the pre-existing tests assert, face false; both fail → both false, no throw; each failure logs its own capability. |
| FR-003 | `domain/capability-face-probe` + existing `capabilities.test.ts` / `capability-segmentation.test.ts` **unmodified** | `tryFace` omitted ⇒ `all()` identical to today; `defaultCapabilities()` still single-entry. |
| FR-001 (no processing) | `domain/capability-face-probe` | A fake detector's `detect` call count is **0** after the probe. |
| FR-004, FR-005 | `domain/face-runtime` | Capability missing ⇒ **no commands**, one `capability_unavailable`/`face_landmarks` diagnostic per scheduled entry, no exception, **`faces()` never called**; no fixed position substituted. |
| FR-006 | `domain/face-action-status` | Same action type: face-anchored instance ⇒ `capability_unavailable`; hand-/screen-anchored instance ⇒ `ready`. No branch keyed on action type (scan of `action-status.ts` for `landmark_trail`/`particle_burst`). |
| FR-007 | `adapters/inspector` (extend) | A face anchor can be authored with the capability unavailable. |
| FR-008 | `architecture/face-boundary` | `src/main.ts` and `session.ts` import no face module; the shipped default catalog (`config/effects.json`, located at implementation time) contains no `faceLandmark`. |
| FR-009, FR-013 | `domain/face-frame` | Wrong count / NaN / ±Infinity / non-positive size rejected; a valid frame is deeply immutable-typed; within `face.ts` and the adapter guard the count is referenced only through `FACE_LANDMARK_COUNT` (no repository-wide literal scan — brittle). `FACE_LANDMARK_COUNT = 478` is **provisional** until V4/DoD-5. |
| FR-010 | `domain/face-frame` (fake `FaceDetector`) | `detect` returns `FaceFrame \| null`; `close()` idempotent. |
| FR-011 | `adapters/face-detector-adapter` (jsdom, fake landmarker) | count ≠ N ⇒ `null` + **one** warn; takes `faceLandmarks[0]` only; requested options are exactly `numFaces 1`, blendshapes false, matrices false; no property of the result other than `faceLandmarks` is read (fake's other properties throw on access). |
| FR-012 | `architecture/layering` (extend) | Regex now includes `FaceLandmarker`, `FaceLandmarkerResult`, `NormalizedLandmark` under `src/domain/`. Includes a **mutation check**: a temp string containing `FaceLandmarker` in a fake domain source is flagged. |
| FR-014, FR-015 | `domain/face-anchors` | Resolves `index` to `x*width`, `y*height` from the **face's** size; hand/screen/centroid anchors unchanged (existing `anchors.test.ts` unmodified); face `null` ⇒ hold last, else `face is not in frame`; index beyond points ⇒ report. |
| FR-015 (sole resolver) | `architecture/face-boundary` | Scan `domain/runtime/actions/**` for `.hands`, `faceLandmark`, `FaceFrame`: none. |
| FR-015a | `domain/project-face-anchor`, `domain/config-driven-effects` (extend), `adapters/inspector` (extend) | **Structural** validation everywhere incl. load: non-negative integer only (`-1`, `1.5`, `'3'` rejected; `FACE_LANDMARK_COUNT` and `100000` **accepted** at load). **Model-range** validation at authoring only (Inspector rejects `> FACE_LANDMARK_COUNT − 1`, message names the range). Catalog and project round-trip identical. |
| FR-015c | `domain/face-anchors` | An index absent from the detected face resolves to **no point**, is reported via the existing unresolvable rule (hold last if any, else skip + report), never clamped/wrapped/remapped, and does not throw. |
| FR-015d | `domain/project-face-anchor` | `PROJECT_SCHEMA_VERSION === 1`; v1 fixtures still parse; a face project serializes at version 1 with only `{kind, index}`; an unknown kind (`faceRegion`) is rejected with a message listing valid kinds (the property that makes older-build rejection real). |
| FR-015b | `domain/face-runtime` | The **registered** `landmark_trail` and `particle_burst` descriptors produce output at the face landmark's pixel position when given a face anchor. That neither action file changed is a reviewer check on `git diff` (no source-hash test — it would be brittle). |
| FR-016, FR-017, FR-034 (lifecycle) | `adapters/editor-face-lifecycle` (jsdom, real `EditorRuntimeController` + real `EffectRuntime` + fake camera/detectors) | Fake `FaceDetector` counts calls. **0** before camera attach · **0** while only hand-anchored effects play · **≥1 per tick** while a face-anchored action is scheduled · **0** on the tick after it leaves its window · **0** after `detachCamera()` even if an effect is still playing · **0** when capability false · **0** in `stop()` · at most **1** call per `advance`. Asserted per tick, not just in aggregate. |
| FR-016 (instant action) | same | An instantaneous-at-0 `particle_burst` fires *with* a face on its first frame (detector called in that same `advance`). |
| FR-034 (switching) | same | Edit anchor face→hand mid-playback ⇒ calls stop next tick; hand→face ⇒ calls start next tick. |
| FR-018 | `architecture/face-boundary` + lifecycle | Capture entry point and every path in `CAPTURE_PATHS` reference no face type/URL; no face source without a camera. |
| FR-018a | `adapters/editor-face-lifecycle`, `domain/face-runtime` | With no camera attached a face anchor is unresolved and reported; no stand-in face is ever produced (asserted by the absence of any face source and of any fixed point in the output). |
| FR-019, FR-019a, FR-020, SC-003 | `adapters/editor-face-indicator` | *on* iff analysis ran on that frame; after the last analysis frame *finished* (distinct text, never *on*) for exactly `FACE_INDICATOR_HOLD_MS` then hidden; **zero** detector calls during the hold; a second analysis frame in the hold restarts it with no timers (`vi.getTimerCount() === 0`); config-only face anchor ⇒ always hidden; help-text sentence present; text passes the capture-label scan. |
| FR-021 (camera off/on ×10) | `adapters/editor-face-lifecycle` | After 10 attach/detach cycles the **same** detector instance still yields anchored output; the detector's `close` count is **0** until teardown; and segmentation behaviour in the same harness is **byte-identical** to a baseline harness run (segmenter `close` still called once per detach — i.e. unchanged). |
| FR-021 (Close Project → reopen) | same | A second controller built with the same detector works. |
| FR-022 | `adapters/face-detector-adapter` | A throwing landmarker ⇒ `null`, frame loop continues, exactly one warn per consecutive-failure streak, resets after a success. |
| FR-022a (SC-5) | `adapters/face-detector-adapter` | Timestamps `[100, 100, 90, 250]` reach the fake as strictly increasing. |
| FR-023 | `architecture/boundaries` (extend) | `vite.config.ts` has the `SHARED_MODELS` entry and `resolve(REPO_ROOT,'assets'…)`; `apps/web/public/` and `apps/web/assets/` contain **no** copy; the adapter's `FACE_MODEL_URL` equals the config URL; **does not assert the file exists**. |
| FR-024, FR-025 | `tools/fetch-face-landmarker` (node) + `architecture/boundaries` | Hash helper: matching file accepted, one flipped byte rejected and removed, truncated file rejected, `.part` never survives; script refuses to install while `EXPECTED_SHA256 === null`; `package.json` script exists and **`fetch-models` still equals its current value**; readme has a provenance block with every required field name. *(Implementer must confirm how `.mjs` is imported under `tsc --noEmit` — `allowJs`/a `.d.mts` sidecar — before choosing; do not loosen `tsconfig`.)* |
| FR-026 | `architecture/boundaries` + build | With no model file: `npm run build` still succeeds (warning only). |
| FR-027 | `architecture/privacy` (unchanged) + `architecture/face-boundary` | Global scans pass over new files; adapter contains no `fetch(` with an external origin and no `http` literal (the model URL is same-origin path). No new dependency: `package.json` `dependencies` deep-equals its pre-change value. |
| FR-028 | `architecture/face-boundary` | `domain/recognition/**`, `domain/events/**`, `domain/normalization/**`, `application/session.ts`, `application/capture-controller.ts` and `domain/landmarks/types.ts` contain no `Face` token; `LandmarkFrame`'s property list equals its pre-change list. |
| FR-029 | `architecture/face-boundary` (+ type-level) | The `ActionContext` interface text contains no `face`/`Face`; a `// @ts-expect-error` line asserting `context.face` does not exist. |
| FR-030 | `domain/project-face-anchor` | **Sentinel**: run a face frame with sentinel coordinates through the runtime with a face-anchored effect, then `serializeProject` and `JSON.stringify` the project *and* every diagnostic/`RuntimeFrame`: none of the sentinel digits appear; the anchor `{kind,index}` does. Architecture scan: persistence/`project-schema`/`catalog-loader` name no `FaceFrame`/`FaceDetector`. |
| FR-031 | `architecture/face-boundary` (+ existing `capture-boundary`) | No `CAPTURE_PATHS` file mentions `Face`, `face_landmarks`, `face-detector`, or `FACE_MODEL_URL`; `capture-main.ts` does not import `mediapipe-face-detector`. |
| FR-032 | `architecture/face-boundary` | `main.ts`/`session.ts` free of face imports; default catalog has no face anchor. |
| FR-033 | `architecture/privacy` **unmodified** | Suite passes; exemption arrays still length 2; new files scanned. |
| FR-035 | `domain/capability-face-probe` + `domain/face-runtime` | Independence both directions; inert-and-reported. |
| FR-036 | `domain/face-anchors` | The asymmetric fixture of research R9 (idx 1→(320,432), idx 2→(1024,216)); `x(1)<x(2)`, `y(1)>y(2)`. |
| FR-037 | full suite | All 1177 baseline tests pass **with no test file weakened** (reviewer checks `git diff` of pre-existing test files is additive only). |
| FR-037a, SC-001 | `architecture/face-boundary` | `SHIPPED_ACTIONS` types equal exactly the six shipped today; existing `registry-completeness`/`capabilities` suites unmodified. |
| Definition of Done | manual + `tools/fetch-face-landmarker` + `architecture/boundaries` | DoD-1…DoD-8: gates pass; provenance/pinned source/SHA-256/licence/count recorded; `EXPECTED_SHA256` non-null; V1–V7 recorded; SC-010 run. Automated tests cannot satisfy DoD-2…DoD-7 by themselves. |
| Schema compat (R4) | `domain/project-face-anchor` | `PROJECT_SCHEMA_VERSION === 1`; v1 fixtures still parse; face project has version 1; an unknown kind (`faceRegion`) is rejected with a message listing valid kinds. |
| Missing-face | `domain/face-anchors` + lifecycle | No-face frame ⇒ hold last; never resolved ⇒ skipped + `face is not in frame`; camera-less ⇒ same. |
| Non-face regression | existing suites unmodified + `domain/face-runtime` | An effect with hand/screen anchors and `faces = null` yields identical output to before (golden comparison against a run of the pre-change code path is unnecessary — existing effect-runtime/anchors/particles tests cover it). |
| Model integrity/provenance | manual V1–V7 + tools test | See protocol below. |

## Model verification protocol (V1–V7)

A **human** step at provisioning time. It is a completion criterion for the feature, **not** for the automated gates. Nothing is downloaded by the plan or by any test. Record each result in `assets/readme.md` and update spec A-3/A-4.

| # | Verify | How | Pass condition |
|---|---|---|---|
| V1 | Provenance / URL | Run the script with `EXPECTED_SHA256 = null`; it prints the resolved URL, HTTP status, byte size | HTTP 200; URL equals the pinned constant; no redirect off `storage.googleapis.com` |
| V2 | Integrity hash | Independently compute `sha256sum assets/face_landmarker.task`; compare with the script's printed hash; pin it | Two hashes agree; pinned as `EXPECTED_SHA256`; re-run installs cleanly; corrupt one byte ⇒ script rejects |
| V3 | Licence | Read the official model card for this exact model/version; record licence name + link + date | Licence permits project use; if not, **stop** and raise it (blocking) |
| V4 | Landmark count & indexing | Local, uncommitted: temporarily log `result.faceLandmarks[0].length` from the adapter in a dev session with a face in view | Set `FACE_LANDMARK_COUNT` to the **observed** value (correcting the provisional 478 if it differs); record it in `assets/readme.md` and A-4. Only then is it the authoring/runtime/guard boundary. Persisted data never depended on it (D21). **Never** ship with the guard silently dropping every frame |
| V5 | Orientation + surface size | Editor dev session, camera on, face-anchored `landmark_trail` at index 1 then at 33 and 263 | Trail sits on the real feature on the mirrored view (no left/right or up/down inversion); x(33) > x(263) for a frontal face **or** the observed relation is recorded as the truth; coordinates scale to the surface (no offset at non-square sizes) |
| V6 | Timestamp semantics | Repeatedly press Test Trigger while a face effect plays; watch the console | No "monotonically increasing" errors; adapter clamp warns nowhere |
| V7 | Privacy at runtime | DevTools Network + Application tabs during a face session | No request other than the model GET; no IndexedDB/localStorage write containing face values; `face_landmarker.task` served same-origin |

Failure of V1–V3 blocks the feature; failure of V4–V6 is a fix in the adapter/constant, not a reason to weaken the guards.

## Implementation work breakdown (input to `/speckit-tasks`)

Order is dependency order. **Files** are exact; **Deps** are task ids; **Reqs** reference the spec; **Verify** lists tests; **Repo-check** flags something the implementer must read first.

| ID | Change (file) | Why | Deps | Reqs | Verify | Repo-check |
|---|---|---|---|---|---|---|
| **T01** | `src/domain/landmarks/face.ts` (new): `FACE_LANDMARK_COUNT`, `FaceFrame`, `faceFrame()`, `FaceFrameError`, `FaceFrameSource`. `src/domain/ports/face-detector.ts` (new): `FaceDetector`. | Framework-free value + port mirroring `landmarks/types.ts` and `ports/segmenter.ts` | — | FR-009, 010, 013 | `face-frame` | Mirror `handLandmarks`/`LandmarkError` style incl. doc comments |
| **T02** | `src/domain/runtime/capabilities.ts`: `FACE_LANDMARKS`; `probeCapabilities` third optional `tryFace`, independent try/catch, return `faceDetector`. | Independent probe; additive | T01 | FR-001–003, 035 | `capability-face-probe`; existing capability tests unmodified | Update the two callers **only** in T13 (editor); leave `main.ts` untouched — destructuring still works |
| **T03** | `src/domain/effects/types.ts` (+`faceLandmark`), `src/domain/effects/anchor-capability.ts` (new). | The anchor kind and the per-instance requirement (R3) | T01, T02 | FR-014, 004 | `face-anchors`, `face-runtime` | grep `handCentroid` to confirm the five touch-points are still the only ones |
| **T04** | `src/domain/runtime/param-schema.ts`: accept `faceLandmark`; **structural** validation only (non-negative integer) — no model-range check at load (D21); handle absence of `hand`. | Loading must not depend on an unverified model fact | T03 | FR-015a, 015d | `project-face-anchor`, `config-driven-effects` (extend) | `validateAnchor` reads `.hand` for non-screen kinds — branch first |
| **T05** | `src/infrastructure/effects/catalog-loader.ts`: `parseAnchor`, `serializeAnchor` (+error text listing the new kind). | Wire form; exhaustive-switch compile check | T03 | FR-015a | `project-face-anchor` round-trip | Error string listing valid kinds is asserted by existing tests — update the *expected* text only if a test pins it, and record that as an additive test edit |
| **T06** | `src/domain/effects/anchor-resolver.ts`: `resolve(..., face = null)`; face branch before the hand lookup. | Sole resolver | T03 | FR-014, 015, 036 | `face-anchors`; existing `anchors.test.ts` unmodified | Use `face.width/height`; keep `lastKnown` semantics |
| **T07** | `src/domain/runtime/effect-runtime.ts`: `advance(..., faces)`, `render` lazy memoized `faceNow`, per-instance capability gate, pass `face` into `resolveAnchor`, `RuntimeFrame.faceTracking`. | The single detection call site + R3 flow | T02, T03, T06 | FR-004, 005, 016, 017, 029 | `face-runtime`; existing runtime suites unmodified | Confirm `startEffect`/`advance` are the only entry points; confirm `RuntimeFrame` consumers tolerate an added field (`frame-output.ts`) |
| **T08** | `src/domain/editor/action-status.ts`: per-instance capability status. | Inspector/timeline/tree badges | T03 | FR-006 | `face-action-status`; existing `action-status.test.ts` unmodified | Keep "no branch keyed on action type" |
| **T09** | `src/infrastructure/detection/mediapipe-face-detector.ts` (new): `FACE_MODEL_URL`, `DEFAULT_FACE_DETECTOR_CONFIG`, adapter class over a structural landmarker interface, `createMediaPipeFaceDetector`. | Sole MediaPipe-face importer; guards (count, throw, clamp) | T01 | FR-011, 022, 022a, 027 | `face-detector-adapter` | **Read `test/adapters/mediapipe-person-segmenter.test.ts` and `mediapipe-detector.ts` first** and follow their injection/`DetectorError` conventions |
| **T10** | `src/application/editor-runtime-controller.ts`: `faceDetector` option (borrowed), `faceSourceFor(nowMs)`, pass to the three `advance` calls; `AttachedCamera`/`attachCamera`/`detachCamera` **untouched**. | Ownership + lifecycle (R1, R7) | T01, T07 | FR-016–018, 021 | `editor-face-lifecycle` | Re-read the three call sites (`tick`, `testTrigger`, `advanceAndPresent`) before editing; `stop()` must not close the detector |
| **T11** | `src/presentation/editor/inspector-controls.ts`: `faceLandmark` in `ANCHOR_KINDS`, kind switch default `{kind, index: 0}`, index field, no hand selector for it. | Authoring | T03 | FR-015a, 007 | `inspector` (extend) | The current code assumes every non-screen anchor has `.hand` |
| **T12** | `src/presentation/editor/editor-shell.ts`: indicator with `FACE_INDICATOR_HOLD_MS` (500) and `reflectFaceTracking(snapshot)` (frame-clock hold, no timers); camera help sentence. | FR-019/019a/020, D24 | T07 | FR-019, 019a, 020 | `editor-face-indicator` | Confirm where camera-control help text lives; no `requestAnimationFrame` under `presentation/editor/**` |
| **T13** | `src/editor-main.ts`: pass `() => createMediaPipeFaceDetector({ wasmPath: WASM_PATH })` as `tryFace`; give `faceDetector` to the controller; close it on `pagehide` after `stop()`. **Do not** change the segmenter lines. | Only entry that probes/holds it | T02, T09, T10, T12 | FR-001, 008, 018, 021 | `face-boundary` (main not touched); manual V-steps | The `pagehide` handler is registered once per page, not per mount — put the close there only |
| **T14** | `tools/fetch-face-landmarker.mjs` (new); `package.json` `fetch-face-model`; `vite.config.ts` `SHARED_MODELS` + `FACE_MODEL_URL`. | Provisioning + serving | — | FR-023–026 | `tools/fetch-face-landmarker`, `boundaries` (extend) | Decide `.mjs` typing approach without loosening `tsconfig`; `EXPECTED_SHA256 = null` initially (V2 pins it) |
| **T15** | `assets/readme.md`: table row + provenance block ("not yet provisioned"). | FR-025 | T14 | FR-025 | `boundaries` (field names) | — |
| **T16** | Tests: `face-boundary` (new), `layering` (extend regex), `boundaries` (extend), plus every file in the Test plan not already created above. | Boundary proofs | T01–T15 | FR-012, 028–033, 037 | all | Never edit an existing assertion to weaken it |
| **T17** | Gates: `npm run typecheck`, `lint`, `test`, `build` (with the model **absent**). | FR-026, SC-009 | T01–T16 | SC-009 | — | Baseline 1177 tests |
| **T18** | **Manual**: provision the model; execute V1–V7; record results (readme, spec A-3/A-4); SC-010 pass. | Truth about the model and the browser | T14, T17 | SC-010 | human | Do not mark verified without doing it |

Parallelizable after T01: T02∥T03∥T09∥T14. T04/T05/T06/T08/T11 follow T03. T07 needs T02/T03/T06. T10 needs T07. T13 last among code tasks.

## Explicitly not in this plan

Regions/masks/`faceRegion`; blendshapes; transform matrices; new actions/commands/renderer changes; multi-face; synthetic face; public experience; Capture Mode; recognition/identity/biometrics/attributes/expression/triggers; mesh/WebGL/WebGPU; segmenter repair; retrofitting hashes to the segmenter script; docking/tabs/undo/redo; `future-work.md` A.9 (documentation follow-up already recorded in the spec); the untracked capture ZIP and the modified spec-010 quickstart.

## Contradictions and open points to resolve before `/speckit-implement`

1. ~~**SC-1 … SC-6** above~~ — **resolved**: promoted into the spec on 2026-09-21 (see the mapping under "Spec corrections"). The analysis findings I1–I5, D1, E1, E2, B1, G1 are also resolved in the spec (D15–D23, FR-015a/c/d, FR-018a, FR-021, FR-022a, FR-026, FR-037a, Definition of Done, SC-001, SC-010).
2. **Separate, out-of-scope defect confirmed** — the page-scoped segmenter is closed by `detachCamera()`/`stop()` and re-handed on the next attach or the next mounted controller (R1). Track as its own issue; Spec 011 is designed to be independent of it.
3. **Shared plugin ships a present face model in every build's `dist/`** (R10) — accepted; revisit only if payload matters.
4. **`boundaries.test.ts` already asserts the segmentation model file exists** (fails on a fresh checkout) — pre-existing; the face equivalent deliberately does not.
5. **No agent-context file/script exists** (`CLAUDE.md`, `update-agent-context.sh` absent) — the workflow's "update agent context" step was skipped as not applicable.
6. **V1–V7 are unrun.** The model URL, hash, licence, landmark count, orientation and timestamp behaviour remain unverified facts; automated green gates do **not** imply them.
7. **`.mjs` under strict `tsc --noEmit`** — implementer must choose a typing approach for the hash-helper test that does not loosen `tsconfig` (T14).

---

## Addendum A — Browser-validation slice (2026-09-21)

Decision and scope live in the spec's **Amendment A** (D25–D29, FR-038–FR-046, BV-1…BV-12). This addendum is only the design.

**What is reused (no new mechanism):** Palette and Inspector authoring of `faceLandmark` (exists); `landmark_trail` as the validation action (exists, continuous); the editor's Diagnostics panel and debug toggle; `RuntimeFrame`/`EditorFrameSnapshot` as the per-frame carrier; the existing frame clock for ages and rates.

**Design:**

1. *Adapter status (FR-038).* `FaceDetector` gains an **optional** `diagnostics?(): FaceDetectorDiagnostics` where `FaceDetectorDiagnostics = { outcome: 'none-yet' | 'face' | 'no-face' | 'count-mismatch' | 'error'; pointCount: number | null; atMs: number | null }`. `MediaPipeFaceDetector` sets it inside `detect()` — after the guard it already has, recording `first.length` **before** deciding — so a count mismatch is visible with the received count. It holds three scalars; no points.
2. *Runtime summary (FR-039).* `RuntimeFrame.faceAnchors: readonly { effectId; actionType; index; resolved }[]` filled in `render()` from what `resolveAnchor` already computes for a `faceLandmark` anchor (`resolution.point !== null`). No coordinate leaves. Existing test that pins `RuntimeFrame`'s key list is updated additively.
3. *Panel (FR-040/041/044).* `DiagnosticsPanel` gets an optional `face` option `{ capabilities, detectorState: () => 'ready'|'not-constructed', status: () => FaceDetectorDiagnostics | undefined, enabled: () => boolean }` supplied only by `editor-main.ts`; `update()` additionally receives the frame's `faceAnchors` and `faceTracking`. "Analyses in the last second" is a sliding count of frames with `faceTracking === true` over the frame clock. **Reading `status()` never calls `detect`.** The group renders only when `enabled()` (the existing debug toggle) is true. The public `main.ts` constructs its panel without the `face` option.
4. *Wiring (`editor-main.ts`).* Pass the option; the closures read the page-scoped `faceDetector`'s `diagnostics?.()` and `capabilities`. No new listener beyond the existing per-frame `onFrame`.
5. *Docs/tests.* Runbook (quickstart §G), manual checklist, and tests: adapter status (count mismatch records the received count; never holds points), runtime summary (resolved true/false; empty when none scheduled), panel (states/texts; hidden when debug off; hidden without the `face` option; **detector call count identical with the group hidden vs shown**; 0 analyses/s while idle), architecture (diagnostics module and status type have no coordinates/`FaceFrame`; public/Capture do not construct the option).

**Constitution check for the addendum:** geometry-only and transient (booleans/counts/indexes only); nothing persisted or transmitted; no readback; face analysis still only per FR-016; Canvas2D unchanged; no new action, command or anchor; no recognition input; editor-only; the diagnostics never cause analysis (D26). ✅

**Risk noted:** the group can only be *trusted* if the adapter's count is recorded before the guard drops the frame (item 1) — otherwise a wrong `FACE_LANDMARK_COUNT` is again indistinguishable from "no face".
