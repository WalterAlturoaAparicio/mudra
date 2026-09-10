/**
 * Why a clip would, or would not, do anything (item 14).
 *
 * One function answers this for the inspector, the timeline clip, and the project tree, so the
 * three can never disagree — which is the whole point, and what these assertions pin down. The
 * ordering matters as much as the individual verdicts: an unregistered or schema-invalid action
 * is reported before anything else, because every later check would be reading values that may
 * not mean what they appear to.
 */

import { describe, expect, it } from 'vitest';

import { evaluateActionStatus, worstStatus } from '../../src/domain/editor/action-status';
import type { ActionDescriptor } from '../../src/domain/runtime/action-registry';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { MapCapabilityRegistry, PERSON_SEGMENTATION } from '../../src/domain/runtime/capabilities';

const registry = createActionRegistry();
const withSegmentation = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, true]]));
const withoutSegmentation = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]]));

function statusOf(
  actionType: string,
  params: Record<string, string | number | boolean> = {},
  options: {
    durationMs?: number;
    capabilities?: typeof withSegmentation;
    resolveAsset?: (reference: string) => string | null;
    diagnostics?: readonly { reason: 'asset_unresolved' | 'anchor_unresolved'; detail: string }[];
  } = {},
) {
  return evaluateActionStatus({
    actionType,
    descriptor: registry.get(actionType),
    params,
    durationMs: options.durationMs ?? 500,
    capabilities: options.capabilities ?? withSegmentation,
    resolveAsset: options.resolveAsset ?? (() => 'resolved'),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
  });
}

describe('ready', () => {
  it('a fully configured action with a duration is ready, and says nothing further', () => {
    const status = statusOf('screen_flash');
    expect(status.kind).toBe('ready');
    expect(status.detail).toBe('');
  });
});

describe('configuration problems', () => {
  it('an unregistered action type is invalid, and names the type', () => {
    const status = evaluateActionStatus({
      actionType: 'not_a_real_action',
      descriptor: undefined,
      params: {},
      capabilities: withSegmentation,
    });
    expect(status.kind).toBe('invalid_configuration');
    expect(status.detail).toContain('not_a_real_action');
  });

  it('an out-of-range parameter is invalid, with the schema’s own message', () => {
    const status = statusOf('screen_flash', { intensity: 99 });
    expect(status.kind).toBe('invalid_configuration');
    expect(status.detail).toContain('intensity');
  });

  it('a zero-length duration-behaviour clip needs configuration — it is never active', () => {
    const status = statusOf('background_wash', {}, { durationMs: 0 });
    expect(status.kind).toBe('needs_configuration');
    expect(status.detail).toMatch(/zero milliseconds/);
  });

  it('an instantaneous action is exempt from the duration check', () => {
    expect(statusOf('play_audio', {}, { durationMs: 0 }).kind).toBe('ready');
  });
});

describe('assets', () => {
  it('an unresolvable reference is a missing asset, and names it', () => {
    const status = statusOf('play_audio', { asset: '@audio/gone' }, { resolveAsset: () => null });
    expect(status.kind).toBe('missing_asset');
    expect(status.detail).toContain('@audio/gone');
  });

  it('an optional asset left as "none" is not a problem', () => {
    const status = statusOf(
      'person_visibility',
      { mode: 'replace_background', asset: '' },
      { resolveAsset: () => null },
    );
    expect(status.kind).toBe('ready');
  });

  it('a runtime asset_unresolved diagnostic is reported even when the reference resolves now', () => {
    const status = statusOf(
      'play_audio',
      {},
      { diagnostics: [{ reason: 'asset_unresolved', detail: '@audio/flash' }] },
    );
    expect(status.kind).toBe('missing_asset');
  });
});

describe('capabilities', () => {
  it('outranks everything below it — the action would not run even with the asset present', () => {
    const status = statusOf(
      'person_visibility',
      { mode: 'replace_person', asset: '@image/gone' },
      { capabilities: withoutSegmentation, resolveAsset: () => null },
    );
    expect(status.kind).toBe('capability_unavailable');
    expect(status.detail).toContain(PERSON_SEGMENTATION);
    // Explicitly reassuring: it is an environment fact, not an authoring mistake.
    expect(status.detail).toMatch(/editable/);
  });
});

describe('anchors', () => {
  it('an unresolved anchor is reported, and explains the stand-in hand', () => {
    const status = statusOf(
      'particle_burst',
      {},
      { diagnostics: [{ reason: 'anchor_unresolved', detail: 'hand "left" is not in frame' }] },
    );
    expect(status.kind).toBe('needs_configuration');
    expect(status.detail).toContain('hand "left" is not in frame');
  });
});

describe('worstStatus — what an effect-level row shows', () => {
  it('is ready only when every action is', () => {
    expect(worstStatus([statusOf('screen_flash'), statusOf('play_audio')]).kind).toBe('ready');
  });

  it('reports the most serious problem among its actions', () => {
    const statuses = [
      statusOf('screen_flash'),
      statusOf('play_audio', { asset: '@audio/gone' }, { resolveAsset: () => null }),
      statusOf('screen_flash', { intensity: 99 }),
    ];
    expect(worstStatus(statuses).kind).toBe('invalid_configuration');
  });

  it('an effect with no actions is ready — an empty container is not broken', () => {
    expect(worstStatus([]).kind).toBe('ready');
  });
});

describe('extensibility', () => {
  it('a newly registered action gets meaningful status with no change to this evaluation', () => {
    const descriptor: ActionDescriptor = {
      type: 'test_status_action',
      behaviour: 'duration',
      params: [
        {
          name: 'picture',
          kind: 'asset',
          assetPrefix: '@image/',
          defaultValue: '@image/none',
          description: 'An image nobody shipped.',
        },
      ],
      update: () => ({ commands: [] }),
    };
    const extended = createActionRegistry([descriptor]);
    const status = evaluateActionStatus({
      actionType: descriptor.type,
      descriptor: extended.get(descriptor.type),
      params: {},
      durationMs: 100,
      capabilities: withSegmentation,
      resolveAsset: () => null,
    });
    expect(status.kind).toBe('missing_asset');
  });
});
