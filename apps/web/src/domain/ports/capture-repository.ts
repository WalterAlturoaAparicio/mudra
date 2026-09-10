/**
 * Capture storage, behind a port (contracts/capture-storage.md, FR-038).
 *
 * Mirrors the existing `ProjectRepository` shape: an interface here, an IndexedDB-backed
 * implementation in `infrastructure/persistence/`, and an in-memory fake for domain-level tests — so
 * every rule about what a capture session is stays testable with no browser and no IndexedDB.
 *
 * **What is deliberately absent is part of the contract.** There is no `updateSample`, no
 * `markExported`, and no `deleted` flag:
 *
 * * export cannot mutate what it cannot address (FR-052a), and
 * * deletion cannot be faked by a status value that does not exist (FR-044).
 *
 * This interface also knows nothing about `Project` — and `ProjectRepository` knows nothing about
 * capture. `test/architecture/capture-boundary.test.ts` fails if either changes (FR-061).
 */

import type { CaptureSample, CaptureSession } from '../capture/types';

/** Raised when a session or sample id names nothing in the repository. */
export class CaptureNotFoundError extends Error {
  /** The message names the missing id. */
  constructor(kind: 'session' | 'sample', id: string) {
    super(`No capture ${kind} with id "${id}".`);
    this.name = 'CaptureNotFoundError';
  }
}

/** Raised when the browser will not give Capture Mode any storage at all. */
export class CaptureStorageUnavailableError extends Error {
  /** @param detail What the browser said, for the operator-facing message (FR-071). */
  constructor(detail: string) {
    super(detail);
    this.name = 'CaptureStorageUnavailableError';
  }
}

/** Browser-local capture persistence (FR-036 – FR-045). */
export interface CaptureRepository {
  /** Store a brand-new session. Rejects a duplicate id. */
  createSession(session: CaptureSession): Promise<void>;
  /** Every stored session, most recently started first. */
  listSessions(): Promise<readonly CaptureSession[]>;
  /** Move a session to `closed`. @throws {CaptureNotFoundError} */
  closeSession(id: string): Promise<void>;
  /**
   * Remove a session **and every one of its samples**, in one transaction.
   *
   * Removal, not a flag: after this resolves the records are absent from the store (FR-044,
   * FR-045). @throws {CaptureNotFoundError}
   */
  deleteSession(id: string): Promise<void>;
  /** Store one accepted sample and increment its session's count. @throws {CaptureNotFoundError} */
  appendSample(sample: CaptureSample): Promise<void>;
  /** Increment a session's discarded count. The rejected frame itself is never stored. */
  recordDiscarded(sessionId: string): Promise<void>;
  /** One session's samples, in capture order (FR-041). */
  listSamples(sessionId: string): Promise<readonly CaptureSample[]>;
  /** Remove one sample and decrement its session's count. @throws {CaptureNotFoundError} */
  deleteSample(id: string): Promise<void>;
  /** Total stored samples across every session — gates export availability (FR-051). */
  countAll(): Promise<number>;
}
