# Contract: Docking Arrangement Persistence Compatibility

**Feature**: `010-editor-workspace-refinements`

`domain/ports/layout-store.ts`'s own documented rule, restated because this feature is the next
thing to rely on it: *"This adds the rest of what View can change... as optional fields, so a
stored record written before they existed still loads, and a caller that only cares about sizes
still round-trips."*

> **Correction pass, 2026-09-17**: the persisted shape for docking is `zoneLayouts` (a per-zone
> **dock tree**, `DockNodeData`), not the originally-shipped `zoneAssignments`/`PanelPlacement`
> (a flat per-panel `{ zoneId, tabIndex? }` map). The flat shape could only record which zone a
> panel was in and its position in that zone's one implicit tab strip — it could not represent a
> stack or a side-by-side split at all, which is the same gap the correction pass's item 1 found
> in the runtime behavior. Because `zoneAssignments` was only ever produced by this same in-flight
> feature and never reached a release, this is a clean replacement, not a migration; the
> compatibility guarantees below for the fields that predate *this whole feature*
> (sizes/`hiddenPanels`/`preset`) are unchanged and still hold exactly as written.

## The boundary

```
EditorLayout (domain/ports/layout-store.ts)
  ├─ leftWidth, rightWidth, timelineHeight     (required — every record has always had these)
  ├─ hiddenPanels?                              (optional, added when View's show/hide shipped;
  │                                              now also doubles as the *closed*-panel list,
  │                                              spec 010 correction pass item 4 — same field,
  │                                              corrected meaning, no schema change)
  ├─ preset?                                    (optional, added when size presets shipped)
  ├─ activeLayoutId?                            (optional, spec 010)
  └─ zoneLayouts?                               (optional, spec 010 — corrected shape, see above)
        Readonly<Record<zoneId, DockNodeData>>
        DockNodeData =
          | { kind: 'leaf'; panelIds: readonly string[] }
          | { kind: 'split'; direction: 'row' | 'column'; children: readonly DockNodeData[];
              sizes?: readonly number[] }          (sizes added workspace UX corrections pass,
                                                     FR-042 — optional within an already-optional
                                                     field; absent means equal share, exactly as
                                                     every split behaved before this field existed)

IndexedDbLayoutStore                            DATABASE_VERSION stays 1. No onupgradeneeded
  (infrastructure/persistence/                  change. The stored record already carries the
   indexeddb-layout-store.ts)                   whole EditorLayout value under one key; adding
                                                 fields to the type is not a store-shape change.
```

A record written by a build **before this whole feature** — sizes, `hiddenPanels`, `preset`,
nothing else — MUST:
- Load without error through the **unmodified** `IndexedDbLayoutStore.load()`.
- Produce an `EditorLayout` whose `activeLayoutId` and `zoneLayouts` are simply `undefined` —
  never a thrown error, never a synthesized empty object standing in for "absent."
- Result in every registered panel appearing at its active layout's `defaultZoneFor` placement,
  **each its own stacked leaf** — the fallback an absent `zoneLayouts` means (data-model.md,
  "Docking arrangement") is explicitly *not* one automatic tab group, per the correction pass.

A `zoneLayouts` entry naming a zone id this build no longer recognizes MUST:
- Be dropped wholesale on load (that whole zone's tree is discarded), tolerated, not an error.

Within a zone's tree that does apply, a leaf naming a panel id not currently registered MUST:
- Be sanitized out — dropping just that id from its leaf (and the leaf/split it was in, if that
  removal empties it, per `dock-tree.ts`'s `sanitize`/`removePanel` shrink rules) — the same
  tolerance `DockLayout.setPanelVisible` already has for an unknown panel id today (a documented
  no-op, not an error); every other panel named in the same record still applies.

This feature MUST NOT:
- Bump `DATABASE_VERSION` or add an `onupgradeneeded` migration step — the whole point of the
  optional-field pattern is that no migration is needed.
- Introduce a second IndexedDB database, or a second object store, for docking data (research D5).

## Verification

1. **Domain/infrastructure test** (extends the existing `indexeddb-layout-store.test.ts`-shaped
   suite, using `fake-indexeddb` the same way the existing tests already do): write a record
   containing only `leftWidth`/`rightWidth`/`timelineHeight` directly (bypassing `activeLayoutId`/
   `zoneLayouts` entirely, simulating a record from before this whole feature), load it back
   through the unmodified store class, and assert `activeLayoutId`/`zoneLayouts` are `undefined`
   and no error is thrown.
2. **Presentation test** (`dock-tree.test.ts`, `dock-layout.test.ts`): a `zoneLayouts` entry
   naming a zone id absent from the currently active `Layout`, or a tree containing a panel id
   not currently registered, does not prevent the rest of the record's entries from applying, and
   does not throw — covering both the whole-zone-dropped case and the sanitize-within-a-tree case
   above.
3. **Round-trip test**: save a record with `activeLayoutId` and a `zoneLayouts` value containing
   at least one `split` (not only leaves) populated, reload it, and assert deep-equality — the
   ordinary round-trip guarantee every other `EditorLayout` field already has, now exercised
   against a genuinely nested tree, not only a flat map.
4. **`sizes` round-trip and back-compat** (workspace UX corrections pass): a `zoneLayouts` value
   containing a `split` with `sizes` populated round-trips deep-equal, the same as test 3; and a
   `zoneLayouts` value containing a `split` with `sizes` *absent* (simulating a record written
   before resizing shipped) loads without error and is treated as an equal share, not a thrown
   error or a synthesized default array.
