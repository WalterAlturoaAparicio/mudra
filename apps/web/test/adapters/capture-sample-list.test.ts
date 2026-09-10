/**
 * Reviewing and deleting captured samples (FR-041 – FR-043, FR-052).
 *
 * The last describe block is the one that matters most for privacy: sample review must show the
 * operator what they recorded **without ever holding a picture of it**. The thumbnail is SVG built
 * from stored coordinates, so the assertion is that no `<img>`, no canvas, and no blob or data URL
 * appears anywhere in the rendered output.
 */

import { describe, expect, it, vi } from 'vitest';

import { landmarkThumbnail } from '../../src/presentation/capture/landmark-thumbnail';
import { SampleList } from '../../src/presentation/capture/sample-list';
import { hand, sample } from '../support/capture';

function mount(): HTMLElement {
  const element = document.createElement('div');
  document.body.replaceChildren(element);
  return element;
}

function list(
  onDeleteSample = vi.fn(async () => undefined),
  onClearSession = vi.fn(async () => undefined),
) {
  const root = mount();
  const instance = new SampleList({ mount: root, document, onDeleteSample, onClearSession });
  return { root, instance, onDeleteSample, onClearSession };
}

const samples = [
  sample({ id: 'a', capturedAt: '2026-09-07T13:20:01.000000+00:00' }),
  sample({ id: 'b', capturedAt: '2026-09-07T13:20:02.000000+00:00' }),
  sample({ id: 'c', capturedAt: '2026-09-07T13:20:03.000000+00:00', hands: [hand('right', 0)] }),
];

describe('the list (FR-041)', () => {
  it('is empty and says so before anything is recorded', () => {
    const l = list();
    l.instance.render([]);
    expect(l.root.querySelectorAll('.capture-samples__row')).toHaveLength(0);
    expect(l.root.querySelector<HTMLElement>('.capture-samples__empty')!.hidden).toBe(false);
    expect(l.root.querySelector('.capture-samples__empty')!.textContent).toMatch(/No samples yet/);
  });

  it('shows the count in the heading', () => {
    const l = list();
    l.instance.render(samples);
    expect(l.root.querySelector('h2')!.textContent).toBe('Collected samples (3)');
  });

  it('shows position, capture time and hand count per sample', () => {
    const l = list();
    l.instance.render(samples);
    const rows = [...l.root.querySelectorAll('.capture-samples__row')];

    expect(rows[0]!.querySelector('.capture-samples__position')!.textContent).toBe('#1');
    expect(rows[0]!.querySelector('.capture-samples__time')!.textContent).toBe('13:20:01');
    expect(rows[0]!.querySelector('.capture-samples__hands')!.textContent).toBe('2 hands');
    expect(rows[2]!.querySelector('.capture-samples__hands')!.textContent).toBe('1 hand');
  });

  it('tags each row with its sample id, so deletion targets the right record', () => {
    const l = list();
    l.instance.render(samples);
    const ids = [...l.root.querySelectorAll<HTMLElement>('.capture-samples__row')].map(
      (row) => row.dataset['sampleId'],
    );
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('deletion (FR-042, FR-043)', () => {
  it('deletes one sample by id', () => {
    const l = list();
    l.instance.render(samples);
    l.root
      .querySelector<HTMLElement>('[data-sample-id="b"]')!
      .querySelector<HTMLButtonElement>('.capture-samples__delete')!
      .click();

    expect(l.onDeleteSample).toHaveBeenCalledWith('b');
  });

  it('redraws only from what the store returns — never an optimistic local edit', () => {
    const l = list();
    l.instance.render(samples);

    l.root
      .querySelector<HTMLElement>('[data-sample-id="b"]')!
      .querySelector<HTMLButtonElement>('.capture-samples__delete')!
      .click();

    // The row is still there until the caller re-renders with the store's answer. That is the
    // point: a list that removed rows itself would drift from the database.
    expect(l.root.querySelectorAll('.capture-samples__row')).toHaveLength(3);

    l.instance.render(samples.filter((s) => s.id !== 'b'));
    expect(l.root.querySelectorAll('.capture-samples__row')).toHaveLength(2);
    expect(l.root.querySelector('h2')!.textContent).toBe('Collected samples (2)');
  });

  it('disables a row’s delete control once pressed, so a double click cannot double-delete', () => {
    const l = list();
    l.instance.render(samples);
    const button = l.root
      .querySelector<HTMLElement>('[data-sample-id="a"]')!
      .querySelector<HTMLButtonElement>('.capture-samples__delete')!;

    button.click();
    expect(button.disabled).toBe(true);
  });

  it('offers a session-wide delete, unavailable while there is nothing to delete', () => {
    const l = list();
    l.instance.render([]);
    const clear = l.root.querySelector<HTMLButtonElement>('.capture-samples__clear')!;
    expect(clear.disabled).toBe(true);

    l.instance.render(samples);
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(l.onClearSession).toHaveBeenCalledOnce();
  });

  it('labels each delete control for assistive technology', () => {
    const l = list();
    l.instance.render(samples);
    const labels = [...l.root.querySelectorAll('.capture-samples__delete')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Delete sample 1', 'Delete sample 2', 'Delete sample 3']);
  });
});

describe('review shows coordinates, never imagery (FR-052, research D8)', () => {
  it('renders each sample as inline SVG built from its landmarks', () => {
    const l = list();
    l.instance.render(samples);
    const thumbnails = l.root.querySelectorAll('svg.capture-thumbnail');
    expect(thumbnails).toHaveLength(3);
    // 21 landmarks per hand, two hands in the first sample.
    expect(thumbnails[0]!.querySelectorAll('circle')).toHaveLength(42);
  });

  it('contains no image, canvas, blob URL or data URL anywhere', () => {
    const l = list();
    l.instance.render(samples);
    const html = l.root.innerHTML;

    expect(l.root.querySelectorAll('img')).toHaveLength(0);
    expect(l.root.querySelectorAll('canvas')).toHaveLength(0);
    expect(html).not.toMatch(/blob:/);
    expect(html).not.toMatch(/data:image/);
    expect(html).not.toMatch(/base64/);
  });

  it('describes the plot for assistive technology', () => {
    const svg = landmarkThumbnail(document, samples[0]!.hands);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Landmark plot, 2 hands');
  });

  it('survives a collapsed hand without dividing by zero', () => {
    // The degenerate-span case: every normalized point at the origin.
    const flat = {
      ...hand('right', 0),
      normalized: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
    };
    const svg = landmarkThumbnail(document, [flat]);
    for (const circle of svg.querySelectorAll('circle')) {
      expect(Number.isFinite(Number(circle.getAttribute('cx')))).toBe(true);
      expect(Number.isFinite(Number(circle.getAttribute('cy')))).toBe(true);
    }
  });

  it('renders nothing rather than throwing for a sample with no hands', () => {
    const svg = landmarkThumbnail(document, []);
    expect(svg.querySelectorAll('circle')).toHaveLength(0);
  });
});
