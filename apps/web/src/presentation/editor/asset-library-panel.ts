/**
 * The project's own small asset library (T047, FR-034–FR-037; items 2 and 17).
 *
 * Adding a file writes its bytes to the injected `AssetBlobStore` and appends an
 * `AssetLibraryEntry` carrying a **logical reference** — never the file's name or a
 * filesystem path — the same indirection every other asset reference in the application
 * already uses (FR-062, restated for author-supplied assets).
 *
 * This pass makes it a library rather than an upload box: every entry shows its kind and a
 * thumbnail (images) or a playable preview (audio), plus whether anything currently references
 * it. "Referenced by" reuses `infrastructure/assets/project-asset-manifest.ts`'s existing
 * effect/action-param scan (`referencedBy`) — the same structure
 * `findBrokenEffectAssetReferences` walks — rather than a second one, so the panel and the
 * runtime can never disagree about what "uses this asset" means. Removing a referenced asset
 * still works (FR-038 already reports the resulting broken reference) but asks first;
 * `inspector-controls.ts`'s `renderAsset` is the other half of "usable", letting any
 * `asset`-kind parameter pick from this same library by name.
 *
 * Object URLs created for previews are revoked on every redraw, so a long editing session does
 * not accumulate them.
 */

import type { AssetLibrary, AssetLibraryEntry } from '../../domain/editor/types';
import type { AssetBlobStore } from '../../domain/ports/asset-blob-store';
import { AUDIO_PREFIX, IMAGE_PREFIX } from '../../infrastructure/assets/asset-manifest';

/** What the panel needs to exist. */
export interface AssetLibraryPanelOptions {
  readonly document: Document;
  readonly blobStore: AssetBlobStore;
  readonly getLibrary: () => AssetLibrary;
  /** Called with the full, updated library after an add or remove. */
  readonly onLibraryChange: (library: AssetLibrary) => void;
  /** Effect names currently naming `reference` in one of their actions' `asset` params
   *  (item 13) — empty when the asset is safe to remove with nothing breaking. */
  readonly referencedBy: (reference: string) => readonly string[];
  /** Confirms a destructive removal when the asset is referenced. Injected for testability;
   *  defaults to `window.confirm`. */
  readonly confirm?: (message: string) => boolean;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug.length > 0 ? slug : 'asset';
}

/** `1.4 MB`, `812 kB`, `96 bytes` — enough to spot a file that is far too large. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown size';
  }
  if (bytes < 1024) {
    return bytes + ' bytes';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' kB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** The project's asset library panel. */
export class AssetLibraryPanel {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly blobStore: AssetBlobStore;
  private readonly options: AssetLibraryPanelOptions;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly emptyNote: HTMLElement;
  private readonly brokenNotice: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;

  private selectedReference: string | null = null;
  /** Object URLs handed out for previews, revoked on the next redraw. */
  private objectUrls: string[] = [];

