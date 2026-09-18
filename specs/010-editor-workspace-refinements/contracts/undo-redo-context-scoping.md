# Contract: Undo/Redo Context Scoping

**Feature**: `010-editor-workspace-refinements` (correction pass, 2026-09-17 — spec.md User Story
7, FR-034 – FR-040) — a fix to spec 009's originally-shipped undo/redo, discovered while reviewing
this feature's own "editing scope" concept (User Story 1) and found to need the identical
boundary.

## The invariant

> Undo and redo may only affect edits belonging to the currently active editing context.

"The currently active editing context" is the single effect, if any, currently selected for
editing — exactly the same concept `isolated-catalog.ts`/User Story 1 already defines as
`selectedEffectId`. There is exactly one editing context at a time, and it changes exactly when
the selected effect changes (not when the selected clip within an effect changes).

## The boundary

```
EditorShell (presentation/editor/editor-shell.ts)
  ├─ editingContextId: string | null      Which effect `history` belongs to
  ├─ history: EditHistory                 domain/editor/edit-history.ts — UNCHANGED class.
  │                                       One instance per context; replaced wholesale
  │                                       (never reset in place) when the context changes.
  └─ contextBaseline: Project             What "Discard" reverts the left context to.

editor-main.ts (composition root)          No longer owns an EditHistory at all — Undo/Redo
                                            menu items call shell.undo()/shell.redo().
```

`domain/editor/edit-history.ts` requires **no code change** for this fix — it was already a
correct, reusable, per-instance bounded stack (spec 009, research D12). The bug was architectural,
not in that class: one global instance, owned by `editor-main.ts`, shared across every effect
selection, meant switching which effect was selected never created a boundary `EditHistory` could
respect, because it never knew one should exist.

## What MUST hold

1. **Structural isolation, not a check.** `EditorShell.undo()`/`redo()` call only
   `this.history.undo()`/`redo()`. Because `this.history` is replaced (not appended to, not
   filtered) every time the editing context changes, there is no code path by which an edit
   recorded under a previous context's `EditHistory` instance is reachable through the current
   one. This MUST remain the mechanism — no `if (edit.contextId !== activeContextId) return`-
   style guard is an acceptable substitute, because such a guard can be forgotten at a new call
   site in a way a structurally-separate instance cannot.
2. **Committing an edit** (`editTimeline`, `renameSelectedEffect`, `renameProject`,
   `updateAssetLibrary`, `updateCameraTreatment`) MUST record into whichever `history` is
   currently active. `applyExternalProject` (undo/redo's own re-application) MUST NOT record.
3. **Changing which effect is selected** MUST go through one gate
   (`EditorShell.requestContextSwitch`) that:
   - Proceeds immediately or when the target effect is already the active context (selecting a
     different clip of the same effect is never a context boundary).
   - Proceeds immediately when the active context has no undoable edit (`!history.state.canUndo`).
   - Proceeds immediately when no confirmation prompt is configured at all (`dialogs` absent) —
     this is the pre-correction, always-immediate behavior, preserved as the default so every
     caller that has not opted into the prompt sees no behavior change in this respect.
   - Otherwise asks Save/Discard/Cancel before proceeding; Cancel performs no state change at
     all; Save keeps the project as-is; Discard reverts it to `contextBaseline` first.
   - In every "proceeds" case, calls `beginEditingContext(targetEffectId, project)` — the one
     place `editingContextId`/`history`/`contextBaseline` are (re)assigned together.
4. **The public-facing default experience is unaffected.** Undo/redo exists only in the editor;
   `Session`'s own runtime instance has no history of any kind. This contract does not touch it.

## Verification

1. **`EditorShell` test** (`test/adapters/editor-shell.test.ts`): with two effects, commit an edit
   to the first, switch the selection to the second (no `dialogs` configured — the default,
   immediate path), and invoke `undo()`. Assert the project is unchanged and `canUndo` is `false`
   — the second effect's brand-new context has nothing to undo, and the first effect's edit was
   never reached.
2. **Same file**: commit an edit to the second effect after switching, assert `canUndo` is `true`
   there; switch back to the first effect; assert `canUndo` is now `false` again (a fresh context)
   and that `undo()` there does not touch the second effect's committed rename.
3. **Same file, redo**: undo an edit, confirming `canRedo` becomes `true`; switch the active
   effect; assert `canRedo` is `false` in the new context and `redo()` there is a no-op.
4. **Same file, the confirmation dialog** (a fake `dialogs`): with a dirty context, Cancel leaves
   the selection and the project exactly as they were; Save completes the switch with the edit
   intact; Discard completes the switch with the effect reverted to its pre-edit state. Selecting
   a different clip of the *same* effect never invokes the dialog, however dirty that effect is.
