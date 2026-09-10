/**
 * Local storage for a project's own asset files (FR-034–FR-037, research D2).
 *
 * A separate, narrow port from `ProjectRepository`: a project's JSON document never embeds
 * binary content directly (contracts/project-schema.md keeps the wire format text-only), so
 * asset bytes live behind their own small store, addressed by the `storageKey` an
 * `AssetLibraryEntry` carries.
 */

/** Local-only binary storage for project assets. */
export interface AssetBlobStore {
  /** Store a file's bytes under a generated key. */
  put(key: string, blob: Blob): Promise<void>;
  /** @returns The stored blob, or `null` if `key` names nothing. */
  get(key: string): Promise<Blob | null>;
  /** Remove a stored blob. Removing an unknown key is a no-op. */
  remove(key: string): Promise<void>;
}
