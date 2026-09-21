---

description: "Task list for Editor Workspace Refinements"
---

# Tasks: Editor Workspace Refinements

**Input**: Design documents from `/specs/010-editor-workspace-refinements/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. The constitution's Web applications standard makes domain-layer
test coverage mandatory ("an automated test runner MUST cover the domain layer"), and both
contracts in `contracts/` specify concrete verification strategies that are authorization
conditions, not optional extras.

**Organization**: Tasks are grouped by user story, in spec.md's priority order, except that US1
(effect isolation) is sequenced first among the two P1 stories — it is fully independent of
docking/zones and is the smallest, lowest-risk slice, making it the natural MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves (US1–US5)
- Every task names its exact file path

## Path Conventions

All paths are relative to the repository root. The application lives at `apps/web/`.

---

## Phase 1: Setup

**Purpose**: nothing new to configure — this feature adds no dependency, no new entry point, no
new config file (research.md D1–D4, plan.md Technical Context). Setup is confirming that.

- [X] T001 Confirm `apps/web/package.json` gains no new dependency for this feature; run `npm run typecheck && npm run lint && npm run test` on the current tree as the pre-change baseline every later task's diff is measured against

---

## Phase 2: Foundational

**Purpose**: none of the five user stories shares blocking domain work — each is independently
domain-scoped by design (spec.md, every story's "Independent Test"). This phase is intentionally
empty; proceed directly to Phase 3.

**Checkpoint**: no foundational work to wait on — all five stories can start immediately.

---

## Phase 3: User Story 1 - Only the effect I'm editing plays while I edit it (Priority: P1) 🎯 MVP

**Goal**: while an effect is selected for editing, a live-detected pose belonging to a different,
unselected effect must not start that effect's playback in the editor.

**Independent Test**: with two effects saved for two different poses, select and preview the first
(camera attached) while performing the second's pose; confirm only the first's output appears.

### Tests for User Story 1

- [X] T002 [P] [US1] Add `isolatedCatalog` tests in `apps/web/test/domain/isolated-catalog.test.ts` (flat under `test/domain/`, matching the existing `edit-history.test.ts` sibling — `test/domain/` has no per-subdirectory nesting even though the source tree does) — returns a catalog with the single named effect when it exists, an empty catalog when `selectedEffectId` is `null`, and an empty catalog (never a throw) when the id names no effect in the given catalog (data-model.md "Editing scope", contracts/editor-preview-isolation.md #1)
- [X] T003 [P] [US1] Add an architecture test extending `apps/web/test/architecture/capture-boundary.test.ts`'s static-import-scan shape (or a new `apps/web/test/architecture/editor-runtime-isolation.test.ts`) asserting nothing reachable from `apps/web/src/main.ts` imports `isolated-catalog.ts` or references `isolatedCatalog` (contracts/editor-preview-isolation.md #2)
- [X] T004 [US1] Extend `apps/web/test/domain/editor-runtime.test.ts` (the real existing suite covering `EditorRuntimeController` — DOM-free, hence grouped under `test/domain/` despite being application-layer) with four cases (contracts/editor-preview-isolation.md #3, depends on T005–T007):
      1. **Editor-side isolation**: with two effects on two poses, select the first, feed a real `PoseEvent` for the second's trigger, assert `activePlaybacks` does not change; then select the second and feed the same event, assert it starts.
      2. **Public-path non-impact** (contract verification #3): construct a second, independent `EffectRuntime` the same way `Session` does — unfiltered `setCatalog(fullCatalog)`, never routed through `isolatedCatalog`/`EditorShell` at all — feed it the same second-effect `PoseEvent`, and assert it starts normally. This proves the public path's "every matching effect plays" behaviour is unconditional, not merely untouched by omission.
      3. **Playback continuity** (FR-028): start a playback for the currently-selected effect, then change the editor's selection away from it *while that playback is still running* (before it completes), and assert the already-started playback is not interrupted — only *subsequent* new-playback starts are subject to isolation, not one already in flight.
      4. Re-run case 1 to confirm case 3's selection change correctly re-scoped isolation for *new* starts (the previously-selected effect's pose no longer triggers anything once its playback above has finished).

### Implementation for User Story 1

- [X] T005 [P] [US1] Implement `isolatedCatalog(catalog, selectedEffectId)` in `apps/web/src/domain/editor/isolated-catalog.ts`, mirroring `domain/editor/playback-selection.ts`'s shape (pure, no side effects, no throw) — depends on T002 failing first
- [X] T006 [US1] Call `isolatedCatalog` from `EditorShell.pushCatalog()` in `apps/web/src/presentation/editor/editor-shell.ts`, replacing the current unfiltered `this.runtime.setCatalog(this.project.catalog)` (depends on T005)
- [X] T007 [US1] Call `pushCatalog()` (or the equivalent filtered `setCatalog`) from `EditorShell.selectEffect()` and `EditorShell.selectAction()` in the same file, so a selection change alone — with no edit — re-scopes isolation immediately (depends on T006)

**Checkpoint**: User Story 1 is fully functional and independently testable — no UI change, no
dependency on any other story in this feature.

---

## Phase 4: User Story 2 - Rearrange panels into a layout that fits how I'm working (Priority: P1)

**Goal**: panels can be relocated, by drag or by a keyboard-operable command, among the zones of a
small set of predefined layouts; an empty zone keeps its space; the arrangement persists.

**Independent Test**: drag a panel to a different valid zone, confirm it relocates, survives a
reload, and that an emptied zone keeps its size.

### Tests for User Story 2

- [X] T008 [P] [US2] Add `EditorLayout` backward-compatibility tests in `apps/web/test/adapters/indexeddb-layout-store.test.ts` (extend the existing suite): a record with only `leftWidth`/`rightWidth`/`timelineHeight` loads through the unmodified store with `activeLayoutId`/`zoneAssignments` both `undefined`, and a round-trip of a record with both new fields populated deep-equals on reload (contracts/docking-persistence.md #1, #3)
- [X] T009 [P] [US2] Add layout-catalog tests in `apps/web/test/adapters/layout-catalog.test.ts` (new file — no existing suite to extend) — every `Layout`'s `zones` are unique, `defaultZoneFor` names only zone ids present in `zones`, and the shipped default layout's zones match today's three regions (data-model.md "Layout"/"Zone" invariants)
- [X] T010 [US2] Add `DockLayout` docking tests extending `apps/web/test/adapters/dock-layout.test.ts` (the real existing suite — not a new `test/presentation/editor/` path) — relocating a panel by simulated pointer drag moves it to the target zone and leaves every other zone's size unchanged; a zone emptied of every panel still reports its layout-defined size (`data-left-collapsed`-style attribute stays `false`); an unrecognized zone/panel id in a loaded arrangement is dropped without throwing (contracts/docking-persistence.md #2, spec Edge Cases). Also cover FR-006/the "already docked" Edge Case explicitly: releasing the drag over a zone that is not a valid target leaves the panel in its original zone (a no-op, not an error); and releasing over the zone the panel is *already* docked in is likewise a no-op — no re-mount, no flicker, no change to `zoneAssignments`.
- [X] T011 [US2] Add a keyboard-relocation test in the same file (`test/adapters/dock-layout.test.ts`) — invoking the relocation command with no pointer event at any point produces the identical end state a completed drag would (spec SC-007)

### Implementation for User Story 2

- [X] T012 [P] [US2] Add `activeLayoutId?: string` and `zoneAssignments?: Readonly<Record<string, { zoneId: string; tabIndex?: number }>>` to `EditorLayout` in `apps/web/src/domain/ports/layout-store.ts`, both optional, per the file's own documented extension pattern (data-model.md "Docking arrangement", contracts/docking-persistence.md)
- [X] T013 [P] [US2] Create `apps/web/src/presentation/editor/layout-catalog.ts`: `Layout`/`Zone` types, the shipped small set of `LAYOUTS` (at minimum, today's three-region shape ported in as the first named layout — research D1), and pure helpers `zonesOf(layoutId)`/`defaultZoneFor(layoutId, panelId)`, mirroring `panel-sizes.ts`'s `LAYOUT_PRESETS` shape (depends on T009 failing first)
- [X] T014 [US2] Generalize `DockRegion`/region-keyed logic in `apps/web/src/presentation/editor/dock-layout.ts` to zone ids sourced from `layout-catalog.ts`'s active layout; keep `registerPanel`/`listPanels`/`isPanelVisible`/`setPanelVisible` behaviour unchanged for existing callers (depends on T012, T013)
- [X] T015 [US2] Implement pointer-driven panel relocation in `dock-layout.ts` (pointerdown on a panel header / pointermove computing which zone's rect contains the pointer / pointerup docks it), mirroring `wireSplitter`'s existing pointer-capture pattern (research D2) — depends on T014
- [X] T016 [US2] Add the valid-drop-target highlight and invalid-zone suppression during a drag (FR-004, FR-005) — a `data-drop-target` (or equivalent) attribute toggled only on zones the dragged panel may enter, depends on T015
- [X] T017 [US2] Add the keyboard-operable relocation control (a small popover/menu listing only the active layout's valid zones for that panel, per research D3) to each panel's header in `dock-layout.ts`, calling the same dock-to-zone operation T015 uses (depends on T014, satisfies FR-010/SC-007)
- [X] T018 [US2] Wire `activeLayoutId`/`zoneAssignments` into `DockLayout.getLayout()`/the constructor's `initialSizes`-style loading, so `editor-main.ts`'s existing `persistLayout`/`layoutStore.load()` calls round-trip the new fields with no change to their own call sites (depends on T012, T014)
- [X] T019 [US2] Add a "Layout: <name>" entry per `layout-catalog.ts` layout to the View menu's existing preset-switcher section in `apps/web/src/editor-main.ts`, alongside the current size-preset checkboxes (depends on T013, FR-007)

**Checkpoint**: User Stories 1 AND 2 both work independently. US3 can now begin (it depends on
US2's zones existing).

---

## Phase 5: User Story 3 - Group related panels under tabs in one zone (Priority: P2)

**Goal**: a zone can hold more than one panel as switchable tabs.

**Independent Test**: drag one panel onto a zone already holding another; confirm both appear as
tabs, switching shows one at a time, and dragging one back out restores standalone presentation.

### Tests for User Story 3

- [X] T020 [P] [US3] Add tab-group tests extending `apps/web/test/adapters/dock-layout.test.ts` (the real existing suite, same file T010/T011 already extend — not a new `test/presentation/editor/` path) — docking a second panel onto an occupied zone produces two tabs with exactly one visible; clicking the inactive tab swaps visibility with no size change; removing every tab but one collapses the strip to a direct single-panel presentation (data-model.md "Tab group" invariants, FR-011, FR-013, FR-014)

### Implementation for User Story 3

- [X] T021 [US3] Render a tab strip (one button per panel sharing a zone, `role="tablist"`/`"tab"`/`"tabpanel"`) in `dock-layout.ts` whenever a zone's panel count is greater than one, toggling each panel host's existing `hidden` property to select the active tab (research D4) — depends on T015 (relocation must be able to target an occupied zone)
- [X] T022 [US3] Make relocating a panel onto an already-occupied zone append it as a new tab (respecting `tabIndex`) rather than replacing the existing panel, and make dragging a tab out to an empty/other zone remove it from the group — depends on T015, T021
- [X] T023 [US3] Collapse a zone's presentation back to a direct single panel (no tab strip) the moment its tab count returns to one — depends on T021

**Checkpoint**: User Stories 1–3 all work independently and together. US4 and US5 do not depend on
this phase and could have been built in parallel with it.

---

## Phase 6: User Story 4 - Hold what the Inspector is showing while I work elsewhere (Priority: P2)

**Goal**: a lock control on the Inspector holds its content across further selection changes,
until explicitly unlocked or its target stops existing.

**Independent Test**: select a clip, lock the Inspector, select a different clip elsewhere,
confirm the Inspector still shows the first.

### Tests for User Story 4

- [X] T024 [P] [US4] Add Inspector-lock tests extending `apps/web/test/adapters/editor-shell.test.ts` (or `inspector.test.ts`) — locking then changing selection leaves the Inspector's rendered content unchanged; unlocking immediately shows the live selection; deleting the locked clip (from the tree, not the Inspector) auto-unlocks and falls back to the ordinary empty state (data-model.md "Inspector lock" invariants and lifecycle, FR-016, FR-018, FR-019)

### Implementation for User Story 4

- [X] T025 [US4] Add a `lockedSelection: { effectId: string; entryIndex: number | null } | null` field and `lockInspector()`/`unlockInspector()` methods to `EditorShell` in `apps/web/src/presentation/editor/editor-shell.ts`, defaulting to `null` (depends on T024 failing first)
- [X] T026 [US4] Route the Inspector's `render()` call site in `editor-shell.ts` through `lockedSelection` when non-`null`, the live selection otherwise — the only call site that consults the lock (depends on T025)
- [X] T027 [US4] Reset `lockedSelection` to `null` whenever its named effect/entry stops resolving against the current project (on edit, undo/redo, or project switch — the existing `applyExternalProject`/`loadProject` paths), per FR-018/FR-019 (depends on T025)
- [X] T028 [US4] Add the lock toggle control (icon button, visibly distinct checked/unchecked state, accessible name) to `apps/web/src/presentation/editor/inspector.ts`, calling `lockInspector()`/`unlockInspector()` (depends on T025, FR-015, FR-017)
- [X] T029 [US4] Add the locked-state CSS to `apps/web/src/presentation/editor/editor.css` (a distinct visual treatment for the lock control's checked state — colour/icon, not reliant on a tooltip) — depends on T028

**Checkpoint**: User Stories 1–4 all work independently. US5 does not depend on this phase.

---

## Phase 7: User Story 5 - Collapse panels and sections to reduce what's on screen at once (Priority: P3)

**Goal**: a whole panel, and independently each of its internal sections, can be collapsed and
expanded, for the remainder of the editor session.

**Independent Test**: collapse a parameter group in the Inspector, confirm it hides and reopens;
collapse a whole panel, confirm its header remains and it can be restored.

### Tests for User Story 5

- [X] T030 [P] [US5] Add section-collapse tests extending `apps/web/test/adapters/inspector.test.ts` — collapsing a field-group hides its fields and keeps its heading clickable to re-expand; collapse state survives an unrelated committed edit (re-render) in the same session (data-model.md "Collapse state" invariants, FR-020, FR-022). Also cover FR-023 explicitly, per its exact wording ("a panel or section with nothing meaningful to collapse... MUST NOT present a collapse control"): select an action whose registered params resolve to exactly one parameter group, and assert that group's heading renders with **no** collapse control at all (not merely non-functional, not merely always-expanded — the control itself must not appear in the DOM) — distinct from the multi-group case in the paragraph above, where every group does get one.
- [X] T031 [P] [US5] Add whole-panel-collapse tests in `apps/web/test/adapters/diagnostics-panel.test.ts` (new file — no existing suite for this panel to extend) for the Diagnostics panel (per quickstart.md scenario 5) — collapsing hides its body while its header/zone placement and View-menu entry remain (FR-021)

### Implementation for User Story 5

- [X] T032 [US5] Add `collapsedSectionIds: Set<string>` to `Inspector` in `apps/web/src/presentation/editor/inspector.ts` and a collapse toggle on each `.mudra-editor__field-group` heading **only when the current selection resolves to more than one group** — a selection with exactly one group renders its heading with no toggle at all, per FR-023 (depends on T030, FR-020, FR-023)
- [X] T033 [US5] Add a `panelCollapsed: boolean` field and a header collapse toggle to `apps/web/src/presentation/debug/diagnostics-panel.ts` (or the chosen whole-panel-collapse target), rendering only its header when collapsed (depends on T031, FR-021)
- [X] T034 [P] [US5] Add the collapse-control CSS (chevron/caret affordance, collapsed-state layout) to `apps/web/src/presentation/editor/editor.css` — depends on T032, T033

**Checkpoint**: all five user stories are independently functional and, per Phase 3–7's checkpoints,
functional together.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T035 [P] Update `apps/web/README.md`'s Editor section with the new panel-docking/tabs/lock/
      collapse capabilities, alongside the existing "Undo/redo" entry this session's prior work added
- [X] T036 Run `npm run test`, `npm run typecheck`, and `npm run lint` across the whole `apps/web`
      suite and confirm the existing recognition/effect suites pass with no threshold, weight, or
      hold value changed (mirrors spec 009's SC-013 discipline)
- [X] T037 Execute every scenario in [quickstart.md](./quickstart.md) end to end and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: empty — nothing blocks any user story.
- **User Stories (Phase 3–7)**: US1 and US2 can start immediately and in parallel. US3 depends on
  US2 (needs zones to exist before tabs can group panels within one). US4 and US5 depend on
  neither US2 nor US3 and can proceed in parallel with either.
- **Polish (Phase 8)**: depends on every user story intended for this release being complete.

### User Story Dependencies

- **US1 (P1)**: no dependency on any other story in this feature.
- **US2 (P1)**: no dependency on any other story in this feature.
- **US3 (P2)**: depends on US2 (zones must exist).
- **US4 (P2)**: no dependency on any other story in this feature.
- **US5 (P3)**: no dependency on any other story in this feature.

### Parallel Opportunities

- T002, T003 (US1 tests) in parallel.
- T008, T009 (US2 tests) in parallel; T012, T013 (US2 implementation) in parallel.
- T020 (US3) has no parallel sibling — it is the only test task in that phase.
- T024 (US4) and T030, T031 (US5) can run in parallel with each other and with any US2/US3 work,
  since neither touches `dock-layout.ts` or `layout-catalog.ts`.
- Different user stories — US1, US2 (+US3), US4, US5 — can be worked on in parallel by different
  contributors once Phase 1 is done, per the Phase Dependencies above.

---

## Parallel Example: User Story 1 (the MVP slice)

```bash
# Launch both US1 tests together:
Task: "isolatedCatalog tests in apps/web/test/domain/isolated-catalog.test.ts"
Task: "Architecture boundary test asserting main.ts never imports isolated-catalog.ts"