  constructor(options: AssetLibraryPanelOptions) {
    this.document = options.document;
    this.blobStore = options.blobStore;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__asset-library';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Assets';
    this.root.append(heading);

    this.emptyNote = this.document.createElement('p');
    this.emptyNote.className = 'mudra-editor__inspector-empty';
    this.emptyNote.textContent =
      'No assets yet. Add an image or a sound below; effects reference them by name.';
    this.root.append(this.emptyNote);

    this.list = this.document.createElement('div');
    this.list.className = 'mudra-editor__asset-list';
    this.root.append(this.list);

    this.detail = this.document.createElement('div');
    this.detail.className = 'mudra-editor__asset-detail';
    this.root.append(this.detail);

    this.brokenNotice = this.document.createElement('p');
    this.brokenNotice.className = 'mudra-editor__asset-broken-notice';
    this.brokenNotice.hidden = true;
    this.root.append(this.brokenNotice);

    const addRow = this.document.createElement('div');
    addRow.className = 'mudra-editor__asset-add-row';
    this.nameInput = this.document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Name';
    this.nameInput.className = 'mudra-editor__input';
    this.nameInput.title =
      'Display name for the file chosen below. Defaults to the filename if left blank.';
    this.fileInput = this.document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,image/*';
    this.fileInput.className = 'mudra-editor__input';
    this.fileInput.title = 'Add an audio or image file to this project’s own asset library.';
    this.fileInput.addEventListener('change', () => {
      void this.addSelectedFile();
    });
    addRow.append(this.nameInput, this.fileInput);
    this.root.append(addRow);

    this.render();
  }

  /** Redraw the entry list from the current library (call after `getLibrary()` changes). */
  render(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls = [];

    const entries = this.options.getLibrary().entries;
    if (
      this.selectedReference !== null &&
      !entries.some((e) => e.reference === this.selectedReference)
    ) {
      this.selectedReference = null; // the selected entry was removed out from under us
    }

    this.emptyNote.hidden = entries.length > 0;
    this.list.replaceChildren();
    for (const entry of entries) {
      this.list.append(this.renderEntry(entry));
    }
    this.renderDetail();
  }

  /** Select an entry from elsewhere — the project explorer's Assets branch. */
  select(reference: string | null): void {
    this.selectedReference = reference;
    this.render();
  }

  /**
   * Surface broken asset references by name (FR-038) — at the point the project is
   * inspected, not only the first time an effect referencing one happens to play.
   */
  showBrokenReferences(references: readonly string[]): void {
    this.brokenNotice.hidden = references.length === 0;
    this.brokenNotice.textContent =
      references.length === 0
        ? ''
        : 'Broken asset reference' +
          (references.length === 1 ? '' : 's') +
          ': ' +
          references.join(', ');
  }

  private renderEntry(entry: AssetLibraryEntry): HTMLElement {
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__asset-entry';
    row.dataset['reference'] = entry.reference;
    row.classList.toggle('is-selected', entry.reference === this.selectedReference);
    row.title = 'Select to inspect "' + entry.displayName + '" and see where it is used.';
    row.addEventListener('click', () => {
      this.selectedReference = this.selectedReference === entry.reference ? null : entry.reference;
      this.render();
    });

    const thumb = this.document.createElement('span');
    thumb.className = 'mudra-editor__asset-thumb';
    thumb.dataset['kind'] = entry.kind;
    row.append(thumb);
    if (entry.kind === 'image') {
      void this.fillThumbnail(thumb, entry);
    } else {
      thumb.textContent = '♪';
    }

    const label = this.document.createElement('span');
    label.className = 'mudra-editor__asset-label';
    label.textContent = entry.displayName;
    const reference = this.document.createElement('span');
    reference.className = 'mudra-editor__asset-reference';
    reference.textContent = entry.reference;
    const text = this.document.createElement('span');
    text.className = 'mudra-editor__asset-text';
    text.append(label, reference);
    row.append(text);

    const usedBy = this.options.referencedBy(entry.reference);
    const usage = this.document.createElement('span');
    usage.className = 'mudra-editor__asset-usage';
    usage.dataset['used'] = usedBy.length > 0 ? 'true' : 'false';
    usage.textContent = usedBy.length === 0 ? 'unused' : String(usedBy.length) + '×';
    usage.title =
      usedBy.length === 0
        ? 'No effect references this asset — removing it breaks nothing.'
        : 'Referenced by: ' + usedBy.join(', ');
    row.append(usage);

    const removeButton = this.document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'mudra-editor__asset-remove';
    removeButton.textContent = 'Remove';
    removeButton.title =
      'Remove "' +
      entry.displayName +
      '" from this project’s asset library. Any effect referencing it will show as broken.';
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.removeEntry(entry);
    });
    row.append(removeButton);

