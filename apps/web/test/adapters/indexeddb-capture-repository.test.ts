/**
 * `IndexedDbCaptureRepository` against `fake-indexeddb` (contracts/capture-storage.md).
 *
 * The deletion assertions read the **store** back rather than trusting a return value, because
 * FR-044/FR-045 are claims about what is in the database, not about what a method returned. A
 * tombstone implementation would pass a return-value test and fail these.
 *
 * `fake-indexeddb/auto` installs a real IndexedDB implementation onto the global scope for this
 * file only — jsdom does not implement the API.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { CaptureNotFoundError } from '../../src/domain/ports/capture-repository';
import {
  CAPTURE_DATABASE_NAME,
  IndexedDbCaptureRepository,
} from '../../src/infrastructure/persistence/indexeddb-capture-repository';
import { CaptureSchemaError, parseStoredSample } from '../../src/infrastructure/persistence/capture-schema';
import { sample, session } from '../support/capture';

/**
 * A fresh database name per test — not one deleted and recreated — because `deleteDatabase`
 * blocks until every open connection closes, and racing that against a fresh `open()` is the
 * classic deadlock. The same reason `indexeddb-project-repository.test.ts` gives.
 */
let counter = 0;
function freshRepository(): IndexedDbCaptureRepository {
  return new IndexedDbCaptureRepository(`mudra-capture-test-${++counter}`);
}

let repository: IndexedDbCaptureRepository;

beforeEach(() => {
  repository = freshRepository();
});

/** Read a store directly, so absence can be asserted rather than inferred. */
function readStore(databaseName: string, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction([store], 'readonly').objectStore(store).getAll();
      request.onsuccess = () => {
        resolve(request.result as unknown[]);
        db.close();
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });
}

