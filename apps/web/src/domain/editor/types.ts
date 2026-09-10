/**
 * The editor's own domain types (constitution v1.7.0, Milestone 2; data-model.md).
 *
 * `Project.catalog` is the *domain* representation — the exact, unmodified `EffectCatalog`
 * type `EffectRuntime` already consumes. The *persisted* wire format (IndexedDB, export
 * blobs) is a different, snake_case shape crossed only by `parseCatalog`/`serializeCatalog`
 * in `infrastructure/effects/catalog-loader.ts` (contracts/project-schema.md). Nothing in
 * this file, or anywhere else, holds a second effect-catalog format.
 */

import type { EffectCatalog } from '../effects/types';

/** One asset available to a project, addressable by logical reference (data-model.md). */
export interface AssetLibraryEntry {
  /** e.g. `@audio/whoosh` — the same indirection `AssetManifest` already uses. */
  readonly reference: string;
  /** Author-facing, shown in the picker. */
  readonly displayName: string;
  readonly kind: 'audio' | 'image';
  /** Opaque handle into local blob storage, resolved by infrastructure. */
  readonly storageKey: string;
}

/** A project's own small collection of assets. */
export interface AssetLibrary {
  readonly entries: readonly AssetLibraryEntry[];
}

/** An empty asset library, for a newly created project. */
export const EMPTY_ASSET_LIBRARY: AssetLibrary = { entries: [] };

/** A normalized rectangle in `[0, 1]` surface coordinates. */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Render-time visual treatment of the camera feed — never sent to the camera device, and
 * never applied to the imagery `HandDetector` receives (FR-048–051).
 */
export interface CameraTreatmentSettings {
  /** `-1..1`, `0` = unchanged. */
  readonly brightness: number;
  /** `-1..1`, `0` = unchanged. */
  readonly contrast: number;
  /** `-1..1`, `0` = unchanged. */
  readonly saturation: number;
  /** Always `true` by default (Milestone 1's FR-002); author-visible, not silently overridable. */
  readonly mirror: boolean;
  /** `1..4`, `1` = unchanged. */
  readonly zoom: number;
  /** `null` = full frame. */
  readonly crop: CropRect | null;
}

/** The identity transform every new project starts from. */
export const DEFAULT_CAMERA_TREATMENT: CameraTreatmentSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  mirror: true,
  zoom: 1,
  crop: null,
};

/** The schema version this build understands (contracts/project-schema.md). */
export const PROJECT_SCHEMA_VERSION = 1;

/**
 * The editor's document (data-model.md `Project`).
 *
 * This is the *domain* representation. `catalog` is the exact `EffectCatalog` type the
 * runtime already consumes — never re-modeled, never a second format.
 */
export interface Project {
  readonly schemaVersion: number;
  /** Stable, generated on create, never reused. */
  readonly id: string;
  /** Author-facing, editable, not an identifier. */
  readonly name: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly catalog: EffectCatalog;
  readonly assetLibrary: AssetLibrary;
  readonly cameraTreatment: CameraTreatmentSettings;
}

/** Build a fresh `Project` around an existing catalog — e.g. the shipped default one. */
export function createProject(
  catalog: EffectCatalog,
  id: string,
  name: string,
  nowMs: number,
): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    catalog,
    assetLibrary: EMPTY_ASSET_LIBRARY,
    cameraTreatment: DEFAULT_CAMERA_TREATMENT,
  };
}

/** Raised by {@link renameProject} when the given name is empty or whitespace-only. */
export class InvalidProjectNameError extends Error {
  constructor() {
    super('A project name cannot be empty.');
    this.name = 'InvalidProjectNameError';
  }
}

/**
 * Rename a project (item 1/P3) — `name` is already part of the existing model and wire
 * format (`project-schema.ts`'s `text()` already requires it as a non-empty string; this
 * trims and rejects whitespace-only on top of that, a stricter UI-facing rule that is still
 * always a valid non-empty string by the time it reaches the schema). `id` — the project's
 * actual identity — is never touched: renaming and identity are already independent fields
 * in this model, so there is nothing else for this function to decide.
 *
 * @throws InvalidProjectNameError when the trimmed name is empty.
 */
export function renameProject(project: Project, name: string, nowMs?: number): Project {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new InvalidProjectNameError();
  }
  // `updatedAtMs` is the repository's to bump on save (data-model.md), so a caller with no
  // clock gets the untouched value. A caller that *has* one — the editor, which keeps a
  // rename in undo history long before anything is saved — passes it, so the history's own
  // ordering does not depend on when a save happens to occur.
  return nowMs === undefined
    ? { ...project, name: trimmed }
    : { ...project, name: trimmed, updatedAtMs: nowMs };
}

/** Enough of a project to list it, without loading its full catalog/assets. */
export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAtMs: number;
}

/** Which project, if any, the default zero-chrome experience should run (FR-033a–c). */
export interface ActiveProjectPointer {
  readonly activeProjectId: string | null;
}

/** No project is active — the default experience runs the shipped default catalog. */
export const NO_ACTIVE_PROJECT: ActiveProjectPointer = { activeProjectId: null };
