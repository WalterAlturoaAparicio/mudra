# Contract: Editor Preview Isolation / Public Runtime Non-Impact

**Feature**: `010-editor-workspace-refinements`

Constitution v1.9.0, "Mudra Web — Milestone 2 refinements": *"This isolation is scoped to the
editor's own runtime instance only — it MUST NOT change how effects are triggered, matched, or
played on the public-facing default experience, whose existing rule (every matching effect plays;
nothing picks a winner) is unaffected."*

## The boundary

```
apps/web/src/main.ts            constructs   Session ──owns──▶ EffectRuntime (instance A)
                                                                        │
apps/web/src/editor-main.ts     constructs   EditorRuntimeController
                                              ──owns──▶ EffectRuntime (instance B)
                                                                        │
                                              EditorShell.pushCatalog()
                                                    │
                                        isolatedCatalog(project.catalog, selectedEffectId)
                                                    │
                                        instance B.setCatalog(...)   ◄── the ONLY call this
                                                                          feature touches
```

Instance A and instance B are two separate `EffectRuntime` objects today, each constructed once,
each never handed to the other's owner. This was already true before this feature (contracts/
editor-runtime-boundary.md, spec 008) — it is what this contract's non-impact claim rests on, not
something this feature introduces.

`isolatedCatalog()` MUST NOT:
- Be called anywhere in `main.ts`'s or `Session`'s construction or frame loop — instance A's
  `setCatalog()` calls, wherever they exist, are untouched by this feature.
- Take, or need, a reference to instance A, `Session`, or anything under `apps/web/src/main.ts`'s
  own module graph — its signature is `(EffectCatalog, string | null) → EffectCatalog`, pure data
  in, pure data out.

`EffectRuntime` itself (`domain/runtime/effect-runtime.ts`) MUST NOT:
- Gain a parameter, flag, or branch distinguishing "the editor's instance" from "the public
  instance" — both remain the same class, with the same `startTriggered()` "every matching effect
  plays" rule, unconditionally. Isolation is achieved entirely by what catalog instance B happens
  to have been given, never by a conditional inside the class both instances share.

`EditorShell`/`EditorRuntimeController` MUST:
- Call `isolatedCatalog()` (or hand its result to `setCatalog()`) every time the editor's own
  selection changes, in addition to every time it already calls `setCatalog()` after an edit —
  otherwise a stale, wider catalog would remain active until the next unrelated edit.

## Verification

1. **Domain test**: `isolatedCatalog(catalog, id)` returns a catalog whose `effects` array has
   length 0 or 1, for every `(catalog, id)` pair including `id = null` and an `id` naming no effect
   in `catalog` — no exception path, no other length possible.
2. **Architecture test** (new, or an extension of an existing boundary/layering suite): no file
   under `apps/web/src/main.ts`, `apps/web/src/application/session.ts`, or anything reachable from
   `main.ts`'s module graph imports `isolatedCatalog` or any module introduced for this feature —
   a static-import scan, the same shape `test/architecture/capture-boundary.test.ts` already runs
   for the capture/editor split.
3. **Integration test** (extends the existing editor-adapter suite): with two effects in a project
   catalog for two different poses, select the first, feed the runtime a real `PoseEvent` for the
   *second* pose's trigger, and assert `activePlaybacks` stays at whatever it was before the event
   (the second effect never starts) — then select the second effect and feed the same event, and
   assert it *does* start. Separately, assert that constructing a `Session`-shaped runtime with the
   same catalog and the same event, with no isolation call ever made against it, still starts the
   effect — proving the public path's behavior is unconditional and unaffected.