    return row;
  }

  /** Draw an image entry's thumbnail from its stored bytes. */
  private async fillThumbnail(host: HTMLElement, entry: AssetLibraryEntry): Promise<void> {
    const blob = await this.blobStore.get(entry.storageKey);
    if (blob === null) {
      host.textContent = '!';
      host.title = 'This asset’s stored file is missing.';
      return;
    }
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    const image = this.document.createElement('img');
    image.src = url;
    image.alt = '';
    host.replaceChildren(image);
  }

  /** The inline inspector for whichever entry is currently selected (items 13 and 17). */
  private renderDetail(): void {
    this.detail.replaceChildren();
    this.detail.hidden = this.selectedReference === null;
    if (this.selectedReference === null) {
      return;
    }
    const entry = this.options
      .getLibrary()
      .entries.find((e) => e.reference === this.selectedReference);
    if (entry === undefined) {
      return;
    }

    const usedBy = this.options.referencedBy(entry.reference);

    this.detail.append(
      this.detailLine('Name', entry.displayName),
      this.detailLine('Kind', entry.kind),
      this.detailLine('Reference', entry.reference),
    );

    const size = this.document.createElement('p');
    size.className = 'mudra-editor__asset-detail-line';
    size.textContent = 'Size: …';
    this.detail.append(size);
    void this.blobStore.get(entry.storageKey).then((blob) => {
      size.textContent =
        blob === null
          ? 'Size: the stored file is missing — this reference is broken.'
          : 'Size: ' + formatBytes(blob.size) + (blob.type === '' ? '' : ' · ' + blob.type);
    });

    const usage = this.document.createElement('p');
    usage.className = 'mudra-editor__asset-detail-line';
    usage.textContent =
      usedBy.length === 0
        ? 'Not referenced by any effect — safe to remove.'
        : 'Used by: ' + usedBy.join(', ');
    this.detail.append(usage);

    if (entry.kind === 'audio') {
      void this.appendAudioPreview(entry);
    }
  }

  private detailLine(label: string, value: string): HTMLElement {
    const line = this.document.createElement('p');
    line.className = 'mudra-editor__asset-detail-line';
    line.textContent = label + ': ' + value;
    return line;
  }

  /** A native audio element, so a sound can be heard before it is wired to an action. */
  private async appendAudioPreview(entry: AssetLibraryEntry): Promise<void> {
    const blob = await this.blobStore.get(entry.storageKey);
    if (blob === null || this.selectedReference !== entry.reference) {
      return;
    }
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    const audio = this.document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.className = 'mudra-editor__asset-audio';
    audio.src = url;
    audio.title = 'Listen to this sound.';
    this.detail.append(audio);
  }

  private async addSelectedFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (file === undefined) {
      return;
    }
    const kind: 'audio' | 'image' = file.type.startsWith('image/') ? 'image' : 'audio';
    const prefix = kind === 'audio' ? AUDIO_PREFIX : IMAGE_PREFIX;
    const displayName = this.nameInput.value.trim() || file.name;
    const slug = slugify(displayName) + '-' + Date.now().toString(36);
    const storageKey = 'asset-' + slug;
    const reference = prefix + slug;

    await this.blobStore.put(storageKey, file);

    const library = this.options.getLibrary();
    const entry: AssetLibraryEntry = { reference, displayName, kind, storageKey };
    this.options.onLibraryChange({ entries: [...library.entries, entry] });

    this.fileInput.value = '';
    this.nameInput.value = '';
    this.selectedReference = reference;
    this.render();
  }

  private async removeEntry(entry: AssetLibraryEntry): Promise<void> {
    const usedBy = this.options.referencedBy(entry.reference);
    if (usedBy.length > 0) {
      const confirmFn = this.options.confirm ?? ((message: string) => globalThis.confirm(message));
      const proceed = confirmFn(
        '"' +
          entry.displayName +
          '" is used by: ' +
          usedBy.join(', ') +
          '. Remove it anyway? Those effects will show a broken asset reference.',
      );
      if (!proceed) {
        return;
      }
    }

    await this.blobStore.remove(entry.storageKey);
    const library = this.options.getLibrary();
    this.options.onLibraryChange({
      entries: library.entries.filter((candidate) => candidate.reference !== entry.reference),
    });
    this.render();
  }
}
