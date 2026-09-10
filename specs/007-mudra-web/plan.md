# Implementation Plan: Mudra Web — Pose-Driven Effect Runtime

**Branch**: `007-mudra-web` (not yet created — see Notes) | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-mudra-web/spec.md`

## Summary

Build the smallest browser application that proves one interaction end to end: **camera → landmarks →
recognition → pose event → effect runtime → render commands → Canvas2D → visible effect.**

The technical approach in one sentence: a **framework-free TypeScript domain** (normalization,
matching, stability, pose events, effect runtime) that is fully testable in Node with no browser,
wrapped by thin infrastructure adapters (MediaPipe Tasks Vision, camera, assets) and a Canvas2D
renderer that is the only component permitted to draw.

Three decisions carry the milestone:

1. **One mirrored surface.** The camera frame is mirrored exactly once, into a single canvas that is
   simultaneously what MediaPipe analyses and what the user sees. Presentation and recognition cannot
   disagree because they are literally the same pixels — the structural answer to the spec's
   highest-risk correctness requirement (FR-013).
2. **The runtime emits, the renderer draws.** Each frame the effect runtime returns a declarative
   frame output (render commands + audio cues) and touches no drawing API. This is what makes the
   runtime testable headlessly and the renderer replaceable (constitution v1.6.0).
3. **Everything the browser needs is derived from the dataset.** Pose identities, display names, and
   hand requirements are all present in the pose-sample JSON — verified 17/17 — so Web reads no other
   application's configuration.

## Technical Context

**Language/Version**: TypeScript 5.x, targeting ES2022, `strict` enabled

**Primary Dependencies**: `@mediapipe/tasks-vision` (hand landmark detection). No UI framework, no
rendering engine, no state library, no math library.

**Storage**: None. Read-only consumption of a build-time exemplar bundle. Nothing is written at
runtime — no `localStorage`, no `IndexedDB`, no network writes (FR-005–FR-008).

**Testing**: Vitest. Domain suites run in the `node` environment with no DOM; the small number of
adapter tests use a `jsdom` environment with fakes.

**Target Platform**: Current evergreen desktop browsers (Chromium, Firefox, Safari) with camera access.

**Project Type**: Single-page browser application at `apps/web/`, built with Vite.

**Performance Goals**: ~30 fps sustained end to end; recognition latency ≤ 200 ms; effect visible
within 200 ms of its triggering event (FR-092–FR-096, SC-004/005).

**Constraints**: No WebGL/3D, no worker architecture unless profiling proves need (FR-097); exemplar
bundle ≤ 2 MB (SC-009); no source imports from Engine or Capture (FR-098); the shared model asset must
not be copied into the application tree (FR-101).

**Scale/Scope**: 18 catalog poses / 17 eligible / 3–5 active; ~2,300 exemplar hands; 4 action types;
3–4 shipped effect definitions; one screen plus a debug overlay.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v1.6.0**.

| Gate | Status | Evidence |
|---|---|---|
| **I — Architecture-First & Modular Boundaries** | ✅ PASS | Four layers, dependencies inward only. Camera, detection, assets, audio, and clock are all interfaces; concrete adapters are injected at one composition root. No global mutable state — the session owns its state and is constructed, not imported. |
| **II — Coordinates, Never Images** | ✅ PASS | No persistence of any kind. FR-005–FR-008 forbid writing frames, images, or video; the renderer draws to a canvas that is never read back or exported. An automated check asserts no storage or upload API is referenced (see contracts/privacy.md). |
| **III — Extensibility by Design** | ✅ PASS | The matcher sits behind a strategy interface; action types are registered, not switched; poses are identified by `pose_id` throughout. The active pose set is a runtime input, leaving the future "experience" grouping reachable without implementing it (FR-024d). |
| **IV — Typed, Modeled, Clean Code** | ✅ PASS | TypeScript `strict`, no `any`, readonly value objects with no untyped object literals, doc comments on public API. Vitest covers normalization, matching, stability, event lifecycle, timeline scheduling, and serialization — the logic the pipeline depends on. |
| **V — Centralized Configuration & Observability** | ✅ PASS | Every tunable (thresholds, weights, hold duration, active pose set, radii, budgets) lives in one validated configuration module. Structured logging with per-frame diagnostics at debug level only, never at info — the engine's real-time-loop rule restated. |
| **VI — Scope Discipline** | ✅ PASS | Exactly the Milestone 1 surface. No editor, no segmentation, no WebGL, no gameplay, no ML, no backend, no accounts, no UGC. `person_visibility` is reserved as an inert, observable capability gap (FR-076/FR-077) and introduces no dependency. |
| **VI — Effects MUST be data, not code paths** | ✅ PASS | Effects load from a validated catalog. An automated test asserts no pose identifier or effect name appears as a literal in runtime source (contracts/effect-catalog.md). |
| **VI — The effect runtime MUST NOT draw** | ✅ PASS | The runtime's only output is a frame output value. An automated test asserts the domain imports no browser drawing API and that the runtime is exercisable with no canvas present. |
| **Web standards subsection** | ✅ PASS | TypeScript + browser APIs behind interfaces; MediaPipe Tasks Vision behind a replaceable detection interface; clean layers; typed immutable models; data-driven configuration; domain tests; clean type-check and lint; Mudra-owned assets only. |
| **Monorepo — no app-to-app source imports** | ✅ PASS | Web imports nothing from Engine or Capture. Verified structurally: pose identity, display name, and hand requirements are all derived **from the dataset**, confirmed 17/17 against the catalog, so Capture's configuration is never read. |
| **Monorepo — shared binary assets shared, not vendored** | ✅ PASS | `assets/hand_landmarker.task` is referenced from the repository-level `assets/` directory; it is copied only into build output, never into `apps/web/` source, and never committed a second time. |
| **Monorepo — cross-language ports verified by golden fixtures** | ✅ PASS | Normalization, distance/matching, and the schema mapping are ported to TypeScript and verified against fixtures generated from Engine's own implementation, following the `scripts/export_capture_fixtures.py` precedent. |

**Result: PASS — no violations, no entries required in Complexity Tracking.**

Re-check after Phase 1 design: **PASS**. The design added no dependency, no layer, and no scope. The
one design decision that touched a constitutional boundary — how the browser learns each pose's hand
requirement — was resolved *away* from a boundary violation (deriving from the dataset) rather than
toward one (reading Capture's catalog).

### Re-check against the delivered code (T105)

Run after implementation, against what was actually built rather than what was planned. **Result:
PASS.** Each row names the check that would fail if the claim stopped being true, because a gate
re-affirmed by reading is a gate that decays.

| Gate | Status | Evidence in the delivered code |
|---|---|---|
| **I — Architecture-First & Modular Boundaries** | ✅ PASS | Camera, detector, matcher, stage, audio, clock, and the frame scheduler are all interfaces injected at `src/main.ts`. `test/support/fake-session.ts` assembles a whole session from fakes with no production support, which is the practical proof. No module-level singleton exists. |
| **II — Coordinates, Never Images** | ✅ PASS | `test/architecture/privacy.test.ts` (8 assertions) scans for every storage, readback, and upload API. Verified live in Chrome: storage empty on all four surfaces, 58 requests all GET and all same-origin, 2 interactive controls in the entire application. |
| **III — Extensibility by Design** | ✅ PASS | `PoseMatcher`, `HandDetector`, `CameraSource`, `CapabilityRegistry` are interfaces. Actions register rather than switch; `test/domain/registry-extensibility.test.ts` registers a *new* action through the production registry and watches it get scheduled. |
| **IV — Typed, Modeled, Clean Code** | ✅ PASS | `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; `tsc --noEmit` and ESLint clean, `no-explicit-any` as an error. 346 tests across 30 files. |
| **V — Centralized Configuration & Observability** | ✅ PASS | Every tunable lives in `SessionConfig`; `test/domain/config.test.ts` asserts the thresholds and rejects unknown keys, out-of-range values, and unknown pose ids at load. `logger.ts` keeps per-frame diagnostics at debug level. |
| **VI — Scope Discipline** | ✅ PASS | No editor, no segmentation, no WebGL, no gameplay, no ML, no backend, no accounts, no UGC. `person_visibility` ships inert and reported; `test/domain/capabilities.test.ts` asserts it produces nothing *even if the capability were declared available*. |
| **VI — Effects MUST be data, not code paths** | ✅ PASS | `test/architecture/no-hardcoded-effects.test.ts` scans runtime and presentation source for all 18 pose ids and every catalog effect id and name, and for a `switch` on action type. `test/domain/config-driven-effects.test.ts` changes colour, timing, anchor, and adds an effect, through the production loader. |
| **VI — The effect runtime MUST NOT draw** | ✅ PASS | `test/architecture/layering.test.ts` asserts `src/domain/**` names no browser global, no canvas call, no MediaPipe symbol, and no `node:` import — **and** that `src/presentation/**` does draw, so the claim cannot pass vacuously. `test/domain/effect-runtime.test.ts` asserts a full `FrameOutput` sequence headlessly. |
| **Web standards subsection** | ✅ PASS | TypeScript + browser APIs behind interfaces; MediaPipe behind `HandDetector`; four layers with dependencies inward; `npm run typecheck` and `npm run lint` clean; assets synthesized by the project, provenance recorded in `apps/web/assets/README.md`. |
| **Monorepo — no app-to-app source imports** | ✅ PASS | `test/architecture/boundaries.test.ts` asserts no import from a sibling application, no path into one *in any file including comments*, and no mention of `pose_catalog`. The `required_hands` derivation was verified against Capture's catalog at **17 of 17**. |
| **Monorepo — shared binary assets shared, not vendored** | ✅ PASS | `assets/hand_landmarker.task` is streamed in dev by a Vite middleware and emitted into `dist/` at build. The boundary test asserts no copy exists under `apps/web/public/` or `apps/web/assets/`. |
| **Monorepo — cross-language ports verified by golden fixtures** | ✅ PASS | Normalization agrees with Engine within `1e-9` across 7 cases; matching agrees within `1e-5` relative across 8 probe cases computed over float32-quantized exemplars. Both generated by `scripts/export_web_fixtures.py` from Engine's own implementation. |

