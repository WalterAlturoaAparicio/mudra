# Phase 1 Data Model: Mudra Web — Visual Effect Editor

Every entity below is either **new** (introduced by this milestone) or an **extension** of an
existing Milestone 1 type. No existing type is redefined incompatibly; extensions add optional or
additive fields only. Types already fully specified in `apps/web/src/domain/effects/types.ts` and
`apps/web/src/domain/runtime/action-registry.ts` (`EffectDefinition`, `Timeline`, `TimelineEntry`,
`Action`, `Trigger`, `Condition`, `Anchor`, `ParamSpec`) are referenced, not restated.

---

## New: `Project`

The editor's document. Corresponds to spec Key Entity **Project**.

```ts
interface Project {
  readonly schemaVersion: number;        // see D3 — validated at load, mismatches reported
  readonly id: string;                   // stable, generated on create, never reused
  readonly name: string;                 // author-facing, editable, not an identifier
  readonly createdAtMs: number;
  readonly updatedAtMs: number;          // bumped on every save
  readonly catalog: EffectCatalog;       // UNMODIFIED existing type (D4) — this project's effects
  readonly assetLibrary: AssetLibrary;
  readonly cameraTreatment: CameraTreatmentSettings;
}
```

**This is the domain representation, not the wire format.** `Project.catalog` above is the
*parsed* `EffectCatalog` — the exact type `EffectRuntime` already consumes, `version` included. The
**persisted** form (IndexedDB, export blobs) stores `catalog` in the same wire shape
`config/effects.json` uses (`catalog_version`, snake_case entries) — see
`contracts/project-schema.md` for the exact shape and the `parseCatalog`/`serializeCatalog` pair
that crosses this boundary in each direction. `ProjectRepository.load()` returns the domain form
above; `ProjectRepository.save()` accepts it and serializes internally. No code outside
`infrastructure/effects/catalog-loader.ts` ever sees the wire shape.

**Validation rules** (fail at load, name the field — same discipline as `parseSessionConfig`):
- `schemaVersion` MUST equal the version this build understands; a mismatch is a
  `ProjectSchemaError` naming both versions, never coerced (FR-032).
- `id` MUST be a non-empty string, unique among the repository's stored projects at creation time.
- `catalog` MUST validate exactly as `config/effects.json` already validates — the wire-format
  JSON is passed through `infrastructure/effects/catalog-loader.ts`'s existing `parseCatalog`,
  unmodified, and only the resulting domain `EffectCatalog` is ever held in a `Project` value —
  reusing the loader in both directions is what makes SC-008 true by construction, not by
  convention.
- `assetLibrary` entries MUST resolve to logical references under the project's own manifest (see
  `AssetLibrary` below); an entry that does not is reported, not rejected at load (FR-038 — the
  rest of the project remains usable).

**Identity vs. uniqueness**: a project's `id` is generated once at `create` and never changes
across `save`, `duplicate` (which gets a **new** `id`), `export`, or `import` (which also gets a
new `id`, since an imported file may already exist locally under its original id). `name` carries
no uniqueness constraint — two projects may share a display name; the author disambiguates by
content, not by the editor enforcing distinct names.

**Lifecycle**: `create → (edit)* → save → (load | duplicate | export)*`. There is no "delete" state
transition table beyond ordinary removal from the repository; a deleted project that was active
triggers FR-033c's fallback (see `ActiveProjectPointer` below).

---

## New: `AssetLibrary`

```ts
interface AssetLibrary {
  readonly entries: readonly AssetLibraryEntry[];
}

interface AssetLibraryEntry {
  readonly reference: string;   // e.g. "@audio/whoosh" — same indirection AssetManifest uses
  readonly displayName: string; // author-facing, shown in the picker
  readonly kind: 'audio' | 'image';
  /** Opaque handle into local storage (an IndexedDB blob-store key), resolved by infrastructure. */
  readonly storageKey: string;
}
```

Corresponds to spec Key Entity **Asset Library Entry**. `reference` is written into an action's
`params` exactly as `DEFAULT_ASSET_MANIFEST` entries already are — an action's parameter data
never knows whether its reference resolves against the global manifest or a project's own library.
A project-scoped `AssetManifest` is built from `AssetLibrary.entries` at load time and handed to
the same `ManifestAssetResolver` Milestone 1 already has (no new resolver class): project assets
extend, and take precedence over, the global manifest for that project's session.

**Validation rules**: `reference` MUST start with `@audio/` or `@image/` (the existing
`ParamSpec.assetPrefix` convention); `kind` MUST agree with the prefix. A `storageKey` that does
not resolve in local storage is the broken-reference case (FR-038), reported by `reference`, not
by `storageKey` (an internal detail the author never sees).

---

## New: `CameraTreatmentSettings`

```ts
interface CameraTreatmentSettings {
  readonly brightness: number;   // -1..1, 0 = unchanged
  readonly contrast: number;     // -1..1, 0 = unchanged
  readonly saturation: number;   // -1..1, 0 = unchanged
  readonly mirror: boolean;      // always true by default (FR-002 of Milestone 1); author-visible, not silently overridable
  readonly zoom: number;         // 1..4, 1 = unchanged
  readonly crop: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null; // normalized [0,1] rect, null = full frame
}
```

