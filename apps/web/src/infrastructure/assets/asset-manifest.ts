/**
 * Logical asset references, resolved through an indirection (FR-062–FR-064).
 *
 * An effect says `@audio/flash`, never `/assets/audio/flash-v3-final.mp3`. Physical
 * locations can then change — a file renamed, a format swapped — without any effect
 * definition changing, which is the whole point of the indirection.
 *
 * An unresolvable reference is **reported and survived** (FR-064): the effect carries on
 * without that action. A missing sound should not take a visual effect down with it.
 */

/** Maps logical identifiers to physical URLs. */
export interface AssetManifest {
  readonly audio: Readonly<Record<string, string>>;
  readonly images: Readonly<Record<string, string>>;
}

/** The prefix an audio reference must carry. */
export const AUDIO_PREFIX = '@audio/';

/** The prefix an image reference must carry. */
export const IMAGE_PREFIX = '@image/';

/**
 * The assets this milestone ships.
 *
 * Mudra-owned or project-licensed only — no third-party protected material (FR-065).
 * Paths are relative to the served root, so they work identically in dev and in build.
 */
export const DEFAULT_ASSET_MANIFEST: AssetManifest = {
  audio: {
    flash: '/assets/audio/flash.wav',
    burst: '/assets/audio/burst.wav',
    wash: '/assets/audio/wash.wav',
  },
  images: {},
};

/** Resolves logical references against a manifest. */
export class ManifestAssetResolver {
  private readonly manifest: AssetManifest;
  private readonly unresolved = new Set<string>();

  /** @param manifest Defaults to the shipped manifest. */
  constructor(manifest: AssetManifest = DEFAULT_ASSET_MANIFEST) {
    this.manifest = manifest;
  }

  /**
   * Resolve a reference to a URL, or `null` when it does not resolve.
   *
   * Each unresolvable reference is remembered once, so the debug panel can list what is
   * missing without a per-frame flood.
   */
  resolve(reference: string): string | null {
    if (reference.startsWith(AUDIO_PREFIX)) {
      const key = reference.slice(AUDIO_PREFIX.length);
      return this.remember(reference, this.manifest.audio[key]);
    }
    if (reference.startsWith(IMAGE_PREFIX)) {
      const key = reference.slice(IMAGE_PREFIX.length);
      return this.remember(reference, this.manifest.images[key]);
    }
    this.unresolved.add(reference);
    return null;
  }

  /** Every reference that failed to resolve, for the diagnostics panel. */
  get unresolvedReferences(): readonly string[] {
    return [...this.unresolved].sort();
  }

  private remember(reference: string, url: string | undefined): string | null {
    if (url === undefined) {
      this.unresolved.add(reference);
      return null;
    }
    return url;
  }
}
