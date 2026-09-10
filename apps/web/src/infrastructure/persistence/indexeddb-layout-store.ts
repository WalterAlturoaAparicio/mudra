/**
 * The real, IndexedDB-backed `LayoutStore` (item 11; domain/ports/layout-store.ts).
 *
 * Mirrors `indexeddb-project-repository.ts`'s shape exactly, including why: `indexedDB` is
 * used only in files under `infrastructure/persistence/**` — asserted by
 * `test/architecture/privacy.test.ts`'s scoped exception — and this is a second, deliberately
 * separate database (`mudra-editor-layout`) rather than a new object store bolted onto
 * `mudra-editor`, so this file never has to coordinate a schema version with the project
 * repository's.
 */

import type { LayoutStore, PanelSizes } from '../../domain/ports/layout-store';

/** The database name every production session uses. Tests supply their own. */
export const DEFAULT_DATABASE_NAME = 'mudra-editor-layout';
const DATABASE_VERSION = 1;
const LAYOUT_STORE = 'layout';
const SIZES_KEY = 'panel-sizes';

interface StoredSizesRecord {
  readonly key: typeof SIZES_KEY;
  readonly sizes: PanelSizes;
}

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
      if (!db.objectStoreNames.contains(LAYOUT_STORE)) {
        db.createObjectStore(LAYOUT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

/** Local-only dock-layout panel size persistence, backed by IndexedDB. */
export class IndexedDbLayoutStore implements LayoutStore {
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(databaseName: string = DEFAULT_DATABASE_NAME) {
    this.dbPromise = openIndexedDb(databaseName);
  }

  async load(): Promise<PanelSizes | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(LAYOUT_STORE, 'readonly');
    const record = await promisify<StoredSizesRecord | undefined>(
      tx.objectStore(LAYOUT_STORE).get(SIZES_KEY),
    );
    return record?.sizes ?? null;
  }

  async save(sizes: PanelSizes): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(LAYOUT_STORE, 'readwrite');
    const record: StoredSizesRecord = { key: SIZES_KEY, sizes };
    await promisify(tx.objectStore(LAYOUT_STORE).put(record));
  }
}
