/**
 * Resolves which catalog the default, zero-chrome experience runs (FR-033a–c, research D10;
 * constitution v1.7.0).
 *
 * Extracted from `main.ts` (which has import-time bootstrap side effects and so cannot be
 * unit-tested directly) precisely so this decision — active project present / absent /
 * broken — is testable on its own (T044).
 *
 * Read **once**, at boot: an edit made in a concurrently open editor tab must not hot-swap
 * the catalog a running default-experience tab is presenting mid-session. A project marked
 * active is preferred; its absence, or any failure to load or validate it (deleted,
 * corrupted, an incompatible schema version), falls back to the shipped default catalog and
 * **clears** the active pointer, so the failure is not repeated silently on the next load
 * (FR-033c).
 */

import type { EffectCatalog } from '../domain/effects/types';
import type { ProjectRepository } from '../domain/ports/project-repository';

/** What resolution needs: a repository, and a way to load the shipped default catalog. */
export interface ResolveDefaultCatalogOptions {
  readonly repository: ProjectRepository;
  readonly loadShippedDefault: () => Promise<EffectCatalog>;
}

export async function resolveDefaultCatalog(
  options: ResolveDefaultCatalogOptions,
): Promise<EffectCatalog> {
  const { repository, loadShippedDefault } = options;
  const activeId = await repository.getActiveProjectId().catch(() => null);
  if (activeId !== null) {
    try {
      const project = await repository.load(activeId);
      return project.catalog;
    } catch {
      await repository.setActiveProjectId(null).catch(() => undefined);
    }
  }
  return loadShippedDefault();
}
