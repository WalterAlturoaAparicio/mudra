# Data Model: Editor Workspace Refinements

**Feature**: `010-editor-workspace-refinements` | **Date**: 2026-09-17

The smallest model that satisfies the specification. Every field below exists because a functional
requirement needs it; nothing is present "in case it is useful later" (research D1, D6, D7).

Layout/Zone/docking-arrangement types are immutable value objects, framework-free, alongside the
existing `panel-sizes.ts`/`layout-store.ts` data. Inspector-lock and collapse state are ordinary
mutable fields on the existing presentation-layer classes that already own the state they extend
(research D6, D7) — not new standalone types with their own module.

---

## Layout

A named, predefined arrangement of docking zones (spec Key Entities). Distinct from the existing
size *presets* (`panel-sizes.ts`'s `LAYOUT_PRESETS`), which vary the dimensions of one fixed
topology; a `Layout` varies the topology itself.

| Field | Type | Source | Why it exists |
|---|---|---|---|
| `id` | string | hand-authored, data | Stable identity — what a persisted docking arrangement and the View menu refer to it by (FR-007, FR-008) |
| `label` | string | hand-authored, data | Shown in the View menu's layout switcher, alongside the existing size presets |
| `zones` | `readonly Zone[]` | hand-authored, data | The docking zones this layout defines (FR-001) |
| `gridTemplate` | string (CSS `grid-template-columns`/`-rows`/`-areas`) | hand-authored, data | Realizes the zones geometrically (research D1) — one layout is one grid template, not a computed one |
| `defaultZoneFor` | `Readonly<Record<string, string>>` (panel id → zone id) | hand-authored, data | Where each of the editor's registered panels starts in this layout, before any author rearranges anything |

**Invariants**

- `zones` is non-empty and every zone id in it is unique within the layout (FR-001).
- `gridTemplate` allocates space to every zone in `zones`, including one with nothing currently
  docked into it — an empty zone occupies exactly the space its `Zone` entry defines, permanently,
  not conditionally (FR-002).
- `defaultZoneFor` names only zone ids present in `zones`.
- The stage/canvas area is never a `Zone` — it has no id in this model, the same way today's
  `DockRegion` excludes `'center'` ("the stage and takes no panels").
- The set of `Layout` values is a small, fixed list (FR-001, Out of Scope) — extending it is
  adding one more value, never introducing a field that makes a `Layout` computed or
  user-composable (constitution v1.9.0: "predefined zones only, for now").

---

## Zone

One named docking location within a `Layout` (spec Key Entities).

| Field | Type | Source | Why it exists |
|---|---|---|---|
| `id` | string | hand-authored, data | Referenced by a docking arrangement's per-zone dock tree |
| `label` | string | hand-authored, data | Shown in the keyboard-operable relocation control's zone list (FR-010) and any drop-target affordance |
| `gridArea` | string | hand-authored, data | The named CSS grid area this zone occupies within its layout's `gridTemplate` |

**Invariants**

- A `Zone` always exists and always occupies its `gridArea`'s space while its `Layout` is active,
  independent of whether any panel is currently docked into it (FR-002) — there is no "occupied"
  vs. "unoccupied" variant of a zone's own geometry.
- Any registered panel is a valid relocation target for any `Zone` of the currently active
  `Layout` — validity is scoped by *layout* (which zones exist at all), not by a per-panel
  allow-list, mirroring how today's three regions already accept any panel registered into them.
- A `Zone`'s *contents* are a **dock tree** (below), not a single panel or a single flat list —
  it MAY hold zero panels, or any number arranged as independent stacked/side-by-side areas, any
  one of which MAY itself be a **tab group** (below). Two panels sharing a zone are independent
  areas by default; a tab group exists only where the author explicitly created one (FR-011a).

---

## Dock tree

The arrangement within one zone (spec Key Entities; correction pass, 2026-09-17 — supersedes an
earlier "Docking arrangement"/"Tab group" model in which a zone was a flat, always-implicitly-
tabbed list; see spec.md's Clarifications). A small, recursive value type — not a general layout
language — bounded to exactly the shapes one drag or one keyboard command against an existing
panel can produce directly.

```ts
type DockNode =
  | { kind: 'leaf'; panelIds: readonly string[] }   // a tab group: 1 panel, or several as tabs
  | {
      kind: 'split';
      direction: 'row' | 'column';
      children: readonly DockNode[];
      sizes?: readonly number[];                    // workspace UX corrections pass (FR-042)
    };
```

| Variant | Field | Type | Why it exists |
|---|---|---|---|
| leaf | `panelIds` | `readonly string[]`, never empty while the leaf exists | The panel(s) sharing this one area, in tab-strip order — more than one is a **tab group**; order is author-reorderable (FR-043) and otherwise defaults to arrival order |
| split | `direction` | `'row' \| 'column'` | Side-by-side (`row`) or stacked (`column`) division of the parent's space |
| split | `children` | `readonly DockNode[]`, always ≥ 2 | The child areas the split divides space between, each itself a leaf or a further split |
| split | `sizes` | `readonly number[] \| undefined`, same length as `children` when present | Relative weight of each child, set by an author resize (FR-042); absent means an equal share, matching every split before this field existed |

**Invariants**

- A `leaf`'s `panelIds` is never empty while the leaf exists — removing its last panel removes
  the leaf itself, not a leaf with zero members (FR-014, FR-033). Reordering (FR-043) permutes this
  array in place; it never changes the *set* of ids in it, so `leafKey` (`dock-layout.ts`'s
  order-independent identity for "which tab is active") is unaffected by a reorder.
- A `split` always has at least two children — one that would drop to one collapses into that
  child directly, replacing the split (same rule, one level up: no redundant single-child
  container).
- `sizes`, when present, always has exactly one entry per `children` entry, in the same order.
  Any operation that changes the *number* of a split's children (a new sibling inserted via
  `insertAdjacent`, a child removed via `removePanel`/`sanitize`) drops `sizes` back to `undefined`
  (equal redistribution) rather than attempting to remap a now-mismatched-length array — the
  simplest rule that can never desync from `children`. Only an explicit resize (FR-042) sets
  `sizes`, and it only ever changes two adjacent entries' weights (the two children sharing the
  dragged boundary), leaving every other entry as it was.
