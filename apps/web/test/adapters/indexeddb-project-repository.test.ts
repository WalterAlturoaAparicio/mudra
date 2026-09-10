/**
 * `IndexedDbProjectRepository` against `fake-indexeddb` (T043, SC-004,
 * contracts/project-schema.md, data-model.md `ActiveProjectPointer`).
 *
 * `fake-indexeddb/auto` installs a real `indexedDB` implementation onto the global scope for
 * this test file only — jsdom itself does not implement the IndexedDB API.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createProject, renameProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { ProjectNotFoundError } from '../../src/domain/ports/project-repository';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { IndexedDbProjectRepository } from '../../src/infrastructure/persistence/indexeddb-project-repository';
import { ProjectSchemaError } from '../../src/infrastructure/persistence/project-schema';

const registry = createActionRegistry();

/**
 * A fresh database name per repository instance — not a single shared/deleted-and-recreated
 * one — because IndexedDB's `deleteDatabase` blocks until every open connection to that name
 * closes, and racing it against a fresh `open()` (as a delete-then-recreate pattern would)
 * is exactly the classic deadlock this avoids entirely.
 */
let dbCounter = 0;
function uniqueDbName(): string {
  dbCounter += 1;
  return 'mudra-editor-test-' + dbCounter;
}

function emptyProject(id: string, name: string, nowMs: number = 1000): Project {
  return createProject({ version: 1, effects: [] }, id, name, nowMs);
}

function withEffect(project: Project): Project {
  return {
    ...project,
    catalog: {
      version: 1,
      effects: [
        {
          id: 'e1',
          name: 'E1',
          trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
          timeline: {
            durationMs: 400,
            entries: [{ atMs: 0, durationMs: 300, action: { type: 'screen_flash', params: {} } }],
          },
        },
      ],
    },
  };
}

