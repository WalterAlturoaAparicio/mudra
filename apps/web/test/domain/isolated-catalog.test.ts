/**
 * Effect isolation during editing (FR-024 – FR-027, spec 010 "Editing scope").
 *
 * `isolatedCatalog` is the whole of the isolation mechanism: a pure filter from the project's
 * full catalog down to at most the one effect currently selected for editing. Nothing here
 * decides *whether* a pose triggers an effect — that is still `EffectRuntime.startTriggered()`,
 * unmodified — this only decides which effects that matching is even allowed to consider.
 */

import { describe, expect, it } from 'vitest';

import { isolatedCatalog } from '../../src/domain/editor/isolated-catalog';
import type { EffectCatalog, EffectDefinition } from '../../src/domain/effects/types';

function effect(id: string, poseId: string): EffectDefinition {
  return {
    id,
    name: id,
    trigger: { on: 'confirmed', poseId, conditions: [] },
    timeline: { durationMs: 300, entries: [] },
  };
}

function catalog(...effects: EffectDefinition[]): EffectCatalog {
  return { version: 1, effects };
}

describe('isolatedCatalog (editing scope)', () => {
  it('returns only the selected effect when it exists in the catalog', () => {
    const alpha = effect('alpha', 'open-palm');
    const beta = effect('beta', 'fist');
    const result = isolatedCatalog(catalog(alpha, beta), 'beta');
    expect(result.effects).toEqual([beta]);
  });

  it('returns an empty catalog when nothing is selected', () => {
    const result = isolatedCatalog(catalog(effect('alpha', 'open-palm')), null);
    expect(result.effects).toEqual([]);
  });

  it('returns an empty catalog, never a throw, when the selected id names no effect', () => {
    const result = isolatedCatalog(catalog(effect('alpha', 'open-palm')), 'nonexistent');
    expect(result.effects).toEqual([]);
  });

  it('preserves the catalog version', () => {
    const alpha = effect('alpha', 'open-palm');
    expect(isolatedCatalog({ version: 7, effects: [alpha] }, 'alpha').version).toBe(7);
  });

  it('is pure — the input catalog is never mutated', () => {
    const alpha = effect('alpha', 'open-palm');
    const beta = effect('beta', 'fist');
    const original = catalog(alpha, beta);
    const before = JSON.stringify(original);
    isolatedCatalog(original, 'alpha');
    expect(JSON.stringify(original)).toBe(before);
  });

  it('two effects sharing a pose stay isolated by identity, not by pose', () => {
    const duplicate = effect('alpha-copy', 'open-palm');
    const original = effect('alpha', 'open-palm');
    const result = isolatedCatalog(catalog(original, duplicate), 'alpha');
    expect(result.effects).toEqual([original]);
  });
});
