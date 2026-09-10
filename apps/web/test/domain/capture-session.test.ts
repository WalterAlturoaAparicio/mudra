/**
 * Session rules, asserted with no browser and no IndexedDB (FR-012 – FR-014b, FR-060).
 *
 * The last describe block matters most: it pins the *absence* of a reopen transition and the
 * *absence* of a soft-delete, both of which are contract, not omission.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CAPTURE_CONFIG } from '../../src/domain/config/capture-config';
import {
  acceptsTakes,
  closeSession,
  contributorLabelProblem,
  createSession,
  poseIdProblem,
  withAcceptedSample,
  withDeletedSample,
  withDiscardedFrame,
} from '../../src/domain/capture/session';
import { CaptureError } from '../../src/domain/capture/types';
import { engineTimestamp } from '../../src/domain/capture/engine-timestamp';
import { FakeCaptureRepository } from '../support/fake-capture-repository';
import { sample, session } from '../support/capture';

const config = DEFAULT_CAPTURE_CONFIG;
const startedAt = new Date('2026-09-07T13:19:56.400Z');

function newSession(overrides: Partial<Parameters<typeof createSession>[0]> = {}) {
  return createSession(
    {
      id: 'session-0001',
      contributorLabel: 'walter',
      poseId: 'dragon',
      displayName: 'dragon',
      requiredHands: 2,
      startedAt,
      ...overrides,
    },
    config,
  );
}

describe('createSession', () => {
  it('starts active, empty, and stamped in Engine’s timestamp format', () => {
    const created = newSession();
    expect(created.status).toBe('active');
    expect(created.sampleCount).toBe(0);
    expect(created.discardedCount).toBe(0);
    expect(created.startedAt).toBe(engineTimestamp(startedAt));
    expect(created.startedAt).toMatch(/\+00:00$/);
  });

  it('rejects a contributor label that could hold personal data', () => {
    expect(() => newSession({ contributorLabel: 'someone@example.com' })).toThrow(CaptureError);
    expect(() => newSession({ contributorLabel: '' })).toThrow(CaptureError);
  });

  it('rejects a pose id the dataset would not accept', () => {
    expect(() => newSession({ poseId: 'Dragon!' })).toThrow(CaptureError);
    expect(() => newSession({ poseId: '' })).toThrow(CaptureError);
  });

  it('accepts a pose that is not in the dataset yet (FR-013)', () => {
    // Collecting samples for a brand-new pose is a reason the feature exists, not an edge case.
    const created = newSession({ poseId: 'brand_new_pose', displayName: null, requiredHands: 1 });
    expect(created.poseId).toBe('brand_new_pose');
    expect(created.displayName).toBeNull();
  });

  it('rejects a hand count that is neither 1 nor 2', () => {
    expect(() => newSession({ requiredHands: 3 as 1 | 2 })).toThrow(CaptureError);
  });
});

describe('validation messages', () => {
  it('names what is wrong, in the operator’s language (FR-071)', () => {
    expect(contributorLabelProblem('', config)).toMatch(/Enter a contributor label/);
    expect(contributorLabelProblem('Walter Alturo', config)).toMatch(/short handle/);
    expect(contributorLabelProblem('walter', config)).toBeNull();
    expect(poseIdProblem('', config)).toMatch(/Choose a pose/);
    expect(poseIdProblem('Dragon', config)).toMatch(/lower-case/);
    expect(poseIdProblem('dragon', config)).toBeNull();
  });
});

describe('counts', () => {
  it('increments on an accepted sample and on a discarded frame independently', () => {
    let s = newSession();
    s = withAcceptedSample(withAcceptedSample(s));
    s = withDiscardedFrame(s);
    expect(s.sampleCount).toBe(2);
    expect(s.discardedCount).toBe(1);
  });

  it('never goes negative when a sample is deleted', () => {
    // A count disagreeing with the store would be worse than one that refuses to.
    expect(withDeletedSample(newSession()).sampleCount).toBe(0);
  });

  it('leaves every other field untouched', () => {
    const before = newSession();
    const after = withAcceptedSample(before);
    expect({ ...after, sampleCount: 0 }).toEqual(before);
  });
});

describe('lifecycle', () => {
  it('closes, and closing twice is harmless', () => {
    const closed = closeSession(newSession());
    expect(closed.status).toBe('closed');
    expect(closeSession(closed)).toBe(closed);
    expect(acceptsTakes(closed)).toBe(false);
  });

  it('offers no way back — there is no reopen operation', async () => {
    // Asserted against the module's own surface: a reopen would have to be added deliberately.
    const module = await import('../../src/domain/capture/session');
    expect(Object.keys(module)).not.toContain('reopenSession');
    expect(Object.keys(module).some((name) => /reopen|activate/i.test(name))).toBe(false);
  });
});

describe('the repository port, through the in-memory fake', () => {
  it('deletes a session and every one of its samples', async () => {
    const repository = new FakeCaptureRepository();
    await repository.createSession(session());
    await repository.appendSample(sample({ id: 'a' }));
    await repository.appendSample(sample({ id: 'b' }));
    expect(await repository.countAll()).toBe(2);

    await repository.deleteSession('session-0001');

    expect(repository.storedSampleIds).toEqual([]);
    expect(repository.storedSessionIds).toEqual([]);
    expect(await repository.countAll()).toBe(0);
  });

  it('removes a deleted sample rather than flagging it (FR-044)', async () => {
    const repository = new FakeCaptureRepository();
    await repository.createSession(session());
    await repository.appendSample(sample({ id: 'a' }));
    await repository.appendSample(sample({ id: 'b' }));

    await repository.deleteSample('a');

    expect(repository.storedSampleIds).toEqual(['b']);
    const [stored] = await repository.listSessions();
    expect(stored?.sampleCount).toBe(1);
  });

  it('exposes no operation that could mutate a stored sample (FR-052a)', () => {
    const repository = new FakeCaptureRepository();
    for (const forbidden of ['updateSample', 'markExported', 'setDeleted']) {
      expect(forbidden in repository).toBe(false);
    }
  });
});