describe('create / load / save', () => {
  let repo: IndexedDbProjectRepository;

  beforeEach(() => {
    repo = new IndexedDbProjectRepository(registry, uniqueDbName());
  });

  it('round-trips a project with zero data loss (SC-004)', async () => {
    const original = withEffect(emptyProject('p1', 'Project One'));
    await repo.create(original);
    const loaded = await repo.load('p1');
    expect(loaded).toEqual(original);
  });

  it('rejects loading an unknown id', async () => {
    await expect(repo.load('nope')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('save() upserts and bumps updatedAtMs', async () => {
    const original = emptyProject('p2', 'Project Two');
    await repo.create(original);
    await repo.save({ ...original, name: 'Renamed' });
    const loaded = await repo.load('p2');
    expect(loaded.name).toBe('Renamed');
    expect(loaded.updatedAtMs).toBeGreaterThanOrEqual(original.updatedAtMs);
  });

  it('list() returns summaries, newest-updated first', async () => {
    await repo.create(emptyProject('a', 'A', 1000));
    await repo.create(emptyProject('b', 'B', 2000));
    const summaries = await repo.list();
    expect(summaries.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('renameProject → save → reload preserves the new name (item 1/P3)', async () => {
    const original = emptyProject('p7', 'Original name');
    await repo.create(original);

    const renamed = renameProject(original, 'Renamed project');
    await repo.save(renamed);

    const loaded = await repo.load('p7');
    expect(loaded.name).toBe('Renamed project');
    expect(loaded.id).toBe('p7'); // identity untouched by the rename

    // The project selector (the left panel's <select>) is populated from list() — the new
    // name must be what an author sees there immediately after saving.
    const summaries = await repo.list();
    expect(summaries.find((s) => s.id === 'p7')?.name).toBe('Renamed project');
  });

  it('save() refuses a project that would fail to reload, and never writes it (P0.1 defense in depth)', async () => {
    const invalid: Project = {
      ...emptyProject('p5', 'Project Five'),
      catalog: {
        version: 1,
        effects: [
          {
            id: 'effect-1',
            name: 'Broken',
            // Out of [0, 1] — exactly the state a since-fixed UI bug used to let through.
            trigger: {
              on: 'confirmed',
              poseId: 'dragon',
              conditions: [{ type: 'confidenceAtLeast', value: 50 }],
            },
            timeline: { durationMs: 1, entries: [] },
          },
        ],
      },
    };

    await expect(repo.create(invalid)).rejects.toBeInstanceOf(ProjectSchemaError);
    await expect(repo.create(invalid)).rejects.toThrow(/would fail to reload/);
    await expect(repo.load('p5')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('the same guard applies to save(), not just create()', async () => {
    const valid = emptyProject('p6', 'Project Six');
    await repo.create(valid);
    const invalid: Project = {
      ...valid,
      catalog: {
        version: 1,
        effects: [
          {
            id: 'effect-1',
            name: 'Broken',
            trigger: { on: 'confirmed', poseId: '', conditions: [] },
            timeline: { durationMs: 1, entries: [] },
          },
        ],
      },
    };
    await expect(repo.save(invalid)).rejects.toBeInstanceOf(ProjectSchemaError);
    const stillValid = await repo.load('p6');
    expect(stillValid.catalog.effects).toHaveLength(0);
  });
});

describe('duplicate / remove', () => {
  let repo: IndexedDbProjectRepository;

  beforeEach(() => {
    repo = new IndexedDbProjectRepository(registry, uniqueDbName());
  });

  it('duplicate() creates an independent copy under a new id', async () => {
    const original = withEffect(emptyProject('p3', 'Original'));
    await repo.create(original);
    const copy = await repo.duplicate('p3');
    expect(copy.id).not.toBe('p3');
    expect(copy.catalog).toEqual(original.catalog);

    await repo.save({ ...copy, name: 'Edited copy' });
    const reloadedOriginal = await repo.load('p3');
    expect(reloadedOriginal.name).toBe('Original');
  });

  it('remove() deletes the project and clears the active pointer if it named it', async () => {
    await repo.create(emptyProject('p4', 'P4'));
    await repo.setActiveProjectId('p4');
    await repo.remove('p4');

    await expect(repo.load('p4')).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await repo.getActiveProjectId()).toBeNull();
  });
});

describe('exportBlob / importBlob', () => {
  let repo: IndexedDbProjectRepository;

  beforeEach(() => {
    repo = new IndexedDbProjectRepository(registry, uniqueDbName());
  });

  it('exports and re-imports under a new id, reproducing the content', async () => {
    const original = withEffect(emptyProject('p5', 'Exportable'));
    await repo.create(original);

    const blob = await repo.exportBlob('p5');
    const imported = await repo.importBlob(blob);

    expect(imported.id).not.toBe('p5');
    expect(imported.catalog).toEqual(original.catalog);
    expect(imported.assetLibrary).toEqual(original.assetLibrary);
  });

  it('the exported blob is valid, human-legible wire-format JSON', async () => {
    await repo.create(emptyProject('p6', 'P6'));
    const blob = await repo.exportBlob('p6');
    // jsdom's Blob lacks .text(); read via FileReader, which it does implement.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['project_schema_version']).toBe(1);
    expect(parsed['catalog']).toMatchObject({ catalog_version: 1 });
  });
});

describe('ActiveProjectPointer state transitions (data-model.md)', () => {
  let repo: IndexedDbProjectRepository;

  beforeEach(() => {
    repo = new IndexedDbProjectRepository(registry, uniqueDbName());
  });

  it('starts at null', async () => {
    expect(await repo.getActiveProjectId()).toBeNull();
  });

  it('null -> P on setActiveProjectId(P)', async () => {
    await repo.setActiveProjectId('p1');
    expect(await repo.getActiveProjectId()).toBe('p1');
  });

  it('P -> Q on setActiveProjectId(Q)', async () => {
    await repo.setActiveProjectId('p1');
    await repo.setActiveProjectId('p2');
    expect(await repo.getActiveProjectId()).toBe('p2');
  });

  it('P -> null on setActiveProjectId(null)', async () => {
    await repo.setActiveProjectId('p1');
    await repo.setActiveProjectId(null);
    expect(await repo.getActiveProjectId()).toBeNull();
  });
});
