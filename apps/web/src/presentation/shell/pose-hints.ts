/**
 * "What can I do here?" — the supported-poses affordance (FR-089).
 *
 * Discoverable, and **collapsed by default**. FR-089 asks that a visitor be able to learn
 * which poses are supported; FR-087 asks that the default screen not be a readout. A
 * disclosure satisfies both: nothing is on screen until someone asks, and then it is a
 * short list of names.
 *
 * Names come from the bundle's `display_name`, which is derived from the dataset — so this
 * list cannot drift from what the matcher will actually recognize.
 */

/** One pose, as the visitor sees it. */
export interface PoseHint {
  readonly poseId: string;
  readonly displayName: string;
  readonly requiredHands: number;
}

/** A collapsed list of the poses this session responds to. */
export class PoseHints {
  private readonly element: HTMLDetailsElement;
  private readonly list: HTMLUListElement;

  /** Build the disclosure, closed. */
  constructor(document: Document) {
    this.element = document.createElement('details');
    this.element.className = 'mudra-hints';

    const summary = document.createElement('summary');
    summary.textContent = 'Which poses work?';
    this.element.append(summary);

    this.list = document.createElement('ul');
    this.list.className = 'mudra-hints__list';
    this.element.append(this.list);
  }

  /** The element to mount. */
  get root(): HTMLElement {
    return this.element;
  }

  /** Replace the listed poses. */
  setPoses(poses: readonly PoseHint[]): void {
    this.list.replaceChildren();
    for (const pose of poses) {
      const item = this.list.ownerDocument.createElement('li');
      const hands = pose.requiredHands === 2 ? 'both hands' : 'one hand';
      item.textContent = pose.displayName + ' — ' + hands;
      this.list.append(item);
    }
  }
}
