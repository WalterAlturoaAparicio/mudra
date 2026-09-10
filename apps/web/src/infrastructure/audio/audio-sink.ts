/**
 * Consumes {@link AudioCue}s. The one place `play()` is called (FR-054a, research D6).
 *
 * Two browser realities shape this:
 *
 * **Autoplay is blocked until a gesture.** The camera-grant click is that gesture, so the
 * sink is unlocked there. A cue arriving before then is *reported*, not swallowed —
 * "silent effects" with no explanation is a bad half-hour for whoever debugs it.
 *
 * **A cue can arrive while the same sound is still playing.** Each asset keeps a small
 * pool of elements so a rapid re-trigger overlaps rather than cutting itself off.
 */

import type { AudioSink } from '../../application/session';

/** Why a cue did not produce a sound. */
export type AudioSkipReason = 'locked' | 'unresolved' | 'blocked';

/** One cue that did not play. */
export interface AudioSkip {
  readonly asset: string;
  readonly reason: AudioSkipReason;
}

/**
 * The one member this file actually calls — narrowed structurally rather than naming the
 * concrete `ManifestAssetResolver` class, so a caller whose resolver instance changes over
 * time (the editor rebuilds one on every asset-library edit, `editor-main.ts`) can hand this
 * sink a small object that always delegates to the *current* one, without this class needing
 * its own `setResolver`-style indirection. `ManifestAssetResolver` itself already satisfies
 * this structurally — every existing call site is unchanged.
 */
export interface AssetResolverLike {
  resolve(reference: string): string | null;
}

/** How many simultaneous copies of one sound may overlap. */
const POOL_SIZE = 3;

/** Plays audio cues through pooled `HTMLAudioElement`s. */
export class HtmlAudioSink implements AudioSink {
  private readonly resolver: AssetResolverLike;
  private readonly document: Document;
  private readonly pools = new Map<string, HTMLAudioElement[]>();
  private readonly skips: AudioSkip[] = [];
  private unlocked = false;

  /** @param resolver Turns `@audio/…` into a URL. */
  constructor(resolver: AssetResolverLike, doc: Document = document) {
    this.resolver = resolver;
    this.document = doc;
  }

  /**
   * Mark audio playable.
   *
   * Called from the camera-grant handler, which is a genuine user gesture — the only thing
   * a browser accepts as consent to make noise.
   */
  unlock(): void {
    this.unlocked = true;
  }

  /** Play a cue, or record why it could not be played. */
  play(asset: string, volume: number): void {
    const url = this.resolver.resolve(asset);
    if (url === null) {
      this.skip(asset, 'unresolved');
      return;
    }
    if (!this.unlocked) {
      this.skip(asset, 'locked');
      return;
    }

    const element = this.take(url);
    element.volume = clamp01(volume);
    element.currentTime = 0;
    void element.play().catch(() => {
      this.skip(asset, 'blocked');
    });
  }

  /** Cues that produced no sound, for the diagnostics panel. */
  get skipped(): readonly AudioSkip[] {
    return this.skips;
  }

  private take(url: string): HTMLAudioElement {
    let pool = this.pools.get(url);
    if (pool === undefined) {
      pool = [];
      this.pools.set(url, pool);
    }
    const free = pool.find((element) => element.paused || element.ended);
    if (free !== undefined) {
      return free;
    }
    if (pool.length < POOL_SIZE) {
      const element = this.document.createElement('audio');
      element.src = url;
      element.preload = 'auto';
      pool.push(element);
      return element;
    }
    // Pool exhausted: steal the oldest. Better a clipped tail than a dropped cue.
    return pool[0]!;
  }

  private skip(asset: string, reason: AudioSkipReason): void {
    if (!this.skips.some((entry) => entry.asset === asset && entry.reason === reason)) {
      this.skips.push({ asset, reason });
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
