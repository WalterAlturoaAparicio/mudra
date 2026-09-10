/**
 * Exporting the capture store to disk (FR-046, FR-051, FR-052a).
 *
 * **This is the one file in Capture Mode that creates a download link**, and it is scoped out of
 * `test/architecture/privacy.test.ts`'s `<a download>` check by name — exactly as
 * `presentation/editor/project-panel.ts` already is, and for the same reason: FR-007's prohibition
 * is about the *camera view and its effects output*, and what leaves here is landmark JSON, never
 * imagery.
 *
 * Two behaviours the specification singles out:
 *
 * * Export is **unavailable with a stated reason** when the store is empty (FR-051) — never a
 *   button that does nothing.
 * * After a successful export the panel says the samples are **still held in this browser** and
 *   that clearing them is a separate, deliberate step (FR-052a). Export never deletes anything.
 */

import type { CaptureExport } from '../../application/capture-export';

/** What the panel needs. */
export interface CaptureExportPanelOptions {
  readonly mount: HTMLElement;
  readonly document: Document;
  /** Build the archive. Rejects with `NothingToExportError` when the store is empty. */
  readonly onExport: () => Promise<CaptureExport>;
}

/** The exact sentence FR-052a requires after a successful export. */
export const POST_EXPORT_NOTICE =
  'These samples are still held in this browser. Check the archive, then delete the sessions when you are satisfied — exporting never removes anything.';

/** The reason shown when there is nothing to export. */
export const EMPTY_STORE_REASON = 'Nothing to export yet — record a take first.';

/** The dataset export control. */
export class CaptureExportPanel {
  private readonly document: Document;
  private readonly options: CaptureExportPanelOptions;
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;

  /** Build and mount the panel. */
  constructor(options: CaptureExportPanelOptions) {
    this.options = options;
    this.document = options.document;

    this.root = this.document.createElement('section');
    this.root.className = 'capture-export';

    const heading = this.document.createElement('h2');
    heading.textContent = 'Export dataset';

    this.button = this.document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'capture-export__button';
    this.button.textContent = 'Export samples';
    this.button.addEventListener('click', () => {
      void this.exportNow();
    });

    this.status = this.document.createElement('p');
    this.status.className = 'capture-export__status';
    this.status.setAttribute('role', 'status');

    this.root.append(heading, this.button, this.status);
    options.mount.appendChild(this.root);
    this.setSampleCount(0);
  }

  /** The element, for a shell that positions it. */
  get element(): HTMLElement {
    return this.root;
  }

  /**
   * Reflect how many samples the store holds.
   *
   * Zero disables the control **and says why** — FR-051 asks for a stated reason, not a dead button.
   */
  setSampleCount(count: number): void {
    this.button.disabled = count === 0;
    if (count === 0) {
      this.status.textContent = EMPTY_STORE_REASON;
      return;
    }
    if (this.status.textContent === EMPTY_STORE_REASON || this.status.textContent === '') {
      this.status.textContent = `${count} sample${count === 1 ? '' : 's'} ready to export.`;
    }
  }

  private async exportNow(): Promise<void> {
    this.button.disabled = true;
    this.status.textContent = 'Building the archive…';
    try {
      const archive = await this.options.onExport();
      this.offer(archive);
      const poses = Object.keys(archive.poseCounts).length;
      this.status.textContent = `Exported ${archive.totalSamples} samples across ${poses} pose${poses === 1 ? '' : 's'}. ${POST_EXPORT_NOTICE}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.status.textContent = detail;
    } finally {
      this.button.disabled = false;
    }
  }

  /**
   * Hand the archive to the browser.
   *
   * A `Blob` and an object URL — the same mechanism project export already uses. The URL is revoked
   * immediately after the click so the bytes are not held alive by a dangling reference.
   */
  private offer(archive: CaptureExport): void {
    // Copied into a view whose buffer is known to be a plain `ArrayBuffer`: a `Uint8Array`
    // may sit on a `SharedArrayBuffer`, which is not a `BlobPart`, and the archive is small
    // enough that one copy costs nothing next to the download it feeds.
    const blob = new Blob([new Uint8Array(archive.bytes)], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = archive.fileName;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}
