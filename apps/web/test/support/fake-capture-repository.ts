/**
 * An in-memory `CaptureRepository`, so session rules are testable with no browser (FR-038, FR-060).
 *
 * It is deliberately faithful about the two behaviours the specification cares most about:
 * `deleteSession` removes the samples too, and deletion **removes** rather than flags. A fake that
 * kept a tombstone would let a test pass that the real adapter would fail.
 */

import type { CaptureSample, CaptureSession } from '../../src/domain/capture/types';
import { withAcceptedSample, withDeletedSample, withDiscardedFrame, closeSession } from '../../src/domain/capture/session';
import type { CaptureRepository } from '../../src/domain/ports/capture-repository';
import { CaptureNotFoundError } from '../../src/domain/ports/capture-repository';

export class FakeCaptureRepository implements CaptureRepository {
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly samples = new Map<string, CaptureSample>();

  async createSession(session: CaptureSession): Promise<void> {
    if (this.sessions.has(session.id)) {
      throw new Error(`A capture session with id "${session.id}" already exists.`);
    }
    this.sessions.set(session.id, session);
  }

  async listSessions(): Promise<readonly CaptureSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async closeSession(id: string): Promise<void> {
    this.sessions.set(id, closeSession(this.require(id)));
  }

  async deleteSession(id: string): Promise<void> {
    this.require(id);
    for (const [sampleId, sample] of [...this.samples]) {
      if (sample.sessionId === id) {
        this.samples.delete(sampleId);
      }
    }
    this.sessions.delete(id);
  }

  async appendSample(sample: CaptureSample): Promise<void> {
    const session = this.require(sample.sessionId);
    this.samples.set(sample.id, sample);
    this.sessions.set(session.id, withAcceptedSample(session));
  }

  async recordDiscarded(sessionId: string): Promise<void> {
    const session = this.require(sessionId);
    this.sessions.set(session.id, withDiscardedFrame(session));
  }

  async listSamples(sessionId: string): Promise<readonly CaptureSample[]> {
    return [...this.samples.values()]
      .filter((sample) => sample.sessionId === sessionId)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  async deleteSample(id: string): Promise<void> {
    const sample = this.samples.get(id);
    if (sample === undefined) {
      throw new CaptureNotFoundError('sample', id);
    }
    this.samples.delete(id);
    const session = this.sessions.get(sample.sessionId);
    if (session !== undefined) {
      this.sessions.set(session.id, withDeletedSample(session));
    }
  }

  async countAll(): Promise<number> {
    return this.samples.size;
  }

  /** Test-only: look straight into the store, to assert absence rather than a flag. */
  get storedSampleIds(): readonly string[] {
    return [...this.samples.keys()];
  }

  /** Test-only: the raw session records. */
  get storedSessionIds(): readonly string[] {
    return [...this.sessions.keys()];
  }

  private require(id: string): CaptureSession {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new CaptureNotFoundError('session', id);
    }
    return session;
  }
}
