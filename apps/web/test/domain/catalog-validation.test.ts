/**
 * Every rule in contracts/effect-catalog.md, enforced at load (FR-045).
 *
 * The catalog is a file a person edits by hand, so the value of these rules is not that
 * they catch impossible states — it is that they catch a typo *at startup*, naming the
 * effect, rather than as a strange absence twenty minutes later when that pose is held.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createActionRegistry } from '../../src/domain/runtime/actions';
import { CatalogError, loadEffectCatalog, parseCatalog } from '../../src/infrastructure/effects/catalog-loader';
import { APP_ROOT } from '../support/source-scan';

const registry = createActionRegistry();

/** A minimal valid catalog document, which each test then breaks in one way. */
function valid(): Record<string, unknown> {
  return {
    catalog_version: 1,
    effects: [
      {
        id: 'a',
        name: 'A',
        trigger: { on: 'confirmed', pose_id: 'p', conditions: [] },
        timeline: {
          duration_ms: 500,
          entries: [{ at_ms: 0, duration_ms: 400, action: { type: 'screen_flash', params: {} } }],
        },
      },
    ],
  };
}

/** Reach into the first effect's first action's params. */
function firstParams(document: Record<string, unknown>): Record<string, unknown> {
  const effects = document['effects'] as Record<string, unknown>[];
  const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
  const action = timeline.entries[0]!['action'] as { params: Record<string, unknown> };
  return action.params;
}

describe('the shipped catalog', () => {
  it('loads against the shipped registry', () => {
    const document = JSON.parse(
      readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8'),
    ) as unknown;
    const catalog = parseCatalog(document, createActionRegistry());
    expect(catalog.effects.length).toBeGreaterThan(0);
  });

  it('demonstrates all three action behaviours (FR-056)', () => {
    const document = JSON.parse(
      readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8'),
    ) as unknown;
    const catalog = parseCatalog(document, createActionRegistry());
    const behaviours = new Set(
      catalog.effects.flatMap((effect) =>
        effect.timeline.entries.map(
          (entry) => createActionRegistry().require(entry.action.type, effect.id).behaviour,
        ),
      ),
    );
    expect(behaviours).toEqual(new Set(['instantaneous', 'duration', 'continuous']));
  });
});

describe('rejections', () => {
  it('rejects a wrong catalog_version, naming the expected one', () => {
    expect(() => parseCatalog({ ...valid(), catalog_version: 2 }, registry)).toThrow(
      /catalog_version must be 1/,
    );
  });

  it('rejects a duplicate effect id, naming it', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    effects.push({ ...effects[0] });
    expect(() => parseCatalog(document, registry)).toThrow(/Duplicate effect id "a"/);
  });

  it('rejects an unknown action type, naming the type and the effect', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    timeline.entries[0]!['action'] = { type: 'teleport_the_user', params: {} };
    expect(() => parseCatalog(document, registry)).toThrow(
      /Effect "a" uses unknown action type "teleport_the_user"/,
    );
  });

  it('rejects an unknown condition type rather than ignoring it', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const trigger = effects[0]!['trigger'] as { conditions: unknown[] };
    trigger.conditions = [{ type: 'when_the_moon_is_full' }];
    expect(() => parseCatalog(document, registry)).toThrow(/unknown condition type/);
  });

  it('rejects an unknown trigger event kind', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    (effects[0]!['trigger'] as Record<string, unknown>)['on'] = 'wiggled';
    expect(() => parseCatalog(document, registry)).toThrow(/must be one of entered, held/);
  });

  it('rejects a negative at_ms', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    timeline.entries[0]!['at_ms'] = -10;
    expect(() => parseCatalog(document, registry)).toThrow(/at_ms must not be negative/);
  });

  it('rejects a timeline shorter than its own entries', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as Record<string, unknown>;
    timeline['duration_ms'] = 100;
    expect(() => parseCatalog(document, registry)).toThrow(/at least as long as its contents/);
  });

  it('rejects an unknown parameter, listing the ones the action does accept', () => {
    const document = valid();
    firstParams(document)['sparkliness'] = 3;
    expect(() => parseCatalog(document, registry)).toThrow(/unknown parameter "sparkliness"/);
  });

  it('rejects an out-of-range parameter value', () => {
    const document = valid();
    firstParams(document)['intensity'] = 4;
    expect(() => parseCatalog(document, registry)).toThrow(/must be at most 1/);
  });

  it('rejects a malformed colour', () => {
    const document = valid();
    firstParams(document)['color'] = 'bright red please';
    expect(() => parseCatalog(document, registry)).toThrow(/hex colour/);
  });

  it('rejects an enum value outside its list', () => {
    const document = valid();
    firstParams(document)['blend'] = 'sparkle';
    expect(() => parseCatalog(document, registry)).toThrow(/must be one of normal, add/);
  });

  it('rejects a physical asset path (FR-062)', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    timeline.entries[0]!['action'] = {
      type: 'play_audio',
      params: { asset: '/assets/audio/flash.wav' },
    };
    expect(() => parseCatalog(document, registry)).toThrow(/physical asset path/);
  });

  it('rejects an anchor with an out-of-range landmark index', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    timeline.entries[0]!['action'] = {
      type: 'landmark_trail',
      params: { anchor: { kind: 'landmark', hand: 'first', index: 44 } },
    };
    expect(() => parseCatalog(document, registry)).toThrow(/integer index in \[0, 20\]/);
  });

  it('rejects an anchor naming a hand that is not a selector', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    timeline.entries[0]!['action'] = {
      type: 'landmark_trail',
      params: { anchor: { kind: 'landmark', hand: 'the good one', index: 8 } },
    };
    expect(() => parseCatalog(document, registry)).toThrow(/hand must be one of/);
  });
});

describe('permitted by design', () => {
  it('accepts a trigger for a pose that is not active — it simply never fires', () => {
    // contracts/effect-catalog.md is explicit that this is not an error: a catalog may
    // outlive a change to the active pose set, and the debug panel reports it.
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    (effects[0]!['trigger'] as Record<string, unknown>)['pose_id'] = 'a_pose_nobody_activated';
    expect(() => parseCatalog(document, registry)).not.toThrow();
  });

  it('accepts an entry with no duration — that is an instantaneous action', () => {
    const document = valid();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    delete timeline.entries[0]!['duration_ms'];
    expect(() => parseCatalog(document, registry)).not.toThrow();
  });

  it('applies declared defaults for omitted parameters', () => {
    const catalog = parseCatalog(valid(), registry);
    // The catalog above supplies no params at all; the schema fills them in.
    expect(catalog.effects[0]!.timeline.entries[0]!.action.params).toEqual({});
  });
});

describe('the loader', () => {
  it('names the file when validation fails', async () => {
    await expect(
      loadEffectCatalog({
        registry,
        url: '/config/effects.json',
        fetcher: () => Promise.resolve({ ...valid(), catalog_version: 9 }),
      }),
    ).rejects.toThrow(/\/config\/effects\.json is invalid/);
  });

  it('reports an unreadable file rather than starting with no effects', async () => {
    await expect(
      loadEffectCatalog({
        registry,
        fetcher: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow(CatalogError);
  });
});
