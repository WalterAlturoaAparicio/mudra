/**
 * The real, IndexedDB-backed `CaptureRepository` (contracts/capture-storage.md).
 *
 * It lives in this directory because this is the **one** directory the privacy scan permits to
 * touch browser storage; putting the capture store here means that permitted-directory list does
 * not grow (FR-039), which is the narrowest possible change.
 *
 * The **database** is separate from the editor's (`mudra-capture` vs `mudra-editor`), which is what
 * makes FR-037 structural rather than a rule: a capture operation cannot address a project record
 * because it is not in this connection, and clearing capture data cannot reach a project.
 *
 * Nothing here can hold a camera frame. The signatures accept `CaptureSample` and nothing else, and
 * `capture-schema.ts`'s type graph has no field an image could be assigned to.
 */

import type { CaptureSample, CaptureSession } from '../../domain/capture/types';
import {
  closeSession as closeSessionValue,
  withAcceptedSample,
  withDeletedSample,
  withDiscardedFrame,
} from '../../domain/capture/session';
import type { CaptureRepository } from '../../domain/ports/capture-repository';
import {
  CaptureNotFoundError,
  CaptureStorageUnavailableError,
} from '../../domain/ports/capture-repository';
import {
  parseStoredSample,
  parseStoredSession,
  serializeSample,
  serializeSession,
} from './capture-schema';

/**
 * The database Capture Mode uses. Deliberately **not** `mudra-editor`.
 *
 * A test supplies its own name so suites cannot collide with each other or with a real session.
 */
export const CAPTURE_DATABASE_NAME = 'mudra-capture';
const DATABASE_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const SAMPLES_STORE = 'samples';
const BY_SESSION_INDEX = 'by_session';

/**
 * `IDBObjectStore`'s methods return `IDBRequest<any>` regardless of what is stored — the DOM types
 * carry no way to parameterize them — so the cast to `T` happens here, once and narrowly, rather
 * than at every call site. The same seam `indexeddb-project-repository.ts` already uses.
 */
function promisify<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openIndexedDb(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, DATABASE_VERSION);
    } catch (error) {
      // A private window or blocked site data throws here rather than erroring the request.
      const detail = error instanceof Error ? error.message : String(error);
      reject(new CaptureStorageUnavailableError(detail));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
        const samples = db.createObjectStore(SAMPLES_STORE, { keyPath: 'id' });
        // So listing and deleting a session's samples are range operations, not full scans.
        samples.createIndex(BY_SESSION_INDEX, 'sessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new CaptureStorageUnavailableError(
          request.error?.message ?? 'This browser would not open local storage for Capture Mode.',
        ),
      );
  });
}

/** Run `work` in a transaction and resolve when the transaction itself completes. */
function transact<T>(
  db: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction([...stores], mode);
    let result: T;
    let failed = false;
    transaction.oncomplete = () => {
      if (!failed) {
        resolve(result);
      }
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => {
      if (!failed) {
        reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      }
    };
    void (async () => {
      try {
        result = await work(transaction);
      } catch (error) {
        failed = true;
        try {
          transaction.abort();
        } catch {
          // Already finished; the rejection below is what matters.
        }
        reject(error);
      }
    })();
  });
}

/** Browser-local capture persistence. */
export class IndexedDbCaptureRepository implements CaptureRepository {
  private readonly databaseName: string;
  private database: IDBDatabase | null = null;

  /** @param databaseName Overridden only by tests. */
  constructor(databaseName: string = CAPTURE_DATABASE_NAME) {
    this.databaseName = databaseName;
  }

  /** Open the database, reporting a browser that refuses storage in a usable form (FR-071). */
  async open(): Promise<void> {
    await this.db();
  }

  /** Close the connection. Idempotent. */
  close(): void {
    this.database?.close();
    this.database = null;
  }

