/**
 * The capture consent step (FR-006, FR-006a, FR-007).
 *
 * Granting camera access is consent to run an effect. It is **not** consent to contribute data, so
 * Capture Mode asks its own question, separately and first — before any camera prompt appears.
 *
 * Consent is held in memory for the lifetime of the page and is **never persisted** (FR-006a). After
 * a reload the operator is asked again. That costs one click and keeps the opt-in a decision made
 * now rather than a box ticked weeks ago; it also means the capture store holds sessions and samples
 * and nothing else.
 */

/** What the consent gate needs. */
export interface ConsentGateOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Called once, when the operator accepts. */
  readonly onAccept: () => void;
}

/**
 * The exact sentences FR-007 requires the operator to be shown.
 *
 * Exported so `test/adapters/capture-shell.test.ts` asserts the disclosure by content rather than by
 * counting paragraphs — if a future edit drops the "nothing is transmitted" line, a test fails.
 */
export const CONSENT_POINTS: readonly string[] = [
  'What is recorded: the coordinates of your hand landmarks — 21 points per hand — plus the pose you selected, your contributor label, and the time of each take.',
  'What is never recorded: camera images, video, screenshots, or anything derived from them. No picture of you is written anywhere, at any point.',
  'Where it is kept: in this browser only. Nothing is uploaded, synced, or transmitted, and there is no server or account involved.',
  'What travels with an export: your contributor label is written into each sample, so a batch can be reviewed or withdrawn later.',
  'You stay in control: you can review every sample, delete any of them, clear the whole session, and export whenever you choose.',
];

/** The separate, unmistakable opt-in Capture Mode requires before anything starts. */
export class ConsentGate {
  private readonly document: Document;
  private readonly root: HTMLElement;
  private readonly options: ConsentGateOptions;
  private accepted = false;

  /** Build and mount the gate. */
  constructor(options: ConsentGateOptions) {
    this.options = options;
    this.document = options.document;
    this.root = this.document.createElement('section');
    this.root.className = 'capture-consent';
    this.root.setAttribute('aria-labelledby', 'capture-consent-title');
    this.render();
    options.mount.appendChild(this.root);
  }

  /** Whether the operator has accepted, in this page's lifetime. */
  get hasConsent(): boolean {
    return this.accepted;
  }

  /** Hide the gate once consent is given. */
  private dismiss(): void {
    this.accepted = true;
    this.root.hidden = true;
  }

  private render(): void {
    const title = this.document.createElement('h1');
    title.id = 'capture-consent-title';
    title.textContent = 'Contribute hand-landmark samples';

    const lead = this.document.createElement('p');
    lead.className = 'capture-consent__lead';
    lead.textContent =
      'This is a separate step from turning on the camera. Please read what is collected before you begin.';

    const list = this.document.createElement('ul');
    list.className = 'capture-consent__points';
    for (const point of CONSENT_POINTS) {
      const item = this.document.createElement('li');
      item.textContent = point;
      list.appendChild(item);
    }

    const note = this.document.createElement('p');
    note.className = 'capture-consent__note';
    note.textContent =
      'Your agreement lasts for this page only. Reload, and you will be asked again.';

    const accept = this.document.createElement('button');
    accept.type = 'button';
    accept.className = 'capture-consent__accept';
    accept.textContent = 'I understand — turn on the camera';
    accept.addEventListener('click', () => {
      this.dismiss();
      this.options.onAccept();
    });

    this.root.append(title, lead, list, note, accept);
  }
}