# Then implement in dependency order:
Task: "Implement isolatedCatalog in apps/web/src/domain/editor/isolated-catalog.ts"
Task: "Call it from EditorShell.pushCatalog() and the two selection-changing methods"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup — a baseline check, effectively instant).
2. Phase 2 is empty.
3. Complete Phase 3 (US1 — effect isolation).
4. **STOP and VALIDATE**: run quickstart.md Scenario 1 independently.
5. This is a real, shippable MVP: it fixes the confusing cross-effect-triggering bug with zero UI
   change and zero dependency on the rest of this feature.

### Incremental Delivery

1. Setup → US1 (MVP, ships the correctness fix alone if desired).
2. Add US2 (docking) → validate Scenario 2 → ships panel rearrangement.
3. Add US3 (tabs, needs US2) → validate Scenario 3.
4. Add US4 (Inspector lock, independent) → validate Scenario 4 — could ship before or after US2/US3.
5. Add US5 (collapsing, independent) → validate Scenario 5 — likewise.
6. Polish (Phase 8) once every intended story for this release is in.

### Parallel Team Strategy

With multiple contributors, after Phase 1:

- Contributor A: US1, then US4 (both touch `editor-shell.ts`/`inspector.ts` but not
  `dock-layout.ts` — coordinate on `editor-shell.ts` specifically).
