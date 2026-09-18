# Feature Specification: Editor Workspace Refinements

**Feature Branch**: `010-editor-workspace-refinements`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "Continue pending Milestone 2 editor work — panel docking with
predefined layouts, tabs, a contextual/lockable Inspector, panel and section collapsing, and
isolating the effect under edit from unrelated live pose detection — while explicitly excluding
timeline multi-select and per-particle textures, and without foreclosing a future effect
overlap/priority system on the public page."

## Why this feature exists

Two threads of already-documented pending work meet here, plus one behavior problem found while
using the editor day to day.

`specs/008-effect-editor/future-work.md` Section C ("smaller things noted but not built") named
four items when the effect editor shipped: drag-and-drop panel docking and tabs, undo/redo,
timeline multi-select, and per-particle textures. Undo/redo was since built (Milestone 3, spec
009). This iteration picks up **panel docking and tabs**, the two items whose foundation — the
editor's existing named-region panel registry — already exists. Timeline multi-select and
per-particle textures remain out of scope by explicit decision (see Out of Scope) — this spec does
not schedule them and does not depend on them.

Alongside that, using the editor surfaced three more concrete frictions, not previously
documented: the Inspector always follows the live selection with no way to hold what it is
showing while working elsewhere; several panels (the Inspector chief among them) show every
field/section at once with no way to reduce that to what is currently relevant; and — the most
disruptive of the three — a live camera attached in the editor for previewing one effect can
accidentally recognize an unrelated pose and start *that* pose's own saved effect, so what the
author sees on the stage stops being only the effect they are working on.

## Clarifications

### Session 2026-09-17

- Q: The project's existing chrome (menu bar, icon buttons) is consistently keyboard-accessible.
  Should moving a panel between zones require only a pointer drag, or also have a
  keyboard-operable path? → A: Require a keyboard-operable alternative (a discrete command, not a
  full simulated-drag interaction) alongside pointer drag, from this iteration.

### Session 2026-09-17 (correction pass)

A manual review of the shipped implementation found it did not match this spec's intent in
several load-bearing ways, even though every task in `tasks.md` had been completed. This session
corrects the spec (and, downstream, the plan/tasks/contracts/data-model) to describe the intended
behavior; the implementation and tests are then brought in line with it, not the reverse.

- Q: The shipped docking forced every panel sharing a zone into one automatic tab group, with no
  way to have independent stacked panels — was that ever the intent? → A: No. FR-001/FR-002 (a
  small, fixed set of predefined *layouts*, each with zones that always occupy their space) were
  correct and remain unchanged. What was missing is that a *zone* itself needed to support
  user-directed subdivision — stacking and side-by-side placement, not just tabs — with tabs
  created only by an explicit action, never as the default for sharing a zone. See the rewritten
  "Tabs" and "Panel docking and layouts" requirements below and the new "Dock tree" concept in
  data-model.md.
- Q: Is a fully general, freely-splittable docking surface (arbitrary nested rows/columns, akin to
  a full IDE) now in scope? → A: No. The correction is bounded to what one drag or one keyboard
  command can produce directly against an existing panel (stack above/below/beside it, or tab with
  it) within a zone the active `Layout` already defines. Floating/undocked panels, user-defined
  layout topologies, and nesting deeper than a drag can reach in one step remain out of scope
  (see Out of Scope, updated).
- Q: The "Relocate" popover button was the shipped drag-and-drop — is a button-driven relocation
  UI what this spec intended? → A: No. FR-003's "by dragging it" was to be read literally: the
  primary interaction is a pointer drag with a visible drag handle and live drop-target feedback.
  FR-010's keyboard-operable alternative is retained (accessibility is not being withdrawn) but is
  no longer presented as a standalone, equally-prominent button — it is folded into a per-panel
  options affordance alongside close and collapse, secondary to the drag handle.
- Q: Should a panel be individually closable from its own header, distinct from the existing
  View-menu show/hide checkbox? → A: Yes — this was an omission, not a rejected idea. A closed
  panel must stop consuming layout space entirely (not merely render `hidden` in place while
  still occupying a tab slot, which is what shipped), and View remains its one recovery mechanism,
  reopening it into its default zone. See the new "Panel closing and recovery" requirements.
- Q: Should whole-panel collapsing be a general mechanism, or is a Diagnostics-only
  implementation sufficient? → A: General. FR-021 already said "a whole panel" in the singular,
  general sense; the correction is that the *mechanism* must be reusable by any registered panel,
  not hand-built once for one panel. See the rewritten "Panel and section collapsing" section.
- Q: Is the undo/redo cross-effect-context bug (editing effect A, switching to B, Ctrl+Z affecting
  A) in this spec's scope, given undo/redo itself shipped under spec 009? → A: The fix is scoped
  here because it is this iteration's discovery and because the fix reuses this spec's own
  "Editing scope" concept (US1) as the same boundary undo/redo must respect — one effect selection
  is one editing context for both purposes. See the new "Undo/redo context scoping" requirements;
  spec 009 remains the record of undo/redo's original shipped behavior.
- Q: Is a unified toast/notification system (replacing the "Saved" status text that does not
  reliably clear) in scope for this correction pass? → A: No — recorded as deferred future work
  in `specs/008-effect-editor/future-work.md` Section C, not designed or implemented here.

### Session 2026-09-17 (workspace UX corrections)

Manual use of the shipped, corrected docking system (the dock-tree/tabs/close/collapse work above)
surfaced six further UX gaps, all inside the same docking/chrome territory rather than new feature
area: dragging a panel could select surrounding text; the "⋮" panel-menu popover carried two
options (`Close`, `Collapse`) that duplicate the panel header's own dedicated buttons, reading as
unnecessary chrome; a tab group's order was fixed at whichever order panels joined it, with no way
to rearrange it; a zone holding more than one stacked/split area had no way to resize the boundary
between them; and neither an individual panel's own overflowing content, nor a zone holding more
panels than fit the viewport, had anywhere to scroll.

- Q: Is dragging a panel supposed to ever select text in the panel or its surrounding chrome? → A:
  No — this was never intended; a panel drag is a window/chrome-level gesture, not a text-selection
  one. See the new "no text selection while dragging" requirement below.
