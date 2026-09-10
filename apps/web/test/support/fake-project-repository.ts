/**
 * An in-memory `ProjectRepository`, for domain-level tests (no browser, no real IndexedDB).
 *
 * Round-trips through the same `parseProject`/`serializeProject` a real, IndexedDB-backed
 * repository would use for `exportBlob`/`importBlob`, so a test exercising those two methods
 * exercises the real wire-format boundary, not a shortcut around it.
 */

import { ProjectNotFoundError } from '../../src/domain/ports/project-repository';
import type { ProjectRepository } from '../../src/domain/ports/project-repository';
import type { Project, ProjectSummary } from '../../src/domain/editor/types';
import type { ActionRegistry } from '../../src/domain/runtime/action-registry';
import {
  parseProject,
  serializeProject,
} from '../../src/infrastructure/persistence/project-schema';

/** An in-memory project store, for tests only. */
export class FakeProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();
  private activeProjectId: string | null = null;

  /** @param registry Used only by `importBlob`, to validate the imported catalog. */
  constructor(private readonly registry: ActionRegistry) {}

  create(project: Project): Promise<void> {
    if (this.projects.has(project.id)) {
      return Promise.reject(new Error('A project with id "' + project.id + '" already exists.'));
    }
    this.projects.set(project.id, project);
    return Promise.resolve();
  }

  save(project: Project): Promise<void> {
    this.projects.set(project.id, project);
    return Promise.resolve();
  }

  load(id: string): Promise<Project> {
    const project = this.projects.get(id);
    if (project === undefined) {
      return Promise.reject(new ProjectNotFoundError(id));
    }
    return Promise.resolve(project);
  }

  list(): Promise<readonly ProjectSummary[]> {
    const summaries = [...this.projects.values()]
      .map((project): ProjectSummary => ({
        id: project.id,
        name: project.name,
        updatedAtMs: project.updatedAtMs,
      }))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return Promise.resolve(summaries);
  }

  duplicate(id: string): Promise<Project> {
    const source = this.projects.get(id);
    if (source === undefined) {
      return Promise.reject(new ProjectNotFoundError(id));
    }
    const copy: Project = {
      ...source,
      id: id + '-copy-' + this.projects.size,
      name: source.name + ' copy',
    };
    this.projects.set(copy.id, copy);
    return Promise.resolve(copy);
  }

  remove(id: string): Promise<void> {
    this.projects.delete(id);
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
    }
    return Promise.resolve();
  }

  async exportBlob(id: string): Promise<Blob> {
    const project = await this.load(id);
    const json = JSON.stringify(serializeProject(project));
    return new Blob([json], { type: 'application/json' });
  }

  async importBlob(blob: Blob): Promise<Project> {
    const text = await blob.text();
    const document: unknown = JSON.parse(text);
    const parsed = parseProject(document, this.registry);
    const imported: Project = { ...parsed, id: parsed.id + '-imported-' + this.projects.size };
    this.projects.set(imported.id, imported);
    return imported;
  }

  getActiveProjectId(): Promise<string | null> {
    return Promise.resolve(this.activeProjectId);
  }

  setActiveProjectId(id: string | null): Promise<void> {
    this.activeProjectId = id;
    return Promise.resolve();
  }
}
