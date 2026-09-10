# Implementation Plan: Mudra Web — Visual Effect Editor

**Branch**: `008-effect-editor` (not yet created — see Notes) | **Date**: 2026-08-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-effect-editor/spec.md`

## Summary

Evolve `apps/web/` from a fixed, pose-driven playground into an authoring surface over the exact
same effect data model: **Editor → EffectDefinition/timeline data → EffectRuntime → RenderCommand[]
→ Renderer**, unchanged. The editor is a new presentation-layer tree (palette, inspector, timeline,
pose/trigger panel, project management) plus a small number of additive domain/infrastructure
pieces — local project persistence, a project-scoped asset library, and Person Segmentation as a
capability-gated addition — none of which introduces a second effect runtime or a second renderer.

The technical approach in one sentence: **the editor authors data through existing ports and reads
existing registries; nothing it adds executes or draws.**

Three decisions carry the milestone, each resolving one of the ten architecture questions the spec
posed:

1. **The inspector is generated, not written.** It reads `ActionDescriptor.params` from the same
   `ActionRegistry` instance the runtime uses (research D6) — the literal fulfillment of Milestone
   1's `FR-072`, written for exactly this moment.
2. **Preview reuses `EffectRuntime.advance()`; it does not reimplement it.** Test Trigger
   constructs a real `PoseEvent` and calls the same method `Session` calls for a live pose;
   Play Timeline adds one small `startEffect()` entry point rather than a parallel evaluator
   (research D9).
3. **Segmentation reaches the renderer exactly the way the camera image already does**: an
   out-of-band, per-frame handle (`SegmentationFrame`) plus one new, small render command
   (`maskedErase`) — not a redesign of the runtime/renderer seam (research D8).

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022, `strict` — unchanged from Milestone 1; this is an
evolution of the same application, not a new one.

**Primary Dependencies**: `@mediapipe/tasks-vision` (unchanged version, `^0.10.14` — now also used
for `ImageSegmenter`, already present in the package). **No new UI framework** is introduced
(research D1). No new runtime dependency for persistence (IndexedDB is a browser API).

**Storage**: **New** — IndexedDB, behind a `ProjectRepository` port, for local project persistence,
the project-scoped asset library, and the active-project pointer (research D2). Still nothing is
transmitted off the device, and still no camera frame, image, or video is ever the payload (FR-029,
FR-031). Milestone 1's "Storage: None" claim now reads "Storage: IndexedDB, local-only, effect data
and author-supplied assets only."

**Testing**: Vitest, unchanged. Domain-level persistence tests run against an in-memory
`ProjectRepository` fake (no browser). Adapter-level tests of the real IndexedDB-backed repository
use `fake-indexeddb` (**new** dev dependency) in the existing `jsdom` adapter-test environment.

**Target Platform**: Unchanged — current evergreen desktop browsers (Chromium, Firefox, Safari)
with camera access. Segmentation availability is expected to vary by browser/device; that variance
is what the capability gate exists to handle (FR-041–043).

**Project Type**: The same single-page application at `apps/web/`, gaining a second entry
route/mode (the editor) alongside the unchanged default, zero-chrome experience (spec
Clarifications; research D10).

**Performance Goals**: Milestone 1's existing budgets (≈30 fps sustained, ≤200 ms recognition
latency, ≤200 ms trigger-to-first-paint) hold **unconditionally**, including while the editor UI is
open and being interacted with (FR-058). Editor UI interactions themselves are held to a
qualitative "no dropped input, no visible stall" bar, not a new numeric target (FR-059) — both
resolved by clarification, not assumed.

**Constraints**: No second effect runtime, no second renderer (FR-002–004, FR-052–054); Canvas2D
remains the renderer (no WebGL/3D unless a concrete, proven-incapable feature justifies it,
requiring its own authorization); local-only persistence, no network call of any kind as part of
project operations (FR-029); segmentation via MediaPipe Tasks Vision only (FR-040); no UI framework
(research D1); the render-command vocabulary gains exactly one command (`maskedErase`), not a
general masking primitive (contracts/render-commands-extension.md).

**Scale/Scope**: Action palette covers the existing six action types (`screen_flash`,
`background_wash`, `particle_burst`, `play_audio`, `landmark_trail`, `person_visibility`) with no
new action type required beyond `person_visibility` becoming genuinely capability-backed (FR-047 is
satisfied by that one action; further segmentation-dependent actions are future, separately-scoped
work). One project may hold several effects (typically single digits, matching the shipped
default's own 3); asset library entries are expected to be a handful per project, not a media
library.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v1.7.0**.

| Gate | Status | Evidence |
|---|---|---|
| **I — Architecture-First & Modular Boundaries** | ✅ PASS | The editor is a new presentation-layer tree plus two new ports (`ProjectRepository`, `PersonSegmenter`), both following the existing `CameraSource`/`HandDetector` interface pattern. No global mutable state — `ProjectRepository`, `ActionRegistry`, and `CapabilityRegistry` are all constructed and injected at the composition root, exactly as today. |
| **II — Coordinates, Never Images** | ✅ PASS | Extended, not merely preserved: `contracts/privacy-persistence.md` names the one deliberate storage-allowlist addition (IndexedDB, scoped to `infrastructure/persistence/**`) and keeps every other prohibition, including on the new `segmentation` field, which carries a mask *handle*, never a persisted image. |
| **III — Extensibility by Design** | ✅ PASS | Segmentation is added as one more capability-registry entry (research D7), not a special case; the inspector's schema-driven design (research D6) is Milestone 1's `FR-072` realized, not a new extensibility mechanism. |
| **IV — Typed, Modeled, Clean Code** | ✅ PASS | `Project`, `AssetLibrary`, `CameraTreatmentSettings`, `SegmentationFrame`, `MaskedEraseCommand` are all typed, immutable value objects (data-model.md), validated at load with the same fail-at-load discipline `parseSessionConfig`/`resolveParams` already established. |
| **V — Centralized Configuration & Observability** | ✅ PASS | No new hardcoded tunable; project data is validated configuration by construction (it reuses the catalog loader). Capability-unavailable and asset-unresolved conditions continue to route through the existing `Diagnostic`/debug-overlay mechanism, extended, not duplicated. |
| **VI — Scope Discipline** | ✅ PASS | Exactly Milestone 2's authorized surface (constitution v1.7.0): editor, local persistence, small asset library, capability-gated segmentation with one implemented segmentation-dependent action. No publishing, accounts, cloud, marketplace, social, collaboration, gameplay, scripting, backend, or WebGL — see spec's Out of Scope, restated nowhere weaker here. |
| **VI — Effects MUST be data, not code paths** | ✅ PASS | `contracts/editor-runtime-boundary.md`: the editor authors `EffectDefinition`/`Timeline` data; `test/architecture/no-hardcoded-effects.test.ts`'s scan extends to `presentation/editor/**` (research D12). |
| **VI — The effect runtime MUST NOT draw** | ✅ PASS | Unchanged; `maskedErase` is one more declarative command the runtime constructs and never executes (contracts/render-commands-extension.md). |
| **VI — Milestone 2: the editor MUST NOT execute effect logic or draw** | ✅ PASS | `contracts/editor-runtime-boundary.md` is written specifically to this new v1.7.0 rule: preview and test-trigger both call the existing `EffectRuntime`/`Renderer`, never a parallel path (research D9, D11). |
| **VI — Milestone 2: Person Segmentation is capability-gated, never faked** | ✅ PASS | `contracts/capability-segmentation.md`: availability is probed at runtime (research D7), the existing skip-and-diagnose mechanism is reused unmodified, and `maskedErase` performs genuine per-pixel separation — never a full-frame overlay standing in for it (FR-046). |
| **Web standards subsection** | ✅ PASS | TypeScript + browser APIs behind interfaces, extended to two new ports; segmentation behind the same replaceable-interface discipline as hand-landmark detection (constitution's new "Editor and segmentation" bullet); the editor is explicitly a presentation-layer surface with no parallel execution/drawing path. |
| **Monorepo — no app-to-app source imports** | ✅ PASS | No new cross-application dependency; the editor reads only `apps/web/`'s own domain model. |
| **Monorepo — shared binary assets shared, not vendored** | ✅ PASS | `assets/selfie_segmenter.tflite` joins `assets/hand_landmarker.task` at the repository level (research D7), streamed and emitted the same way, never copied into `apps/web/`. |
| **Monorepo — cross-language ports verified by golden fixtures** | N/A this milestone | No new cross-language algorithm port is introduced; segmentation and persistence are browser-native/MediaPipe capabilities with no Engine-side reference implementation to diverge from. |

**Result: PASS — no violations, no entries required in Complexity Tracking.**

Re-check after Phase 1 design: **PASS**. Every Phase 1 artifact (data-model.md, contracts/)
resolves an architecture question *toward* an existing seam (the catalog loader, the `ActionRegistry`,
the `frame`/`ActionContext` pattern, the `CameraSource`/`HandDetector` port shape) rather than by
introducing a new one. The one genuinely new seam — `ProjectRepository` — is shaped identically to
the two ports Milestone 1 already has, so it adds no new *kind* of boundary, only one more instance
of the kind the constitution already sanctions.

## Project Structure

### Documentation (this feature)

```text
specs/008-effect-editor/
├── plan.md                          # This file
├── research.md                      # Phase 0 output — 12 decisions (D1–D12)
├── data-model.md                    # Phase 1 output
├── quickstart.md                    # Phase 1 output — 16 validation scenarios
├── contracts/                       # Phase 1 output
│   ├── project-schema.md            # Project document shape, versioning, storage
│   ├── privacy-persistence.md       # Extends 007's privacy contract to persistence + preview
│   ├── capability-segmentation.md   # Detection, gating, palette/inspector marking
│   ├── editor-runtime-boundary.md   # Editor MUST NOT execute/draw — the new v1.7.0 rule
│   └── render-commands-extension.md # The one new command (`maskedErase`) and its inputs
├── checklists/
│   └── requirements.md              # Spec quality checklist (complete)
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/web/
├── editor.html                          # NEW — the editor's entry document (or an in-app route; task-level decision)
├── config/                              # unchanged: effects.json, session.json remain the shipped default
├── assets/                              # unchanged Mudra-owned experience assets
├── src/
│   ├── domain/
│   │   ├── effects/                     # unchanged — EffectDefinition, Timeline, Trigger, Anchor, ...
│   │   ├── runtime/
│   │   │   ├── action-registry.ts       # unchanged shape
│   │   │   ├── capabilities.ts          # MODIFIED — probeCapabilities() replaces defaultCapabilities()
│   │   │   ├── frame-output.ts          # MODIFIED — + MaskedEraseCommand
│   │   │   ├── effect-runtime.ts        # MODIFIED — + startEffect() for Play Timeline (research D9)
│   │   │   └── actions/
│   │   │       └── person-visibility.ts # MODIFIED — genuinely capability-backed (was permanently inert)
│   │   ├── editor/                      # NEW — framework-free: Project, AssetLibrary, CameraTreatmentSettings,
│   │   │                                #        validation, versioning (data-model.md)
│   │   └── ports/
│   │       ├── project-repository.ts    # NEW
│   │       └── segmenter.ts             # NEW — PersonSegmenter
│   ├── application/
│   │   ├── session.ts                   # unchanged
│   │   └── editor-runtime-controller.ts # NEW — camera-optional EffectRuntime advancement (research D11)
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   └── indexeddb-project-repository.ts  # NEW
│   │   └── segmentation/
│   │       └── mediapipe-person-segmenter.ts    # NEW
│   └── presentation/
│       ├── renderer/canvas2d-renderer.ts # MODIFIED — + setPersonMask(), executes maskedErase
│       ├── stage/stage.ts                # MODIFIED — supplies the per-frame mask, applies camera treatment
│       └── editor/                       # NEW
│           ├── palette.ts
│           ├── inspector.ts              # schema-driven, reads ActionRegistry (research D6)
│           ├── timeline.ts               # clips, drag/resize/select/delete/duplicate (research D5)
│           ├── pose-trigger-panel.ts
│           ├── project-panel.ts          # create/save/load/duplicate/import/export/set-active
│           ├── asset-library-panel.ts
│           └── editor-shell.ts
└── test/
    ├── domain/
    │   ├── project.test.ts               # NEW — validation, versioning (contracts/project-schema.md)
    │   ├── capability-segmentation.test.ts # NEW (extends capabilities.test.ts)
    │   └── editor-runtime.test.ts        # NEW — Test Trigger / Play Timeline via EffectRuntime directly
    ├── adapters/
    │   ├── indexeddb-project-repository.test.ts # NEW — fake-indexeddb
    │   └── mediapipe-person-segmenter.test.ts   # NEW
    ├── architecture/
    │   ├── no-hardcoded-effects.test.ts  # MODIFIED — scope extended to presentation/editor/**
    │   ├── layering.test.ts              # MODIFIED — asserts editor never draws, never schedules
    │   └── privacy.test.ts               # MODIFIED — the one allowlist addition (indexedDB, scoped)
    └── support/
        └── fake-project-repository.ts    # NEW

assets/
├── hand_landmarker.task                 # unchanged, existing shared asset
└── selfie_segmenter.tflite              # NEW — shared, repository-level (research D7)
```

**Structure Decision**: No new application, no new top-level directory outside `apps/web/`. The
editor is added as a fifth presentation subtree (`presentation/editor/`) plus one new domain
subtree (`domain/editor/`) and two new ports, following the exact four-layer split Milestone 1
already established and the constitution already mandates for web applications. The new shared
segmentation model asset joins the existing shared asset at the repository level, under the same
rule that already governs `hand_landmarker.task` — no new boundary rule is needed because the
existing one is written generically ("Repository-level assets... MAY be consumed directly by any
application").

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

## Phase Summary

| Phase | Output | Status |
|---|---|---|
| 0 — Research | [research.md](./research.md) — 12 decisions (D1–D12), all Technical Context unknowns resolved | ✅ Complete |
| 1 — Design & Contracts | [data-model.md](./data-model.md), [contracts/](./contracts/) (5 documents), [quickstart.md](./quickstart.md) (16 scenarios) | ✅ Complete |
| 2 — Tasks | [tasks.md](./tasks.md) — 73 tasks across 7 phases | ✅ Complete |

## Notes

- **No git branch was created.** As with 007, no `before_specify`/`before_plan` git extension hook
  is installed in `.specify/extensions.yml`, so branch creation was not attempted here either.
- **Speckit path resolution** requires `SPECIFY_FEATURE_DIRECTORY=specs/008-effect-editor` on this
  machine, for the same reason recorded in 007's plan (`jq` absent, `python3` a non-functional
  stub). Confirmed unchanged in this session.
- **No agent-context update script exists** in `.specify/scripts/` in this installation (there is
  no `CLAUDE.md`/`AGENTS.md` at the repository root for it to update), so that Phase 1 sub-step was
  skipped, consistent with how 007's plan handled the same absence.
- **`fake-indexeddb` is a new dev dependency**, scoped to adapter-level tests only; it is not a
  runtime dependency and does not appear in `apps/web/package.json`'s `dependencies`.
- **One existing file's claim changes**: Milestone 1's `apps/web/README.md` states "Storage: None."
  Updating that line (and adding the editor's own section) is in-scope task-level work for
  `/speckit-tasks`, not performed by this plan.
