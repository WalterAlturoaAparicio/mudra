/**
 * Parses and serializes a project document (contracts/project-schema.md, data-model.md).
 *
 * Deliberately **infrastructure**, not domain: like `catalog-loader.ts`, it is the one place
 * that knows the wire format is snake_case JSON while the domain model is camelCase
 * (constitution's layering rule — dependencies point inward only, so domain code must never
 * import from here). Every branch fails **at load**, naming the offending field — the same
 * discipline `parseSessionConfig` and `parseCatalog` already apply. `catalog` is wire-format
 * JSON, identical in shape to `config/effects.json`, and is parsed/serialized through
 * `parseCatalog`/`serializeCatalog` **unmodified** — there is no second effect-catalog format
 * anywhere in this file (I1 remediation; SC-008 depends on this being true by construction).
 */

import type { ActionRegistry } from '../../domain/runtime/action-registry';
import type {
  AssetLibrary,
  AssetLibraryEntry,
  CameraTreatmentSettings,
  CropRect,
  Project,
} from '../../domain/editor/types';
import {
  DEFAULT_CAMERA_TREATMENT,
  EMPTY_ASSET_LIBRARY,
  PROJECT_SCHEMA_VERSION,
} from '../../domain/editor/types';
import { parseCatalog, serializeCatalog } from '../effects/catalog-loader';
import type { Json } from '../effects/catalog-loader';

/** Raised when a project document does not satisfy its schema. */
export class ProjectSchemaError extends Error {
  /** The message names the offending field; there is no code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSchemaError';
  }
}

function object(value: unknown, where: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectSchemaError(where + ' must be an object.');
  }
  return value as Json;
}

function text(raw: Json, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectSchemaError(where + '.' + key + ' must be a non-empty string.');
  }
  return value;
}

function num(raw: Json, key: string, where: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectSchemaError(where + '.' + key + ' must be a finite number.');
  }
  return value;
}

function bool(raw: Json, key: string, where: string): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') {
    throw new ProjectSchemaError(where + '.' + key + ' must be a boolean.');
  }
  return value;
}

const ASSET_KINDS = ['audio', 'image'] as const;

function parseAssetEntry(raw: unknown, where: string): AssetLibraryEntry {
  const entry = object(raw, where);
  const kind = text(entry, 'kind', where);
  if (!ASSET_KINDS.includes(kind as (typeof ASSET_KINDS)[number])) {
    throw new ProjectSchemaError(
      where + '.kind must be one of ' + ASSET_KINDS.join(', ') + ', got "' + kind + '".',
    );
  }
  const reference = text(entry, 'reference', where);
  const prefix = kind === 'audio' ? '@audio/' : '@image/';
  if (!reference.startsWith(prefix)) {
    throw new ProjectSchemaError(
      where + '.reference must start with "' + prefix + '" for kind "' + kind + '".',
    );
  }
  return {
    reference,
    displayName: text(entry, 'display_name', where),
    kind: kind as 'audio' | 'image',
    storageKey: text(entry, 'storage_key', where),
  };
}

function parseAssetLibrary(raw: unknown, where: string): AssetLibrary {
  if (raw === undefined) {
    return EMPTY_ASSET_LIBRARY;
  }
  const container = object(raw, where);
  const entriesRaw = container['entries'];
  if (!Array.isArray(entriesRaw)) {
    throw new ProjectSchemaError(where + '.entries must be an array.');
  }
  const entries = (entriesRaw as unknown[]).map((entry, index) =>
    parseAssetEntry(entry, where + '.entries[' + index + ']'),
  );
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.reference)) {
      throw new ProjectSchemaError(
        where + ': duplicate asset reference "' + entry.reference + '".',
      );
    }
    seen.add(entry.reference);
  }
  return { entries };
}

function parseCropRect(raw: unknown, where: string): CropRect {
  const entry = object(raw, where);
  return {
    x: num(entry, 'x', where),
    y: num(entry, 'y', where),
    w: num(entry, 'w', where),
    h: num(entry, 'h', where),
  };
}

function inRange(value: number, min: number, max: number, where: string): number {
  if (value < min || value > max) {
    throw new ProjectSchemaError(
      where + ' must lie in [' + min + ', ' + max + '], got ' + value + '.',
    );
  }
  return value;
}

function parseCameraTreatment(raw: unknown, where: string): CameraTreatmentSettings {
  if (raw === undefined) {
    return DEFAULT_CAMERA_TREATMENT;
  }
  const entry = object(raw, where);
  const cropRaw = entry['crop'];
  return {
    brightness: inRange(num(entry, 'brightness', where), -1, 1, where + '.brightness'),
    contrast: inRange(num(entry, 'contrast', where), -1, 1, where + '.contrast'),
    saturation: inRange(num(entry, 'saturation', where), -1, 1, where + '.saturation'),
    mirror: bool(entry, 'mirror', where),
    zoom: inRange(num(entry, 'zoom', where), 1, 4, where + '.zoom'),
    crop:
      cropRaw === null || cropRaw === undefined ? null : parseCropRect(cropRaw, where + '.crop'),
  };
}

/**
 * Parse a project document (wire-format JSON) into the domain `Project`.
 *
 * @param document Untrusted input — typically `JSON.parse`d IndexedDB or file content.
 * @param registry The same `ActionRegistry` instance the runtime uses, so `catalog` validates
 *   against the actions this build actually knows.
 */
export function parseProject(document: unknown, registry: ActionRegistry): Project {
  const root = object(document, 'project');
  const schemaVersion = num(root, 'project_schema_version', 'project');
  if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectSchemaError(
      'project.project_schema_version must be ' +
        PROJECT_SCHEMA_VERSION +
        ', got ' +
        schemaVersion +
        '. This project was saved by an incompatible version of the editor.',
    );
  }

  let catalog;
  try {
    catalog = parseCatalog(root['catalog'], registry);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProjectSchemaError('project.catalog is invalid — ' + detail);
  }

  return {
    schemaVersion,
    id: text(root, 'id', 'project'),
    name: text(root, 'name', 'project'),
    createdAtMs: num(root, 'created_at_ms', 'project'),
    updatedAtMs: num(root, 'updated_at_ms', 'project'),
    catalog,
    assetLibrary: parseAssetLibrary(root['asset_library'], 'project.asset_library'),
    cameraTreatment: parseCameraTreatment(root['camera_treatment'], 'project.camera_treatment'),
  };
}

function serializeAssetEntry(entry: AssetLibraryEntry): Json {
  return {
    reference: entry.reference,
    display_name: entry.displayName,
    kind: entry.kind,
    storage_key: entry.storageKey,
  };
}

function serializeCameraTreatment(settings: CameraTreatmentSettings): Json {
  return {
    brightness: settings.brightness,
    contrast: settings.contrast,
    saturation: settings.saturation,
    mirror: settings.mirror,
    zoom: settings.zoom,
    crop: settings.crop === null ? null : { ...settings.crop },
  };
}

/**
 * Serialize a domain `Project` back to the wire-format JSON stored/exported by
 * `ProjectRepository` (contracts/project-schema.md). The exact structural inverse of
 * {@link parseProject}.
 */
export function serializeProject(project: Project): Json {
  return {
    project_schema_version: project.schemaVersion,
    id: project.id,
    name: project.name,
    created_at_ms: project.createdAtMs,
    updated_at_ms: project.updatedAtMs,
    catalog: serializeCatalog(project.catalog),
    asset_library: { entries: project.assetLibrary.entries.map(serializeAssetEntry) },
    camera_treatment: serializeCameraTreatment(project.cameraTreatment),
  };
}
