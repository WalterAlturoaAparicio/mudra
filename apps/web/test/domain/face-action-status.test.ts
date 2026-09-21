/**
 * A face anchor makes *this instance* unavailable when `face_landmarks` is (Spec 011 FR-006).
 *
 * The same action type must read as `ready` with a hand or screen anchor and as
 * `capability_unavailable` with a face anchor — decided from the anchor's kind, never from the
 * action type — and the badge must agree with what the runtime does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateActionStatus } from '../../src/domain/editor/action-status';
import type { ParamValue } from '../../src/domain/effects/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import { APP_ROOT } from '../support/source-scan';

const registry = createActionRegistry();
const faceOn = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));
const faceOff = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, false]]));
const faceAbsent = new MapCapabilityRegistry(new Map());

function statusOf(
  actionType: string,
  anchor: ParamValue,
  capabilities: MapCapabilityRegistry,
): ReturnType<typeof evaluateActionStatus> {
  return evaluateActionStatus({
    actionType,
    descriptor: registry.get(actionType),
    params: { anchor },
    durationMs: 800,
    capabilities,
    resolveAsset: () => 'resolved',
  });
}

const face: ParamValue = { kind: 'faceLandmark', index: 1 };
const hand: ParamValue = { kind: 'landmark', hand: 'first', index: 8 };
const screen: ParamValue = { kind: 'screen', x: 0.5, y: 0.5 };

describe('the same action type, different anchors', () => {
  for (const type of ['landmark_trail', 'particle_burst']) {
    it(`${type}: unavailable with a face anchor when face_landmarks is, ready with any other`, () => {
      const unavailable = statusOf(type, face, faceOff);
      expect(unavailable.kind).toBe('capability_unavailable');
      expect(unavailable.detail).toContain(FACE_LANDMARKS);

      expect(statusOf(type, hand, faceOff).kind).toBe('ready');
      expect(statusOf(type, screen, faceOff).kind).toBe('ready');
    });

    it(`${type}: ready with a face anchor when face_landmarks is available`, () => {
      expect(statusOf(type, face, faceOn).kind).toBe('ready');
    });

    it(`${type}: unavailable when no face capability is registered at all (public experience)`, () => {
      expect(statusOf(type, face, faceAbsent).kind).toBe('capability_unavailable');
    });
  }
});

describe('no branch keyed on an action type', () => {
  it('action-status.ts names neither anchored action', () => {
    const source = readFileSync(join(APP_ROOT, 'src/domain/editor/action-status.ts'), 'utf-8');
    expect(source).not.toMatch(/landmark_trail|particle_burst/);
  });
});
