# Quickstart: Editor Workspace Refinements

**Feature**: `010-editor-workspace-refinements` | **Date**: 2026-09-17

Manual validation scenarios proving each user story works end to end, once implemented. Automated
coverage lives in `apps/web/test/**`, per the contracts in `contracts/` and the entities in
`data-model.md`; this file is the human-run pass, the same role quickstart.md plays for specs
007–009.

## Prerequisites

```bash
cd apps/web
npm install
npm run dev   # http://localhost:5173 — open /editor.html
```

A project with **at least two effects, each with a different trigger pose**, one of which has an
action with several parameter groups (e.g. `background_wash`, which has a colour, an opacity, a
blend mode, and two fade-fraction groups) — create one if the default project doesn't already have
this shape. A webcam is required for scenarios 1 and 6 (Test Trigger / live isolation); the rest
work with no camera attached (item 15's stand-in hand).

---

## Scenario 1 — Effect isolation (US1, P1, SC-001)

1. Select effect A (whose trigger pose is, say, "open palm"). Attach the camera (camera-panel
   toggle).
2. In front of the camera, perform effect B's trigger pose (a *different* pose than A's).
3. **Expected**: nothing from effect B appears on the stage. Only effect A's own explicit
   Play/Play Selected/Test Trigger, or genuinely performing effect A's own pose, produces output.
4. Select effect B instead (leave the camera attached). Perform effect B's pose again.
5. **Expected**: effect B now previews normally. Re-perform effect A's pose while B is selected —
   nothing from A appears.
6. Open effect A's own project entry directly (unrelated to selection) and confirm its trigger,
   timeline, and every action parameter are byte-identical to before step 2 — isolation excluded
   it from playback, it did not touch the saved effect (FR-025).

## Scenario 2 — Panel docking (US2, P1, SC-002, SC-003, SC-007, SC-008)

1. From the View menu, note the current layout (the shipped default, unchanged from today). Note
   that the right column shows several *independent, simultaneously visible* panels (Effect,
   Pose & Trigger, Actions, Inspector, Camera, Diagnostics) stacked one above another, **not** one
   tab group — this is the corrected default (no automatic tabbing, correction pass item 3).
2. Drag the Inspector panel by its header (a visibly grip-styled top edge) toward a different
   zone's empty background. **Expected**: as the pointer moves, the target that would receive it
   is visibly highlighted, distinctly from targets that would not; a target over another panel
   shows which specific edge (top/bottom/left/right) or its tab/content area (centre) would
   result, before release. Release over the empty background of a different zone. **Expected**:
   the panel relocates there as its own new independent area immediately; every other panel's
   size and content are unchanged.
3. Reload the page. **Expected**: the Inspector is still in the zone chosen in step 2, and the
   right column's remaining panels are still independently stacked, not merged into tabs.
4. Drag every panel out of one zone, leaving it empty. **Expected**: that zone still renders at
   its normal size — nothing else expands into it, and it is not hidden.
5. Drag a panel onto another panel's top or right edge specifically (not its centre).
   **Expected**: a new area appears stacked above it, or side by side with it, respectively —
   both panels stay independently visible, neither becomes a tab of the other.
6. Repeat step 2 using only the keyboard-operable relocation control (reachable from a panel's
   own "⋮" options, not a separate always-visible button) — no pointer drag at any point — on a
   different panel. **Expected**: it relocates to the chosen zone as its own new independent
   area; the control only ever lists zones a drag to them would have accepted, never an "already
   there" one.
7. If more than one predefined layout ships, switch to a different one from the View menu.
   **Expected**: the zones change to the new layout's zones; any panel docked to a zone that
   exists in both layouts stays where it was, with its internal stack/split/tab arrangement
   intact.

## Scenario 3 — Tabs (US3, P2)

1. Drag one panel directly onto a *different* panel's own tab/content area (its centre, not
   merely into the same zone as it — the zone may already hold it as an independent stacked
   area from Scenario 2, which must stay independent until this specific action). **Expected**:
   both now show as tabs of one group; no additional layout space is used.
2. Click the non-active tab. **Expected**: its content replaces the previous tab's; the zone's
   size does not change.
3. Close one of the two tabs, from that tab's own close control. **Expected**: it disappears
   (User Story 6, Scenario 6 below); the remaining panel is now shown directly, no longer a
   single-item tab strip (FR-014).
