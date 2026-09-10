/**
 * Triggering a take, and showing what is happening while it runs (FR-009, FR-011, FR-016, FR-019).
 *
 * Two things this panel is responsible for making unmistakable:
 *
 * * **A take is deliberate.** One control, pressed by the operator, is the only path to a recorded
 *   sample. The panel never arms itself.
 * * **An in-progress take looks different from merely being in Capture Mode** (FR-009): the
 *   countdown is shown as it runs, and the burst reports its progress.
 */

import type { CaptureSnapshot } from '../../application/capture-controller';
import type { RequiredHands } from '../../domain/capture/types';
import { explainRejection } from '../../domain/capture/validation';

/** What the panel needs. */
export interface TakeControlsOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Called when the operator asks for a take. */
  readonly onTake: () => void;
  /** Called when the operator abandons one in progress. */
  readonly onCancel: () => void;
}

/** The take trigger, the countdown, and the last outcome. */
export class TakeControls {
  private readonly document: Document;
  private readonly root: HTMLElement;
  private readonly takeButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly state: HTMLParagraphElement;
  private readonly outcome: HTMLParagraphElement;

  private requiredHands: RequiredHands = 2;

  /** Build and mount the controls. */
  constructor(options: TakeControlsOptions) {
    this.document = options.document;
    this.root = this.document.createElement('section');
    this.root.className = 'capture-take';

    this.takeButton = this.document.createElement('button');
    this.takeButton.type = 'button';
    this.takeButton.className = 'capture-take__trigger';
    this.takeButton.textContent = 'Capture a take';
    this.takeButton.addEventListener('click', () => options.onTake());

    this.cancelButton = this.document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.className = 'capture-take__cancel';
    this.cancelButton.textContent = 'Cancel take';
    this.cancelButton.hidden = true;
    this.cancelButton.addEventListener('click', () => options.onCancel());

    this.state = this.document.createElement('p');
    this.state.className = 'capture-take__state';
    // A live region, so a countdown and a rejection are announced rather than only drawn.
    this.state.setAttribute('role', 'status');
    this.state.setAttribute('aria-live', 'polite');

    this.outcome = this.document.createElement('p');
    this.outcome.className = 'capture-take__outcome';
    this.outcome.setAttribute('role', 'status');

    this.root.append(this.takeButton, this.cancelButton, this.state, this.outcome);
    options.mount.appendChild(this.root);
  }

  /** The element, for a shell that shows it only while a session is open. */
  get element(): HTMLElement {
    return this.root;
  }

  /** How many hands the current pose needs, for the rejection wording. */
  setRequiredHands(hands: RequiredHands): void {
    this.requiredHands = hands;
  }

  /** Enable or disable the trigger — there is no session to record into, for instance. */
  setEnabled(enabled: boolean): void {
    this.takeButton.disabled = !enabled;
  }

  /** Reflect the controller's state. Called once per frame; cheap and idempotent. */
  update(snapshot: CaptureSnapshot): void {
    this.root.dataset['takeState'] = snapshot.takeState;
    this.cancelButton.hidden = snapshot.takeState === 'idle';

    switch (snapshot.takeState) {
      case 'countdown':
        this.state.textContent = `Hold the pose — ${snapshot.countdownRemaining}…`;
        break;
      case 'recording':
        this.state.textContent = `Recording ${snapshot.burstProgress.recorded + 1} of ${snapshot.burstProgress.total} — keep still.`;
        break;
      case 'idle':
        this.state.textContent =
          snapshot.handCount === 0
            ? 'No hands in frame.'
            : `${snapshot.handCount} hand${snapshot.handCount === 1 ? '' : 's'} in frame.`;
        break;
    }

    if (snapshot.lastRejection !== null) {
      this.outcome.textContent = explainRejection(snapshot.lastRejection, this.requiredHands);
      this.outcome.dataset['tone'] = 'rejected';
    } else {
      this.outcome.textContent = '';
      delete this.outcome.dataset['tone'];
    }
  }
}
