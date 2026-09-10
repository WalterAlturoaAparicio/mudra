/**
 * Builds a project-scoped `AssetManifest` from `Project.assetLibrary` (T046, FR-034–FR-038).
 *
 * Deliberately **infrastructure**, not domain: it constructs `Object URL`s from stored blobs,
 * a browser-specific concern the framework-free domain must never learn about — the same
 * layering reason `project-schema.ts` moved out of `domain/editor/` (I1 remediation
 * precedent). The resulting `AssetManifest` is handed to the existing `ManifestAssetResolver`
 * unmodified; there is no second resolution mechanism.
 */

import type { Project, AssetLibrary } from '../../domain/editor/types';
import type { AssetBlobStore } from '../../domain/ports/asset-blob-store';
import type { ActionRegistry } from '../../domain/runtime/action-registry';
import { AUDIO_PREFIX, DEFAULT_ASSET_MANIFEST, IMAGE_PREFIX } from '../assets/asset-manifest';
import type { AssetManifest } from '../assets/asset-manifest';
import { ManifestAssetResolver } from '../assets/asset-manifest';

/**
 * Build the manifest a project's assets resolve through, layered **over** the shipped
 * default manifest — a project's own entries take precedence for a shared logical name, and
 * every shipped default remains reachable for an effect that references one directly.
 *
 * Object URLs created here live for the page's lifetime; nothing revokes them mid-session,
 * matching how long an `EffectRuntime`'s resolver is expected to remain valid for.
 */
export async function buildProjectAssetManifest(
  library: AssetLibrary,
  blobStore: AssetBlobStore,
): Promise<AssetManifest> {
  const audio: Record<string, string> = { ...DEFAULT_ASSET_MANIFEST.audio };
  const images: Record<string, string> = { ...DEFAULT_ASSET_MANIFEST.images };

  for (const entry of library.entries) {
    const blob = await blobStore.get(entry.storageKey);
    if (blob === null) {
      continue; // reported separately as a broken reference (FR-038) — never thrown here
    }
    const url = URL.createObjectURL(blob);
    if (entry.kind === 'audio') {
      audio[entry.reference.slice(AUDIO_PREFIX.length)] = url;
    } else {
      images[entry.reference.slice(IMAGE_PREFIX.length)] = url;
    }
  }

  return { audio, images };
}

/**
 * Which of a project's own asset-library entries do not currently resolve to a stored blob
 * (FR-038) — surfaced by name, before the effect ever plays.
 */
export async function findBrokenAssetReferences(
  library: AssetLibrary,
  blobStore: AssetBlobStore,
): Promise<readonly string[]> {
  const broken: string[] = [];
  for (const entry of library.entries) {
    const blob = await blobStore.get(entry.storageKey);
    if (blob === null) {
      broken.push(entry.reference);
    }
  }
  return broken;
}

/**
 * Which asset references an **effect's own actions** name that do not resolve against the
 * given manifest — the static, at-inspection-time counterpart to the runtime's own
 * `asset_unresolved` diagnostic (`play-audio.ts`), reusing the identical resolver so the two
 * can never disagree about what "resolves" means (FR-038).
 */
export function findBrokenEffectAssetReferences(
  project: Project,
  registry: ActionRegistry,
  manifest: AssetManifest,
): readonly string[] {
  const resolver = new ManifestAssetResolver(manifest);
  const broken = new Set<string>();
  for (const effect of project.catalog.effects) {
    for (const entry of effect.timeline.entries) {
      const descriptor = registry.get(entry.action.type);
      if (descriptor === undefined) {
        continue;
      }
      for (const spec of descriptor.params) {
        if (spec.kind !== 'asset') {
          continue;
        }
        const value = entry.action.params[spec.name];
        const reference = typeof value === 'string' ? value : String(spec.defaultValue);
        if (resolver.resolve(reference) === null) {
          broken.add(reference);
        }
      }
    }
  }
  return [...broken].sort();
}

/**
 * Which effects (by name) currently name `reference` in one of their actions' `asset`-kind
 * params (item 13, P1.3) — the inverse question `findBrokenEffectAssetReferences` above asks:
 * not "what fails to resolve," but "what would break if this specific asset were removed."
 * Walks the exact same effect/action/param structure, so the two can never disagree about
 * what "references an asset" means.
 */
export function referencedBy(
  project: Project,
  registry: ActionRegistry,
  reference: string,
): readonly string[] {
  const names = new Set<string>();
  for (const effect of project.catalog.effects) {
    for (const entry of effect.timeline.entries) {
      const descriptor = registry.get(entry.action.type);
      if (descriptor === undefined) {
        continue;
      }
      for (const spec of descriptor.params) {
        if (spec.kind !== 'asset') {
          continue;
        }
        const value = entry.action.params[spec.name];
        const used = typeof value === 'string' ? value : String(spec.defaultValue);
        if (used === reference) {
          names.add(effect.name);
        }
      }
    }
  }
  return [...names].sort();
}
