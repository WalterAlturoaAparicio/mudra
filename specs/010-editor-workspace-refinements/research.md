# Research: Editor Workspace Refinements

**Feature**: `010-editor-workspace-refinements` | **Date**: 2026-09-17

Phase 0 decisions. Each is a choice the specification deliberately left open (implementation is a
plan/tasks concern, not a spec one), resolved against the existing code rather than against a
preference. Where an alternative was rejected, the reason is recorded so a later reader can tell a
decision from an accident.

---

## D1 — Docking is a small, hand-authored enum of CSS Grid layouts, not a layout engine

**Decision**: Generalize the existing fixed three-region concept (`DockRegion = 'left' | 'right' |
'timeline'`) into a **zone id** (`string`) scoped to whichever **layout** is active. Each of the
small, fixed set of predefined layouts is a hand-authored value: a list of zone ids, a CSS
Grid `grid-template-columns`/`grid-template-rows` (or `grid-template-areas`) string realizing
them, and which zone each existing panel defaults into. Switching layouts swaps which grid
template and zone list are active; it does not recompute anything algorithmically.

**Rationale**: The spec (FR-001, FR-009, Out of Scope) explicitly rejects "an arbitrary,
freely-splittable docking surface" and asks for extensibility ("a new layout is an addition, not a
restructuring") without building a general layout engine — exactly the shape a hand-authored enum
of grid templates gives for free: adding a layout is adding one entry to a record, the same way
`panel-sizes.ts`'s `LAYOUT_PRESETS` today is "data, not behaviour: a preset is a set of sizes,
applied through the same `applySizes` a drag uses. Adding one is a row here." This decision
extends that exact precedent from sizes to topology.

**Alternatives considered**:

- *A generic layout engine* (arbitrary nested splits, runtime-computed grid templates). Rejected:
  explicitly out of scope (spec Out of Scope, constitution v1.9.0's "predefined zones only, for
  now"), and the complexity (persistence format, drag-to-resize-and-reparent interactions,
  degenerate-split guarding) is the "mini-IDE" cost the spec explicitly declines to pay yet.
- *A third-party docking library* (e.g., a GoldenLayout-style package). Rejected on the
  constitution's dependency rule ("no new runtime dependency without a concrete architectural
  reason") — `apps/web` has exactly one runtime dependency today (`@mediapipe/tasks-vision`), and
  the bounded, hand-authored-enum shape above is fully sufficient for "a small, fixed set of
  predefined layouts."

---

## D2 — Panel relocation drag uses pointer events, matching the existing splitter-drag pattern

**Decision**: A panel's drag handle (its header) uses `pointerdown`/`pointermove`/`pointerup` with
`setPointerCapture`, the same pattern `dock-layout.ts`'s splitter drag already implements (`wireSplitter`
private method) — not the HTML5 Drag and Drop API (`draggable`, `dragstart`/`dragover`/`drop`).

**Rationale**: The codebase already has exactly one drag interaction, and it is pointer-event
based, with an explicit documented reason: "no layout read (`getBoundingClientRect`, `offsetWidth`,
…) is ever interleaved with [`pointermove`], so there is no read/write cycle for the browser to
thrash on." HTML5 DnD's `dragover`-driven drop-target model is a second, inconsistent interaction
primitive with well-known styling and cross-browser quirks; introducing it alongside the existing
pointer pattern for one feature would be the second drag mechanism the codebase would then have to
maintain. Reusing pointer events also keeps the drop-target highlight (FR-004) and invalid-zone
suppression (FR-005) simple: `pointermove` computes which registered zone's bounding rect contains
the pointer and toggles a `data-drop-target` attribute, no native drag-image or `dataTransfer`
plumbing involved.

**Alternatives considered**:

- *HTML5 Drag and Drop API*. Rejected: inconsistent cross-browser drag-image/ghost behavior, no
  natural fit with the pointer-capture pattern already established, and no help implementing the
  required keyboard-operable alternative (D3) — that has to exist regardless, so DnD's one
  advantage (some built-in accessibility affordances) does not actually materialize here.

---

## D3 — The keyboard-operable relocation path is a discrete command, not simulated drag

**Decision**: Each panel's header exposes a control (button) that opens a small list of the zones
currently valid for that panel — the same set FR-005 already restricts drop targets to — and
choosing one relocates the panel immediately, calling the identical "dock panel to zone" operation
a completed pointer drag calls.

