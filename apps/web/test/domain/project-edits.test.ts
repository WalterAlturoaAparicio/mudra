/**
 * `domain/editor/project-edits.ts`'s immutable-update invariants (SC-007, SC-008).
 *
 * The property that matters most: moving, resizing, deleting, or duplicating one timeline
 * entry never changes any other entry's `atMs`/`durationMs` — the direct domain-level proof
 * behind SC-007, which `test/adapters/timeline.test.ts` (T037) then re-exercises through the
 * actual UI.
 */

import { describe, expect, it } from 'vitest';

import {
  addTimelineEntry,
  createNewEffect,
  duplicateTimelineEntry,
  findEffect,
  moveTimelineEntry,
  removeTimelineEntry,
  resizeTimelineEntry,
  updateActionParams,
  withEffect,
  withTrigger,
} from '../../src/domain/editor/project-edits';
import type { Project } from '../../src/domain/editor/types';
import {
  DEFAULT_CAMERA_TREATMENT,
  EMPTY_ASSET_LIBRARY,
  InvalidProjectNameError,
  renameProject,
} from '../../src/domain/editor/types';
import { parseCatalog, serializeCatalog } from '../../src/infrastructure/effects/catalog-loader';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import type { EffectDefinition } from '../../src/domain/effects/types';

function effect(): EffectDefinition {
  return {
    id: 'e1',
    name: 'Effect 1',
    trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
    timeline: {
      durationMs: 1000,
      entries: [
        { atMs: 0, durationMs: 300, action: { type: 'screen_flash', params: { intensity: 0.5 } } },
        { atMs: 500, durationMs: 400, action: { type: 'particle_burst', params: {} } },
      ],
    },
  };
}

function project(): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    name: 'Project 1',
    createdAtMs: 0,
    updatedAtMs: 0,
    catalog: { version: 1, effects: [effect()] },
    assetLibrary: EMPTY_ASSET_LIBRARY,
    cameraTreatment: DEFAULT_CAMERA_TREATMENT,
  };
}

describe('moveTimelineEntry', () => {
  it('changes only the moved entry (SC-007)', () => {
    const before = project();
    const after = moveTimelineEntry(before, 'e1', 0, 200);
    const entries = findEffect(after, 'e1')!.timeline.entries;
    expect(entries[0]).toEqual({
      atMs: 200,
      durationMs: 300,
      action: { type: 'screen_flash', params: { intensity: 0.5 } },
    });
    expect(entries[1]).toEqual(effect().timeline.entries[1]);
  });

  it('extends the timeline duration when the move would otherwise exceed it', () => {
    const after = moveTimelineEntry(project(), 'e1', 1, 900);
    expect(findEffect(after, 'e1')!.timeline.durationMs).toBeGreaterThanOrEqual(1300);
  });

  it('is a no-op for an unknown effect id', () => {
    const before = project();
    expect(moveTimelineEntry(before, 'nope', 0, 100)).toEqual(before);
  });
});

describe('resizeTimelineEntry', () => {
  it('changes only the resized entry', () => {
    const after = resizeTimelineEntry(project(), 'e1', 1, 200);
    const entries = findEffect(after, 'e1')!.timeline.entries;
    expect(entries[0]).toEqual(effect().timeline.entries[0]);
    expect(entries[1]!.durationMs).toBe(200);
  });
});

describe('removeTimelineEntry / duplicateTimelineEntry', () => {
  it('removes exactly one entry, in place', () => {
    const after = removeTimelineEntry(project(), 'e1', 0);
    const entries = findEffect(after, 'e1')!.timeline.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(effect().timeline.entries[1]);
  });

  it('duplicates one entry without touching the others', () => {
    const after = duplicateTimelineEntry(project(), 'e1', 0);
    const entries = findEffect(after, 'e1')!.timeline.entries;
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual(entries[1]);
    expect(entries[2]).toEqual(effect().timeline.entries[1]);
  });
});

describe('addTimelineEntry', () => {
  it('appends and extends duration to cover it', () => {
    const after = addTimelineEntry(project(), 'e1', {
      atMs: 2000,
      durationMs: 100,
      action: { type: 'play_audio', params: {} },
    });
    const result = findEffect(after, 'e1')!;
    expect(result.timeline.entries).toHaveLength(3);
    expect(result.timeline.durationMs).toBeGreaterThanOrEqual(2100);
  });
});