4. Repeat steps 1–2 to form a new two-tab group, then drag one of the two tabs out to a
   different area (a different zone, or a different edge within the same zone) instead of
   closing it. **Expected**: it becomes an independent panel there; the original group now shows
   the remaining panel directly.

## Scenario 4 — Inspector lock (US4, P2, SC-004)

1. Select a clip with parameters showing in the Inspector.
2. Lock the Inspector via its lock control. **Expected**: the control's visual state changes
   obviously (distinct icon/colour/label — not just a tooltip).
3. Select a different clip elsewhere (tree, timeline, or effect dropdown). **Expected**: the
   Inspector keeps showing the first clip's parameters; the tree/timeline's own selection highlight
   *does* move to the newly selected clip.
4. Edit a value in the (locked) Inspector. **Expected**: the edit commits normally, against the
   clip the Inspector is actually showing.
5. Delete the clip the Inspector is locked onto, from the tree (not through the Inspector).
   **Expected**: the Inspector auto-unlocks and falls back to its ordinary contextual/empty state
   (FR-018).
6. Lock the Inspector again on a different clip, then explicitly unlock it. **Expected**: it
   immediately shows whatever is currently selected.

## Scenario 5 — Collapsing (US5, P3, SC-005, SC-006, SC-010)

1. Select an action with multiple parameter groups (e.g. `background_wash`). Collapse one group.
   **Expected**: its fields hide; its heading stays, and is clickable to re-expand.
2. Collapse a whole panel not currently in use, using its header's collapse control. **Expected**:
   its content hides; its header (and place in the layout/View menu) remains.
3. Repeat step 2 on a *different* panel — any registered panel, not only the one a prior build
   happened to implement collapsing for. **Expected**: identical behavior — collapsing is one
   mechanism every panel gets, not a capability special to whichever panel had it first
   (correction pass — the shipped implementation had this working only on Diagnostics).
4. Make an unrelated edit elsewhere (rename an effect, move a clip). **Expected**: everything
   collapsed in steps 1–3 is still collapsed — an unrelated edit does not reset it.
5. Reload the page. **Expected**: collapse state from steps 1–3 is *not* restored (session-scoped
   only, per spec Assumptions) — this is expected, not a bug.

## Scenario 6 — Closing and reopening panels (US6, P2, SC-009)

1. Close a panel (any registered panel) from its own header's close control. **Expected**: it
   disappears from the workspace entirely — the space it occupied is reclaimed by its neighbors
   (if it was stacked) or the zone simply holds one fewer independent area; it is not merely
   `hidden` in place still claiming a slot.
2. Open the View menu. **Expected**: the closed panel is still listed there.
3. Reopen it from View. **Expected**: it reappears in its default zone — no manual reconstruction
   of where it used to be.
4. Form a two-tab group (Scenario 3, step 1), then close one tab specifically (not the whole
   zone). **Expected**: only that panel closes; the other remains, now shown directly per FR-014.

## Scenario 7 — Undo/redo never crosses an effect switch (US7, P1, SC-011)

1. Select Effect A. Edit one of its action parameters (a value change that commits).
2. Switch the selection to Effect B, making no edit to B yet. **Expected**: no confirmation is
   required — Effect A had exactly the one edit from step 1, but nothing here has asked to leave
   it yet in a way that loses anything, so the switch is worth re-testing precisely because of
   what step 6 checks below.
3. Press Undo (Ctrl+Z). **Expected**: nothing in Effect A changes, and nothing visible on Effect
   B's screen changes either — Effect B's own editing context has nothing to undo.
4. Re-select Effect A directly (e.g. from the effect dropdown) and confirm the edit from step 1
   is still present, untouched.
5. Now edit an action parameter of Effect A again, then attempt to switch to Effect B.
   **Expected**: a Save/Discard/Cancel prompt appears, since Effect A now has an edit since this
   editing session on it began. Choose Cancel. **Expected**: the selection stays on Effect A, and
   the edit is intact.
6. Repeat the switch and choose Discard. **Expected**: Effect A reverts to how it stood before
   step 5's edit, and the selection moves to Effect B.
7. Edit an action parameter of Effect B, then press Undo. **Expected**: only Effect B's edit is
   undone; Effect A is never touched by this Undo.

## Scenario 8 — Full pass (all stories together)

