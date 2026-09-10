/**
 * The real, IndexedDB-backed `AssetBlobStore` (research D2).
 *
 * A separate database from `IndexedDbProjectRepository`'s — asset bytes are a different
 * concern from project documents, and keeping them apart means a project's own document
 * stays small, text, and human-legible (contracts/project-schema.md) with no binary content
 * inlined into it.
 */

import type { AssetBlobStore } from '../../domain/ports/asset-blob-store';

const DATABASE_NAME = 'mudra-editor-assets';
const DATABASE_VERSION = 1;
const BLOBS_STORE = 'blobs';

/**
 * `IDBObjectStore`'s own methods return `IDBRequest<any>` regardless of what is actually
 * stored, so the cast to `T` here is the one place that untyped boundary is crossed.
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
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

interface BlobRecord {
  readonly key: string;
  readonly blob: Blob;
}

/** Local, project-scoped asset blob storage, backed by IndexedDB. */
export class IndexedDbAssetBlobStore implements AssetBlobStore {
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(databaseName: string = DATABASE_NAME) {
    this.dbPromise = openIndexedDb(databaseName);
  }

  async put(key: string, blob: Blob): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    const record: BlobRecord = { key, blob };
    await promisify(tx.objectStore(BLOBS_STORE).put(record));
  }

  async get(key: string): Promise<Blob | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(BLOBS_STORE, 'readonly');
    const record = await promisify<BlobRecord | undefined>(tx.objectStore(BLOBS_STORE).get(key));
    return record?.blob ?? null;
  }

  async remove(key: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    await promisify(tx.objectStore(BLOBS_STORE).delete(key));
  }
}
