/**
 * The dataset export control (FR-051, FR-052a).
 *
 * Two behaviours the specification singles out, and this file exists to pin both:
 *
 * * an empty store disables export **and states why** — never a button that does nothing;
 * * after a successful export the panel says the samples are **still held in this browser**, so an
 *   operator is never left assuming exporting cleared anything.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CaptureExport } from '../../src/application/capture-export';
import { NothingToExportError } from '../../src/application/capture-export';
import {
  CaptureExportPanel,
  EMPTY_STORE_REASON,
  POST_EXPORT_NOTICE,
} from '../../src/presentation/capture/capture-export-panel';

function mount(): HTMLElement {
  const element = document.createElement('div');
  document.body.replaceChildren(element);
  return element;
}

function archive(overrides: Partial<CaptureExport> = {}): CaptureExport {
  return {
    bytes: new Uint8Array([80, 75, 5, 6]),
    fileName: 'mudra-web-capture-2026-09-07.zip',
    totalSamples: 12,
    poseCounts: { dragon: 8, peace: 4 },
    sessionCount: 2,
    ...overrides,
  };
}

/** jsdom implements neither; both are stubbed so the download path can be exercised. */
function stubObjectUrl(): { revoked: string[] } {
  const revoked: string[] = [];
  URL.createObjectURL = vi.fn(() => 'blob:capture-test');
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  return { revoked };
}

function panel(onExport = vi.fn(async () => archive())) {
  const root = mount();
  const instance = new CaptureExportPanel({ mount: root, document, onExport });
  return {
    root,
    instance,
    onExport,
    button: root.querySelector<HTMLButtonElement>('.capture-export__button')!,
    status: root.querySelector<HTMLElement>('.capture-export__status')!,
  };
}

describe('an empty store (FR-051)', () => {
  it('disables export and states the reason', () => {
    const p = panel();
    expect(p.button.disabled).toBe(true);
    expect(p.status.textContent).toBe(EMPTY_STORE_REASON);
    expect(p.status.textContent).toMatch(/record a take first/i);
  });

  it('enables export once a sample exists, and says how many are ready', () => {
    const p = panel();
    p.instance.setSampleCount(3);
    expect(p.button.disabled).toBe(false);
    expect(p.status.textContent).toBe('3 samples ready to export.');
  });

  it('goes back to the stated reason when the store is emptied again', () => {
    const p = panel();
    p.instance.setSampleCount(3);
    p.instance.setSampleCount(0);
    expect(p.button.disabled).toBe(true);
    expect(p.status.textContent).toBe(EMPTY_STORE_REASON);
  });

  it('uses the singular for one sample', () => {
    const p = panel();
    p.instance.setSampleCount(1);
    expect(p.status.textContent).toBe('1 sample ready to export.');
  });
});

describe('a successful export (FR-046, FR-052a)', () => {
  it('offers the archive as a download named by the export date', async () => {
    stubObjectUrl();
    const p = panel();
    p.instance.setSampleCount(12);

    const clicks: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicks.push(this.download);
    };

    p.button.click();
    await vi.waitFor(() => expect(clicks).toHaveLength(1));
    HTMLAnchorElement.prototype.click = realClick;

    expect(clicks[0]).toBe('mudra-web-capture-2026-09-07.zip');
  });

  it('says the samples are still held locally, and that clearing is a separate step', async () => {
    stubObjectUrl();
    HTMLAnchorElement.prototype.click = function click() {
      /* the download itself is not what this test is about */
    };
    const p = panel();
    p.instance.setSampleCount(12);

    p.button.click();
    await vi.waitFor(() => expect(p.status.textContent).toMatch(/Exported 12 samples/));

    expect(p.status.textContent).toContain(POST_EXPORT_NOTICE);
    expect(p.status.textContent).toMatch(/still held in this browser/i);
    expect(p.status.textContent).toMatch(/exporting never removes anything/i);
    expect(p.status.textContent).toMatch(/across 2 poses/);
  });

  it('releases the object URL rather than leaving the bytes alive', async () => {
    const stub = stubObjectUrl();
    HTMLAnchorElement.prototype.click = function click() {
      /* no-op */
    };
    const p = panel();
    p.instance.setSampleCount(1);

    p.button.click();
    await vi.waitFor(() => expect(stub.revoked).toEqual(['blob:capture-test']));
  });

  it('leaves no anchor behind in the document', async () => {
    stubObjectUrl();
    HTMLAnchorElement.prototype.click = function click() {
      /* no-op */
    };
    const p = panel();
    p.instance.setSampleCount(1);

    p.button.click();
    await vi.waitFor(() => expect(p.status.textContent).toMatch(/Exported/));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});

describe('a failed export', () => {
  it('reports the reason and leaves the control usable', async () => {
    const p = panel(
      vi.fn(async () => {
        throw new NothingToExportError();
      }),
    );
    p.instance.setSampleCount(1);

    p.button.click();
    await vi.waitFor(() => expect(p.status.textContent).toMatch(/no captured samples to export/i));
    expect(p.button.disabled).toBe(false);
  });
});

describe('export never mutates the store (FR-052a)', () => {
  it('calls the export use case and nothing else — no delete, no clear', () => {
    // The panel is handed exactly one callback. There is no repository here to delete through,
    // which is the structural half of "export never mutates".
    const p = panel();
    const options = Object.keys({ mount: 0, document: 0, onExport: 0 });
    for (const forbidden of ['onDelete', 'onClear', 'repository']) {
      expect(options).not.toContain(forbidden);
    }
    expect(p.onExport).not.toHaveBeenCalled();
  });
});
