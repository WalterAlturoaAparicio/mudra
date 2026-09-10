/**
 * Starting a capture session: contributor label, pose, hand count (FR-012 – FR-014b).
 *
 * Two rules shape this panel:
 *
 * * A pose **not yet in the dataset is permitted** — collecting samples for a new pose is one of
 *   the reasons Capture Mode exists (FR-013). So the pose field is a free-text identifier with a
 *   datalist of what the browser already knows, not a closed dropdown.
 * * The operator is **never asked to retype what the application knows** (FR-014a). Pick a known
 *   pose and its display name and required hand count come from the loaded exemplar data and become
 *   read-only. Type a new one and the operator supplies them.
 */

import type { CaptureConfig } from '../../domain/config/capture-config';
import { contributorLabelProblem, poseIdProblem } from '../../domain/capture/session';
import type { RequiredHands } from '../../domain/capture/types';

/** A pose the browser already knows about, from the exemplar bundle. */
export interface KnownPose {
  readonly poseId: string;
  readonly displayName: string;
  readonly requiredHands: RequiredHands;
}

/** What starting a session produces. */
export interface SessionRequest {
  readonly contributorLabel: string;
  readonly poseId: string;
  readonly displayName: string | null;
  readonly requiredHands: RequiredHands;
}

/** What the panel needs. */
export interface SessionPanelOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  readonly config: CaptureConfig;
  /** Poses derived from the dataset — never from another application's catalog (FR-015). */
  readonly knownPoses: readonly KnownPose[];
  readonly onStart: (request: SessionRequest) => void;
}

/** Session setup. */
export class SessionPanel {
  private readonly document: Document;
  private readonly options: SessionPanelOptions;
  private readonly root: HTMLElement;

  private readonly labelInput: HTMLInputElement;
  private readonly poseInput: HTMLInputElement;
  private readonly displayNameInput: HTMLInputElement;
  private readonly handsSelect: HTMLSelectElement;
  private readonly startButton: HTMLButtonElement;
  private readonly problem: HTMLParagraphElement;

  /** Build and mount the panel. */
  constructor(options: SessionPanelOptions) {
    this.options = options;
    this.document = options.document;
    this.root = this.document.createElement('section');
    this.root.className = 'capture-session-setup';

    this.labelInput = this.field('Contributor label', 'capture-contributor', 'a short handle');
    this.poseInput = this.field('Pose', 'capture-pose', 'dragon');
    this.displayNameInput = this.field('Display name', 'capture-display-name', 'optional');
    this.handsSelect = this.document.createElement('select');
    this.handsSelect.id = 'capture-hands';
    for (const value of [1, 2]) {
      const option = this.document.createElement('option');
      option.value = String(value);
      option.textContent = value === 1 ? 'One hand' : 'Two hands';
      this.handsSelect.appendChild(option);
    }
    this.handsSelect.value = '2';

    this.problem = this.document.createElement('p');
    this.problem.className = 'capture-session-setup__problem';
    this.problem.setAttribute('role', 'status');

    this.startButton = this.document.createElement('button');
    this.startButton.type = 'button';
    this.startButton.className = 'capture-session-setup__start';
    this.startButton.textContent = 'Start session';

    this.render();
    this.bind();
    this.validate();
    options.mount.appendChild(this.root);
  }

  /** The element, for a shell that wants to hide it while a session runs. */
  get element(): HTMLElement {
    return this.root;
  }

  private field(labelText: string, id: string, placeholder: string): HTMLInputElement {
    const input = this.document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    return input;
  }

  private labelled(text: string, control: HTMLElement): HTMLElement {
    const wrapper = this.document.createElement('div');
    wrapper.className = 'capture-field';
    const label = this.document.createElement('label');
    label.htmlFor = control.id;
    label.textContent = text;
    wrapper.append(label, control);
    return wrapper;
  }

  private render(): void {
    const heading = this.document.createElement('h2');
    heading.textContent = 'New session';

    // A datalist rather than a select: known poses are offered, a new one is still typeable.
    const datalist = this.document.createElement('datalist');
    datalist.id = 'capture-known-poses';
    for (const pose of this.options.knownPoses) {
      const option = this.document.createElement('option');
      option.value = pose.poseId;
      option.textContent = pose.displayName;
      datalist.appendChild(option);
    }
    this.poseInput.setAttribute('list', datalist.id);

    const hint = this.document.createElement('p');
    hint.className = 'capture-session-setup__hint';
    hint.textContent =
      'Pick a pose the dataset already has, or type a new identifier to start collecting one.';

    this.root.append(
      heading,
      this.labelled('Contributor label', this.labelInput),
      this.labelled('Pose', this.poseInput),
      datalist,
      hint,
      this.labelled('Display name', this.displayNameInput),
      this.labelled('Hands required', this.handsSelect),
      this.problem,
      this.startButton,
    );
  }

  private bind(): void {
    this.labelInput.addEventListener('input', () => this.validate());
    this.poseInput.addEventListener('input', () => {
      this.adoptKnownPose();
      this.validate();
    });
    this.startButton.addEventListener('click', () => {
      if (this.validate() === null) {
        this.options.onStart(this.request());
      }
    });
  }

  /** When the typed pose is one the dataset knows, take its metadata rather than asking again. */
  private adoptKnownPose(): void {
    const known = this.options.knownPoses.find((p) => p.poseId === this.poseInput.value.trim());
    if (known === undefined) {
      this.displayNameInput.readOnly = false;
      this.handsSelect.disabled = false;
      return;
    }
    this.displayNameInput.value = known.displayName;
    this.displayNameInput.readOnly = true;
    this.handsSelect.value = String(known.requiredHands);
    this.handsSelect.disabled = true;
  }

  private request(): SessionRequest {
    const displayName = this.displayNameInput.value.trim();
    return {
      contributorLabel: this.labelInput.value.trim(),
      poseId: this.poseInput.value.trim(),
      displayName: displayName.length > 0 ? displayName : null,
      requiredHands: this.handsSelect.value === '1' ? 1 : 2,
    };
  }

  /** Show what is missing, and gate the start control on it. @returns the problem, or `null`. */
  private validate(): string | null {
    const request = this.request();
    const problem =
      contributorLabelProblem(request.contributorLabel, this.options.config) ??
      poseIdProblem(request.poseId, this.options.config);
    this.problem.textContent = problem ?? '';
    this.startButton.disabled = problem !== null;
    return problem;
  }
}
