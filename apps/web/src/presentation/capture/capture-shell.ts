/**
 * The Capture Mode surface (FR-008 – FR-010, FR-020).
 *
 * It owns three things the specification is explicit about:
 *
 * * A **persistent, unambiguous indicator** that Capture Mode is on and landmark samples are being
 *   collected — visible for as long as the mode is active, not only while a take runs (FR-008).
 * * A **visibly distinct in-take state** (FR-009), driven from the controller's snapshot.
 * * The **accepted-sample count, visible at all times** while Capture Mode is active (FR-020).
 *
 * Leaving is explicit and stops the camera (FR-010). Like every other view in this application, the
 * shell reads state and dispatches intent — it holds no business logic and it never draws.
 */

import type { CaptureSnapshot } from '../../application/capture-controller';
import { CameraError } from '../../domain/ports/camera';
import { DetectorError } from '../../domain/ports/detector';
import { CaptureStorageUnavailableError } from '../../domain/ports/capture-repository';

/** What the shell shows right now. */
export type CaptureShellState = 'consent' | 'starting' | 'ready' | 'error';

/** What the shell needs. */
export interface CaptureShellOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Called when the operator leaves Capture Mode. */
  readonly onExit: () => void;
}

/**
 * Plain language for every failure an operator can hit (FR-071).
 *
 * The mapping lives here because the shell is what talks to a person; each adapter contributes the
 * distinction, and none of them contributes an API name.
 */
export function explainFailure(error: unknown): string {
  if (error instanceof CaptureStorageUnavailableError) {
    return 'This browser will not give Capture Mode any local storage, so samples could not be saved. Private windows and blocked site data are the usual causes — try a normal window.';
  }
  if (error instanceof CameraError) {
    switch (error.reason) {
      case 'noCamera':
        return 'No camera was found on this machine.';
      case 'permissionDenied':
        return 'Camera access was refused. Allow it in your browser’s site settings, then reload.';
      case 'permissionDismissed':
        return 'The camera prompt was dismissed. Reload and choose “Allow” to continue.';
      case 'deviceInUse':
        return 'Another application is holding the camera. Close it and try again.';
      case 'unsupported':
        return 'This browser cannot open a camera here. A secure (https) context is required.';
      default:
        return 'The camera could not be opened.';
    }
  }
  if (error instanceof DetectorError) {
    switch (error.reason) {
      case 'modelUnavailable':
        return 'The hand-detection model could not be loaded, so nothing can be captured.';
      case 'unsupportedBrowser':
        return 'This browser cannot run hand detection.';
      default:
        return 'Hand detection could not start.';
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** The capture surface. */
export class CaptureShell {
  private readonly document: Document;
  private readonly options: CaptureShellOptions;
  private readonly root: HTMLElement;

  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly message: HTMLParagraphElement;
  private readonly exitButton: HTMLButtonElement;

  /** Where the setup, take, review and export panels mount. */
  readonly panels: HTMLElement;

  private state: CaptureShellState = 'consent';

  /** Build and mount the surface. */
  constructor(options: CaptureShellOptions) {
    this.options = options;
    this.document = options.document;

    this.root = this.document.createElement('div');
    this.root.className = 'capture-shell';
    this.root.dataset['state'] = this.state;

    // The persistent indicator. It is in the document from the moment Capture Mode is active and
    // does not depend on a take running (FR-008).
    this.banner = this.document.createElement('div');
    this.banner.className = 'capture-banner';
    this.banner.setAttribute('role', 'status');
    this.banner.hidden = true;

    const dot = this.document.createElement('span');
    dot.className = 'capture-banner__dot';
    dot.setAttribute('aria-hidden', 'true');

    this.bannerText = this.document.createElement('span');
    this.bannerText.className = 'capture-banner__text';
    this.bannerText.textContent = 'Capture Mode is on — hand landmark samples are being collected.';

    this.counter = this.document.createElement('span');
    this.counter.className = 'capture-banner__count';
    this.counter.textContent = '0 samples';

    this.exitButton = this.document.createElement('button');
    this.exitButton.type = 'button';
    this.exitButton.className = 'capture-banner__exit';
    this.exitButton.textContent = 'Leave Capture Mode';
    this.exitButton.addEventListener('click', () => this.options.onExit());

    this.banner.append(dot, this.bannerText, this.counter, this.exitButton);

    const stage = this.document.createElement('div');
    stage.className = 'capture-stage';
    this.canvas = this.document.createElement('canvas');
    this.canvas.className = 'capture-stage__canvas';
    stage.appendChild(this.canvas);

    this.message = this.document.createElement('p');
    this.message.className = 'capture-shell__message';
    this.message.setAttribute('role', 'alert');
    this.message.hidden = true;

    this.panels = this.document.createElement('div');
    this.panels.className = 'capture-panels';

    this.root.append(this.banner, this.message, stage, this.panels);
    options.mount.appendChild(this.root);
  }

  /** The canvas the `Stage` composites onto. The shell itself never draws. */
  get stageCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Move to a new state, showing the indicator once Capture Mode is genuinely live. */
  setState(state: CaptureShellState): void {
    this.state = state;
    this.root.dataset['state'] = state;
    this.banner.hidden = state !== 'ready';
    if (state !== 'error') {
      this.message.hidden = true;
      this.message.textContent = '';
    }
  }

  /** The current state, for a test or a caller deciding what to do next. */
  get currentState(): CaptureShellState {
    return this.state;
  }

  /** Report a failure in plain language, and stop pretending to be ready. */
  showFailure(error: unknown): void {
    this.setState('error');
    this.message.hidden = false;
    this.message.textContent = explainFailure(error);
  }

  /** Report something that is not a failure — a session cleared, for instance. */
  showNotice(text: string): void {
    this.message.hidden = text.length === 0;
    this.message.textContent = text;
  }

  /** Reflect one frame of controller state. */
  update(snapshot: CaptureSnapshot): void {
    this.root.dataset['takeState'] = snapshot.takeState;
    this.counter.textContent = `${snapshot.sampleCount} sample${snapshot.sampleCount === 1 ? '' : 's'}`;
    this.bannerText.textContent =
      snapshot.takeState === 'idle'
        ? 'Capture Mode is on — hand landmark samples are being collected.'
        : 'Recording a take — hold the pose.';
  }
}