- Contributor B: US2, then US3 (both own `dock-layout.ts`/`layout-catalog.ts`).
- Contributor C: US5 (touches `inspector.ts` and one whole-panel target — coordinate with A on
  `inspector.ts`).

---

## Phase 9: Correction pass (2026-09-17)

**Purpose**: a manual review of the shipped Phases 1–8 found the implementation did not match
spec.md's intent for docking/tabs, panel closing, whole-panel collapse, or undo/redo scoping (see
spec.md's "Session 2026-09-17 (correction pass)" and plan.md's "Revision" section). This phase
corrects the implementation and its tests to match the now-corrected spec, in place — it does not
introduce a sixth user story so much as fix Phases 4, 5, 7, and add the two the review surfaced
(panel closing, undo/redo scoping) as User Stories 6–7.

### Dock tree foundation (US2/US3 correction)

- [X] T038 [P] Add `apps/web/src/presentation/editor/dock-tree.ts` — the pure `DockNode`
      leaf/split type and its structural operations (`insertAdjacent`, `mergeAsTab`,
      `removePanel`, `appendStacked`, `applyDrop`, `sanitize`, `findLeafOf`, `listPanelIds`),
      mirroring `isolated-catalog.ts`'s pure/framework-free style
- [X] T039 [P] Add `apps/web/src/presentation/editor/drop-region.ts` — `resolveDropRegion`, pure
      geometry resolving a pointer position within a hovered leaf's rect to
      top/bottom/left/right/center, treating a zero-area rect as `center`
