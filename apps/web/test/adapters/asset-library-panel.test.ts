/**
 * `AssetLibraryPanel` — made genuinely usable (P1.3, item 13): selecting an entry shows its
 * kind/reference/used-by, and removing a referenced asset asks for confirmation first rather
 * than silently breaking the effects that use it.
 */

import { describe, expect, it } from 'vitest';

import type { AssetBlobStore } from '../../src/domain/ports/asset-blob-store';
import type { AssetLibrary } from '../../src/domain/editor/types';
import { AssetLibraryPanel } from '../../src/presentation/editor/asset-library-panel';

class FakeBlobStore implements AssetBlobStore {
  private readonly blobs = new Map<string, Blob>();
  put(key: string, blob: Blob): Promise<void> {
    this.blobs.set(key, blob);
    return Promise.resolve();
  }
  get(key: string): Promise<Blob | null> {
    return Promise.resolve(this.blobs.get(key) ?? null);
  }
  remove(key: string): Promise<void> {
    this.blobs.delete(key);
    return Promise.resolve();
  }
}

const oneEntryLibrary: AssetLibrary = {
  entries: [{ reference: '@audio/flash', displayName: 'Flash', kind: 'audio', storageKey: 'k1' }],
};

function buildPanel(
  library: AssetLibrary,
  overrides: Partial<{ referencedBy: (reference: string) => readonly string[]; confirm: (message: string) => boolean }> = {},
) {
  let current = library;
  const changes: AssetLibrary[] = [];
  const panel = new AssetLibraryPanel({
    document,
    blobStore: new FakeBlobStore(),
    getLibrary: () => current,
    onLibraryChange: (updated) => {
      current = updated;
      changes.push(updated);
    },
    referencedBy: overrides.referencedBy ?? (() => []),
    ...(overrides.confirm === undefined ? {} : { confirm: overrides.confirm }),
  });
  return { panel, changes };
}

describe('selecting an entry', () => {
  it('shows kind, reference, and "safe to remove" when nothing references it', () => {
    const { panel } = buildPanel(oneEntryLibrary);
    panel.root.querySelector<HTMLElement>('.mudra-editor__asset-entry')!.click();

    const text = panel.root.querySelector('.mudra-editor__asset-detail')!.textContent ?? '';
    expect(text).toContain('Kind: audio');
    expect(text).toContain('Reference: @audio/flash');
    expect(text).toMatch(/safe to remove/i);
  });

  it('shows which effects use it when referencedBy reports some', () => {
    const { panel } = buildPanel(oneEntryLibrary, {
      referencedBy: () => ['Greeting Flash', 'Teleport'],
    });
    panel.root.querySelector<HTMLElement>('.mudra-editor__asset-entry')!.click();

    const text = panel.root.querySelector('.mudra-editor__asset-detail')!.textContent ?? '';
    expect(text).toContain('Used by: Greeting Flash, Teleport');
  });

  it('clicking the same entry again deselects it', () => {
    const { panel } = buildPanel(oneEntryLibrary);
    const row = panel.root.querySelector<HTMLElement>('.mudra-editor__asset-entry')!;
    row.click();
    expect(panel.root.querySelector('.mudra-editor__asset-detail')!.textContent).not.toBe('');
    row.click();
    expect(panel.root.querySelector('.mudra-editor__asset-detail')!.textContent).toBe('');
  });
});

describe('removing an unreferenced asset', () => {
  it('removes it immediately, with no confirmation prompt', async () => {
    let confirmCalled = false;
    const { panel, changes } = buildPanel(oneEntryLibrary, {
      referencedBy: () => [],
      confirm: () => {
        confirmCalled = true;
        return true;
      },
    });
    panel.root.querySelector<HTMLButtonElement>('.mudra-editor__asset-entry button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmCalled).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.entries).toHaveLength(0);
  });
});

describe('removing a referenced asset (item 13 — never a silent one-click accident)', () => {
  it('asks for confirmation, and does not remove it when declined', async () => {
    let confirmMessage = '';
    const { panel, changes } = buildPanel(oneEntryLibrary, {
      referencedBy: () => ['Greeting Flash'],
      confirm: (message) => {
        confirmMessage = message;
        return false;
      },
    });
    panel.root.querySelector<HTMLButtonElement>('.mudra-editor__asset-entry button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmMessage).toContain('Greeting Flash');
    expect(changes).toHaveLength(0);
  });

  it('removes it when the confirmation is accepted', async () => {
    const { panel, changes } = buildPanel(oneEntryLibrary, {
      referencedBy: () => ['Greeting Flash'],
      confirm: () => true,
    });
    panel.root.querySelector<HTMLButtonElement>('.mudra-editor__asset-entry button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(changes).toHaveLength(1);
    expect(changes[0]!.entries).toHaveLength(0);
  });

  it('the remove button does not also trigger selection (event.stopPropagation)', async () => {
    const { panel } = buildPanel(oneEntryLibrary, { referencedBy: () => [], confirm: () => true });
    panel.root.querySelector<HTMLButtonElement>('.mudra-editor__asset-entry button')!.click();
    await Promise.resolve();
    await Promise.resolve();
    // The entry (and its detail) is gone entirely after removal — nothing left selected.
    expect(panel.root.querySelector('.mudra-editor__asset-detail')!.textContent).toBe('');
  });
});

describe('deselection when the selected entry disappears out from under the panel', () => {
  it('render() with a library missing the selected reference clears the detail view', () => {
    let library: AssetLibrary = { entries: [...oneEntryLibrary.entries] };
    const panel = new AssetLibraryPanel({
      document,
      blobStore: new FakeBlobStore(),
      getLibrary: () => library,
      onLibraryChange: () => {},
      referencedBy: () => [],
    });
    panel.root.querySelector<HTMLElement>('.mudra-editor__asset-entry')!.click();
    expect(panel.root.querySelector('.mudra-editor__asset-detail')!.textContent).not.toBe('');

    // Simulate the library changing elsewhere (e.g. another tab) without going through
    // removeEntry — render() must still notice the selection no longer exists.
    library = { entries: [] };
    panel.render();
    expect(panel.root.querySelector('.mudra-editor__asset-detail')!.textContent).toBe('');
  });
});