  async createSession(session: CaptureSession): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE], 'readwrite', async (transaction) => {
      // `add` rather than `put`: a duplicate id is a bug, and it should say so.
      await promisify(transaction.objectStore(SESSIONS_STORE).add(serializeSession(session)));
    });
  }

  async listSessions(): Promise<readonly CaptureSession[]> {
    const db = await this.db();
    const records = await transact(db, [SESSIONS_STORE], 'readonly', (transaction) =>
      promisify<unknown[]>(transaction.objectStore(SESSIONS_STORE).getAll()),
    );
    return records
      .map((record) => parseStoredSession(record))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async closeSession(id: string): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(SESSIONS_STORE);
      const session = await this.requireSession(store, id);
      await promisify(store.put(serializeSession(closeSessionValue(session))));
    });
  }

  /**
   * Remove a session and every one of its samples, in **one** transaction.
   *
   * Both stores are named in the same transaction so a failure leaves neither orphaned samples nor
   * a session missing its samples (contracts/capture-storage.md).
   */
  async deleteSession(id: string): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE, SAMPLES_STORE], 'readwrite', async (transaction) => {
      const sessions = transaction.objectStore(SESSIONS_STORE);
      await this.requireSession(sessions, id);
      const samples = transaction.objectStore(SAMPLES_STORE);
      const keys = await promisify<IDBValidKey[]>(
        samples.index(BY_SESSION_INDEX).getAllKeys(IDBKeyRange.only(id)),
      );
      for (const key of keys) {
        await promisify(samples.delete(key));
      }
      await promisify(sessions.delete(id));
    });
  }

  async appendSample(sample: CaptureSample): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE, SAMPLES_STORE], 'readwrite', async (transaction) => {
      const sessions = transaction.objectStore(SESSIONS_STORE);
      const session = await this.requireSession(sessions, sample.sessionId);
      await promisify(transaction.objectStore(SAMPLES_STORE).add(serializeSample(sample)));
      await promisify(sessions.put(serializeSession(withAcceptedSample(session))));
    });
  }

  async recordDiscarded(sessionId: string): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(SESSIONS_STORE);
      const session = await this.requireSession(store, sessionId);
      await promisify(store.put(serializeSession(withDiscardedFrame(session))));
    });
  }

  async listSamples(sessionId: string): Promise<readonly CaptureSample[]> {
    const db = await this.db();
    const records = await transact(db, [SAMPLES_STORE], 'readonly', (transaction) =>
      promisify<unknown[]>(
        transaction
          .objectStore(SAMPLES_STORE)
          .index(BY_SESSION_INDEX)
          .getAll(IDBKeyRange.only(sessionId)),
      ),
    );
    return records
      .map((record) => parseStoredSample(record))
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  async deleteSample(id: string): Promise<void> {
    const db = await this.db();
    await transact(db, [SESSIONS_STORE, SAMPLES_STORE], 'readwrite', async (transaction) => {
      const samples = transaction.objectStore(SAMPLES_STORE);
      const stored = await promisify<unknown>(samples.get(id));
      if (stored === undefined) {
        throw new CaptureNotFoundError('sample', id);
      }
      const sample = parseStoredSample(stored);
      await promisify(samples.delete(id));
      const sessions = transaction.objectStore(SESSIONS_STORE);
      const record = await promisify<unknown>(sessions.get(sample.sessionId));
      if (record !== undefined) {
        await promisify(
          sessions.put(serializeSession(withDeletedSample(parseStoredSession(record)))),
        );
      }
    });
  }

  async countAll(): Promise<number> {
    const db = await this.db();
    return transact(db, [SAMPLES_STORE], 'readonly', (transaction) =>
      promisify<number>(transaction.objectStore(SAMPLES_STORE).count()),
    );
  }

  private async db(): Promise<IDBDatabase> {
    this.database ??= await openIndexedDb(this.databaseName);
    return this.database;
  }

  private async requireSession(store: IDBObjectStore, id: string): Promise<CaptureSession> {
    const record = await promisify<unknown>(store.get(id));
    if (record === undefined) {
      throw new CaptureNotFoundError('session', id);
    }
    return parseStoredSession(record);
  }
}