- [X] T040 [P] Add `apps/web/test/adapters/dock-tree.test.ts` and
      `apps/web/test/adapters/drop-region.test.ts` — full coverage of both pure modules
- [X] T041 Replace `PanelPlacement`/`zoneAssignments` in
      `apps/web/src/domain/ports/layout-store.ts` with `DockLeafData`/`DockSplitData`/
      `DockNodeData` and `EditorLayout.zoneLayouts` (depends on T038; no migration needed — the
      old shape was never released)

### Dock layout rewrite (US2/US3 correction, item 1–3)

- [X] T042 Rewrite `DockLayout`'s internal state in `dock-layout.ts` from a flat
      zone→tab-strip model to `zoneTrees: Map<zoneId, DockNode>`; `registerPanel` gives a newly
      registered, not-previously-persisted panel its own stacked leaf — never an automatic tab
      group (depends on T038, T041)
- [X] T043 Replace the pointer-drag zone-only relocation with leaf-aware resolution:
      `pointermove` finds the nearest `[data-dock-leaf]` (a specific tab group, via real
      geometry + `drop-region.ts`) or falls back to `[data-dock-zone]` (empty background);
      `pointerup` applies `insertAdjacent`/`mergeAsTab`/`appendStacked` accordingly (depends on
      T039, T042)