describe('sessions', () => {
  it('stores and lists a session', async () => {
    await repository.createSession(session());
    const stored = await repository.listSessions();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.poseId).toBe('dragon');
    expect(stored[0]?.contributorLabel).toBe('walter');
    expect(stored[0]?.status).toBe('active');
  });

  it('rejects a duplicate session id', async () => {
    await repository.createSession(session());
    await expect(repository.createSession(session())).rejects.toBeTruthy();
  });

  it('lists most recently started first', async () => {
    await repository.createSession(session({ id: 'a', startedAt: '2026-09-07T10:00:00.000000+00:00' }));
    await repository.createSession(session({ id: 'b', startedAt: '2026-09-07T12:00:00.000000+00:00' }));
    expect((await repository.listSessions()).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('closes a session, and reports an unknown id', async () => {
    await repository.createSession(session());
    await repository.closeSession('session-0001');
    expect((await repository.listSessions())[0]?.status).toBe('closed');
    await expect(repository.closeSession('nope')).rejects.toThrow(CaptureNotFoundError);
  });
});

describe('samples', () => {
  beforeEach(async () => {
    await repository.createSession(session());
  });

  it('appends a sample and increments the session count', async () => {
    await repository.appendSample(sample({ id: 'a' }));
    await repository.appendSample(sample({ id: 'b', capturedAt: '2026-09-07T13:20:01.000000+00:00' }));
    expect(await repository.countAll()).toBe(2);
    expect((await repository.listSessions())[0]?.sampleCount).toBe(2);
  });

  it('lists a session’s samples in capture order', async () => {
    await repository.appendSample(sample({ id: 'b', capturedAt: '2026-09-07T13:20:05.000000+00:00' }));
    await repository.appendSample(sample({ id: 'a', capturedAt: '2026-09-07T13:20:01.000000+00:00' }));
    expect((await repository.listSamples('session-0001')).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('round-trips landmark coordinates exactly', async () => {
    const original = sample({ id: 'a' });
    await repository.appendSample(original);
    const [stored] = await repository.listSamples('session-0001');
    expect(stored?.hands[0]?.raw).toEqual(original.hands[0]?.raw);
    expect(stored?.hands[0]?.normalized).toEqual(original.hands[0]?.normalized);
  });

  it('refuses a sample whose session does not exist', async () => {
    await expect(repository.appendSample(sample({ sessionId: 'nope' }))).rejects.toThrow(
      CaptureNotFoundError,
    );
  });

  it('records a discarded frame without storing anything (FR-019)', async () => {
    await repository.recordDiscarded('session-0001');
    await repository.recordDiscarded('session-0001');
    expect(await repository.countAll()).toBe(0);
    expect((await repository.listSessions())[0]?.discardedCount).toBe(2);
  });
});

describe('deletion removes, and does not flag (FR-044, FR-045, SC-006)', () => {
  const databaseName = () => `mudra-capture-test-${counter}`;

  beforeEach(async () => {
    await repository.createSession(session());
    await repository.appendSample(sample({ id: 'a' }));
    await repository.appendSample(sample({ id: 'b', capturedAt: '2026-09-07T13:20:02.000000+00:00' }));
  });

  it('deletes one sample — the record is absent from the store, not marked', async () => {
    await repository.deleteSample('a');
    repository.close();

    const records = await readStore(databaseName(), 'samples');
    expect(records.map((r) => (r as { id: string }).id)).toEqual(['b']);
    // No flag survived under any plausible name.
    for (const record of records) {
      const keys = Object.keys(record as object);
      expect(keys).not.toContain('deleted');
      expect(keys).not.toContain('deletedAt');
      expect(keys).not.toContain('tombstone');
    }
  });

  it('decrements the session count when a sample is deleted', async () => {
    await repository.deleteSample('a');
    expect((await repository.listSessions())[0]?.sampleCount).toBe(1);
    expect(await repository.countAll()).toBe(1);
  });

  it('reports an unknown sample id', async () => {
    await expect(repository.deleteSample('nope')).rejects.toThrow(CaptureNotFoundError);
  });

  it('deletes a session and every one of its samples, leaving 0 residual records', async () => {
    await repository.deleteSession('session-0001');
    repository.close();

    expect(await readStore(databaseName(), 'samples')).toEqual([]);
    expect(await readStore(databaseName(), 'sessions')).toEqual([]);
  });

  it('leaves another session’s samples untouched', async () => {
    await repository.createSession(session({ id: 'other', poseId: 'peace' }));
    await repository.appendSample(sample({ id: 'c', sessionId: 'other' }));

    await repository.deleteSession('session-0001');

    expect(await repository.countAll()).toBe(1);
    expect((await repository.listSamples('other')).map((s) => s.id)).toEqual(['c']);
  });

  it('reports an unknown session id', async () => {
    await expect(repository.deleteSession('nope')).rejects.toThrow(CaptureNotFoundError);
  });
});

describe('isolation from project persistence (FR-037)', () => {
  it('uses its own database, never the editor’s', () => {
    expect(CAPTURE_DATABASE_NAME).toBe('mudra-capture');
    expect(CAPTURE_DATABASE_NAME).not.toBe('mudra-editor');
  });

  it('does not create the editor’s database as a side effect', async () => {
    await repository.createSession(session());
    await repository.appendSample(sample());
    repository.close();

    const databases = await indexedDB.databases?.();
    if (databases !== undefined) {
      expect(databases.map((d) => d.name)).not.toContain('mudra-editor');
    }
  });
});

describe('stored records are validated on the way out', () => {
  it('rejects a record this build does not understand, rather than half-reading it', () => {
    expect(() => parseStoredSample({ id: 'a' })).toThrow(CaptureSchemaError);
    expect(() => parseStoredSample({ ...sample(), hands: [] })).toThrow(/non-empty/);
  });

  it('rejects a hand with the wrong landmark count', () => {
    const broken = { ...sample(), hands: [{ ...sample().hands[0]!, raw: [] }] };
    expect(() => parseStoredSample(broken)).toThrow(/exactly 21 landmarks/);
  });
});
