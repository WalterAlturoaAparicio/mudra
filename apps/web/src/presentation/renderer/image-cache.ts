/**
 * Lazily decodes the images `drawMaskedImage` names, and hands the renderer whatever is ready
 * (items 2 and 3).
 *
 * The renderer must stay synchronous — it is called once per frame with a command list and
 * draws it — but decoding an image is not. This cache is the seam: a command carrying a URL
 * the cache has not seen starts a load and draws nothing that frame; once decoded, every
 * later frame draws it. That is exactly the "not ready yet" behaviour `drawCamera` already
 * has before the camera's first frame, so it needs no new concept in the vocabulary.
 *
 * URLs arriving here are already **resolved** — the action resolved its logical `@image/…`
 * reference through the asset manifest (FR-062). This file never learns what a logical
 * reference is, and never fetches anything a command did not name.
 */

import type { ImageProvider } from './canvas2d-renderer';

/** What the cache needs to build an image element. Injected so a test needs no DOM loader. */
export interface ImageCacheOptions {
  readonly document: Document;
  /** Called once per URL that fails to load, so the failure is observable rather than silent. */
  readonly onError?: (source: string) => void;
}

interface CacheEntry {
  readonly element: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

/** Decoded images, by resolved URL. */
export class ImageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly options: ImageCacheOptions;

  constructor(options: ImageCacheOptions) {
    this.options = options;
  }

  /**
   * The image for `source`, or `null` while it is still loading (or has failed).
   *
   * Requesting an unseen URL starts its load as a side effect — the cache is demand-driven by
   * the command list, so an image an author configured but never plays is never fetched.
   */
  get(source: string): CanvasImageSource | null {
    if (source === '') {
      return null;
    }
    const existing = this.entries.get(source);
    if (existing !== undefined) {
      return existing.loaded ? existing.element : null;
    }
    const element = this.options.document.createElement('img');
    const entry: CacheEntry = { element, loaded: false, failed: false };
    this.entries.set(source, entry);
    element.addEventListener('load', () => {
      entry.loaded = true;
    });
    element.addEventListener('error', () => {
      entry.failed = true;
      this.options.onError?.(source);
    });
    // Object URLs (a project's own asset library) and same-origin paths (the shipped
    // manifest) are all this ever sees; nothing cross-origin is fetched.
    element.src = source;
    return null;
  }

  /** Every URL that failed to load, for the diagnostics panel. */
  get failedSources(): readonly string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.failed)
      .map(([source]) => source)
      .sort();
  }

  /** Forget everything — e.g. when a project's asset object URLs are replaced. */
  clear(): void {
    this.entries.clear();
  }

  /** The cache as the renderer's `ImageProvider`. */
  get provider(): ImageProvider {
    return (source) => this.get(source);
  }
}
