/**
 * The entry experience: a call to action, the live view, and plain-language errors.
 *
 * **The default screen shows no landmarks, no numbers, and no technical vocabulary**
 * (FR-087, SC-012). Everything the developer wants to see lives behind debug mode. What is
 * left is a canvas, a ring that fills while a pose is held, and a collapsed list of poses
 * for anyone who asks.
 *
 * Errors are the same discipline: a person is told what happened and what to do, never
 * which API rejected. The mapping from failure reason to sentence lives with each adapter,
 * because the adapter is what knows the difference.
 */

import type { SessionSnapshot } from '../../application/session';
import { CameraError } from '../../domain/ports/camera';
import { DetectorError } from '../../domain/ports/detector';
import { HoldIndicator } from './hold-indicator';
import { PoseHints } from './pose-hints';
import type { PoseHint } from './pose-hints';

/** What the shell shows right now. */
export type ShellState = 'idle' | 'starting' | 'running' | 'error';

/** What the shell needs to exist. */
export interface ShellOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Called when the visitor asks to begin — the explicit user action FR-001 requires. */
  readonly onStart: () => Promise<void>;
  /** Called when the visitor asks to stop, and on page unload. */
  readonly onStop: () => void;
}

/** The visitor-facing screen. */
export class Shell {
  private readonly document: Document;
  private readonly mount: HTMLElement;
  private readonly options: ShellOptions;

  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly message: HTMLParagraphElement;
  private readonly startButton: HTMLButtonElement;
  private readonly hold: HoldIndicator;
  private readonly hints: PoseHints;
  private readonly debugSlot: HTMLElement;

  private state: ShellState = 'idle';

  /** Build the screen and mount it. Nothing starts until the visitor asks. */
  constructor(options: ShellOptions) {
    this.options = options;
    this.document = options.document;
    this.mount = options.mount;

    const root = this.document.createElement('div');
    root.className = 'mudra';

    this.canvas = this.document.createElement('canvas');
    this.canvas.className = 'mudra__stage';
    root.append(this.canvas);

    this.overlay = this.document.createElement('div');
    this.overlay.className = 'mudra__overlay';

    const title = this.document.createElement('h1');
    title.className = 'mudra__title';
    title.textContent = 'Mudra';

    this.message = this.document.createElement('p');
    this.message.className = 'mudra__message';
    this.message.textContent = 'Make a hand sign and hold it.';

    this.startButton = this.document.createElement('button');
    this.startButton.className = 'mudra__start';
    this.startButton.type = 'button';
    this.startButton.textContent = 'Turn on camera';
    this.startButton.addEventListener('click', () => {
      void this.begin();
    });

    this.hints = new PoseHints(this.document);
    this.overlay.append(title, this.message, this.startButton, this.hints.root);
    root.append(this.overlay);

    this.hold = new HoldIndicator(this.document);
    root.append(this.hold.root);

    this.debugSlot = this.document.createElement('div');
    this.debugSlot.className = 'mudra__debug';
    root.append(this.debugSlot);

    this.mount.replaceChildren(root);
    this.setState('idle');
  }

  /** The canvas the stage draws into. */
  get stageCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Where the debug panels mount, empty until debug mode is on. */
  get debugContainer(): HTMLElement {
    return this.debugSlot;
  }

  /** List the poses this session responds to (FR-089). */
  setPoses(poses: readonly PoseHint[]): void {
    this.hints.setPoses(poses);
  }

  /** Update per-frame chrome. The only thing the default screen reflects is progress. */
  update(snapshot: SessionSnapshot): void {
    this.hold.update(snapshot.holdProgress);
  }

  /** Show a failure in plain language (FR-003, FR-017). */
  showError(error: unknown): void {
    this.setState('error');
    this.message.textContent = plainLanguage(error);
    this.startButton.textContent = 'Try again';
    this.startButton.disabled = false;
  }

  private async begin(): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') {
      return;
    }
    this.setState('starting');
    this.startButton.disabled = true;
    this.message.textContent = 'Starting the camera…';
    try {
      await this.options.onStart();
      this.setState('running');
      this.message.textContent = 'Make a hand sign and hold it.';
    } catch (error) {
      this.showError(error);
    }
  }

  private setState(state: ShellState): void {
    this.state = state;
    this.mount.firstElementChild?.setAttribute('data-state', state);
    this.startButton.hidden = state === 'running';
    // Once the camera is live the copy gets out of the way: the experience is the picture,
    // not the caption around it.
    this.overlay.classList.toggle('is-minimal', state === 'running');
  }

  /** Stop the session — used by the page-unload handler. */
  shutdown(): void {
    this.options.onStop();
    this.setState('idle');
  }
}

/**
 * Turn any failure into a sentence a visitor can act on.
 *
 * Adapters already classify their own failures, so this reads the classification rather
 * than parsing a message — which is why `CameraError` and `DetectorError` carry a `reason`
 * at all.
 */
export function plainLanguage(error: unknown): string {
  if (error instanceof CameraError) {
    return error.message;
  }
  if (error instanceof DetectorError) {
    switch (error.reason) {
      case 'modelUnavailable':
        return 'Hand detection could not load. Check your connection and try again.';
      case 'unsupportedBrowser':
        return 'This browser cannot run hand detection. Try a current Chrome, Firefox, or Safari.';
      default:
        return 'Hand detection could not start.';
    }
  }
  return 'Something went wrong starting the experience. Try again.';
}
