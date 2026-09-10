/**
 * A live preview of a particle configuration (item 5).
 *
 * **It runs the shipped action.** Every frame, it builds an `ActionContext` and calls
 * `particleBurstAction.update()` — the same function the runtime calls, producing the same
 * `drawCircles` commands — and hands the result to a `PreviewSurface`, which executes them
 * through the same `Canvas2DRenderer` the stage uses. There is no second particle simulation
 * and no second renderer, so "the preview looks different from the effect" is not a state this
 * can reach.
 *
 * Two things are deliberately *not* the live experience, and the panel says so:
 *
 * - The anchor is the preview's own centre, not a hand. The preview answers "what shape,
 *   which way, how fast, in what colours" — questions about the burst itself. Where it lands
 *   is the anchor parameter's business, and is what Play and Test Trigger on the real stage
 *   are for.
 * - The clock is the preview's own loop, restarted by Replay, so a 300 ms burst can be watched
 *   repeatedly without re-triggering the effect.
 *
 * It runs no frame loop of its own: `tick()` is called from `EditorRuntimeController`'s frame
 * listener, which is the editor's single scheduler (`test/architecture/layering.test.ts`
 * forbids `requestAnimationFrame` anywhere under `presentation/editor/**`).
 */

import type { ParamValue } from '../../domain/effects/types';
import { landmarkFrame } from '../../domain/landmarks/types';
import type { ActionContext } from '../../domain/runtime/action-registry';
import { particleBurstAction } from '../../domain/runtime/actions/particle-burst';
import type { ResolvedParams } from '../../domain/runtime/action-registry';
import { PreviewSurface } from '../renderer/preview-surface';

/** Backing-store size of the preview canvas, in device pixels. */
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 150;
/** How long the preview waits, after a burst ends, before starting the next one. */
const REPLAY_GAP_MS = 350;
/** Used when the clip itself has no duration yet, so there is still something to look at. */
const FALLBACK_DURATION_MS = 800;

/** What the preview needs to exist. */
export interface ParticlePreviewOptions {
  readonly document: Document;
}

/** A looping, replayable preview of the current `particle_burst` configuration. */
export class ParticlePreview {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly surface: PreviewSurface;
  private readonly caption: HTMLElement;

  private params: ResolvedParams = {};
  private durationMs = FALLBACK_DURATION_MS;
  private startedAtMs: number | null = null;
  private looping = true;

  constructor(options: ParticlePreviewOptions) {
    this.document = options.document;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__particle-preview';

    const header = this.document.createElement('div');
    header.className = 'mudra-editor__particle-preview-header';
    const title = this.document.createElement('h3');
    title.className = 'mudra-editor__field-group-title';
    title.textContent = 'Preview';
    header.append(title);

    const replay = this.document.createElement('button');
    replay.type = 'button';
    replay.className = 'mudra-editor__particle-preview-replay';
    replay.textContent = 'Replay';
    replay.title = 'Restart the preview from the first frame.';
    replay.addEventListener('click', () => this.replay());
    header.append(replay);

    const loop = this.document.createElement('button');
    loop.type = 'button';
    loop.className = 'mudra-editor__particle-preview-loop';
    loop.textContent = 'Loop: on';
    loop.title = 'Whether the preview repeats automatically.';
    loop.addEventListener('click', () => {
      this.looping = !this.looping;
      loop.textContent = this.looping ? 'Loop: on' : 'Loop: off';
      if (this.looping) {
        this.replay();
      }
    });
    header.append(loop);
    this.root.append(header);

    this.surface = new PreviewSurface({
      document: this.document,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      className: 'mudra-editor__particle-preview-canvas',
    });
    this.root.append(this.surface.canvas);

    this.caption = this.document.createElement('p');
    this.caption.className = 'mudra-editor__particle-preview-caption';
    this.caption.textContent =
      'Emitted from the centre of this box. On the stage it emits from the clip’s anchor.';
    this.root.append(this.caption);
  }

  /** Adopt a new configuration. Restarts the preview so the change is immediately visible. */
  update(params: Readonly<Record<string, ParamValue>>, durationMs: number): void {
    this.params = params as ResolvedParams;
    this.durationMs = durationMs > 0 ? durationMs : FALLBACK_DURATION_MS;
    this.replay();
  }

  /** Restart from the first frame. */
  replay(): void {
    this.startedAtMs = null;
  }

  /**
   * Draw the frame at `nowMs`.
   *
   * Called from the controller's frame listener; safe to call at any rate, since everything
   * below is a function of elapsed time rather than of frame count (FR-049).
   */
  tick(nowMs: number): void {
    if (this.startedAtMs === null) {
      this.startedAtMs = nowMs;
    }
    const cycleMs = this.durationMs + REPLAY_GAP_MS;
    let elapsedMs = nowMs - this.startedAtMs;
    if (elapsedMs > this.durationMs) {
      if (!this.looping) {
        elapsedMs = this.durationMs;
      } else {
        elapsedMs = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
      }
    }
    if (elapsedMs > this.durationMs) {
      this.surface.render([]);
      return;
    }
    this.surface.render(this.commandsAt(elapsedMs));
  }

  /** Release nothing of its own — kept so callers can treat every preview identically. */
  destroy(): void {
    this.startedAtMs = null;
  }

  /** The shipped action's own output for this configuration at `elapsedMs`. */
  private commandsAt(elapsedMs: number): ReturnType<typeof particleBurstAction.update>['commands'] {
    const width = this.surface.width;
    const height = this.surface.height;
    const context: ActionContext = {
      effectId: '(preview)',
      params: this.params,
      elapsedMs,
      progress: this.durationMs <= 0 ? 1 : Math.min(1, elapsedMs / this.durationMs),
      durationMs: this.durationMs,
      justFired: elapsedMs === 0,
      frame: landmarkFrame([], elapsedMs, width, height),
      segmentation: null,
      width,
      height,
      // The preview's own centre, deliberately — see this file's header.
      anchor: { x: width / 2, y: height / 2 },
      resolveAsset: () => null,
      state: {},
    };
    return particleBurstAction.update(context).commands;
  }
}
