/**
 * The real, IndexedDB-backed `ProjectRepository` (T039, contracts/project-schema.md,
 * contracts/privacy-persistence.md).
 *
 * `indexedDB` is used **only in this file** among the entire application — asserted by
 * `test/architecture/privacy.test.ts`'s scoped exception. Every project stored is exactly
 * what `serializeProject`/`parseProject` (`project-schema.ts`) produce and accept: wire-format
 * JSON, the same shape a hand-authored `config/effects.json` would embed. No camera frame,
 * image, video, or `SegmentationFrame` ever reaches this file (there is no code path by which
 * one could — the domain `Project` type simply has no field for one).
 */

import type { Project, ProjectSummary } from '../../domain/editor/types';
import type { ActionRegistry } from '../../domain/runtime/action-registry';
import type { ProjectRepository } from '../../domain/ports/project-repository';
import { ProjectNotFoundError } from '../../domain/ports/project-repository';
import { ProjectSchemaError, parseProject, serializeProject } from './project-schema';
import type { Json } from '../effects/catalog-loader';

/** The database name every production session uses. Tests supply their own (see T043). */
export const DEFAULT_DATABASE_NAME = 'mudra-editor';
const DATABASE_VERSION = 1;
const PROJECTS_STORE = 'projects';
const META_STORE = 'meta';
const ACTIVE_META_KEY = 'active-project';

/**
 * Read a `Blob` as text, without assuming `Blob.prototype.text()` exists — some DOM
 * implementations (including the jsdom environment `test/adapters/**` runs under) provide an
 * incomplete `Blob` that lacks it, while every DOM environment implements `FileReader`.
 */
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the project file.'));
    reader.readAsText(blob);
  });
}

/**
 * `IDBObjectStore`'s own methods return `IDBRequest<any>` regardless of what is actually
 * stored — the DOM types carry no way to parameterize them — so the cast to `T` here is the
 * one place that untyped boundary is crossed, deliberately and narrowly, rather than at
 * every call site.
 */
function promisify<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openIndexedDb(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

interface StoredProjectRecord extends Json {
  readonly id: string;
}

interface ActiveMetaRecord {
  readonly key: typeof ACTIVE_META_KEY;
  readonly projectId: string | null;
}

/** Local-only project persistence, backed by IndexedDB. */
export class IndexedDbProjectRepository implements ProjectRepository {
  private readonly registry: ActionRegistry;
  private readonly dbPromise: Promise<IDBDatabase>;

  /**
   * @param registry The same instance the runtime uses, so an imported catalog validates
   *   against it.
   * @param databaseName Defaults to the one production database; tests supply their own so
   *   they never share state (or IndexedDB's open/delete blocking behaviour) with each other.
   */
  constructor(registry: ActionRegistry, databaseName: string = DEFAULT_DATABASE_NAME) {
    this.registry = registry;
    this.dbPromise = openIndexedDb(databaseName);
  }

  async create(project: Project): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    const record = this.validatedRecord(project);
    await promisify(tx.objectStore(PROJECTS_STORE).add(record));
  }

  async save(project: Project): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    const stamped: Project = { ...project, updatedAtMs: Date.now() };
    const record = this.validatedRecord(stamped);
    await promisify(tx.objectStore(PROJECTS_STORE).put(record));
  }

  /**
   * Serialize, then immediately re-parse the result through the exact `parseProject` a later
   * `load()` will use (P0.1's defense in depth) — a state that would fail to reload is refused
   * here, at write time, naming the same field a load-time failure would have named, rather
   * than being written and only discovered broken on the next open.
   */
  private validatedRecord(project: Project): StoredProjectRecord {
    const record = serializeProject(project) as StoredProjectRecord;
    try {
      parseProject(record, this.registry);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ProjectSchemaError(
        'Refusing to save — the project would fail to reload: ' + detail,
      );
    }
    return record;
  }

  async load(id: string): Promise<Project> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const record = await promisify<StoredProjectRecord | undefined>(
      tx.objectStore(PROJECTS_STORE).get(id),
    );
    if (record === undefined) {
      throw new ProjectNotFoundError(id);
    }
    return parseProject(record, this.registry);
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const records = await promisify<StoredProjectRecord[]>(tx.objectStore(PROJECTS_STORE).getAll());
    return records
      .map((record): ProjectSummary => ({
        id: String(record['id']),
        name: String(record['name']),
        updatedAtMs: Number(record['updated_at_ms']),
      }))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.load(id);
    const copy: Project = {
      ...source,
      id: id + '-copy-' + Date.now().toString(36),
      name: source.name + ' copy',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    await this.create(copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    await promisify(tx.objectStore(PROJECTS_STORE).delete(id));
    const activeId = await this.getActiveProjectId();
    if (activeId === id) {
      await this.setActiveProjectId(null);
    }
  }

  async exportBlob(id: string): Promise<Blob> {
    const project = await this.load(id);
    const json = JSON.stringify(serializeProject(project), null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  async importBlob(blob: Blob): Promise<Project> {
    const text = await readBlobText(blob);
    const document: unknown = JSON.parse(text);
    const parsed = parseProject(document, this.registry);
    const imported: Project = {
      ...parsed,
      id: 'imported-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    await this.create(imported);
    return imported;
  }

  async getActiveProjectId(): Promise<string | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(META_STORE, 'readonly');
    const record = await promisify<ActiveMetaRecord | undefined>(
      tx.objectStore(META_STORE).get(ACTIVE_META_KEY),
    );
    return record?.projectId ?? null;
  }

  async setActiveProjectId(id: string | null): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(META_STORE, 'readwrite');
    const record: ActiveMetaRecord = { key: ACTIVE_META_KEY, projectId: id };
    await promisify(tx.objectStore(META_STORE).put(record));
  }
}
