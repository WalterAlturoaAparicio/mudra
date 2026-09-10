/**
 * Three populations, three states, none silent (FR-023a, FR-023b, SC-013).
 *
 * | Population | What it is |
 * |---|---|
 * | Catalog | Every pose identity the project has recorded anything for |
 * | Eligible | Those with enough samples to be worth matching against |
 * | Active | Those this session is currently considering |
 *
 * A pose that is in the catalog but not eligible is listed **with its reason and its actual
 * sample count** — not omitted. A pose that is eligible but inactive is listed as inactive.
 * The failure this prevents is the quiet one: a pose that stops working and leaves nothing
 * anywhere saying why.
 */

import type { ExemplarBundle } from '../../domain/recognition/types';

/** The pose-population panel. */
export class PosePanel {
  private readonly element: HTMLElement;

  /** Build the panel from the loaded bundle; its contents do not change per frame. */
  constructor(document: Document, bundle: ExemplarBundle, activePoseSet: readonly string[]) {
    this.element = document.createElement('section');
    this.element.className = 'mudra-panel';

    const heading = document.createElement('h2');
    heading.textContent = 'Poses';
    this.element.append(heading);

    const counts = document.createElement('dl');
    addRow(counts, 'catalog', String(bundle.catalogPoseCount));
    addRow(counts, 'eligible', String(bundle.poses.length));
    addRow(counts, 'active', String(activePoseSet.length));
    addRow(counts, 'minimum', bundle.minSamples + ' samples');
    this.element.append(counts);

    const list = document.createElement('ul');
    const active = new Set(activePoseSet);

    for (const pose of bundle.poses) {
      const item = document.createElement('li');
      const state = active.has(pose.poseId) ? 'active' : 'inactive';
      if (state === 'inactive') {
        item.className = 'is-inactive';
      }
      item.textContent =
        pose.poseId +
        ' — ' +
        state +
        ', ' +
        pose.sampleCount +
        ' samples, ' +
        pose.requiredHands +
        (pose.requiredHands === 1 ? ' hand' : ' hands');
      list.append(item);
    }

    for (const excluded of bundle.excluded) {
      const item = document.createElement('li');
      item.className = 'is-ineligible';
      item.textContent =
        excluded.poseId +
        ' — ineligible, ' +
        excluded.sampleCount +
        (excluded.sampleCount === 1 ? ' sample' : ' samples') +
        ', minimum ' +
        bundle.minSamples +
        ' (' +
        excluded.reason +
        ')';
      list.append(item);
    }

    this.element.append(list);
  }

  /** The element to mount. */
  get root(): HTMLElement {
    return this.element;
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