- Q: Is the panel-menu popover's `Close`/`Collapse` entries load-bearing, given the header already
  has its own dedicated close and collapse buttons? → A: No — they are pure duplicates of buttons
  already on the same header. The popover is trimmed to its one non-duplicated purpose (the
  keyboard-operable "Move to `<zone>`" path, FR-010) rather than removed outright; nothing FR-010,
  FR-021, or FR-030 requires is lost.
- Q: Should a tab group's order be treated as fixed once panels join it? → A: No — this was an
  omission. A tab group's order is author-directed, the same way its membership already is (User
  Story 3), and reorders persist through the existing docking-arrangement persistence.
- Q: Is manual resizing of the boundary between two areas sharing a zone (stacked or side-by-side)
  in scope, now that a zone can hold more than one independent area? → A: Yes — this was deferred
  implicitly, not excluded; FR-011a already establishes that subdivision is genuinely author-
  directed, and a subdivision the author cannot resize is incomplete. Scope is bounded to the
  boundary between two *directly adjacent* siblings in the dock tree — not an arbitrary multi-pane
  resize spanning non-adjacent areas.
- Q: Should scrolling be handled by applying `overflow: auto` uniformly to every container? → A:
  No — two distinct scroll boundaries are needed (an individual panel's own content, and a zone
  holding more panels than fit its viewport), and applying overflow indiscriminately risks nested,
  redundant scrollbars on the same axis. See the new "Workspace scrolling" requirements.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Only the effect I'm editing plays while I edit it (Priority: P1)

An author has several effects authored for several poses. They open one effect to adjust it,
attach the camera to judge an anchor-based action, and move around while working — inevitably
performing gestures that resemble other poses in the project.

**Why this priority**: This is a correctness problem, not a preference — it actively confuses the
"create → test → adjust" loop every session that uses a live camera with more than one saved
effect in the project, which is the common case past a project's first effect. It is also
independent of every other story here: it touches only how the editor's runtime decides what may
start playing, never a UI surface.

**Independent Test**: With two effects saved for two different poses, select and preview the
first one (Play, Play Selected, or Test Trigger, with a camera attached) while performing the
second effect's pose in view of the camera. Confirm only the first effect's output appears on the
stage, and that closing the first effect and selecting the second lets it preview normally on its
own pose.

**Acceptance Scenarios**:

1. **Given** an effect is selected for editing and a camera is attached, **When** the camera
   detects a pose belonging to a different, unselected effect, **Then** that other effect's saved
   output does not play in the editor.
2. **Given** an effect is selected for editing, **When** the author performs that same effect's
   own pose live in front of the camera, **Then** it is free to preview exactly as before — this
   story isolates *other* effects, not the one being worked on.
3. **Given** an author switches their selection from one effect to another, **When** the camera
   subsequently detects the newly-selected effect's pose, **Then** it previews normally, and the
   previously-selected effect's pose no longer triggers anything.
4. **Given** an effect that is not currently selected, **When** its pose is detected during
   another effect's editing session, **Then** the unselected effect's own saved definition is
   left completely unchanged — isolation hides it from this session's playback, it does not
   touch, disable, or mark the effect itself.

---

### User Story 2 - Rearrange panels into a layout that fits how I'm working (Priority: P1)

An author wants the editor's chrome arranged for the task at hand — more room for the timeline
while arranging clips, more room for parameters while tuning an action, panels grouped so the
ones they don't need right now are out from underfoot rather than gone.

**Why this priority**: This is the most-requested and most-elaborated part of this iteration, and
every later story in this spec (tabs, in particular) builds on the zones it introduces.

**Independent Test**: Drag a panel from its current position onto a different valid target — a
different zone's empty background, or a specific edge of another panel already in a zone — and
confirm it relocates there, stays there across a reload, and that a zone with nothing docked into
it still occupies its place in the layout rather than letting a neighboring zone expand into it.

**Acceptance Scenarios**:

1. **Given** the editor showing its default layout, **When** the author drags a panel by its
   header (a clearly identifiable drag handle, distinguishable at a glance from the rest of the
   panel's chrome) toward another zone or another panel, **Then** the possible results are
   visually indicated before release — a zone's empty background, or a specific edge (top/bottom/
   left/right) of a panel already there for a new adjacent area, or that panel's own tab/content
   target for joining it as a tab — and a target that would not accept the panel is never
   presented as one.
2. **Given** a panel dragged over a valid target, **When** the author releases it there, **Then**
   the panel moves there immediately, the layout re-renders with every other panel's geometry
   otherwise unchanged, and the result matches what was indicated before release.
3. **Given** a layout with more zones than the author currently has panels for, **When** a zone
   has nothing docked into it, **Then** that zone still renders at its layout-defined size —
   neighboring zones do not expand to fill it, and it is not hidden.
4. **Given** the author has rearranged panels — relocated between zones, stacked, split
   side-by-side, or grouped as tabs — **When** they reload the editor, **Then** the same
   arrangement, including the structure within each zone, is restored, the same way panel
   visibility and panel sizes are already remembered today.
5. **Given** the set of predefined layouts, **When** the author picks a different one from the
   View menu (the same menu the existing size presets already live in), **Then** the editor's
   zones change to that layout's zones, and panels already docked to a zone that still exists in
   the new layout stay where they were.
6. **Given** an author who cannot or does not want to perform a pointer drag, **When** they invoke
   the keyboard-operable alternative for moving a panel (reachable from that panel's own options,
   not a separate always-visible button competing with the drag handle), **Then** they can choose
   the panel and its destination zone and have it relocate there — as its own independent area,
   never automatically joined to whatever else is already in that zone — with no pointer
   interaction required at any step.
7. **Given** a zone that currently holds more than one independent panel (stacked or side by
   side), **When** the author looks at it, **Then** each is its own panel with its own header and
   content, not tabs — tabs exist only where the author explicitly created them (User Story 3).

---

### User Story 3 - Group related panels under tabs in one zone (Priority: P2)

An author wants panels that are used in the same moment — say, the Inspector and the Pose &
Trigger panel while wiring up a trigger — to share one screen area as switchable tabs, rather than
each claiming its own stacked or side-by-side area.