**Two deviations from the plan, both recorded rather than absorbed:**

1. **The softmax temperature was calibrated, not guessed.** The plan left it unspecified. Left at an
   arbitrary value the confidence floor would have been meaningless — at a low temperature every frame
   reports ~1.0 for whatever pose is nearest, so FR-026 could never reject anything. It was chosen by
   leave-one-out over the recorded dataset (8.0: 158/160 correct while rejecting 53/72 off-set
   probes). The floor and the ambiguity margin were **not** touched (FR-028).
2. **Three measurements are absent, not estimated.** Sustained frame rate on a real camera,
   trigger-to-first-paint, and the SC-002 reliability trial all need a webcam and a person; this
   machine has neither. They are listed as unmeasured in `apps/web/README.md` with instructions,
   rather than filled in with plausible numbers.

**No violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/007-mudra-web/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── engine-consumption.md   # What the build scripts consume from Engine
│   ├── exemplar-bundle.md      # Build-time bundle format + determinism
│   ├── effect-catalog.md       # The data-driven effect schema
│   ├── render-commands.md      # Runtime → renderer vocabulary
│   └── privacy.md              # The no-persistence contract and how it is enforced
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── public/
│   └── (build-time staging only; no committed copy of the shared model)
├── assets/                        # Mudra-owned experience assets
│   ├── audio/
│   └── images/
├── config/
│   ├── effects.json               # The effect catalog (data, not code)
│   └── session.json               # Active pose set + tunables
├── src/
│   ├── domain/                    # Framework-free. No DOM, no MediaPipe, no canvas.
│   │   ├── landmarks/             # Landmark, HandLandmarks, LandmarkFrame, topology
│   │   ├── normalization/         # Translation-scale port (golden-fixture verified)
│   │   ├── recognition/           # Exemplars, weights, matcher, softmax, gates
│   │   ├── events/                # Stability tracking, pose lifecycle events
│   │   ├── effects/               # Definitions, triggers, conditions, timeline, anchors
│   │   ├── runtime/               # Effect runtime, action registry, frame output
│   │   └── config/                # Validated configuration + defaults
│   ├── application/               # Session orchestration; wires the pipeline per frame
│   ├── infrastructure/            # Camera, MediaPipe detector, bundle/asset/audio loaders
│   └── presentation/              # Canvas2D renderer, stage, debug overlay, shell
└── test/
    ├── domain/                    # Node environment, no DOM
    ├── fixtures/                  # Golden fixtures generated from Engine
    ├── architecture/              # Boundary and layering assertions
    └── adapters/                  # jsdom + fakes

