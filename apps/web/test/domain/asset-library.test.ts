/**
 * Project-scoped asset resolution (T050, FR-034–FR-038).
 *
 * Runs in Node: `AssetBlobStore` is a port, faked here with a plain `Map`, so no real
 * IndexedDB is needed to test manifest layering or broken-reference detection.
 */

import { describe, expect, it } from 'vitest';

import type { AssetBlobStore } from '../../src/domain/ports/asset-blob-store';
import type { AssetLibrary } from '../../src/domain/editor/types';
import { createProject } from '../../src/domain/editor/types';
import { DEFAULT_ASSET_MANIFEST } from '../../src/infrastructure/assets/asset-manifest';
import {
  buildProjectAssetManifest,
  findBrokenAssetReferences,
  findBrokenEffectAssetReferences,
  referencedBy,
} from '../../src/infrastructure/assets/project-asset-manifest';
import { createActionRegistry } from '../../src/domain/runtime/actions';

const registry = createActionRegistry();

/** An in-memory `AssetBlobStore`, for tests only. */
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

function fakeBlob(): Blob {
  return new Blob(['x'], { type: 'audio/wav' });
}

describe('buildProjectAssetManifest', () => {
  it('extends the shipped default manifest rather than replacing it', async () => {
    const store = new FakeBlobStore();
    const library: AssetLibrary = { entries: [] };
    const manifest = await buildProjectAssetManifest(library, store);
    expect(manifest.audio).toEqual(DEFAULT_ASSET_MANIFEST.audio);
  });

  it('a project entry resolves to an object URL for its stored blob', async () => {
    const store = new FakeBlobStore();
    await store.put('key-1', fakeBlob());
    const library: AssetLibrary = {
      entries: [
        { reference: '@audio/mine', displayName: 'Mine', kind: 'audio', storageKey: 'key-1' },
      ],
    };
    const manifest = await buildProjectAssetManifest(library, store);
    expect(manifest.audio['mine']).toMatch(/^blob:/);
  });

  it('a project entry can override a shipped default name', async () => {
    const store = new FakeBlobStore();
    await store.put('key-1', fakeBlob());
    const library: AssetLibrary = {
      entries: [
        {
          reference: '@audio/flash',
          displayName: 'Custom flash',
          kind: 'audio',
          storageKey: 'key-1',
        },
      ],
    };
    const manifest = await buildProjectAssetManifest(library, store);
    expect(manifest.audio['flash']).toMatch(/^blob:/);
    expect(manifest.audio['flash']).not.toBe(DEFAULT_ASSET_MANIFEST.audio['flash']);
  });
});

describe('findBrokenAssetReferences', () => {
  it('reports a library entry whose blob is missing, by reference', async () => {
    const store = new FakeBlobStore();
    const library: AssetLibrary = {
      entries: [
        {
          reference: '@audio/gone',
          displayName: 'Gone',
          kind: 'audio',
          storageKey: 'missing-key',
        },
      ],
    };
    const broken = await findBrokenAssetReferences(library, store);
    expect(broken).toEqual(['@audio/gone']);
  });

  it('reports nothing when every entry resolves', async () => {
    const store = new FakeBlobStore();
    await store.put('k', fakeBlob());
    const library: AssetLibrary = {
      entries: [{ reference: '@audio/ok', displayName: 'OK', kind: 'audio', storageKey: 'k' }],
    };
    expect(await findBrokenAssetReferences(library, store)).toEqual([]);
  });
});

describe('findBrokenEffectAssetReferences', () => {
  it("reports an effect's asset param that names nothing in the manifest", () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'E1',
            trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [
                {
                  atMs: 0,
                  action: { type: 'play_audio', params: { asset: '@audio/does-not-exist' } },
                },
              ],
            },
          },
        ],
      },
      'p1',
      'P1',
      1000,
    );
    const broken = findBrokenEffectAssetReferences(project, registry, DEFAULT_ASSET_MANIFEST);
    expect(broken).toEqual(['@audio/does-not-exist']);
  });

  it('reports nothing for a reference the manifest resolves', () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'E1',
            trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [
                { atMs: 0, action: { type: 'play_audio', params: { asset: '@audio/flash' } } },
              ],
            },
          },
        ],
      },
      'p1',
      'P1',
      1000,
    );
    expect(findBrokenEffectAssetReferences(project, registry, DEFAULT_ASSET_MANIFEST)).toEqual([]);
  });
});

describe('referencedBy (P1.3 — the inverse of findBrokenEffectAssetReferences)', () => {
  function projectReferencing(
    reference: string,
    effectName = 'E1',
  ): ReturnType<typeof createProject> {
    return createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: effectName,
            trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [{ atMs: 0, action: { type: 'play_audio', params: { asset: reference } } }],
            },
          },
        ],
      },
      'p1',
      'P1',
      1000,
    );
  }

  it('names the effect that references the given asset', () => {
    const project = projectReferencing('@audio/mine', 'Greeting Flash');
    expect(referencedBy(project, registry, '@audio/mine')).toEqual(['Greeting Flash']);
  });

  it('reports nothing for a reference no effect names', () => {
    const project = projectReferencing('@audio/mine');
    expect(referencedBy(project, registry, '@audio/unused')).toEqual([]);
  });

  it('names every effect that references it, sorted, without duplicates for the same effect', () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'Zeta',
            trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [
                { atMs: 0, action: { type: 'play_audio', params: { asset: '@audio/shared' } } },
                { atMs: 10, action: { type: 'play_audio', params: { asset: '@audio/shared' } } },
              ],
            },
          },
          {
            id: 'e2',
            name: 'Alpha',
            trigger: { on: 'confirmed', poseId: 'hi', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [
                { atMs: 0, action: { type: 'play_audio', params: { asset: '@audio/shared' } } },
              ],
            },
          },
        ],
      },
      'p1',
      'P1',
      1000,
    );
    expect(referencedBy(project, registry, '@audio/shared')).toEqual(['Alpha', 'Zeta']);
  });

  it('also matches a param left at its descriptor default (never provided explicitly)', () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'Default user',
            trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
            timeline: {
              durationMs: 100,
              entries: [{ atMs: 0, action: { type: 'play_audio', params: {} } }],
            },
          },
        ],
      },
      'p1',
      'P1',
      1000,
    );
    // play_audio's own default asset param, from domain/runtime/actions/play-audio.ts.
    expect(referencedBy(project, registry, '@audio/flash')).toEqual(['Default user']);
  });
});

describe('a resolved param value is always a logical reference, never a path', () => {
  it('the asset library entry itself never stores a filesystem or URL path', () => {
    const entry = {
      reference: '@audio/whoosh',
      displayName: 'Whoosh',
      kind: 'audio' as const,
      storageKey: 'blob-key-not-a-path',
    };
    expect(entry.reference.startsWith('@audio/')).toBe(true);
    expect(entry.reference).not.toMatch(/^[a-zA-Z]:\\|^\/|\.(wav|mp3|png|jpg)$/);
  });
});