**Why this priority**: Builds directly on User Story 2's zones; a tab group is one specific,
explicitly-chosen way two or more panels can share space within a zone — an alternative to
stacking or splitting them, never the default outcome of two panels merely sharing a zone. Not
independently meaningful without zones to live in, but independently testable once they exist.

**Independent Test**: Drag one panel directly onto another panel's own tab/content area (not
merely into the same zone — a zone may already hold that other panel stacked or split, which must
stay independent until this specific action is taken) and confirm they become tabs of one group,
switching between them shows one panel's content at a time, and dragging one of them back out
restores it as an independent stacked/split panel again.

**Acceptance Scenarios**:

1. **Given** two independent panels (stacked or side by side, not tabs) in the current layout,
   **When** the author drags one directly onto the other's own tab/content target, **Then** both
   appear as tabs of that one group and no additional space is claimed — merely dragging one onto
   the general area of a zone that already holds the other, without targeting its tab/content
   area specifically, instead places the dragged panel as its own new independent area (User
   Story 2), never an automatic tab group.
2. **Given** a zone holding a tab group, **When** the author clicks a different tab, **Then** that
   panel's content replaces the previously showing one, with no change to the zone's size.
3. **Given** a panel that is one tab among several, **When** the author drags it out to its own
   area (a different zone, or a different position within the same zone), **Then** it becomes an
   independent panel there and the remaining tabs stay grouped as they were.
4. **Given** a panel that is one tab among several, **When** the author closes it (User Story
   "Panel closing and recovery," below) rather than dragging it out, **Then** it is removed from
   the tab group the same way closing removes any panel from the workspace, and the group's
   remaining membership follows the same rule as Scenario 5.
5. **Given** a tab group with only one tab remaining (every other tab moved or closed elsewhere),
   **When** that state is reached, **Then** the zone shows that one panel directly rather than a
   single-tab strip with nothing to switch between.
6. **Given** a tab group with zero tabs remaining (every panel in it moved or closed elsewhere),
   **When** that state is reached, **Then** the zone's layout no longer reserves a container for
   that former group — it does not persist as an empty tab strip with nothing in it.

---

### User Story 4 - Hold what the Inspector is showing while I work elsewhere (Priority: P2)

An author has a clip's parameters open in the Inspector and wants to reference or compare them
while clicking around the project tree or timeline, without the Inspector jumping to whatever
they click next.

**Why this priority**: A focused quality-of-life fix, valuable on its own, and independent of the
docking/tabs work — the Inspector already exists and already follows selection; this adds one
toggle in front of behavior that is otherwise unchanged.

**Independent Test**: Select a clip, lock the Inspector, select a different clip elsewhere in the
editor, and confirm the Inspector still shows the first clip's parameters until explicitly
unlocked.

**Acceptance Scenarios**:

1. **Given** the Inspector unlocked (the default), **When** the author selects a different clip
   anywhere in the editor, **Then** the Inspector's content updates to that clip, exactly as it
   does today.
2. **Given** the author locks the Inspector while a clip's parameters are showing, **When** they
   select a different clip, **Then** the Inspector keeps showing the originally-locked clip's
   parameters, and editing them still commits normally.
3. **Given** the Inspector is locked, **Then** its locked state is visibly obvious at a glance —
   distinct from the unlocked state — without needing to hover or read a tooltip.
4. **Given** the Inspector is locked, **When** the author explicitly unlocks it, **Then** it
   immediately shows whatever is currently selected, resuming ordinary contextual behavior.
5. **Given** the Inspector is locked onto a clip, **When** that clip is deleted (by any surface,
   including one the author is not currently looking at), **Then** the Inspector does not keep
   showing a stale reference to a clip that no longer exists — it unlocks and falls back to its
   ordinary contextual/empty state.

---

### User Story 5 - Collapse panels and sections to reduce what's on screen at once (Priority: P3)

An author working on one action's parameters wants to collapse the parameter groups they aren't
touching right now, and, when a whole panel isn't currently useful, collapse the panel itself down
to its header.

**Why this priority**: Polish that reduces visual noise; valuable but the least load-bearing story
here — nothing else in this spec depends on it, and the editor is fully usable without it.

**Independent Test**: Collapse a parameter group in the Inspector, confirm its fields hide and the
group's own header stays visible and reopens it; separately, collapse a whole panel and confirm
its content hides while the zone still shows the panel's header and can restore it.

**Acceptance Scenarios**:

1. **Given** a panel section with a group of related fields (e.g., an action's parameter group),
   **When** the author collapses it, **Then** its fields hide and its heading remains, clickable
   to expand it again.
2. **Given** a whole panel the author is not currently using, **When** they collapse it, **Then**
   its body hides while its header (and, for a docked panel, its place in the layout) remains, and
   collapsing it never removes it from the layout or the View menu.
3. **Given** the author has collapsed some sections and panels, **When** they continue working in
   the same editor session (no reload), **Then** those collapsed/expanded states persist without
   the author having to redo them after every unrelated edit.
4. **Given** a panel or section with nothing collapsible in it, **Then** no collapse control is
   shown for it — collapsing is offered only where it does something.

---

### User Story 6 - Close a panel I don't need, and bring it back from View (Priority: P2)

An author working in a cramped zone wants a panel gone entirely — not just tabbed behind another,
not just collapsed to a header — until they explicitly want it back.

**Why this priority**: Directly enables User Story 2's stacking-by-default (several independent
panels in one zone use more total space than one tab group did); without a fast way to close what
isn't needed right now, that becomes friction rather than flexibility. Independent of docking's
internal mechanics — it is a visibility state, the same kind View already manages today.

**Independent Test**: Close a panel from its own header. Confirm it disappears from the workspace
and occupies no layout space. Reopen it from the View menu and confirm it reappears in its default
zone, without having to reconstruct where it used to be.

**Acceptance Scenarios**:

1. **Given** a panel docked anywhere in the workspace, **When** the author closes it (from its own
   header, or one of its tabs specifically, if it is part of a tab group), **Then** it is removed
   from the active workspace and consumes no layout space — a stacked zone with one fewer panel
   gets that space back; a tab group with one fewer tab behaves per User Story 3's Scenarios 4–6.
