/**
 * `IndexedDbLayoutStore` against `fake-indexeddb` (item 11's "persist panel sizes").
 *
 * Same `fake-indexeddb/auto` + unique-database-name pattern
 * `indexeddb-project-repository.test.ts` already uses, and for the same reason: a fresh
 * database name per instance avoids `deleteDatabase`'s close-then-reopen deadlock a
 * shared/reset database would risk.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import { IndexedDbLayoutStore } from '../../src/infrastructure/persistence/indexeddb-layout-store';
import type { PanelSizes } from '../../src/domain/ports/layout-store';

let dbCounter = 0;
function uniqueDbName(): string {
  dbCounter += 1;
  return 'mudra-editor-layout-test-' + dbCounter;
}

describe('IndexedDbLayoutStore', () => {
  it('load() resolves null when nothing has been saved yet', async () => {
    const store = new IndexedDbLayoutStore(uniqueDbName());
    expect(await store.load()).toBeNull();
  });

  it('round-trips whatever save() was given', async () => {
    const store = new IndexedDbLayoutStore(uniqueDbName());
    const sizes: PanelSizes = { leftWidth: 300, rightWidth: 260, timelineHeight: 180 };
    await store.save(sizes);
    expect(await store.load()).toEqual(sizes);
  });

  it('a later save() overwrites an earlier one', async () => {
    const store = new IndexedDbLayoutStore(uniqueDbName());
    await store.save({ leftWidth: 300, rightWidth: 260, timelineHeight: 180 });
    await store.save({ leftWidth: 200, rightWidth: 220, timelineHeight: 150 });
    expect(await store.load()).toEqual({ leftWidth: 200, rightWidth: 220, timelineHeight: 150 });
  });

  it('persists across a new IndexedDbLayoutStore against the same database name', async () => {
    const name = uniqueDbName();
    const first = new IndexedDbLayoutStore(name);
    const sizes: PanelSizes = { leftWidth: 320, rightWidth: 280, timelineHeight: 200 };
    await first.save(sizes);

    const second = new IndexedDbLayoutStore(name);
    expect(await second.load()).toEqual(sizes);
  });
});
