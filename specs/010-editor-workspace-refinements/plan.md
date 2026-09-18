# Implementation Plan: Editor Workspace Refinements

**Branch**: `010-editor-workspace-refinements` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-editor-workspace-refinements/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Status: Constitution Check passed (v1.9.0) — proceeding to Phase 0/1

This plan was briefly blocked at the Constitution Check gate for two of its five user stories
(docking, tabs); see the struck-through history in the Constitution Check section below. Resolved
via `/speckit-constitution` (constitution now v1.9.0). Phase 0 research and Phase 1 design now
proceed.

## Summary

Five independent, prioritized refinements to the Mudra Web effect editor: isolating the effect
under edit from unrelated live pose detection (P1), rearranging panels via drag-and-drop into a
small set of predefined layouts (P1), grouping panels as tabs within one docking zone (P2), a
lockable/contextual Inspector (P2), and collapsible panels/sections (P3). Full detail in
[spec.md](./spec.md).

## Technical Context

**Language/Version**: TypeScript, current evergreen browsers (existing `apps/web` standard —
constitution's Web applications standards subsection).

**Primary Dependencies**: None new anticipated. The constitution requires any new runtime
dependency to be justified against an existing capability first; Phase 0 research must confirm
whether the existing pointer-event/DOM patterns already used for splitter-dragging and menu
interaction are sufficient for panel drag-and-drop, tabs, and the keyboard-operable relocation
path (FR-010), or whether a concrete gap justifies one.

**Storage**: The existing editor layout-persistence mechanism (IndexedDB, presentation-layer/
application state per the constitution's Web applications standards — "editor-only state (open
project, selection, unsaved edits) is application/presentation state, never domain state"),
extended to also hold docking/tab-group assignments. No new persisted data category, no change to
the project document schema.

**Testing**: The existing `apps/web` automated test runner (domain-layer and adapter/architecture
suites) — constitution requirement that camera, detection, and rendering stay isolated behind
interfaces so the suite runs without a browser or webcam is unaffected by this feature, which adds
no such capability.

**Target Platform**: Browser, `apps/web`'s existing editor entry point. No new entry point, no
change to the public-facing default experience's bundle.

**Project Type**: Existing web application (single project, `apps/web/`), presentation-layer
feature work over the existing domain/application/infrastructure/presentation layering.

**Performance Goals**: No new numeric target. The constitution's existing FR-058/FR-059-class
requirement (editor UI interaction must not degrade the live camera/recognition frame budget) is
inherited unchanged — Phase 0 must confirm docking/drag interactions stay DOM/CSS-only on
`pointermove`, the same discipline the existing splitter-drag code already follows, so they add no
work proportional to the camera's frame rate.

**Constraints**: No new runtime dependency without a concrete architectural reason (constitution,
Web applications standards). Effect isolation must not alter the public-facing default
experience's effect-matching behavior (spec Technical Constraints, FR-029).

**Scale/Scope**: A fixed, small number of registered panels (currently ten) across a small,
fixed number of predefined layouts — not an open-ended docking surface (spec FR-001, Out of
Scope).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` as it exists on disk: **version 1.7.0**,
"Last Amended: 2026-08-24". Two findings precede the per-principle table below because they
determine whether this gate can pass at all for part of the spec.

### Finding 1 — the constitution file is missing an amendment other specs already depend on

`specs/009-web-capture-mode` cites "constitution v1.8.0" throughout as its authorization for
Capture Mode and editor undo/redo, both already shipped. The constitution file on disk has no
entry past v1.7.0 (Mudra Web Milestone 2 — the visual effect editor and capability-gated Person
Segmentation). This is a pre-existing gap from the disk-failure recovery, not something this
spec introduces, and this plan does not attempt to fix it — but it means the constitution this
Constitution Check evaluates against is known-incomplete, which the user has been made aware of
separately (both when it was first found, and again in the gate question this plan paused on).

### Finding 2 — panel docking and tabs are not within the current v1.7.0 authorization

Milestone 2's authorization text is an enumerated grant ("This authorization permits exactly:
...") naming "a browser-based editor UI — a live camera/canvas stage, an action palette, a
pose/trigger selection panel, an inspector, and a timeline." Panel docking and tabs are named
nowhere in that enumeration, nor in the "does not authorize" list that follows it — they are
simply absent, and Principle VI's default rule for anything not explicitly authorized is
"rejected or deferred by default." Corroborating evidence, from the same project at the same
milestone: `specs/008-effect-editor/future-work.md` Section C names "drag-and-drop panel
docking and tabs" as explicitly deferred — "a fragile drag-target implementation was explicitly
not worth this pass" — describing it as future work the existing panel registry could build on,
not as something already granted.

The user was asked how to proceed (constitution gate cannot be waived by an agent unilaterally,
per Governance: "a change that violates a principle is not merged until either the change is
corrected or the constitution is amended to permit it") and chose to **pause this plan and amend
the constitution first**, via `/speckit-constitution`, before continuing.

### Per-principle evaluation

| Principle | Applies to this spec? | Status |
|---|---|---|
| I. Architecture-First & Modular Boundaries | Yes — docking/tabs/lock/collapse are presentation-layer additions over the existing editor layering | PASS. Nothing proposed crosses `domain`/`application`/`infrastructure`/`presentation` boundaries; the spec's own Technical Constraints require the existing runtime/drawing boundary stay singular. |
| II. Coordinates, Never Images | Not implicated | PASS (N/A) — no imagery, no new persisted category of any kind. |
| III. Extensibility by Design | Yes, for layouts specifically | PASS — spec FR-009 requires the layout set be extensible without restructuring; Key Entities separates Layout/Zone from Panel exactly so a new layout or zone is additive. |
| IV. Typed, Modeled, and Clean Code | Yes, inherited | PASS (standard, re-verified at implementation, not a design-time gate concern). |
| V. Centralized Configuration & Observability | Yes, for the predefined-layouts set | PASS — spec Assumptions expects the layout set to be data-shaped and extensible, consistent with the existing `panel-sizes`-style preset pattern already in the codebase. |
| VI. Scope Discipline (Milestone-Bounded YAGNI) | Yes — this is the gate in question | ~~**CONDITIONAL** (2026-09-17, first pass). User Stories 1, 4, 5 PASS as refinements of already-authorized surfaces. User Stories 2 (docking) and 3 (tabs) FAIL pending a constitution amendment. See Findings 1–2 above.~~ **PASS** (2026-09-17, re-evaluated after `/speckit-constitution`). All five user stories now trace to an explicit authorization: constitution v1.9.0's "Mudra Web — Milestone 2 refinements" entry names panel docking, tabs, the lockable Inspector, collapsible panels, and editor-preview isolation by name, with the same predefined-zones-only bound and editor-runtime-only isolation scope this spec already assumed. |

### Gate result

~~**BLOCKED** (2026-09-17, first pass). Per the user's decision, this plan stopped here rather
than generating Phase 0/1 design artifacts for User Stories 2 and 3, pending a constitution
amendment.~~

**UNBLOCKED** (2026-09-17, resolved). `/speckit-constitution` amended the constitution to v1.9.0,
adding "Mudra Web — Milestone 2 refinements: panel docking and tabs, a lockable Inspector,
collapsible panels, and editor-preview isolation" to Principle VI — scoped exactly as this spec's
Assumptions and Out of Scope already bounded it (predefined layouts/zones only, no arbitrary
nested/freely-splittable docking; isolation scoped to the editor's own runtime instance only). The
same pass also reconstructed the previously-missing v1.8.0 amendment (Capture Mode and undo/redo,
spec 009 — a separate, pre-existing gap, unrelated to this spec). This plan does not proceed to
Phase 0/1 itself; a fresh `/speckit-plan` run on this feature will find the gate open.

## Project Structure

### Documentation (this feature)

```text
specs/010-editor-workspace-refinements/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/web/
├── src/
│   ├── domain/
│   │   ├── editor/
│   │   │   └── isolated-catalog.ts        # NEW: the one domain addition this feature makes —
│   │   │                                  # a pure (EffectCatalog, effectId|null) -> EffectCatalog
│   │   │                                  # filter (US1), alongside the existing edit-history.ts,
│   │   │                                  # playback-selection.ts, project-edits.ts, types.ts.
│   │   └── ports/
│   │       └── layout-store.ts            # MODIFIED: `EditorLayout` gains two new optional
│   │                                       # fields, `activeLayoutId?`/`zoneAssignments?` (US2).
│   ├── application/
│   │   └── editor-runtime-controller.ts   # unchanged by this feature — isolation is wired at
│   │                                      # the catalog-supply call site (EditorShell), not here.
│   ├── infrastructure/
│   │   └── persistence/
│   │       └── indexeddb-layout-store.ts  # unchanged — it already stores/loads whatever
│   │                                      # `EditorLayout` shape it is given generically, under
│   │                                      # one key; adding optional fields to the *type* needs
│   │                                      # no change to this file's code (contracts/
│   │                                      # docking-persistence.md).
│   └── presentation/
│       ├── editor/
│       │   ├── layout-catalog.ts          # NEW: `Layout`/`Zone` types and the shipped small
│       │   │                              # set of predefined layouts (US2), mirroring
│       │   │                              # panel-sizes.ts's `LAYOUT_PRESETS` shape.
│       │   ├── dock-layout.ts             # MODIFIED: the existing named-region registry
│       │   │                              # generalized to layout-sourced zones, plus
│       │   │                              # drag/keyboard relocation and tabs (US2, US3).
│       │   ├── editor-shell.ts            # MODIFIED: calls `isolatedCatalog` from
│       │   │                              # `pushCatalog()` and the selection-changing methods
│       │   │                              # (US1); owns the Inspector-lock state (US4).
│       │   ├── inspector.ts               # MODIFIED: the lock toggle control (US4) and
│       │   │                              # per-section collapse (US5).
│       │   └── editor.css                 # MODIFIED: drop-target, tab-strip, lock, and
│       │                                  # collapse-control styling.
│       └── debug/
│           └── diagnostics-panel.ts       # MODIFIED: whole-panel collapse, as one concrete
│                                          # target for that affordance (US5).
└── test/
    ├── domain/                            # flat, no per-subdirectory nesting (unlike src/) —
    │                                      # isolated-catalog.test.ts sits directly here,
    │                                      # alongside the existing edit-history.test.ts
    ├── adapters/                          # existing adapter-level suites (editor-shell,
    │                                      # inspector, dock-layout, indexeddb-layout-store)
    │                                      # extended in place, not replaced; layout-catalog.test.ts
    │                                      # is the one genuinely new file here
    └── architecture/                      # existing layering/boundary tests — this feature
                                            # must keep passing capture-boundary.test.ts and
                                            # layering.test.ts unmodified in intent
```

**Structure Decision**: Single existing project (`apps/web/`), no new application and no new
top-level directory. Every change is presentation-layer (docking, tabs, lock UI, collapse UI)
plus one small domain addition (the layout/zone/tab-group/lock/collapse value objects, kept
framework-free per the constitution's clean-architecture layering) and one application-layer
change (isolation scoping in `EditorRuntimeController`). This mirrors exactly how the constitution
describes Milestone 2 refinements: extensions of an already-authorized surface, not a new project
or a new architectural layer.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. The Constitution Check above passes on every principle for all five user stories;
this section is intentionally empty.

## Post-Design Constitution Re-Check

*Re-evaluated after Phase 1 (`research.md`, `data-model.md`, `contracts/`, `quickstart.md`), per
the gate's own instruction to re-check after design.*

No new violation surfaced by design. Specifically:

- **I. Architecture-First** — `data-model.md`'s `Layout`/`Zone`/docking-arrangement types are
  plain data (a CSS grid-template string is a value, not a framework dependency); `isolatedCatalog`
  is a pure function taking and returning existing domain types. Nothing crosses into
  `presentation/` from `domain/`, or vice versa, beyond the existing read-only patterns
  (`ActionRegistry`, `CapabilityRegistry`) the editor already uses.
- **III. Extensibility** — confirmed by design, not just asserted: `research.md` D1 makes adding a
  layout "one entry to a record," the same shape `LAYOUT_PRESETS` already has.
- **V. Centralized Configuration** — the small set of `Layout` values is hand-authored data,
  analogous to `LAYOUT_PRESETS`, not scattered literals.
- **VI. Scope Discipline** — `contracts/editor-preview-isolation.md`'s verification section is
  exactly the kind of architecture test (`capture-boundary.test.ts`-shaped static-import scan)
  that makes "scoped to the editor's own runtime instance only" checkable by CI, not merely
  asserted in prose — the same discipline the constitution's own Governance section expects
  ("Compliance review: The Constitution Check gate ... MUST be evaluated").
- **Dependency discipline** — research.md D1–D4 each explicitly reject a third-party-dependency
  alternative in favor of extending an existing in-house pattern; no new `package.json` entry is
  implied by any Phase 1 artifact.

**Result**: PASS, unchanged from the pre-design evaluation above.

## Revision (2026-09-17, correction pass)

A manual review of the shipped implementation (every task in `tasks.md` marked complete) found it
did not match spec.md's intent for docking/tabs (forced auto-tabbing, no real drag, a button
standing in for both), panel closing (no per-panel close control), whole-panel collapse
(Diagnostics-only, not reusable), or undo/redo (one global history, crossing effect-selection
boundaries). Spec.md's Clarifications section ("Session 2026-09-17 (correction pass)") records the
corrected intent; this section records what changed here, in the design.

**Constitution re-check**: still PASS, unchanged authorization. Nothing here adds a new capability
beyond what constitution v1.9.0's "Mudra Web — Milestone 2 refinements" entry already grants
(panel docking and tabs, a lockable Inspector, collapsible panels, editor-preview isolation) —
the dock-tree model is a corrected *shape* for docking/tabs already authorized, not a new kind of
authorization; the undo/redo scoping fix operates entirely within spec 009's already-authorized
undo/redo feature. No new persisted data category, no new runtime dependency.

**Project Structure — corrected/added**:

```text
apps/web/
├── src/
│   ├── domain/
│   │   ├── editor/
│   │   │   └── edit-history.ts             # UNCHANGED — already a clean, reusable,
│   │   │                                    # per-instance bounded stack (research D12,
│   │   │                                    # spec 009). The correction is in how many
│   │   │                                    # instances exist and who owns them
│   │   │                                    # (EditorShell, one per editing context), not
│   │   │                                    # in this class itself.
│   │   └── ports/
│   │       └── layout-store.ts             # MODIFIED again: `zoneAssignments`/
│   │                                        # `PanelPlacement` (flat, tab-index-only)
│   │                                        # replaced outright by `zoneLayouts` +
│   │                                        # `DockNodeData` (`DockLeafData`/
│   │                                        # `DockSplitData`) — a tree, not a flat map,
│   │                                        # because a flat per-panel zone+tabIndex
│   │                                        # cannot represent a stack/split at all. No
│   │                                        # real saved data depended on the old shape
│   │                                        # (never released), so this is a clean
│   │                                        # replacement, not a migration.
│   └── presentation/
│       └── editor/
│           ├── dock-tree.ts                # NEW: the pure `DockNode` leaf/split type and
│           │                                # its structural operations
│           │                                # (insertAdjacent/mergeAsTab/removePanel/
│           │                                # appendStacked/sanitize) — mirrors
│           │                                # `isolated-catalog.ts`'s style (pure,
│           │                                # framework-free, no DOM).
│           ├── drop-region.ts              # NEW: one pure function resolving a pointer
│           │                                # position within a hovered leaf's rect to
│           │                                # top/bottom/left/right/center.
│           ├── dock-layout.ts              # MODIFIED again: the flat
│           │                                # zone→tab-strip model replaced by
│           │                                # `zoneTrees: Map<zoneId, DockNode>`; the
│           │                                # "⇄ Relocate" popover button replaced by a
│           │                                # real pointer drag (drag handle + live
│           │                                # drop-target indicators) plus a
│           │                                # de-emphasized "⋮" panel menu hosting the
│           │                                # keyboard path, close, and collapse;
│           │                                # closing now detaches a panel's host from
│           │                                # the DOM entirely rather than toggling
│           │                                # `hidden` on an always-mounted node; a
│           │                                # generic per-panel collapse toggle added
│           │                                # to every panel's header.
│           ├── dialog.ts                   # MODIFIED: `chooseAction` added — an
│           │                                # arbitrary-actions-plus-cancel dialog,
│           │                                # alongside the existing two-button
│           │                                # `confirm()` — for Save/Discard/Cancel.
│           └── editor-shell.ts             # MODIFIED again: owns a per-editing-context
│                                            # `EditHistory` (`beginEditingContext`,
│                                            # `requestContextSwitch`) instead of
│                                            # `editor-main.ts` owning one global one;
│                                            # `undo()`/`redo()` moved here from
│                                            # `editor-main.ts`'s `performUndo`/
│                                            # `performRedo`.
├── src/presentation/debug/
│   └── diagnostics-panel.ts                # MODIFIED: its own bespoke whole-panel
│                                            # collapse removed — superseded by
│                                            # `dock-layout.ts`'s generic mechanism.
├── src/editor-main.ts                      # MODIFIED: constructs one `DialogHost`
│                                            # (previously never actually instantiated,
│                                            # despite `project-panel.ts` already
│                                            # supporting one as an optional `prompts`
│                                            # port), wires it into both `ProjectPanel`
│                                            # and `EditorShell`; Edit menu items call
│                                            # `shell.undo()`/`shell.redo()`.
└── test/
    ├── adapters/
    │   ├── dock-tree.test.ts               # NEW — pure structural-edit coverage.
    │   ├── drop-region.test.ts             # NEW — pure geometry coverage.
    │   ├── dock-layout.test.ts             # EXTENDED — default-arrangement-never-
    │   │                                    # auto-tabs, split/tab-by-drag, close/reopen,
    │   │                                    # generic whole-panel collapse.
    │   ├── indexeddb-layout-store.test.ts  # EXTENDED — round-trips `zoneLayouts`.
    │   ├── diagnostics-panel.test.ts       # NARROWED — collapse coverage moved to
    │   │                                    # dock-layout.test.ts; this file covers only
    │   │                                    # this panel's own data rendering now.
    │   └── editor-shell.test.ts            # EXTENDED — context-scoped undo/redo, and
    │                                        # the Save/Discard/Cancel confirmation's
    │                                        # three outcomes, via a fake `dialogs`.
```

**Design note — why the confirmation dialog is an *optional* dependency**: `EditorShellOptions
.dialogs` is optional, and a context switch with pending edits proceeds synchronously (keeping
them, exactly as before this pass) whenever `dialogs` is absent. This was the deciding factor
against making `selectEffect`/`selectAction`/`createEffect` return promises generally: doing so
would have forced every existing synchronous test asserting post-selection state to become
async, for a behavior change (the confirmation) that only a handful of new tests actually
exercise. Scoping the async branch to "dirty context **and** a real dialog host configured" kept
the change's blast radius to the files that needed it (`editor-shell.ts`, `editor-main.ts`, their
own tests) — confirmed empirically: every other `EditorShell`-constructing test file required zero
changes.