- [X] T044 Add drop-target visuals for every target kind (zone background, and each of a
      leaf's four edges plus its centre) — `data-drop-target`/`data-drop-position` attributes,
      styled in `editor.css` (depends on T043)
- [X] T045 Remove the "⇄ Relocate" popover button; replace it with a "⋮" panel-menu button
      (Move to \<zone\>, Close, Collapse/Expand) — the keyboard-operable path (FR-010) now lives
      here, secondary to the drag handle, which gains a visibly thicker/grip-styled top border
      (depends on T042)
- [X] T046 Rewrite `apps/web/test/adapters/dock-layout.test.ts`'s docking/tab-group coverage
      for the corrected model: default arrangement never auto-tabs; plain relocation (drag to
      background, or the keyboard menu) always stacks; tabbing requires an explicit
      centre-drop; edge-drops split; the "drag onto its own group" edge case is a true no-op
      (depends on T042–T045)

### Panel closing and recovery (US6, new)

- [X] T047 Add `closedPanelIds`, and rework `setPanelVisible`/`togglePanel`/`revealPanel`/
      `isPanelVisible` in `dock-layout.ts` to insert into/remove from the panel's zone tree
      (not merely toggle a `hidden` flag on an always-mounted host) — a closed panel's host is
      detached from the DOM entirely; View menu call sites (`editor-main.ts`) are unchanged
      (depends on T042)
- [X] T048 Add a close (`×`) control to every panel's header, and to each tab of a tab group
      individually, calling `setPanelVisible(id, false)` (depends on T047)
- [X] T049 Extend `dock-layout.test.ts` and `layout-panels.test.ts` for FR-030–FR-033: closing
      detaches the host from the DOM; reopening re-inserts it as a new stacked leaf in its
      current zone; closing the last tab of a group/leaf removes that now-empty container
      (depends on T047, T048)

### Whole-panel collapse, generalized (US5 correction)

- [X] T050 Add `collapsedPanelIds` and a generic collapse toggle to every panel's header in
      `dock-layout.ts` (`isPanelCollapsed`/`setPanelCollapsed`/`togglePanelCollapsed`), hiding
      only `panel.element` while the header stays visible (depends on T042)
- [X] T051 Remove `DiagnosticsPanel`'s own bespoke `panelCollapsed`/collapse toggle
      (`apps/web/src/presentation/debug/diagnostics-panel.ts`) — superseded by T050; narrow
      `diagnostics-panel.test.ts` to this panel's own data rendering, moving whole-panel-collapse
      coverage to `dock-layout.test.ts` (depends on T050)

### Undo/redo context scoping (US7, new)

- [X] T052 Add `chooseAction<T>` to `apps/web/src/presentation/editor/dialog.ts` — an
      arbitrary-actions-plus-cancel dialog, alongside the existing two-button `confirm()`
- [X] T053 Move `EditHistory` ownership from `editor-main.ts` into `EditorShell`
      (`apps/web/src/presentation/editor/editor-shell.ts`): `beginEditingContext`,
      `contextBaseline`, `undo()`/`redo()`/`canUndo`/`canRedo` — one fresh, bounded `EditHistory`
      per editing context, seeded at the project as it stands when that context begins (depends
      on T052)
- [X] T054 Gate `selectEffect`/`selectAction`/`createEffect` through `requestContextSwitch`:
      same-context, a not-dirty context, or no `dialogs` configured all proceed synchronously
      (unchanged timing for every existing caller/test); a dirty context with `dialogs`
      configured asks Save/Discard/Cancel first (depends on T053)
- [X] T055 Record every committed edit (`editTimeline`, `renameSelectedEffect`, `renameProject`,
      `updateAssetLibrary`, `updateCameraTreatment`) into the active context's history; leave
      `applyExternalProject` (undo/redo's own apply path) unrecorded (depends on T053)
- [X] T056 Wire a `DialogHost` in `editor-main.ts` (previously never actually constructed,
      despite `project-panel.ts` already supporting one as an optional `prompts` port) into both
      `ProjectPanel` and `EditorShell.dialogs`; Edit menu's Undo/Redo call `shell.undo()`/
      `shell.redo()` (depends on T054)
- [X] T057 Extend `apps/web/test/adapters/editor-shell.test.ts`: an edit to effect A followed by
      a silent (no-`dialogs`) switch to B leaves A's data reachable only by staying on A, and
      `undo()` on B's fresh context is a no-op; with a fake `dialogs`, Cancel/Save/Discard each
      produce their documented outcome; selecting a different clip of the *same* effect never
      prompts (depends on T054–T056)

### Documentation and gates

- [X] T058 [P] Update `specs/008-effect-editor/future-work.md` Section C with the deferred
      unified toast/notification system, naming `project-panel.ts`'s `setStatus`/`statusText` as
      the concrete site it will replace
- [X] T059 [P] Update `apps/web/README.md`'s Editor section for the corrected docking/closing/
      collapse/undo-scoping behavior
- [X] T060 Run `npm run typecheck && npm run lint && npm run test` and confirm a clean pass with
      no regression to any pre-existing suite (depends on every task above)

**Checkpoint**: docking/tabs/closing/collapsing behave per the corrected spec; undo/redo cannot
cross an effect-selection boundary; every pre-existing test file not directly touched by this
phase required zero changes.

---

## Phase 10: Workspace UX corrections (2026-09-17)

**Purpose**: manual use of the corrected docking system (Phase 9) surfaced six further UX gaps —
text selection during a panel drag, a panel-menu popover duplicating header buttons, fixed tab
order, no split resizing, and no panel-level or region-level scrolling. See spec.md's "Session
2026-09-17 (workspace UX corrections)" and the new FR-041–FR-047/SC-012–SC-015. All within the
existing dock-tree/dock-layout files — no new architecture, no change outside the docking/CSS
layer.

### Dock tree + pure resize math

- [X] T061 [P] Add `reorderTab(node, panelId, toIndex)` to `dock-tree.ts` — moves `panelId` to a
      clamped index within its own leaf's `panelIds`; `null` if `panelId` isn't found anywhere
      (mirrors `mergeAsTab`/`insertAdjacent`'s existing not-found convention) (FR-043)
- [X] T062 [P] Add `sizes?: readonly number[]` to `DockSplitData` in `layout-store.ts`; add
      `withSplitSizesAtPath(node, path, sizes)` to `dock-tree.ts` (`path`: child indices from the
      zone root); update `insertAdjacent`/`removePanel`/`sanitize` to drop a split's `sizes` back
      to `undefined` whenever that split's child count changes (FR-042, data-model.md "Dock tree")
- [X] T063 [P] Add `apps/web/src/presentation/editor/split-resize.ts` — pure
      `resizeSplitSizes(sizes, index, deltaPx, containerSizePx, minPx)`, redistributing only
      `index`/`index+1`, clamped so neither child's pixel share drops below `minPx` (FR-042)
- [X] T064 [P] Add/extend `dock-tree.test.ts` for T061/T062 and a new `split-resize.test.ts` for
      T063 (contracts/docking-persistence.md #4, spec Success Criteria SC-013/SC-014)

### Dock layout wiring

- [X] T065 Trim `buildPanelMenu` in `dock-layout.ts` to "Move to `<zone>`" options only (drop the
      duplicate Collapse/Close entries — both already have dedicated header buttons); update its
      accessible name/title accordingly (FR-010's note, workspace UX corrections pass)
- [X] T066 Add `mudra-layout--dragging` class toggling on `this.root` for the duration of any drag
      (panel-header or tab-strip); call `event.preventDefault()` at the point a drag is confirmed
      to start; add `user-select: none` CSS scoped to `.mudra-layout__panel-header` (permanent) and
      `.mudra-layout--dragging` (drag-scoped only) in `editor.css` (FR-041, depends on T067 for the
      tab-strip half)
- [X] T067 Give each tab button (`renderNode`'s tab strip) a `pointerdown` that also sets
      `draggingPanelId` (same button-target guard as the header); extend `wireRelocationDrag`'s
      `leafIsOwnGroup` branch so hovering that leaf's own tab strip computes a live reorder-preview
      index (pointer-X vs. sibling tab midpoints) instead of a pure no-op; `end()` calls
      `reorderTab` when a reorder was being previewed, otherwise falls through to the existing
      `relocatePanel` path unchanged (FR-043, depends on T061)
- [X] T068 Give `renderNode` a `path: readonly number[]` parameter (default `[]`, appended per
      recursive call); render a resize handle between every adjacent pair of a split's children,
      wired like the existing `wireSplitter`s (one `getBoundingClientRect()` read on `pointerdown`
      only, no interleaved reads during `pointermove`); commit via `withSplitSizesAtPath` +
      `onLayoutChange` on `pointerup` (FR-042, depends on T062, T063)
- [X] T069 `registerPanel` adds `mudra-editor__panel-content` to `panel.element`'s class list
      (FR-044, depends on nothing new)
- [X] T070 CSS: `.mudra-editor__panel-section` becomes a header/content flex column
      (`.mudra-layout__panel-header { flex: 0 0 auto }`, `.mudra-editor__panel-content { flex: 1 1
      auto; min-height: 0; overflow-y: auto }`) — panel-level scroll (FR-044); give
      `.mudra-layout__leaf` a real `min-height`/`min-width` floor (`MIN_LEAF_SIZE_PX`, shared with
      T063's `minPx`) instead of `0`, which is what lets the existing `.mudra-layout__left/right`
      `overflow-y: auto` finally activate for region-level scroll once combined panel minimums
      exceed the zone's space (FR-045–FR-047); insertion-position and resize-handle visuals
      (depends on T067, T068)
- [X] T071 Extend `dock-layout.test.ts`: tab-strip simulated-pointer reorder produces the expected
      order and survives `getLayout()`; dragging a tab out of the strip still undocks via
      `relocatePanel` (proving reorder vs. undock don't conflict); a simulated resize-handle drag
      updates the right split's `sizes` and clamps at the minimum; header/tab pointerdown still
      ignores clicks on the header's own buttons; the trimmed popover renders only "Move to
      `<zone>`" options (depends on T065–T070)

### Documentation and gates

- [X] T072 [P] Update `specs/010-editor-workspace-refinements/data-model.md`,
      `contracts/docking-persistence.md`, and `quickstart.md`'s Scenario 9 for the corrected
      behavior (done ahead of implementation this pass, per the request to update SDD artifacts
      before coding)
- [X] T073 Run `npm run typecheck && npm run lint && npm run test && npm run build` and confirm a
      clean pass with no regression to any pre-existing suite (depends on every task above)

**Checkpoint**: dragging never leaves text selected; the panel-menu popover only offers what
isn't already a header button; tabs are reorderable and persist; adjacent split siblings are
resizable with an enforced minimum and persist; panel content and, separately, a zone's combined
panels scroll only when genuinely needed, with no redundant nested scrollbar. Scenario 9's manual
browser pass remains outstanding until actually run (see quickstart.md's Definition of done).

---

## Notes

- [P] tasks = different files, no dependencies on an incomplete task.
- [Story] label maps every implementation task to the story it serves, per spec.md's priorities.
- US1 is the smallest, most independent, and highest-value slice — treat it as the true MVP rather
  than defaulting to "whichever story is listed first."
- Verify each test task's test fails before starting its paired implementation task.
- Two files see the most cross-story traffic and are the most likely source of a merge conflict if
  worked in parallel: `dock-layout.ts` (US2, US3) and `editor-shell.ts` (US1, US4). Sequence work
  on each of those two files within its own set of stories.

---

## Amendment 2026-09-21 — restore invariant, persistence, popover (FR-051–FR-053)

- [X] T074 Fix `DockLayout` restore: keep stored trees intact until every persisted panel has registered; add `finishRestore()` (drop unknown/closed/duplicate ids, mount orphaned open panels, re-persist only if healed); call it once in `editor-main.ts` after the last `registerPanel`. *(FR-051)*
- [X] T075 Persist the active tab per tab group (`EditorLayout.activeTabs`, `DockLayoutOptions.initialActiveTabs`, save on tab click); flush the layout on explicit project Save (`ProjectPanel.onProjectSaved`). Extend `layout-panels.test.ts` (additive `activeTabs`). *(FR-052)*
- [X] T076 Popover: `[hidden] { display: none }` and `.mudra-layout__menu { position: relative; z-index: 40 }` in `editor.css`. *(FR-053)*
- [X] T077 `test/adapters/dock-layout-restore.test.ts`: registration-order matrix, healing, duplicates, active-tab round-trip, popover CSS contract. *(FR-051–053)*
- [ ] T078 **Manual, human**: refresh; restart the dev server; close/reopen and switch projects; arrange left `Project|Explorer` tabs and right `Inspector|Effect|Actions` tabs + Camera/Diagnostics; Save; restart; confirm the same arrangement and every open panel visible; open File/Edit/View over panels and confirm no overlap. Not ticked until performed.

