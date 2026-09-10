/**
 * Authoring operations added in this pass, and the round trip that proves they persist.
 *
 * - `renameEffect` (item 11) — the edit `EffectDefinition.name` never had.
 * - `selectedClipEffect` (item 15) — what "Play Selected" actually plays.
 * - Save/reload of everything new: the extended particle configuration, `person_visibility`'s
 *   modes, and an optional asset left as "none". A parameter that cannot survive its own wire
 *   format is not configurable, however good the inspector looks.
 */

import { describe, expect, it } from 'vitest';

import { InvalidEffectNameError, renameEffect } from '../../src/domain/editor/project-edits';
import {
  SELECTED_CLIP_ID_SUFFIX,
  selectedClipEffect,
} from '../../src/domain/editor/playback-selection';
import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import type { EffectDefinition } from '../../src/domain/effects/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { parseProject, serializeProject } from '../../src/infrastructure/persistence/project-schema';

const registry = createActionRegistry();

function projectWith(effects: readonly EffectDefinition[]): Project {
  return createProject({ version: 1, effects }, 'p1', 'A project', 1000);
}

const twoClipEffect: EffectDefinition = {
  id: 'e1',
  name: 'Original name',
  trigger: { on: 'confirmed', poseId: 'somepose', conditions: [] },
  timeline: {
    durationMs: 1200,
    entries: [
      { atMs: 0, durationMs: 300, action: { type: 'screen_flash', params: {} } },
      { atMs: 800, durationMs: 400, action: { type: 'background_wash', params: {} } },
    ],
  },
};

describe('renameEffect (item 11)', () => {
  it('changes the name and nothing else', () => {
    const renamed = renameEffect(projectWith([twoClipEffect]), 'e1', 'A better name');
    const effect = renamed.catalog.effects[0]!;

    expect(effect.name).toBe('A better name');
    expect(effect.id).toBe('e1');
    expect(effect.trigger).toEqual(twoClipEffect.trigger);
    expect(effect.timeline).toEqual(twoClipEffect.timeline);
  });

  it('trims surrounding whitespace', () => {
    expect(renameEffect(projectWith([twoClipEffect]), 'e1', '  Spaced  ').catalog.effects[0]!.name).toBe(
      'Spaced',
    );
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => renameEffect(projectWith([twoClipEffect]), 'e1', '')).toThrow(
      InvalidEffectNameError,
    );
    expect(() => renameEffect(projectWith([twoClipEffect]), 'e1', '   ')).toThrow(
      InvalidEffectNameError,
    );
  });

  it('leaves every other effect untouched, and is a no-op for an unknown id', () => {
    const second: EffectDefinition = { ...twoClipEffect, id: 'e2', name: 'Second' };
    const project = projectWith([twoClipEffect, second]);

    expect(renameEffect(project, 'e1', 'Renamed').catalog.effects[1]).toEqual(second);
    expect(renameEffect(project, 'nope', 'Renamed')).toBe(project);
  });

  it('two effects may end up with the same name; their ids stay distinct', () => {
    const project = projectWith([twoClipEffect, { ...twoClipEffect, id: 'e2', name: 'Second' }]);
    const renamed = renameEffect(project, 'e2', 'Original name');

    expect(renamed.catalog.effects.map((effect) => effect.name)).toEqual([
      'Original name',
      'Original name',
    ]);
    expect(new Set(renamed.catalog.effects.map((effect) => effect.id)).size).toBe(2);
  });
});

