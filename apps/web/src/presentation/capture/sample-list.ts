/**
 * Reviewing and deleting captured samples (FR-041 – FR-043).
 *
 * Each row shows enough to judge a sample — its position, when it was taken, how many hands, and a
 * landmark plot — and **no camera imagery of any kind**. The plot is inline SVG built from the
 * stored coordinates (research D8); this module never touches a canvas, a surface, or an image.
 *
 * Deletion here calls straight through to the repository, which removes the record. There is no
 * "hide it in the list" path, because a list that disagreed with the store is exactly the shape a
 * soft delete takes.
 */

import type { CaptureSample } from '../../domain/capture/types';
import { landmarkThumbnail } from './landmark-thumbnail';

/** What the list needs. */
export interface SampleListOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Delete one sample. Resolves once it is gone from the store. */
  readonly onDeleteSample: (id: string) => Promise<void>;
  /** Clear the whole session, behind the caller's own confirmation. */
  readonly onClearSession: () => Promise<void>;
}

/** Render the capture time as something an operator can scan. */
function shortTime(engineTimestamp: string): string {
  // `2026-09-07T13:20:00.100000+00:00` → `13:20:00`. Sliced rather than parsed: this is a label,
  // and a Date round-trip would introduce a timezone question nobody asked.
  return engineTimestamp.slice(11, 19);
}

/** The reviewable list of what has been collected. */
export class SampleList {
  private readonly document: Document;
  private readonly options: SampleListOptions;
  private readonly root: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private readonly list: HTMLUListElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly empty: HTMLParagraphElement;

  /** Build and mount the list. */
  constructor(options: SampleListOptions) {
    this.options = options;
    this.document = options.document;

    this.root = this.document.createElement('section');
    this.root.className = 'capture-samples';

    this.heading = this.document.createElement('h2');
    this.heading.textContent = 'Collected samples';

    this.empty = this.document.createElement('p');
    this.empty.className = 'capture-samples__empty';
    this.empty.textContent = 'No samples yet. Hold the pose and take one.';

    this.list = this.document.createElement('ul');
    this.list.className = 'capture-samples__list';

    this.clearButton = this.document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'capture-samples__clear';
    this.clearButton.textContent = 'Delete this session';
    this.clearButton.addEventListener('click', () => {
      void this.options.onClearSession();
    });

    this.root.append(this.heading, this.empty, this.list, this.clearButton);
    options.mount.appendChild(this.root);
  }

  /** The element, for a shell that hides it before a session exists. */
  get element(): HTMLElement {
    return this.root;
  }

  /** Redraw from the store's own answer — never from an optimistic local edit. */
  render(samples: readonly CaptureSample[]): void {
    this.heading.textContent = `Collected samples (${samples.length})`;
    this.empty.hidden = samples.length > 0;
    this.clearButton.disabled = samples.length === 0;
    this.list.replaceChildren();

    samples.forEach((sample, index) => {
      this.list.appendChild(this.row(sample, index + 1));
    });
  }

  private row(sample: CaptureSample, position: number): HTMLLIElement {
    const row = this.document.createElement('li');
    row.className = 'capture-samples__row';
    row.dataset['sampleId'] = sample.id;

    row.appendChild(landmarkThumbnail(this.document, sample.hands));

    const facts = this.document.createElement('div');
    facts.className = 'capture-samples__facts';

    const number = this.document.createElement('span');
    number.className = 'capture-samples__position';
    number.textContent = `#${position}`;

    const time = this.document.createElement('span');
    time.className = 'capture-samples__time';
    time.textContent = shortTime(sample.capturedAt);

    const hands = this.document.createElement('span');
    hands.className = 'capture-samples__hands';
    hands.textContent = `${sample.hands.length} hand${sample.hands.length === 1 ? '' : 's'}`;

    facts.append(number, time, hands);

    const remove = this.document.createElement('button');
    remove.type = 'button';
    remove.className = 'capture-samples__delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete sample ${position}`);
    remove.addEventListener('click', () => {
      remove.disabled = true;
      void this.options.onDeleteSample(sample.id);
    });

    row.append(facts, remove);
    return row;
  }
}
