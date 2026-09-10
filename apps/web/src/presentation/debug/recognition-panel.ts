/**
 * What recognition thinks, and the context that makes it mean something.
 *
 * **The active pose set is displayed alongside every confidence** (FR-024c). This is not
 * decoration. Softmax normalizes across the candidate set, so 0.7 among four poses is a
 * different claim from 0.7 among seventeen (research D11) — a reader shown the number
 * without the set will draw a false conclusion from it, and there is no way to tell from
 * the number alone.
 */

import type { PoseEvent } from '../../domain/events/pose-events';
import type { RecognitionOutcome } from '../../domain/recognition/types';

/** How each outcome reads to a developer. */
const OUTCOME_LABEL: Readonly<Record<RecognitionOutcome['kind'], string>> = {
  noHand: 'no hand in frame',
  unrecognized: 'below confidence floor',
  ambiguous: 'too close to call',
  recognized: 'recognized',
};

/** The recognition panel. */
export class RecognitionPanel {
  private readonly element: HTMLElement;
  private readonly body: HTMLElement;

  /** Build the panel. */
  constructor(document: Document) {
    this.element = document.createElement('section');
    this.element.className = 'mudra-panel';

    const heading = document.createElement('h2');
    heading.textContent = 'Recognition';
    this.element.append(heading);

    this.body = document.createElement('div');
    this.element.append(this.body);
  }

  /** The element to mount. */
  get root(): HTMLElement {
    return this.element;
  }

  /** Redraw from the latest frame. */
  update(
    outcome: RecognitionOutcome,
    events: readonly PoseEvent[],
    holdProgress: number,
    activePoseSet: readonly string[],
  ): void {
    const document = this.element.ownerDocument;
    const list = document.createElement('dl');

    addRow(list, 'state', OUTCOME_LABEL[outcome.kind]);
    addRow(
      list,
      'active set',
      // Shown next to the confidences below, never separately — FR-024c is about the two
      // being read together.
      activePoseSet.length + ' poses: ' + activePoseSet.join(', '),
    );
    addRow(list, 'hold', (holdProgress * 100).toFixed(0) + '%');
    addRow(list, 'latency', outcome.latencyMs.toFixed(1) + ' ms');
    if (events.length > 0) {
      addRow(list, 'events', events.map((event) => event.kind + ':' + event.poseId).join(' '));
    }

    const candidates = document.createElement('ul');
    if (outcome.topCandidates.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'is-inactive';
      empty.textContent = 'no eligible candidates';
      candidates.append(empty);
    }
    for (const candidate of outcome.topCandidates) {
      const item = document.createElement('li');
      item.textContent =
        candidate.poseId +
        '  ' +
        candidate.confidence.toFixed(3) +
        '  (d=' +
        candidate.distance.toFixed(2) +
        ')';
      candidates.append(item);
    }

    this.body.replaceChildren(list, candidates);
  }
}

function addRow(list: HTMLElement, term: string, value: string): void {
  const document = list.ownerDocument;
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  list.append(dt, dd);
}