describe('selectedClipEffect (item 15)', () => {
  it('contains only the chosen clip, rebased to start immediately', () => {
    const clip = selectedClipEffect(twoClipEffect, 1)!;

    expect(clip.timeline.entries).toHaveLength(1);
    expect(clip.timeline.entries[0]!.atMs).toBe(0);
    expect(clip.timeline.entries[0]!.action.type).toBe('background_wash');
    // The clip's own length is preserved exactly; only when it starts changed.
    expect(clip.timeline.entries[0]!.durationMs).toBe(400);
    expect(clip.timeline.durationMs).toBe(400);
  });

  it('is identifiable in diagnostics, without colliding with the authored effect', () => {
    const clip = selectedClipEffect(twoClipEffect, 0)!;
    expect(clip.id).toBe('e1' + SELECTED_CLIP_ID_SUFFIX);
    expect(clip.id).not.toBe(twoClipEffect.id);
  });

  it('never mutates the effect it was derived from', () => {
    const before = JSON.stringify(twoClipEffect);
    selectedClipEffect(twoClipEffect, 1);
    expect(JSON.stringify(twoClipEffect)).toBe(before);
  });

  it('is null for an index that names no clip, so the command can be disabled', () => {
    expect(selectedClipEffect(twoClipEffect, 9)).toBeNull();
    expect(
      selectedClipEffect({ ...twoClipEffect, timeline: { durationMs: 1, entries: [] } }, 0),
    ).toBeNull();
  });

  it('gives a zero-length clip a playable minimum, rather than a timeline of length 0', () => {
    const instant: EffectDefinition = {
      ...twoClipEffect,
      timeline: {
        durationMs: 10,
        entries: [{ atMs: 5, action: { type: 'play_audio', params: {} } }],
      },
    };
    expect(selectedClipEffect(instant, 0)!.timeline.durationMs).toBe(1);
  });
});

describe('everything new survives save and reload', () => {
  function roundTrip(project: Project): Project {
    return parseProject(JSON.parse(JSON.stringify(serializeProject(project))), registry);
  }

  it('the full particle configuration', () => {
    const params = {
      count: 77,
      directionDeg: 210,
      arcDeg: 45,
      spread: 512,
      speedVariation: 0.7,
      gravity: -300,
      swirlDeg: 180,
      radius: 4,
      endScale: 2,
      color: '#123456',
      colorMix: 'alternate',
      colorEnd: '#abcdef',
      startOpacity: 0.8,
      endOpacity: 0.2,
      lifetimeFraction: 0.6,
      emissionFraction: 0.4,
      randomness: 0.9,
      seed: 314,
      anchor: { kind: 'handCentroid', hand: 'first' },
    } as const;
    const project = projectWith([
      {
        id: 'e1',
        name: 'Burst',
        trigger: { on: 'confirmed', poseId: 'somepose', conditions: [] },
        timeline: {
          durationMs: 900,
          entries: [{ atMs: 0, durationMs: 900, action: { type: 'particle_burst', params } }],
        },
      },
    ]);

    const reloaded = roundTrip(project);
    expect(reloaded.catalog.effects[0]!.timeline.entries[0]!.action.params).toEqual(params);
  });

  it('person_visibility’s replacement modes, image and colour', () => {
    const project = projectWith([
      {
        id: 'e1',
        name: 'Backdrop',
        trigger: { on: 'confirmed', poseId: 'somepose', conditions: [] },
        timeline: {
          durationMs: 500,
          entries: [
            {
              atMs: 0,
              durationMs: 500,
              action: {
                type: 'person_visibility',
                params: {
                  mode: 'replace_background',
                  intensity: 0.9,
                  asset: '@image/beach',
                  color: '#204060',
                  fit: 'contain',
                },
              },
            },
          ],
        },
      },
    ]);

    const reloaded = roundTrip(project);
    expect(reloaded.catalog.effects[0]!.timeline.entries[0]!.action.params).toEqual({
      mode: 'replace_background',
      intensity: 0.9,
      asset: '@image/beach',
      color: '#204060',
      fit: 'contain',
    });
  });

  it('an optional asset left as "none" — the state that used to be unrepresentable', () => {
    const project = projectWith([
      {
        id: 'e1',
        name: 'Colour backdrop',
        trigger: { on: 'confirmed', poseId: 'somepose', conditions: [] },
        timeline: {
          durationMs: 500,
          entries: [
            {
              atMs: 0,
              durationMs: 500,
              action: {
                type: 'person_visibility',
                params: { mode: 'replace_person', asset: '', color: '#000000' },
              },
            },
          ],
        },
      },
    ]);

    const reloaded = roundTrip(project);
    expect(reloaded.catalog.effects[0]!.timeline.entries[0]!.action.params['asset']).toBe('');
  });

  it('an effect renamed but never re-identified reloads under its original id', () => {
    const renamed = renameEffect(projectWith([twoClipEffect]), 'e1', 'Renamed before saving');
    const reloaded = roundTrip(renamed);

    expect(reloaded.catalog.effects[0]!.id).toBe('e1');
    expect(reloaded.catalog.effects[0]!.name).toBe('Renamed before saving');
  });
});