describe('updateActionParams', () => {
  it('replaces one entry action params, leaving offset/duration and other entries alone', () => {
    const after = updateActionParams(project(), 'e1', 0, { intensity: 0.9, color: '#FFFFFF' });
    const entries = findEffect(after, 'e1')!.timeline.entries;
    expect(entries[0]).toEqual({
      atMs: 0,
      durationMs: 300,
      action: { type: 'screen_flash', params: { intensity: 0.9, color: '#FFFFFF' } },
    });
    expect(entries[1]).toEqual(effect().timeline.entries[1]);
  });
});

describe('withTrigger', () => {
  it('replaces the trigger without touching the timeline', () => {
    const before = project();
    const after = withTrigger(before, 'e1', { on: 'held', poseId: 'hi', conditions: [] });
    const result = findEffect(after, 'e1')!;
    expect(result.trigger).toEqual({ on: 'held', poseId: 'hi', conditions: [] });
    expect(result.timeline).toEqual(effect().timeline);
  });
});

describe('createNewEffect (P0.1b — ids must never collide, even across a reload)', () => {
  const poses = [{ poseId: 'dragon' }, { poseId: 'hi' }];

  it('gives a valid default trigger — a real poseId, never empty', () => {
    const created = createNewEffect(project(), poses);
    expect(created.trigger.poseId).toBe('dragon');
    expect(created.trigger.poseId.length).toBeGreaterThan(0);
  });

  it('falls back to an empty poseId only when the dataset has no poses at all', () => {
    const created = createNewEffect(project(), []);
    expect(created.trigger.poseId).toBe('');
  });

  it('creating N effects in sequence yields N unique ids', () => {
    let current = project();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const created = createNewEffect(current, poses);
      expect(ids.has(created.id)).toBe(false);
      ids.add(created.id);
      current = withEffect(current, created);
    }
    expect(ids.size).toBe(10);
  });

  it('never collides with an id the project already has — the exact reload scenario', () => {
    // Simulates: "New Effect" (gets effect-1), reload the page (a module-level counter would
    // reset to 1), "New Effect" again in the freshly reloaded editor. The id must not repeat.
    const withExisting: Project = withEffect(project(), {
      id: 'effect-1',
      name: 'Already saved',
      trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
      timeline: { durationMs: 1, entries: [] },
    });
    const created = createNewEffect(withExisting, poses);
    expect(created.id).not.toBe('effect-1');

    // And the previously-saved effect must survive being "replaced" by the new one — proving
    // this isn't just a differently-named collision that still overwrites something.
    const after = withEffect(withExisting, created);
    expect(findEffect(after, 'effect-1')!.name).toBe('Already saved');
    expect(findEffect(after, created.id)!.name).toBe('New effect');
  });

  it('a project built entirely from createNewEffect stays valid through a full serialize/reload round-trip', () => {
    const registry = createActionRegistry();
    let current = project();
    for (let i = 0; i < 5; i++) {
      current = withEffect(current, createNewEffect(current, poses));
    }
    const wire = serializeCatalog(current.catalog);
    const reloaded = parseCatalog(wire, registry);
    expect(reloaded.effects).toHaveLength(current.catalog.effects.length);
    const ids = reloaded.effects.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('renameProject (item 1/P3)', () => {
  it('replaces the name, leaving id and everything else untouched', () => {
    const before = project();
    const after = renameProject(before, 'New name');
    expect(after.name).toBe('New name');
    expect(after.id).toBe(before.id); // renaming never changes identity
    expect(after.catalog).toBe(before.catalog);
    expect(after.assetLibrary).toBe(before.assetLibrary);
    expect(after.cameraTreatment).toBe(before.cameraTreatment);
  });

  it('trims surrounding whitespace', () => {
    const after = renameProject(project(), '  Padded  ');
    expect(after.name).toBe('Padded');
  });

  it('rejects an empty name', () => {
    expect(() => renameProject(project(), '')).toThrow(InvalidProjectNameError);
  });

  it('rejects a whitespace-only name', () => {
    expect(() => renameProject(project(), '   ')).toThrow(InvalidProjectNameError);
  });

  it('a rejected rename leaves the original project value unaffected', () => {
    const before = project();
    try {
      renameProject(before, '   ');
    } catch {
      // expected
    }
    expect(before.name).toBe('Project 1');
  });
});
