/**
 * FR-072: every action type resolves, and every descriptor carries enough metadata for a
 * future editor to build a control without knowing the action.
 *
 * The second half is the one that would rot quietly. A descriptor whose parameter schema
 * drifted from what its `update` actually reads would still work — right up until an editor
 * tried to generate a form from it, which is a milestone away and would be far too late to
 * notice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHIPPED_ACTIONS, createActionRegistry } from '../../src/domain/runtime/actions';
import { RegistryError } from '../../src/domain/runtime/action-registry';
import { parseCatalog } from '../../src/infrastructure/effects/catalog-loader';
import { APP_ROOT } from '../support/source-scan';

const registry = createActionRegistry();

const shippedCatalog = parseCatalog(
  JSON.parse(readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8')) as unknown,
  createActionRegistry(),
);

describe('the shipped catalog against the shipped registry', () => {
  it('resolves every action type it uses', () => {
    for (const effect of shippedCatalog.effects) {
      for (const entry of effect.timeline.entries) {
        expect(
          registry.get(entry.action.type),
          effect.id + ' uses ' + entry.action.type,
        ).toBeDefined();
      }
    }
  });
});

describe('every registered descriptor', () => {
  it('exposes a parameter schema', () => {
    for (const descriptor of registry.all()) {
      expect(Array.isArray(descriptor.params), descriptor.type).toBe(true);
    }
  });

  it('gives every parameter a name, a kind, a default, and a description', () => {
    for (const descriptor of registry.all()) {
      for (const spec of descriptor.params) {
        const where = descriptor.type + '.' + spec.name;
        expect(spec.name, where).toBeTruthy();
        expect(spec.kind, where).toBeTruthy();
        expect(spec.defaultValue, where).toBeDefined();
        // The description is what a future editor puts in a tooltip; a blank one makes the
        // metadata technically present and practically useless.
        expect(spec.description.length, where).toBeGreaterThan(5);
      }
    }
  });

  it('bounds every numeric parameter, so a control has a range to draw', () => {
    for (const descriptor of registry.all()) {
      for (const spec of descriptor.params) {
        if (spec.kind === 'number') {
          const where = descriptor.type + '.' + spec.name;
          expect(spec.min, where).toBeDefined();
          expect(spec.max, where).toBeDefined();
          expect(spec.min!).toBeLessThan(spec.max!);
        }
      }
    }
  });

  it('lists the values of every enum parameter', () => {
    for (const descriptor of registry.all()) {
      for (const spec of descriptor.params) {
        if (spec.kind === 'enum') {
          expect(spec.values, descriptor.type + '.' + spec.name).toBeDefined();
          expect(spec.values!.length).toBeGreaterThan(1);
          expect(spec.values).toContain(spec.defaultValue);
        }
      }
    }
  });

  it('gives every asset parameter a required prefix (FR-062)', () => {
    for (const descriptor of registry.all()) {
      for (const spec of descriptor.params) {
        if (spec.kind === 'asset') {
          expect(spec.assetPrefix, descriptor.type + '.' + spec.name).toMatch(/^@/);
          // An `allowEmpty` asset parameter (`person_visibility.asset`) may default to the
          // empty string — its representable "none chosen" — but to nothing else unprefixed:
          // a physical path as a default would be exactly the FR-062 violation this checks.
          const isNone = spec.allowEmpty === true && spec.defaultValue === '';
          expect(
            isNone || String(spec.defaultValue).startsWith(spec.assetPrefix!),
            descriptor.type + '.' + spec.name,
          ).toBe(true);
        }
      }
    }
  });

  it('has a default that satisfies its own schema', () => {
    for (const descriptor of registry.all()) {
      for (const spec of descriptor.params) {
        const where = descriptor.type + '.' + spec.name;
        if (spec.kind === 'number') {
          expect(spec.defaultValue, where).toBeGreaterThanOrEqual(spec.min!);
          expect(spec.defaultValue, where).toBeLessThanOrEqual(spec.max!);
        }
        if (spec.kind === 'color') {
          expect(String(spec.defaultValue), where).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
        }
      }
    }
  });
});

describe('the shipped action set', () => {
  it('covers all three behaviour classes (FR-056)', () => {
    const behaviours = new Set(SHIPPED_ACTIONS.map((a) => a.behaviour));
    expect(behaviours).toEqual(new Set(['instantaneous', 'duration', 'continuous']));
  });

  it('registers each type exactly once', () => {
    const types = SHIPPED_ACTIONS.map((a) => a.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('the registry itself', () => {
  it('refuses a duplicate registration rather than silently replacing', () => {
    const fresh = createActionRegistry();
    expect(() => fresh.register(SHIPPED_ACTIONS[0]!)).toThrow(RegistryError);
  });

  it('names the effect and lists the alternatives when a type is unknown', () => {
    expect(() => registry.require('nope', 'some.effect')).toThrow(
      /Effect "some\.effect" uses unknown action type "nope"\. Registered types: /,
    );
  });

  it('is constructed, never shared — two registries are independent', () => {
    const a = createActionRegistry();
    const b = createActionRegistry();
    a.register({
      type: 'only_in_a',
      behaviour: 'instantaneous',
      params: [],
      update: () => ({ commands: [] }),
    });
    expect(a.get('only_in_a')).toBeDefined();
    expect(b.get('only_in_a')).toBeUndefined();
  });
});