scripts/
├── export_capture_fixtures.py     # (existing, untouched)
├── export_web_fixtures.py         # NEW — golden fixtures for the TypeScript ports
└── export_web_exemplars.py        # NEW — the browser exemplar bundle

assets/
└── hand_landmarker.task           # (existing, shared — referenced, never copied into apps/web/)

README.md                          # Monorepo table + folder structure gain apps/web/ (approved)
```

**Structure Decision**: A single browser application at `apps/web/`, using the same inward-pointing
four-layer split the constitution mandates for web applications and that Capture already follows. The
`domain/` directory is the load-bearing choice: it holds every rule the milestone must prove and
imports nothing from the browser, which is what allows the interesting logic to be tested with
`vitest --environment node` and no display, mirroring how Studio's scene-plan rules are asserted
without Qt. The two new scripts live in the repository-level `scripts/` directory rather than inside
`apps/web/`, because they run under Python against Engine — placing them in the web application would
put a Python dependency inside a TypeScript app and blur the boundary the constitution draws.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

## Phase Summary

| Phase | Output | Status |
|---|---|---|
| 0 — Research | [research.md](./research.md) — 14 decisions, all NEEDS CLARIFICATION resolved | ✅ Complete |
| 1 — Design & Contracts | [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md) | ✅ Complete |
| 2 — Tasks | [tasks.md](./tasks.md) — 112 tasks across 7 phases | ✅ Complete |

## Notes

- **No git branch was created.** The workflow delegates branch creation to a `before_specify` git
  extension hook, which is not installed in `.specify/extensions.yml`. The working tree currently
  carries three unrelated concerns (Studio renderer fix, constitution v1.6.0, this feature); a commit
  separation is proposed to the user rather than performed.
- **Speckit path resolution** requires `SPECIFY_FEATURE_DIRECTORY=specs/007-mudra-web` on this machine,
  because `jq` is absent and `python3` resolves to a non-functional stub. This is a local tooling
  condition, not a repository concern, and nothing was changed to hide it.
- **README update is approved** as part of this feature's work and appears in Phase 2 tasks: the
  Monorepo table and Folder Structure sections gain `apps/web/`. No unrelated README content changes.