- A given panel id appears in at most one leaf across the *whole* docking arrangement (every
  zone's tree together) at any time — moving a panel is always "remove it from wherever it is,
  then insert it at the destination," never a copy.
- Every operation that produces a `DockNode` (drag onto an edge → new split; drag onto a leaf's
  own tab/content area → merged leaf; drop on empty background → appended stacked leaf; closing
  a panel → removal; reordering a tab within its own leaf; resizing a split's boundary) is one
  bounded, structural edit driven by one user action — never an open-ended, freely-authored tree
  (Out of Scope: unbounded docking).

---

## Docking arrangement (persisted)

The record of each zone's dock tree, and which `Layout` is active (spec Key Entities). Extends
the existing persisted `EditorLayout` (`domain/ports/layout-store.ts`) with **optional** fields
(research D5), rather than a separate record.

| Field | Type | Source | Why it exists |
|---|---|---|---|
| `activeLayoutId` | `string \| undefined` | author's layout switch | Which `Layout` is in effect; absent means the shipped default layout (FR-008) |
| `zoneLayouts` | `Readonly<Record<string, DockNodeData>> \| undefined` | author's drag/keyboard relocation | Each zone's whole dock tree; absent means every panel is at its active layout's `defaultZoneFor`, each its own stacked leaf (FR-008) |

`DockNodeData` is the plain-data shape of `DockNode` above, declared in
`domain/ports/layout-store.ts` itself (not imported from the presentation-layer `dock-tree.ts`) —
the same reason the superseded `PanelPlacement` used to live there: the port persists plain data,
and `domain/**` may not import `presentation/**` (`test/architecture/layering.test.ts`).

**Invariants**

- Both fields are optional, exactly like `hiddenPanels`/`preset` before them — a record written
  before either feature existed still loads, with every panel falling back to its active layout's
  default placement, each its own stacked leaf (research D5).
- A `zoneLayouts` entry naming a zone id absent from the currently active layout is dropped
  wholesale on load; within a tree that does apply, a leaf naming a panel id no longer registered
  is sanitized out (dropping just that id, and the leaf/split it was in, per the dock tree's own
  shrink rules above) — the same tolerance `DockLayout.setPanelVisible` already has for an
  unknown panel id (spec Edge Cases, contracts/docking-persistence.md).
- Switching `activeLayoutId` preserves every zone's tree whose zone id exists in the new layout
  unchanged (structure included), and falls back to default placement for any panel whose zone
  does not exist in the new layout (spec Edge Cases, FR-007).
- This field replaced an earlier `zoneAssignments`/`PanelPlacement` shape (a flat per-panel
  zone+tab-index map) outright, rather than extending it — that shape could not represent a
  stack or a side-by-side split at all, and was never produced by a released build (this same
  feature, corrected before merge), so no migration path was needed for it specifically.
- A split's `sizes` field (added in the workspace UX corrections pass, FR-042) is itself optional
  within an already-optional `zoneLayouts` — a `zoneLayouts` record written before resizing existed
  has every split's `sizes` simply absent, which already means "equal share," so no separate
  compatibility handling is needed beyond what `sizes`'s own optionality already provides.

---

## Inspector lock

Editor-session state (spec Key Entities) — not persisted, not a project-document field — held on
`EditorShell`, the class that already owns the live selection this lock sits in front of
(research D6).

| Field | Type | Source | Why it exists |
|---|---|---|---|
| `lockedSelection` | `{ effectId: string; entryIndex: number \| null } \| null` | author toggling the lock control | The selection pair the Inspector is held on; `null` means unlocked (follow the live selection) |

**Invariants**

- When `lockedSelection` is non-`null`, the Inspector's `render()` is called with
  `lockedSelection`, never with the live `selectedEffectId`/`selectedEntryIndex` (FR-016). Every
  other surface continues to read the live pair — this field is consulted in exactly one place.
- Locking captures the *current* live selection pair as `lockedSelection`; it does not create a
  new selection concept, and the live selection continues to change normally underneath it
  (FR-014, FR-017).
- If the effect or entry `lockedSelection` names no longer exists (deleted, or an undo/redo
  crosses the point it was created, or the project is switched), `lockedSelection` is reset to
  `null` and the Inspector reverts to following the live selection (FR-018, spec Edge Cases).
- `lockedSelection` is never read by, or written into, anything persisted — it does not survive a
  reload, and does not appear in a saved project document (constitution v1.9.0, "editor-only
  application/presentation state").

**Lifecycle**

```text
        unlocked (lockedSelection = null, the default)
              │ author locks (captures live selection)
              ▼
        locked (lockedSelection = {effectId, entryIndex})
              │                                  │
              │ author unlocks                   │ locked target stops existing
              ▼                                  ▼
        unlocked ◄─────────────────────── unlocked (auto-reset)
```

---

## Collapse state

Editor-session state (spec Key Entities) — two independent kinds, at two different owners
(correction pass, 2026-09-17: whole-panel collapse moved from "local to whichever one panel
happened to implement it" to a single reusable mechanism; see spec.md's Clarifications).

| Field | Type | Owner | Why it exists |
|---|---|---|---|
| `collapsedPanelIds` | `Set<string>` | `DockLayout` (`presentation/editor/dock-layout.ts`) | Whole-panel collapse to a header-only state (FR-021) — **one** mechanism, keyed by panel id, that every registered panel gets through its docking header, not a per-panel reimplementation |
| `collapsedSectionIds` | `Set<string>` | the panel instance itself (e.g. `Inspector`) | Which of the panel's own internal sections (e.g. an inspector parameter group) are collapsed (FR-020) — same shape `ProjectTree`'s existing `collapsed` field already uses for action-list groups; necessarily per-panel, since only the panel itself knows its own section structure |

**Invariants**

- Both fields are session-scoped: they live exactly as long as `DockLayout`/the owning panel
  instance does, the same as `ProjectTree`'s existing collapse state today, and are never read
  from or written to any store (FR-022, constitution v1.9.0).
- A panel or section with nothing meaningful to collapse simply never reads these fields and
  renders no collapse control (FR-023) — there is no "collapsed: N/A" state to model.
- Collapsing a whole panel (adding its id to `collapsedPanelIds`) hides only that panel's own
  content element, never its header — and never touches `collapsedSectionIds`, which continues
  to belong to the panel instance and is unaffected by the panel around it being collapsed.
- Collapsing is independent of closing (`DockLayout`'s `closedPanelIds` — Key Entities, "Closed
  panel"): a collapsed panel is still part of a zone's dock tree and still consumes its (now
  minimal) share of that zone's space; a closed one is not part of any dock tree at all.

---

## Editing scope (derived, not stored)

The single effect, if any, currently selected for editing — the set of effects eligible to start
playback from a live-detected pose while editing (spec Key Entities). Not a field anywhere; a pure
function of existing state, computed fresh whenever it is needed (research D8).

```text
isolatedCatalog(catalog: EffectCatalog, selectedEffectId: string | null): EffectCatalog
```

| Input | Type | Source |
|---|---|---|
| `catalog` | `EffectCatalog` | the open project's full, authored catalog (unchanged, still the source of truth for editing) |
| `selectedEffectId` | `string \| null` | `EditorShell`'s existing live selection |

**Invariants**

- Returns a catalog containing at most one effect: the one named by `selectedEffectId`, if it
  exists in `catalog`; otherwise an empty catalog (FR-024, FR-026).
- Pure and total: no side effects, no I/O, never throws — an unmatched id behaves exactly like
  `null` (empty result), never an error (spec Edge Cases: isolation degrades gracefully, it does
  not crash the editor).
- Called wherever the editor's own `EffectRuntime.setCatalog()` is already called (after every
  edit) and additionally whenever the live selection changes — `EffectRuntime` itself, and the
  catalog `Session`'s own separate runtime instance uses, are never touched by this function or
  its callers (FR-029, research D8).

---

## Editing context, extended (undo/redo scoping — correction pass, 2026-09-17)

The same "editing scope" above is also the boundary undo/redo respects (spec Key Entities,
"Editing scope / editing context"; FR-034 – FR-040). Unlike `isolatedCatalog`, this half is
genuinely stateful — held on `EditorShell`, not derived fresh each time — because an `EditHistory`
(`domain/editor/edit-history.ts`, unchanged by this correction) is itself a bounded stack that has
to persist across renders.

| Field | Type | Owner | Why it exists |
|---|---|---|---|
| `editingContextId` | `string \| null` | `EditorShell` | Which effect (or none) `history` currently belongs to — always kept equal to the live selection's effect id except mid-flight during a pending Save/Discard/Cancel confirmation |
| `history` | `EditHistory` | `EditorShell` | The active context's own bounded undo/redo stack — replaced wholesale, not reset in place, every time the context changes (see Lifecycle) |
| `contextBaseline` | `Project` | `EditorShell` | The project as it stood the moment the active context began — what "Discard" reverts to; kept as its own field (not derived by replaying `history.undo()`) so it stays correct even once the bounded history has dropped its oldest entries |

**Invariants**

- `history` belongs to exactly one context at a time; `undo()`/`redo()` operate on `this.history`
  only, so they are **structurally** incapable of reaching an edit made in a different context —
  there is nothing else in `history` to reach (FR-039, FR-040). This is deliberately not an
  ad-hoc check ("is this edit's context still active?") bolted onto `Ctrl+Z` — a wrong or
  missing check of that kind is exactly the bug this correction fixes.
- Every edit committed to the project (`editTimeline`, `renameSelectedEffect`, `renameProject`,
  `updateAssetLibrary`, `updateCameraTreatment`) is recorded into whichever context is currently
  active via `history.record(project)`. Undo/redo's own re-application (`applyExternalProject`)
  is never itself recorded — it is history navigation, not a new edit.
- "Unsaved changes" (FR-035) means exactly `history.state.canUndo` — the active context has at
  least one recorded edit since it began. A context with no edit yet switches away immediately,
  with no confirmation (FR-038).
- Selecting a different clip *of the same effect* does not change `editingContextId` and is never
  gated by the confirmation — only a change of *which effect* is selected is a context boundary.

**Lifecycle**

```text
        context begins (beginEditingContext(effectId, project))
              │  editingContextId := effectId
              │  contextBaseline  := project
              │  history          := new EditHistory(project, depth)
              ▼
        edits recorded (history.record(project)) ── Undo/Redo (scoped to history only)
              │
              │ author switches to a different effect
              ▼
        history.state.canUndo?
          ├─ no, or no confirmation dialog configured ──► begins the new context immediately
          └─ yes, and a dialog is configured ──► Save/Discard/Cancel
                ├─ Cancel   → nothing changes; still the same context
                ├─ Save     → keep current project as-is, then begin the new context
                └─ Discard  → project := contextBaseline, then begin the new context
```