**Rationale**: Directly what the spec's clarification session resolved (Option A): "a discrete
command, not a full simulated-drag interaction." A list of valid destinations reuses UI the
codebase already has patterns for (a small popover/menu, the same shape `color-picker.ts`'s
popover or `menu-bar.ts`'s panel already are) rather than inventing arrow-key-driven drag
simulation, which the spec's Out of Scope explicitly declines to build.

**Alternatives considered**:

- *Full WAI-ARIA drag-and-drop keyboard equivalence* (arrow keys simulate the drag step by step).
  Rejected: explicitly out of scope (spec Out of Scope, from the clarification session); a
  discrete command satisfies the accessibility requirement (SC-007: every relocation achievable
  by drag is achievable with no pointer interaction) without the added interaction-state machine.

---

## D4 — Tabs reuse the existing button-driven interaction style; no new dependency

**Decision**: A zone holding more than one panel renders a small horizontal strip of buttons (one
per panel, showing that panel's label), with one marked active; clicking a button shows that
panel's content and hides the others'. The same DOM-visibility toggle `dock-layout.ts` already
uses for hidden panels (`host.hidden = ...`) switches which tab's content is visible.

**Rationale**: Consistent with the codebase's existing preference for plain DOM/button-driven UI
over a component framework or UI kit — `menu-bar.ts`'s own docstring states the same reasoning for
the menu system: "no framework, plain DOM." No new dependency is justified for a control this
simple, and the visibility-toggle mechanism already exists and is already tested.

**Alternatives considered**:

- *A tab-panel ARIA pattern with roving tabindex and full keyboard arrow navigation between tabs*.
  Not rejected, exactly — folded into scope as the natural accessibility baseline (`role="tablist"`
  /`role="tab"`/`role="tabpanel"`, matching the accessibility care already evident elsewhere in
  this codebase, e.g. `menu-bar.ts`'s accessible names and keyboard shortcuts) rather than treated
  as a separate research question; it is markup and event-handler detail for the tasks phase, not
  an architectural decision.

---

## D5 — Docking/tab-group persistence extends `EditorLayout` with new optional fields

**Decision**: Add new **optional** fields to the existing `EditorLayout` interface
(`domain/ports/layout-store.ts`) — e.g. an active-layout id and a per-panel zone/tab-position
record — rather than introducing a second persisted record, a second store, or bumping the
IndexedDB schema version.

**Rationale**: `EditorLayout` already documents exactly this extension pattern for exactly this
reason: "This adds the rest of what View can change... as **optional** fields, so a stored record
written before they existed still loads, and a caller that only cares about sizes still
round-trips." `hiddenPanels` and `preset` were added this same way when they were introduced. A
record written before this feature shipped (sizes only) continues to load correctly — the new
fields are simply absent, and the caller falls back to each layout's own default docking
arrangement, the same fallback `hiddenPanels`'s absence already produces today (no hidden panels).
No `DATABASE_VERSION` bump, no `onupgradeneeded` migration — `indexeddb-layout-store.ts`'s object
store is already keyed generically and the stored record already carries the whole `EditorLayout`
value under one key.

**Alternatives considered**:

- *A second IndexedDB object store for docking, separate from sizes/visibility/preset.* Rejected:
  splits one coherent "editor chrome" concept across two records that must then be loaded and
  reasoned about together anyway, for no isolation benefit — chrome state is not sensitive or
  independently large the way, say, capture samples are from project documents.

---

## D6 — The Inspector lock is state on the existing selection owner, not a new selection system

**Decision**: `EditorShell` — which already owns `selectedEffectId`/`selectedEntryIndex`, the
single selection model every surface reads from — gains one additional field: an optional "locked
selection" (the same `{effectId, entryIndex}` shape, held rather than live). When present, the
value handed to the Inspector's `render()` is the locked pair instead of the live
`selectedEffectId`/`selectedEntryIndex`; every other surface (tree, timeline, effect panel)
continues to read the live pair unchanged, because they never look at the lock at all.

**Rationale**: Directly what the spec's Technical Constraints require ("this feature MUST NOT
introduce a second, parallel notion of 'what is selected'") and what investigating the existing
architecture before writing the spec confirmed: selection is already one pair, already owned by
one class, already the thing every surface reads from. A lock is a hold in front of that one
pair's *last mile* (which value reaches the Inspector's `render()` call), not a second store of
what is selected.

**Alternatives considered**:

- *A separate `InspectorLock` class/module observing selection changes.* Rejected: introduces a
  second place selection-shaped data lives, and an observer relationship (`EditorShell` would have
  to notify it, or it would have to poll) where a single held field read at one call site is
  simpler and cannot drift out of sync.

---

## D7 — Collapse state stays local to each panel instance, matching the existing tree precedent

**Decision**: Each panel that needs whole-panel or per-section collapsing owns its own collapsed/
expanded state as a private in-memory field (a `boolean` for the whole panel, a `Set<string>` of
collapsed section ids for internal groups) — the same shape `project-tree.ts` already uses for its
per-effect action-list collapse (`private readonly collapsed = new Set<string>()`). No central
"collapse registry" is introduced.

**Rationale**: The spec's own instruction — "revisa primero cómo están construidos actualmente los
paneles para evitar introducir una abstracción excesivamente genérica si no es necesaria" — and the
fact that a working, tested precedent for exactly this shape (a twisty button + a `Set` of
collapsed ids) already exists in the same directory. Panels are already independent classes with
their own local state (selection, hover, open/closed popovers); collapse state is one more field
of the same kind, not a new subsystem. Session-scoped persistence (spec Assumptions) falls out for
free: the field simply lives as long as the panel instance does, exactly like `ProjectTree`'s
existing collapse state does today.

**Alternatives considered**:

- *A shared `CollapseState` service, keyed by panel/section id, injected into every panel.*
  Rejected: exactly the "excessively generic abstraction" the spec warns against — it would
  centralize state that has no reason to be centralized (no two panels ever need to read each
  other's collapse state), in exchange for a new injected dependency every panel constructor would
  need.

---

## D8 — Effect isolation filters the catalog the editor's runtime is given, not the runtime itself

**Decision**: Add a pure domain function (e.g. `isolatedCatalog(catalog, selectedEffectId):
EffectCatalog`) returning a catalog containing at most one effect — the selected one, or empty
when nothing is selected. `EditorShell`'s existing `pushCatalog()` (already called after every
edit, via `this.runtime.setCatalog(this.project.catalog)`) calls this function first and hands the
*filtered* catalog to `setCatalog()`; `pushCatalog()` is additionally called from the selection-
changing methods (`selectEffect`, `selectAction`), which today update selection state but do not
re-push the catalog. `EffectRuntime` itself — its `startTriggered()`, its "every matching effect
plays, the catalog does not pick a winner" rule — is not modified in any way.

**Rationale**: `EffectRuntime.setCatalog()` is already the editor's sole mechanism for keeping the
runtime's working set in sync with authoring state (its own docstring: "the editor calls this
after every edit, so Test Trigger and Play Timeline immediately reflect the change being
authored"). Filtering *what* is handed to an already-existing, already-called method is the
smallest change that achieves isolation, and it makes the public-facing-experience non-impact
(spec FR-029, constitution's "scoped to the editor's own runtime instance only") true by
construction rather than by discipline: `main.ts`'s `Session` constructs and owns a **separate**
`EffectRuntime` instance entirely — this change touches no code either instance shares, so there
is no code path by which it could reach the public runtime. Explicit Play/Play Selected/Test
Trigger are unaffected: Play Timeline's `startEffect(effectId, ...)` looks up the id in
`this.catalog.effects`, which still contains it (it is the selected effect); Play Selected's
`startDefinition()` bypasses catalog lookup entirely already; Test Trigger already constructs its
synthetic event from the selected effect's own trigger.

**Alternatives considered**:

- *Pass an `allowedEffectIds` parameter through `EffectRuntime.advance()`/`startTriggered()`.*
  Rejected: touches the one class both the editor and the public runtime construct their own
  instance of, which is exactly the surface the constitution's "scoped to the editor's own runtime
  instance only" rule exists to keep untouched. Every call site (including `Session`'s) would need
  to pass the new parameter or rely on a default, which is a larger, riskier change for the same
  outcome the catalog-filtering approach achieves with zero change to the shared class.
- *A new "isolation mode" flag on `EditorRuntimeController`, branching inside its `tick()`.*
  Rejected: `tick()` already has a clear, single responsibility (capture a frame, classify it,
  advance the runtime, present); adding a conditional branch there for what is really a
  catalog-composition decision would blur that, where filtering at the one existing catalog-entry
  point keeps `tick()` completely unchanged.