Corresponds to spec Key Entity **Camera Treatment Settings**. Applied by the renderer as a
render-time transform of the camera image **before** `drawCamera` composites it — never sent to
the camera device, and never applied to the imagery `HandDetector` receives (FR-051; the detector
continues to receive the unmodified mirrored surface). Default value is the identity transform
(`{0,0,0,true,1,null}`), so a project with no camera treatment authored behaves exactly as
Milestone 1's fixed presentation already does.

---

## Extension: `ActionContext` gains `segmentation`

```ts
interface ActionContext {
  // ...existing fields unchanged...
  readonly segmentation: SegmentationFrame | null; // NEW — null when the capability is unavailable
}

interface SegmentationFrame {
  readonly mask: ImageBitmap; // an opaque handle; the runtime never reads its pixels
  readonly width: number;
  readonly height: number;
}
```

Populated by infrastructure exactly where `frame: LandmarkFrame` already is (`Session`/
`EditorRuntimeController`'s per-tick assembly of `ActionContext`), `null` when
`capabilities.has(PERSON_SEGMENTATION)` is false. See research D7/D8.

---

## Extension: `RenderCommand` gains `MaskedEraseCommand`

```ts
interface MaskedEraseCommand {
  readonly kind: 'maskedErase';
  readonly region: 'person' | 'background';
  readonly alpha: number; // 0 = no effect, 1 = fully erased within the region
}

type RenderCommand =
  | ClearCommand | DrawCameraCommand | FillScreenCommand
  | DrawCirclesCommand | DrawPolylineCommand
  | MaskedEraseCommand; // NEW
```

See research D8 for the renderer-side execution (`destination-out` clipped by an out-of-band mask
image, set via a new `Canvas2DRenderer.setPersonMask(image)` paralleling `setCameraImage`).

---

## New: `ActiveProjectPointer`

Not a document — one row in the repository's `meta` object store.

```ts
interface ActiveProjectPointer {
  readonly activeProjectId: string | null;
}
```

**State transitions**:

| From | Event | To |
|---|---|---|
| `null` | author marks project `P` active | `P` |
| `P` | author marks project `Q` active | `Q` |
| `P` | author clears the active designation | `null` |
| `P` | `P` is deleted, or fails to load/validate at the default route's boot | `null` (FR-033c) |

Read exactly once, at the default route's boot (research D10) — never subscribed to live, so an
edit made in an open editor tab cannot hot-swap the catalog a concurrently open default-experience
tab is running.

---

## New port: `ProjectRepository`

```ts
interface ProjectRepository {
  create(project: Project): Promise<void>;
  save(project: Project): Promise<void>;         // upsert by id
  load(id: string): Promise<Project>;             // throws ProjectSchemaError / ProjectNotFoundError
  list(): Promise<readonly ProjectSummary[]>;      // id, name, updatedAtMs — for a project picker
  duplicate(id: string): Promise<Project>;         // new id, same content, name suffixed
  remove(id: string): Promise<void>;
  exportBlob(id: string): Promise<Blob>;           // application/json
  importBlob(blob: Blob): Promise<Project>;        // new id; validates before returning
  getActiveProjectId(): Promise<string | null>;
  setActiveProjectId(id: string | null): Promise<void>;
}
```

Mirrors the existing `CameraSource`/`HandDetector` port shape: an interface in `domain/ports/`,
implemented in `infrastructure/persistence/indexeddb-project-repository.ts`, with an in-memory fake
(`test/support/fake-project-repository.ts`) used by every domain-level test — persistence logic is
therefore testable with no browser and no real IndexedDB, exactly as camera and detection already
are.

---

## New port: `PersonSegmenter`

```ts
interface PersonSegmenter {
  segment(surface: MirroredSurface, timestampMs: number): SegmentationFrame | null;
  close(): void;
}
```

Mirrors `HandDetector`'s shape exactly (`detect(surface, timestampMs): LandmarkFrame`). Implemented
by `infrastructure/segmentation/mediapipe-person-segmenter.ts` (research D7); a `null` return means
"no result this frame" (not the same as capability-unavailable, which is decided once at session
start and gates whether a `PersonSegmenter` is constructed at all).

---

## Unchanged types this milestone depends on

For completeness, listed rather than restated: `EffectCatalog`, `EffectDefinition`, `Timeline`,
`TimelineEntry`, `Action`, `Trigger`, `Condition`, `Anchor`, `HandSelector` (all in
`domain/effects/types.ts`); `ActionDescriptor`, `ParamSpec`, `ParamKind`, `ActionRegistry`,
`ActionContext` (base fields), `ActionOutput` (all in `domain/runtime/action-registry.ts`);
`CapabilityRegistry`, `MapCapabilityRegistry`, `PERSON_SEGMENTATION` (in
`domain/runtime/capabilities.ts` — `PERSON_SEGMENTATION`'s value is unchanged; only how its
availability is determined changes, per research D7); `PoseEvent`, `PoseEventKind` (in
`domain/events/pose-events.ts`); `SessionConfig` and every field on it, **including
`activePoseSet`, which this milestone reads but never writes** (FR-021/FR-022).