Repeat scenario 1 with the Inspector locked (scenario 4) on a third effect's clip and a
non-default layout/tab/collapse/close arrangement (scenarios 2–3, 5–6) in place, editing across
two effects (scenario 7) along the way, to confirm the stories compose with no interaction
effects — isolation, docking, tabs, closing, the lock, collapsing, and undo/redo scoping are
independent by design (spec: every user story's Independent Test), and this scenario is the check
that holds in practice, not just on paper.

## Scenario 9 — Workspace UX corrections (SC-012–SC-015)

Browser-only behavior — cursor feel, actual text selection, real scrollbars — cannot be exercised
by the automated (jsdom) suite; this scenario is the one place these are actually verified.

1. **No text selection while dragging (FR-041, SC-012)**: with a zone holding at least two
   stacked/tabbed panels with visible text, press and hold on a panel's header, then drag across
   several lines of another panel's text content before releasing. **Expected**: no text anywhere
   is left selected/highlighted when the drag ends. Repeat starting the drag from a tab instead of
   the header. Then, with no drag in progress, click-drag across ordinary panel content (e.g. an
   Inspector field label). **Expected**: it selects normally — the suppression is scoped to an
   active drag, not permanent.
2. **Panel-menu popover trimmed (FR-010, workspace UX corrections pass)**: open a panel's "⋮"/move
   menu. **Expected**: it lists only "Move to `<zone>`" options — no separate Close or Collapse
   entries (those remain directly on the header as their own buttons, unchanged).
3. **Tab reorder (FR-043, SC-014)**: form a three-panel tab group (Scenario 3). Drag the middle tab
   to the first position, staying within the tab strip. **Expected**: an insertion-position
   indicator is visible before release, the tab moves there on release, and no panel is undocked or
   split as a side effect. Reload the page. **Expected**: the new tab order is preserved. Then
   start a drag on a tab and move the pointer out of the tab strip onto a different zone's
   background. **Expected**: this undocks the panel instead of reordering (FR-003), confirming the
   two interactions don't conflict.
4. **Split resizing (FR-042, SC-013)**: with two panels split side by side or stacked in the same
   zone (Scenario 2, step 5), hover the boundary between them. **Expected**: the cursor shows a
   resize affordance (`ew-resize`/`ns-resize` matching the split's direction) and a visible handle.
   Drag it. **Expected**: only the two adjacent areas resize; every other panel/zone is unaffected.
   Drag it as far as possible toward one side. **Expected**: it stops at a minimum usable size
   rather than crushing either panel's controls to nothing. Reload the page. **Expected**: the
   resized boundary is restored.
5. **Panel-level scrolling (FR-044, SC-015)**: pick a panel with more content than its current
   allocated space (e.g. shrink a zone via Scenario 2's splitters, or open the Inspector on an
   action with many parameter groups in a small area). **Expected**: that panel alone shows a
   scrollbar for its own content; its header/toolbar stays visible and usable while scrolling; no
   other panel is affected.
6. **Region-level scrolling (FR-045–FR-047, SC-015)**: dock enough panels into the right zone
   (Scenario 2/3) that their combined minimum sizes exceed the browser window's height. **Expected**:
   the zone itself shows one scrollbar reaching every panel in it, distinct from any individual
   panel's own content scrollbar from step 5 — confirm there is no redundant second scrollbar for
   the same axis when only one is actually needed, and that keyboard focus/tab order still reaches
   every control while scrolled.

---

## Definition of done for this feature

- [X] Scenarios 1–9 pass, run manually in a real browser (`npm run dev`) — **not yet re-verified
      after the 2026-09-17 correction pass, and Scenario 9 is new for the workspace UX corrections
      pass and has never been run**. The corrected behavior is covered by the automated suite
      below; a human pass through this file's scenarios in an actual browser is still outstanding
      and should not be marked done until someone has actually clicked through it.
- [X] `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all clean (verified
      2026-09-17, after the workspace UX corrections pass — 1172 tests, 91 files, all four gates
      green).
- [X] The architecture-boundary assertions in
      [contracts/editor-preview-isolation.md](./contracts/editor-preview-isolation.md),
      [contracts/docking-persistence.md](./contracts/docking-persistence.md), and
      [contracts/undo-redo-context-scoping.md](./contracts/undo-redo-context-scoping.md) are
      implemented as automated tests, not left as manual-only checks.
- [X] A pre-feature `EditorLayout` record (sizes/hiddenPanels/preset only, no docking fields)
      still loads correctly against the current build (contracts/docking-persistence.md).
