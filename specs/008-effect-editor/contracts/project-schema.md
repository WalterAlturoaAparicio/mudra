# Contract: Project Schema & Local Persistence

**Feature**: `008-effect-editor` | **Producer**: the editor (`presentation/editor/`,
`application/`) | **Consumer**: `ProjectRepository` (`infrastructure/persistence/`)

Constitution v1.7.0 (Milestone 2): local project persistence only, and a saved project MUST NOT
contain a camera frame, image, video, or any derivative of captured imagery (Principle II, restated
without exception for this new persistence surface).

## The document

The project file has **one boundary, twice**: the outer project fields are the project format's
own wire shape (snake_case, as below); `catalog` is, **byte-for-byte, the same wire shape
`config/effects.json` already uses** — including its own `catalog_version` field — never the
parsed TypeScript domain object. Nothing about persisting a project invents a second effect-catalog
format.

```json
{
  "project_schema_version": 1,
  "id": "prj_9f2a...",
  "name": "Greeting variants",
  "created_at_ms": 1755999999999,
  "updated_at_ms": 1756000012345,
  "catalog": {
    "catalog_version": 1,
    "effects": [ /* wire-format entries — at_ms, duration_ms, pose_id, ... — identical shape to config/effects.json */ ]
  },
  "asset_library": { "entries": [ { "reference": "@audio/whoosh", "display_name": "Whoosh", "kind": "audio", "storage_key": "..." } ] },
  "camera_treatment": { "brightness": 0, "contrast": 0, "saturation": 0, "mirror": true, "zoom": 1, "crop": null }
}
```

**Wire format vs. domain representation, made explicit**: `infrastructure/effects/catalog-loader.ts`
already separates the two — its exported `parseCatalog(document: unknown, registry: ActionRegistry):
EffectCatalog` takes exactly this wire shape and returns the domain `EffectCatalog` (`version`,
camelCase throughout). Loading a project's `catalog` field calls `parseCatalog` **unmodified** —
the same function, the same validation, the same error messages `config/effects.json` already gets.
There is no second parser and no project-specific catalog format.

Saving a project needs the **inverse direction**, which `catalog-loader.ts` does not yet provide
(Milestone 1 only ever *read* `effects.json`; it never had to write one). This milestone adds one
small, paired serializer — `serializeCatalog(catalog: EffectCatalog): Json` — living in the same
module, so "the mapping lives here and nowhere else" (`catalog-loader.ts`'s own stated rule)
continues to hold for both directions. `serializeCatalog` is the exact structural inverse of
`parseCatalog`: domain `EffectCatalog` in, wire-format JSON out, never the other way round, and
never a direct `JSON.stringify` of the domain object standing in for it.

This is what makes a project's effects usable by the runtime **and** re-editable by a person
without a second format existing anywhere (SC-008): the runtime only ever sees the output of
`parseCatalog`, exactly as it does today, and a project file only ever contains what `parseCatalog`
accepts and `serializeCatalog` produces.

## Versioning

| Guarantee | Requirement |
|---|---|
| A project carries a schema version | FR-032 |
| A version this build does not understand is reported, never coerced | FR-032 |
| A malformed or invalid project fails clearly and does not partially apply | FR-033 |

`project_schema_version` starts at `1`. A future incompatible change bumps it and the loader
rejects any project below the version it knows how to migrate from — the same policy the exemplar
bundle's `formatVersion` and `SessionConfig`'s `bundle.formatVersion` already apply.

## Storage

| Operation | Mechanism |
|---|---|
| `create`, `save`, `load`, `list`, `duplicate`, `remove` | IndexedDB, one object store keyed by `id` (research D2) |
| `exportBlob` | `application/json` `Blob`, offered as a browser download |
| `importBlob` | `<input type="file">` selection, parsed and validated identically to `load` |
| Active-project pointer | IndexedDB, a single-row `meta` object store (data-model.md `ActiveProjectPointer`) |

No File System Access API, no server, no network request of any kind is part of any operation
above (FR-029).

## The privacy guarantee, specific to persistence

| Guarantee | Requirement |
|---|---|
| No camera frame, image, video, or derivative of captured imagery in a saved/exported project | FR-031 |
| A project is effect data — timelines, action parameters, asset references, pose/trigger selections — and nothing else | FR-031 |
| Duplicate, import, and export touch no network destination | SC-007 |

An `AssetLibraryEntry`'s `storage_key` addresses a **project-local asset the author explicitly
added to the library** (an audio clip, an image) — never a camera capture. There is no code path
by which a `LandmarkFrame`, a canvas readback, or a `MediaStream` frame can become a `storage_key`;
the asset-library write path only accepts a file the author picked through a file input, the same
affordance `importBlob` already uses, never a frame from the live pipeline.

## Verification

1. **Load-time validation test**: a project with a future/unknown `project_schema_version`, a
   malformed `catalog`, or a broken `asset_library` entry produces a specific, attributable error —
   never a partially-applied project (mirrors `test/domain/config.test.ts`'s existing pattern).
2. **Round-trip test**: create → save → load reproduces the project byte-for-byte in its validated,
   parsed form (SC-004).
3. **Architecture test**: extends `test/architecture/privacy.test.ts`'s existing prohibited-API
   scan (see `contracts/privacy-persistence.md`) to the new `infrastructure/persistence/**` tree —
   proving the storage layer itself cannot smuggle imagery in, not just that nothing currently asks
   it to.