2. **Given** a panel closed this way, **When** the author opens the View menu, **Then** it is
   listed there (the same list View already shows for every registered panel) and can be reopened
   with one action.
3. **Given** a closed panel is reopened from View, **When** it reappears, **Then** it appears in
   its defined/default zone — the author is never required to manually reconstruct its former
   position, tab membership, or split arrangement.
4. **Given** every panel in the editor is closable this way, **Then** closing is available
   uniformly — not as a capability only some panels happen to have.

---

### User Story 7 - Undo/redo never crosses which effect I'm editing (Priority: P1)

An author edits an action's parameter in Effect A, switches to Effect B to check something, and
presses Undo. They expect either nothing to happen (they haven't touched B yet) or, if they had
made an edit to B, for that edit to be undone — never for their earlier, now out-of-view edit to
Effect A to be silently reverted.

**Why this priority**: A correctness and safety problem, in the same class as User Story 1 — an
edit can be undone without the author seeing it happen, to a project surface they are not even
looking at. Independent of docking/tabs/lock/collapse; it touches only undo/redo's own scoping and
the moment the active effect changes.

**Independent Test**: Edit an action's parameter in Effect A. Switch the selection to Effect B
(with no edit to B). Press Undo. Confirm Effect A's parameter is unchanged and nothing in the
editor moved. Now edit something in Effect B and press Undo — confirm only Effect B's edit is
undone.

**Acceptance Scenarios**:

1. **Given** an effect is selected for editing and has at least one edit made to it during this
   session, **When** the author switches the selection to a different effect, **Then** the editor
   requires an explicit choice before completing the switch: save the changes and continue,
   discard them and continue, or cancel and remain on the original effect.
2. **Given** the author chooses to cancel that switch, **When** the dialog closes, **Then** the
   selection has not changed and no edit has been reverted.
3. **Given** the author chooses to discard, **When** the switch completes, **Then** the effect
   being left reverts to how it stood at the start of this editing session (before any edit made
   to it during this session), and the new effect becomes selected.
4. **Given** the author chooses to save, **When** the switch completes, **Then** every edit made
   to the effect being left is kept exactly as it was, and the new effect becomes selected.
5. **Given** an effect with no edit made to it during this session, **When** the author switches
   away from it, **Then** no choice is required — the switch happens immediately, exactly as
   selecting among effects already does for every other purpose in this editor.
6. **Given** the author is editing Effect B after switching away from Effect A, **When** they
   invoke Undo, **Then** only an edit made to Effect B during this session (since the switch) may
   be undone — an edit made to Effect A, whether saved or already left behind, is never reachable.
7. **Given** Effect B's editing session has no undoable edit yet, **When** the author invokes
   Undo, **Then** nothing happens — it does not reach into Effect A's or any other effect's
   history.
8. **Given** the author invokes Redo after an Undo made within the same effect's editing session,
   **When** it completes, **Then** only that same effect's undone edit is restored — Redo is
   scoped identically to Undo.

---

### Edge Cases

- What happens if the author drags a panel over the zone it is already docked in? Nothing moves;
  the drop is a no-op, not a flicker or a re-mount that would lose the panel's own internal state
  (e.g., an open colour picker).
- What happens if the last panel is dragged out of a zone, leaving it empty? The zone stays in the
  layout at its defined size (User Story 2, Acceptance Scenario 3) — it does not collapse and does
  not become a drop target that behaves differently from any other empty zone.
- What happens when a saved layout/docking arrangement names a panel that no longer exists (a
  future build renamed or removed one)? The rest of the arrangement is restored; the unknown
  panel id is dropped silently, the same tolerance panel visibility already has for an unknown id
  today.
- What happens if the author switches to a different predefined layout while a panel is docked
  into a zone that layout doesn't have? That panel returns to its default zone in the new layout
  rather than disappearing — every registered panel is always docked somewhere in whichever
  layout is active.
- What happens to an Inspector lock across a project switch (opening a different project, or
  undo/redo crossing the point the locked clip was created)? The locked target is scoped to the
  open project; opening a different project, or an undo/redo that removes the locked clip, unlocks
  the Inspector the same way deleting the clip does (User Story 4, Acceptance Scenario 5).
- What happens if two effects that are each individually eligible to be the "effect being edited"
  both claim triggers for the same pose (e.g., the author duplicated an effect)? Isolation is
  scoped to the one effect currently selected for editing — only that specific effect (by
  identity, not by which pose it happens to answer to) is eligible to preview; a duplicate sharing
  the same pose stays isolated out until it is itself selected.
- What happens to a playback that was already running when the author changes which effect is
  selected? It is allowed to finish on its own rather than being cut off mid-effect; only *newly
  starting* playback is subject to isolation from that point on.

## Requirements *(mandatory)*

### Panel docking and layouts

- **FR-001**: The editor MUST offer a small, fixed set of predefined layouts, each explicitly
  defining its own set of docking zones — not an arbitrary, freely-splittable docking surface.
- **FR-002**: Each layout's zones MUST all exist and occupy their defined space regardless of
  whether any panel is currently docked into them; an empty zone MUST NOT collapse, and no other
  zone MUST expand to occupy an empty zone's space.
- **FR-003**: The author MUST be able to move a panel from its current position to any other zone
  the active layout marks as valid for that panel, by dragging it — either onto that zone's empty
  background (becoming its own new independent area there) or onto a specific edge of a panel
  already in that zone (becoming a new adjacent area next to it, stacked above/below or placed
  beside it, per FR-011a).
- **FR-004**: While dragging a panel, the editor MUST visually indicate every valid drop
  target — an empty zone background, a specific edge of another panel (a new adjacent area), or
  that panel's own tab/content area (joining it as a tab, FR-011) — distinctly from targets that
  would not accept it, and distinctly from each other, so the resulting layout is obvious before
  release (correcting the shipped behavior, which offered only whole-zone relocation via a button
  and no drop-target preview at all).
- **FR-005**: A target that cannot currently accept the panel being dragged MUST NOT be presented
  as a drop target during that drag — this applies to zones, to another panel's edges, and to
  another panel's tab/content area alike.
- **FR-006**: Releasing a dragged panel over a valid target MUST dock it there immediately, per
  FR-003/FR-011's rules for what that target produces; releasing it anywhere else, or over the
  panel's own current position, MUST leave the panel exactly where it was, with no re-render that
  would lose its own internal state (e.g., an open colour picker).
- **FR-007**: The author MUST be able to switch between the predefined layouts (from the same menu
  the existing layout size-presets are offered in), and doing so MUST preserve each panel's
  current zone for every zone that exists in both the old and new layout — the internal
  stacking/splitting/tab arrangement within a preserved zone is unaffected by a layout switch.
- **FR-008**: The editor MUST remember, across a reload, each zone's whole internal arrangement
  (which panels it holds, how they are stacked, split, or tabbed) and which predefined layout is
  active, the same way it already remembers panel visibility and panel sizes today.
- **FR-009**: The set of predefined layouts MUST be extensible (a new layout, or a new zone within
  an existing layout, is an addition, not a restructuring of how docking works) — this
  requirement bounds acceptable designs; it does not itself add a layout in this iteration beyond
  what already exists.
- **FR-010**: The author MUST be able to move a panel to a different valid zone through a
  keyboard-operable path that does not require performing a pointer drag (e.g., a command that
  names the panel and the destination zone), offering only the zones that would have accepted it
  as a drop target, and placing it there as its own new independent area — never automatically
  joined to whatever else already occupies that zone (FR-011a). This command is reachable from the
  panel's own options alongside closing and collapsing it (User Story 6, FR-030), not presented as
  a separate, equally-prominent control competing with the drag handle for attention — dragging is
  the primary interaction (FR-003), this is the accessible alternative to it, matching the
  accessibility baseline the rest of the editor's chrome already holds to. This command's menu
  MUST NOT duplicate a control the panel's header already exposes directly (e.g. its own close or
  collapse button) — where a header control already exists for an action, the menu offers only
  what is not already directly reachable (workspace UX corrections pass, trimming the popover to
  its one non-duplicated purpose rather than presenting the same action twice).
