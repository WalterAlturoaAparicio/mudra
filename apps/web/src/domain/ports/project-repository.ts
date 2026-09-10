/**
 * Local project persistence, behind a port (data-model.md `ProjectRepository`).
 *
 * Mirrors the existing `CameraSource`/`HandDetector` port shape: an interface here, a
 * concrete IndexedDB-backed implementation in `infrastructure/persistence/`, and an
 * in-memory fake for domain-level tests (`test/support/fake-project-repository.ts`) — so
 * every rule about *what* a project is stays testable with no browser and no real
 * IndexedDB (constitution's Web-applications standards, "every platform capability MUST
 * sit behind an application-defined interface").
 */

import type { Project, ProjectSummary } from '../editor/types';

/** Raised when a project id names nothing in the repository. */
export class ProjectNotFoundError extends Error {
  /** The message names the missing id. */
  constructor(id: string) {
    super('No project with id "' + id + '".');
    this.name = 'ProjectNotFoundError';
  }
}

/** Local-only project persistence (FR-028, FR-029). */
export interface ProjectRepository {
  /** Store a brand-new project. Rejects a duplicate `id`. */
  create(project: Project): Promise<void>;
  /** Upsert an existing project by `id`. */
  save(project: Project): Promise<void>;
  /** @throws {ProjectNotFoundError} when `id` names nothing stored. */
  load(id: string): Promise<Project>;
  /** Every stored project, newest-updated first, for a project picker. */
  list(): Promise<readonly ProjectSummary[]>;
  /** Copy a project under a new id. @throws {ProjectNotFoundError} */
  duplicate(id: string): Promise<Project>;
  /** Remove a project. Also clears the active pointer if it named this project. */
  remove(id: string): Promise<void>;
  /** A portable, importable artifact of one project. @throws {ProjectNotFoundError} */
  exportBlob(id: string): Promise<Blob>;
  /** Parse and store an exported project under a **new** id. */
  importBlob(blob: Blob): Promise<Project>;
  /** Which project the default, zero-chrome experience should run, if any (FR-033a–c). */
  getActiveProjectId(): Promise<string | null>;
  /** Mark a project active, or pass `null` to clear the designation. */
  setActiveProjectId(id: string | null): Promise<void>;
}
