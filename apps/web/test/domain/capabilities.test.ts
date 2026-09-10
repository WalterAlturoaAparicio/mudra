/**
 * FR-077/FR-078, SC-011: an unavailable capability is inert, reported, and not fatal.
 *
 * The distinction being defended is between *no output* and *no explanation*. An action
 * that produced nothing and said nothing would look like a broken effect; the whole reason
 * `person_visibility` exists in this milestone is to make a known absence visible rather
 * than to make a feature present.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import {
  MapCapabilityRegistry,
  PERSON_SEGMENTATION,
  defaultCapabilities,
} from '../../src/domain/runtime/capabilities';
import { personVisibilityAction } from '../../src/domain/runtime/actions/person-visibility';
import { SHIPPED_ACTIONS } from '../../src/domain/runtime/actions';
import {
  allCapabilities,
  catalog,
  effect,
  entry,
  poseEvent,
  runtimeFor,
} from '../support/effects';

const emptyFrame = landmarkFrame([], 0, 1280, 720);

const visibility = { type: 'person_visibility', params: { opacity: 0.3 } };
const flash = { type: 'screen_flash', params: { color: '#FFFFFF' } };

describe('the shipped capability registry', () => {
  it('declares person_segmentation, and declares it unavailable', () => {
    const capabilities = defaultCapabilities();
    expect(capabilities.has(PERSON_SEGMENTATION)).toBe(false);
    // Listed, not absent: a capability nobody had declared would be indistinguishable from
    // one nobody had thought about.
    expect(capabilities.all()).toEqual([{ name: PERSON_SEGMENTATION, available: false }]);
  });

  it('reports an unknown capability as unavailable rather than throwing', () => {
    expect(defaultCapabilities().has('something_else')).toBe(false);
  });
});

describe('person_visibility', () => {
  it('is the only shipped action requiring a capability', () => {
    const requiring = SHIPPED_ACTIONS.filter((a) => a.requiresCapability !== undefined);
    expect(requiring.map((a) => a.type)).toEqual(['person_visibility']);
    expect(personVisibilityAction.requiresCapability).toBe(PERSON_SEGMENTATION);
  });

  it('produces no commands and one diagnostic (FR-077)', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'e.reserved', poseId: 'p', durationMs: 500, entries: [entry(0, visibility, 500)] }),
      ),
    );
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);

    expect(output.commands).toEqual([]);
    expect(output.diagnostics).toEqual([
      {
        effectId: 'e.reserved',
        actionType: 'person_visibility',
        reason: 'capability_unavailable',
        detail: PERSON_SEGMENTATION,
      },
    ]);
  });

  it('never appears to succeed, on any frame of its window', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'e', poseId: 'p', durationMs: 600, entries: [entry(0, visibility, 600)] }),
      ),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    for (const t of [100, 300, 500]) {
      const output = runtime.advance([], emptyFrame, t);
      expect(output.commands).toEqual([]);
      expect(output.diagnostics).toHaveLength(1);
    }
  });

  it('does not abort the rest of the effect (FR-078, SC-011)', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.mixed',
          poseId: 'p',
          durationMs: 500,
          entries: [entry(0, visibility, 500), entry(0, flash, 500)],
        }),
      ),
    );

    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(output.commands).toHaveLength(1);
    expect(output.commands[0]!.kind).toBe('fillScreen');
    expect(output.diagnostics).toHaveLength(1);
  });

  it('produces nothing even if the capability were somehow available', () => {
    // Acquiring segmentation is separately-authorized work. If a future registry declared
    // the capability present without that work having been done, this action must still
    // not pretend — it would be worse to half-do it than to leave it reserved.
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 400, entries: [entry(0, visibility, 400)] })),
      { capabilities: allCapabilities() },
    );
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(output.commands).toEqual([]);
    expect(output.diagnostics[0]!.reason).toBe('capability_unavailable');
  });
});

describe('capability gating in general', () => {
  it('gates any action that declares a requirement, not just the shipped one', () => {
    const registry = new MapCapabilityRegistry(new Map([['some_capability', false]]));
    expect(registry.has('some_capability')).toBe(false);
    expect(registry.all()).toEqual([{ name: 'some_capability', available: false }]);
  });

  it('lets an action through when its capability is available', () => {
    const registry = new MapCapabilityRegistry(new Map([['some_capability', true]]));
    expect(registry.has('some_capability')).toBe(true);
  });
});