- **FR-011a**: A zone MUST support genuine internal subdivision at the author's direction: two or
  more panels sharing a zone MUST be able to coexist as independent stacked or side-by-side areas,
  each with its own header and content simultaneously visible, without being forced into a tab
  group. Sharing a zone MUST NOT, by itself, make panels tabs of one another (correcting the
  shipped behavior, where every panel registered to the same zone became one automatic tab group).
- **FR-041**: Starting a panel drag (by its header, or by a tab — FR-043) MUST NOT select text
  inside the panel, its header, or any other part of the editor's chrome as a side effect of the
  pointer movement; this MUST be achieved by scoping the interaction (the drag handle itself, and
  the state of an active drag) rather than by disabling text selection across the whole
  application. Text selection inside a panel's own content MUST continue to work normally whenever
  a drag is not in progress (workspace UX corrections pass).
- **FR-042**: Where two or more areas directly share a split within a zone (stacked or
  side-by-side, FR-011a), the author MUST be able to resize the boundary between two directly
  adjacent areas by dragging it, with an obvious resize affordance (cursor, visible handle) at that
  boundary; resizing MUST adjust only the two adjacent areas sharing that boundary, MUST enforce a
  sensible minimum size on each so neither area's controls become unusable, and MUST NOT corrupt
  the dock tree's structure (workspace UX corrections pass). Resizing a non-adjacent pair of areas
  in one action, or resizing anything outside a zone's own dock tree, is out of scope (see Out of
  Scope).
- **FR-043a**: The resulting split dimensions from FR-042 MUST persist through the same docking-
  arrangement persistence mechanism the dock tree's structure already uses (FR-008), so a resized
  boundary survives a reload.

### Tabs

- **FR-011**: A zone MUST be able to hold more than one panel presented as tabs of one group, with
  exactly one tab's content visible at once — but only where the author explicitly created that
  grouping (by dragging one panel directly onto another's own tab/content area, or an equivalent
  explicit action), never merely because two panels share a zone (FR-011a).
- **FR-012**: The author MUST be able to switch which tab is showing with one action (a click),
  and switching tabs MUST NOT change the zone's size.
