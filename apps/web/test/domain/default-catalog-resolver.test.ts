/**
 * `resolveDefaultCatalog` — active project present / absent / broken (T044, FR-033a–c,
 * quickstart.md scenario 9).
 */

import { describe, expect, it } from 'vitest';

import { resolveDefaultCatalog } from '../../src/application/default-catalog-resolver';
import { createProject } from '../../src/domain/editor/types';
import type { EffectCatalog } from '../../src/domain/effects/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { FakeProjectRepository } from '../support/fake-project-repository';

const registry = createActionRegistry();
const SHIPPED_DEFAULT: EffectCatalog = { version: 1, effects: [] };

function loadShippedDefault(): Promise<EffectCatalog> {
  return Promise.resolve(SHIPPED_DEFAULT);
}

describe('no active project', () => {
  it('runs the shipped default catalog', async () => {
    const repo = new FakeProjectRepository(registry);
    const catalog = await resolveDefaultCatalog({ repository: repo, loadShippedDefault });
    expect(catalog).toBe(SHIPPED_DEFAULT);
  });
});

describe('a valid active project', () => {
  it("runs that project's catalog instead of the shipped default", async () => {
    const repo = new FakeProjectRepository(registry);
    const authoredCatalog: EffectCatalog = {
      version: 1,
      effects: [
        {
          id: 'authored',
          name: 'Authored',
          trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
          timeline: {
            durationMs: 300,
            entries: [{ atMs: 0, durationMs: 200, action: { type: 'screen_flash', params: {} } }],
          },
        },
      ],
    };
    const project = createProject(authoredCatalog, 'p1', 'Active', 1000);
    await repo.create(project);
    await repo.setActiveProjectId('p1');

    const catalog = await resolveDefaultCatalog({ repository: repo, loadShippedDefault });
    expect(catalog).toEqual(authoredCatalog);
  });
});

describe('a broken active project (deleted)', () => {
  it('falls back to the shipped default and clears the pointer (FR-033c)', async () => {
    const repo = new FakeProjectRepository(registry);
    await repo.setActiveProjectId('missing-project');

    const catalog = await resolveDefaultCatalog({ repository: repo, loadShippedDefault });

    expect(catalog).toBe(SHIPPED_DEFAULT);
    expect(await repo.getActiveProjectId()).toBeNull();
  });
});

describe('a broken active project (repository failure)', () => {
  it('falls back cleanly even when getActiveProjectId itself rejects', async () => {
    const repo = new FakeProjectRepository(registry);
    const originalGet = repo.getActiveProjectId.bind(repo);
    repo.getActiveProjectId = () => Promise.reject(new Error('IndexedDB unavailable'));

    const catalog = await resolveDefaultCatalog({ repository: repo, loadShippedDefault });
    expect(catalog).toBe(SHIPPED_DEFAULT);

    repo.getActiveProjectId = originalGet;
  });
});