- **FR-013**: The author MUST be able to move a panel into an existing tab group (by dragging it
  onto that group's own tab/content area specifically, not merely into the same zone) and out of
  one (by dragging it to a different valid position, or by closing it — User Story 6), wherever
  the active layout allows that panel to go.
- **FR-014**: A tab group reduced to exactly one panel (every other tab moved or closed out) MUST
  present that panel directly, without a single-item tab strip; a tab group reduced to zero panels
  MUST NOT persist as an empty container in the layout.
- **FR-043**: Within a tab group, the author MUST be able to reorder its tabs by dragging one
  within the tab strip, with the insertion position made visually clear before release; this MUST
  be a distinct interaction from dragging a tab out of the strip onto a docking target (FR-003,
  FR-013) — reordering MUST NOT undock the tab or create a new split, and dragging out MUST NOT be
  interpreted as a reorder (workspace UX corrections pass). A tab group's order is otherwise
  deterministic (registration/arrival order until explicitly reordered) and persists through the
  same docking-arrangement persistence mechanism FR-008 already provides; reopening a closed panel
  whose prior tab position still exists in the persisted arrangement MUST NOT discard that
  arrangement's recorded order.

### Panel closing and recovery

- **FR-030**: Every registered panel MUST be individually closable from its own header (and, for a
  panel currently presented as one tab among several, from that specific tab), independent of
  whether it also has a keyboard-operable path (FR-010) or a whole-panel collapse control
  (FR-021).
- **FR-031**: Closing a panel MUST remove it from the active workspace entirely — it MUST NOT
  continue to consume layout space (e.g., as a hidden-but-still-reserved tab slot) — while leaving
  it registered: still listed in the View menu, still reopenable.
- **FR-032**: Reopening a closed panel from the View menu MUST place it in its defined/default
  zone, without requiring the author to manually reconstruct its former zone, stack position, or
  tab membership.
- **FR-033**: Closing the last remaining panel of a tab group or a stacked/split area MUST remove
  that now-empty group or area from the layout, per FR-014's zero-panel rule — never leaving a
  useless empty container.

### Workspace scrolling

- **FR-044**: Where an individual panel's own content is taller than the space its area currently
  allocates it, that panel MUST offer its own scrollbar for its content specifically; the panel's
  header/toolbar MUST remain visible and usable while its content scrolls (workspace UX
  corrections pass).
- **FR-045**: Where the combined size of the independent areas stacked or split within one zone
  exceeds that zone's own available space, the zone MUST offer a scrollbar that reaches every area
  in it, distinct from any individual panel's own content scrollbar (FR-044).
- **FR-046**: FR-044 and FR-045 MUST NOT both produce a scrollbar for the same axis when only one
  is genuinely needed — scrolling MUST be placed at the specific content boundary that actually
  overflows (an individual panel's content, or the zone as a whole), not applied indiscriminately
  to every container in between.
- **FR-047**: Existing internal collapsible sections (FR-020) and keyboard navigation/focus MUST
  continue to work normally with FR-044/FR-045's scrolling in place — scrolling to a focused
  control MUST behave as ordinary browser scroll-into-view behavior, not a bespoke mechanism.

### Contextual Inspector and lock

- **FR-015**: The Inspector MUST continue to reflect the current selection automatically by
  default, using the editor's single existing selection model — this feature MUST NOT introduce a
  second, parallel notion of "what is selected."
- **FR-016**: The author MUST be able to lock the Inspector to what it is currently showing, and
  unlock it, through one clearly visible, clearly labelled control.
- **FR-017**: While the Inspector is locked, further selection changes anywhere in the editor MUST
  NOT change what the Inspector displays; every other surface (project tree, timeline, effect
  panel) MUST continue to reflect the live selection normally.
- **FR-018**: The Inspector's locked/unlocked state MUST be visually distinguishable at a glance,
  without requiring a hover or a tooltip to determine which state it is in.
- **FR-019**: If the entity a locked Inspector is showing stops existing (deleted, or removed by
  an undo/redo, or the project is switched), the Inspector MUST unlock and fall back to its
  ordinary contextual/empty state rather than continuing to reference something gone.

### Panel and section collapsing

- **FR-020**: Where a panel's own content is organized into distinct sections (e.g., a parameter
  group), each section MUST be independently collapsible and expandable without affecting any
  other section's state.
- **FR-021**: A whole panel MUST be collapsible to a compact, header-only state and expandable back
  to its full content, without removing it from its zone or from the View menu's list of panels —
  distinct from closing (FR-030): a collapsed panel remains part of the workspace and occupies
  minimal space; a closed one is removed and recovered through View. This MUST be provided as one
  reusable mechanism every registered panel gets uniformly (from the same docking chrome FR-030's
  close control and FR-010's move command live in), not implemented separately by each panel that
  happens to want it — correcting the shipped behavior, where only one specific panel (Diagnostics)
  had its own hand-built whole-panel collapse and every other panel had none.
- **FR-022**: Collapsed/expanded state, for both whole panels and internal sections, MUST persist
  for the remainder of the editor session (i.e., survive further, unrelated edits) without
  requiring the author to reapply it.
- **FR-023**: A panel or section with nothing meaningful to collapse (e.g., a single field, or a
  panel with only one always-visible section) MUST NOT present a collapse control.

### Undo/redo context scoping

- **FR-034**: The single effect currently selected for editing (the same "editing scope" concept
  FR-024 already defines for isolation) MUST also be the boundary undo/redo respects: an edit MUST
  be undoable/redoable only while the effect it was made to remains the active editing context.
- **FR-035**: Before completing a change of which effect is selected, if the effect being left has
  at least one edit made to it since it became the active editing context, the editor MUST require
  an explicit choice — save the changes and continue, discard them and continue, or cancel and
  remain on the original effect — rather than switching silently.
- **FR-036**: Choosing to discard MUST revert the effect being left to how it stood at the moment
  it became the active editing context (before any edit made to it during that session), before
  the switch completes.
- **FR-037**: Choosing to save MUST keep every edit made to the effect being left exactly as it
  was, with no reversion, before the switch completes.
- **FR-038**: An effect with no edit made to it since becoming the active editing context MUST be
  left without requiring this choice — switching away from an untouched effect is exactly as
  immediate as it was before this correction.
- **FR-039**: Once a different effect becomes the active editing context, an Undo or Redo invoked
  thereafter MUST be capable of affecting only edits made to *that* effect since it became active —
  never an edit belonging to a previously active context, whether that edit was saved or
  discarded when its context was left.
- **FR-040**: An Undo or Redo invoked when the active editing context has no undoable/redoable
  edit of its own MUST have no effect — it MUST NOT reach into a different context's history.

### Effect isolation during editing

- **FR-024**: While an effect is selected for editing in the editor, only that effect's own
  playback (started explicitly — Play, Play Selected, Test Trigger — or by the author genuinely
  performing that effect's own pose live) MUST be eligible to start during that session.
- **FR-025**: A live pose detected while editing that matches a *different* effect's trigger MUST
  NOT start that other effect's playback, regardless of how confidently or clearly it was
  detected.
- **FR-026**: Effect isolation MUST NOT alter, disable, or otherwise touch any effect's saved
  definition — an effect excluded from playback by isolation remains exactly as authored and
  becomes eligible again the moment it is itself selected for editing.
- **FR-027**: Switching which effect is selected MUST update, without further action, which single
  effect is eligible to preview from live detection — the previous selection's exclusion from
  isolation and the new selection's inclusion both take effect together.
- **FR-028**: A playback already running when the selection changes MUST be allowed to finish
  rather than being forcibly stopped by the selection change itself.
- **FR-029**: This isolation MUST apply only to the editor's own preview session and MUST NOT
  change how effects are triggered, matched, or played on the public-facing default experience —
  its "every matching effect plays, nothing picks a winner" behavior is unaffected by this
  feature.

### Key Entities

- **Layout**: A named, predefined arrangement of docking zones for the editor's chrome — distinct
  from the existing size *presets* (which only resize the current fixed regions). A layout defines
  which zones exist and their default sizes; it does not itself hold panel content.
- **Zone**: One named docking location within a layout. A zone always exists and always occupies
  its layout-defined space, whether or not any panel is currently docked into it. A zone's
  *contents* are a dock tree, below — not itself a single panel or a single tab group; it may hold
  several independent stacked/side-by-side areas, any one of which may in turn be a tab group.
- **Panel**: A registered piece of editor content (Project, Explorer, Assets, Effect, Pose &
  Trigger, Actions, Inspector, Camera, Diagnostics, Timeline, and any future addition) — unchanged
  in what it is, newly mobile in where it can be docked, individually closable (User Story 6), and
  individually collapsible (below) regardless of where it is docked.
- **Dock tree**: The arrangement within one zone — either a *tab group* (below) or a *split*
  dividing the zone's space between two or more child areas, stacked (one above another) or placed
  side by side, each of which is itself a tab group or a further split. What one drag or one
  keyboard command against an existing panel produces directly (User Story 2); never a
  freely-authored, arbitrarily deep layout. A split additionally carries the relative size of each
  of its children — absent means an equal share, present once the author resizes that boundary
  (FR-042) — and structural edits to a split's children (a new sibling inserted or removed) reset
  that split back to an equal share rather than remapping a now-mismatched set of sizes.
- **Tab group**: A dock-tree node holding more than one panel, exactly one showing at a time —
  created only by an explicit action targeting another panel's own tab/content area (User Story
  3), never merely by sharing a zone with it. Its members have a deterministic order (arrival order
  until the author explicitly reorders it, FR-043), which the group's tab strip presents left to
  right and which persists the same way the rest of the dock tree does.
- **Docking arrangement**: The persisted record of each zone's whole dock tree and which layout is
  active — extends the existing persisted layout record (today's panel sizes/visibility/preset)
  rather than replacing it.
- **Closed panel**: A registered panel currently absent from every zone's dock tree — it consumes
  no layout space and is not part of the workspace, but remains listed (and reopenable) in the
  View menu (User Story 6). Distinct from a *collapsed* panel, below, which stays part of the
  workspace.
- **Inspector lock**: A boolean, editor-session state (not part of a project document) naming
  which selection the Inspector is held on while locked, and reverting to "follow the live
  selection" the moment it is unlocked or its target stops existing.
- **Collapse state**: Per-panel (whole-panel, via one mechanism every registered panel shares) and
  per-section (internal to a panel, e.g. Inspector's parameter groups) boolean state
  (expanded/collapsed), kept for the editor session, not part of a saved project document.
- **Editing scope / editing context**: The single effect, if any, currently selected for editing —
  the set of effects eligible to start playback from a live-detected pose while editing (User
  Story 1), *and* the boundary undo/redo is scoped to (User Story 7): always exactly the selected
  effect or nothing, for both purposes, by the same one concept.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With two or more effects saved to different poses, previewing one effect with a
  camera attached never shows another effect's output, in 100% of sessions — eliminating the
  confusion this spec's Story 1 exists to fix.
- **SC-002**: An author can relocate a panel to a different valid zone in three actions or fewer
  (grab, drag, release), with the outcome visible before release in every case.
- **SC-003**: A rearranged panel/tab/layout arrangement is exactly restored after a reload, with
  no manual reconstruction, in 100% of cases where the panels involved still exist.
- **SC-004**: An author can lock the Inspector, work with a different selection elsewhere, and
  return to the locked content, without the locked content ever changing in between, across an
  arbitrary number of intervening selections.
- **SC-005**: A collapsed panel or section stays collapsed through ordinary editing (adding,
  removing, or adjusting unrelated actions/clips) for the remainder of the session, with no
  measured case of it silently re-expanding.
- **SC-006**: The number of simultaneously visible parameter fields/sections in the Inspector, for
  an action with several groups, can be reduced to just the groups currently relevant, at the
  author's choice.
- **SC-007**: Every panel relocation achievable by dragging is also achievable with no pointer
  interaction at all, through the keyboard-operable alternative, in 100% of valid panel/zone
  combinations.
- **SC-008**: Two or more panels can occupy one zone as independent, simultaneously-visible
  stacked or side-by-side areas — not tabs — in every session, with tabs appearing only where the
  author explicitly created them.
- **SC-009**: A closed panel occupies zero layout space and is reopenable from View into its
  default zone in one action, in 100% of cases, for every registered panel.
- **SC-010**: Whole-panel collapse is available for every registered panel through the same one
  mechanism — not a capability only present on whichever panel happened to have it hand-built.
- **SC-011**: With an edit made to Effect A, then Effect B selected instead, Undo never modifies
  Effect A's data in 100% of sessions — eliminating this correction pass's Story 7 defect the same
  way SC-001 eliminates Story 1's.
- **SC-012**: Dragging a panel by its header or a tab, across any distance and any number of other
  panels' text content, never leaves any text selected when the drag ends, in 100% of drags — and
  text inside panel content remains normally selectable whenever no drag is in progress.
- **SC-013**: The boundary between any two directly-adjacent areas sharing a zone's split can be
  resized by the author, with the resulting sizes surviving a reload, in every zone that holds more
  than one area.
- **SC-014**: A tab can be moved to any other position within its own tab group by the author, with
  the resulting order surviving a reload.
- **SC-015**: For a panel or zone whose content/combined areas exceed the space available to them,
  a scrollbar reaches the overflowing content in 100% of cases, with no more than one scrollbar per
  axis appearing for content that only needs one.

## Assumptions

- **Docking scope for this iteration**: "a small, fixed set of predefined layouts" starts from the
  editor's current three-region shape (left / center-with-timeline / right) as one layout, adding
  zone variety incrementally rather than shipping several exotic topologies up front. The precise
  additional layouts to ship are an implementation decision for planning, not fixed here. Within
  each zone, the dock tree (stacking, side-by-side splitting, tab grouping) is genuinely
  author-directed, per the correction pass above — this is the one point where the original spec's
  intent and the first implementation diverged, and where this revision is authoritative.
- **What "editing an effect" means for isolation (Story 1)**: scoped to whichever effect is
  currently selected in the editor's existing single-selection model — no new "am I actively
  testing right now" mode is introduced. An effect is in scope for isolation for as long as it is
  the selection, whether the author is actively clicking Play or simply has it open while
  adjusting a parameter.
- **Collapse/lock persistence is session-scoped, not saved with the project**: matches an existing
  precedent elsewhere in the editor (the project explorer's own expand/collapse state is already
  kept only in memory for the running session) and avoids adding new fields to the project
  document for editor-only UI state, consistent with undo/redo (spec 009) being editor state
  rather than project data.
- **Docking arrangement persistence reuses the existing layout store**: the same mechanism that
  already remembers panel visibility, panel sizes, and the active size preset is extended to also
  remember each zone's whole dock tree, rather than introducing a second persistence path for
  editor chrome. The shape persisted for this is a correction-pass detail, not a user-facing
  guarantee — what's promised is the arrangement is restored (FR-008), not any particular
  serialization of it.
- **No new top-level milestone authorization is required**: this iteration operates entirely
  within the existing Mudra Web editor (constitution Principle VI's Milestone 2/effect-editor
  authorization) — it adds no new persisted data category, touches no capture or recognition
  boundary, and introduces no new runtime dependency category. It is scoped as a continuation of
  already-authorized editor work, not a new milestone.

## Technical Constraints *(given, not derived)*

- The effect runtime's core matching rule — every matching effect plays, nothing picks a winner —
  is a stated architectural decision that applies unmodified to the public-facing default
  experience. This feature's isolation is scoped to the editor's own runtime instance and must not
  change that rule for the public experience.
- The editor's runtime/drawing boundary is unmodified: one controller remains the only place
  effects are advanced for the editor, and one renderer remains the only place anything is drawn.
  Nothing about isolation, docking, tabs, the Inspector lock, or collapsing may add a second
  execution or drawing path.
- The editor's existing single selection model — the one effect-and-optional-clip pair the project
  explorer, the effect dropdown, the timeline, the effect panel, and the Inspector already all
  read from — is the selection source of truth. The Inspector lock sits in front of this model as
  an opt-in hold; it does not replace or duplicate it.
- The editor's existing named-region panel registry (panels register into a region and can be
  shown/hidden without being destroyed) is the foundation docking builds on, per the prior
  iteration's own note that this is the structure a docking system would build on.
- No new runtime dependency may be introduced without a concrete architectural reason — the
  existing panel-registry and pointer-driven drag/resize patterns already established elsewhere in
  the editor's chrome are the approach for this kind of interaction in this codebase.

## Out of Scope

- **Timeline multi-select.** Remains deferred (`specs/008-effect-editor/future-work.md` Section C)
  — the timeline's selection stays exactly one clip.
- **Per-particle textures / sprite particles.** Remains deferred (same Section C) — untouched by
  this iteration.
- **Unbounded, freely-authored docking** (floating/undocked panel windows, user-defined layout
  topologies saved and named by the author, nesting deeper than one drag against an existing panel
  produces). This iteration is predefined layouts with predefined zones, each holding a dock tree
  shaped only by direct stack/split/tab actions against a panel that is already there — not a
  general-purpose docking surface, and this spec's design must not foreclose evolving toward one
  later. (Bounded subdivision *within* a zone — stacking, side-by-side splitting, explicit tab
  grouping — is in scope; see the correction pass above and User Stories 2–3.)
- **Full keyboard equivalence of the drag gesture itself** (e.g., arrow keys simulating a drag step
  by step, matching the WAI-ARIA drag-and-drop pattern exactly, or a keyboard path that names a
  specific stack/split/tab position rather than a destination zone). FR-010's discrete
  choose-panel/choose-zone command satisfies this iteration's accessibility requirement without
  building a parallel simulated-drag interaction.
- **A unified toast/notification system.** The "Saved" status text not reliably clearing (noticed
  during this correction pass) motivates one, but it is recorded as future work
  (`specs/008-effect-editor/future-work.md` Section C) and not designed or implemented here.
- **Persisting undo/redo history, or the editing-context boundary itself, as part of a project
  document.** Both remain editor-session state, unchanged from spec 009's original framing —
  correcting undo/redo's *scoping* does not change what kind of state it is.
- **An effect overlap/priority/composition system on the public-facing experience.** Recognized
  while investigating Story 1 as a related, separate future problem (multiple poses triggering
  overlapping effects simultaneously on the public page) — not designed or implemented here. This
  spec's isolation work must not make that future system harder to add later (see Technical
  Constraints).
- **Any change to recognition, matching, thresholds, hold semantics, or the shipped action
  catalog.** This iteration is editor chrome and editor-runtime scoping only.
- **Persisting Inspector-lock or collapse state as part of a project document**, or syncing either
  across devices/sessions — both are editor-session state (see Assumptions).
- **A constitution amendment.** This iteration is scoped to already-authorized editor territory
  (see Assumptions); if that turns out not to hold once the implementation plan inspects the
  constitution in detail, resolving that is a prerequisite for planning, not part of this
  specification.
- **Resizing spanning non-adjacent areas, or any area outside a zone's own dock tree, in one
  action.** FR-042 is bounded to the boundary between two areas that directly share one split —
  not a general multi-pane resize tool, and not the three existing whole-region (left/right/
  timeline) splitters, which are unchanged by this pass.
- **A full drag-and-drop keyboard equivalent for tab reordering.** FR-043's pointer drag is the
  primary interaction; a discrete keyboard reorder command is not introduced in this pass (distinct
  from FR-010's existing keyboard relocation-to-zone command, which is unaffected).

## Dependencies

- The editor's existing panel registry and layout-persistence mechanism — this feature extends
  both rather than replacing them.
- The editor's existing single selection model and its "reveal the surface that answers a
  selection" pattern — the source of truth the Inspector lock and contextual behavior sit in front
  of.
- The editor's existing runtime controller and its effect-catalog matching behavior — what effect
  isolation scopes down for the editor's own runtime instance, specifically.
- The editor's existing controlled preview environment (the stand-in hand and debug overlay
  already provided with no camera attached) — the same conceptual territory effect isolation
  extends.
