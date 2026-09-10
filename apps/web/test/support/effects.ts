/**
 * Builders for exercising the effect runtime with no browser present.
 *
 * The runtime's whole claim is that it is a pure function of (playbacks, elapsed time,
 * frame) — so a test needs nothing but literals to drive it. That is what these are.
 */

import type {
  Action,
  Condition,
  EffectCatalog,
  EffectDefinition,
  TimelineEntry,
  TriggerEventKind,
} from '../../src/domain/effects/types';
import type { PoseEvent } from '../../src/domain/events/pose-events';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import type { ActionRegistry } from '../../src/domain/runtime/action-registry';
import { MapCapabilityRegistry, PERSON_SEGMENTATION } from '../../src/domain/runtime/capabilities';
import type { CapabilityRegistry } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';

/** A pose event, with sensible defaults. */
export function poseEvent(
  kind: TriggerEventKind,
  poseId: string,
  atMs = 0,
  confidence = 0.9,
): PoseEvent {
  return { kind, poseId, confidence, atMs, progress: kind === 'confirmed' ? 1 : 0.5 };
}

/** A timeline entry. */
export function entry(atMs: number, action: Action, durationMs?: number): TimelineEntry {
  return durationMs === undefined ? { atMs, action } : { atMs, durationMs, action };
}

/** An effect definition. */
export function effect(options: {
  id: string;
  poseId: string;
  on?: TriggerEventKind;
  conditions?: readonly Condition[];
  durationMs: number;
  entries: readonly TimelineEntry[];
  name?: string;
}): EffectDefinition {
  return {
    id: options.id,
    name: options.name ?? options.id,
    trigger: {
      on: options.on ?? 'confirmed',
      poseId: options.poseId,
      conditions: options.conditions ?? [],
    },
    timeline: { durationMs: options.durationMs, entries: options.entries },
  };
}

/** A catalog holding the given effects, in order. */
export function catalog(...effects: EffectDefinition[]): EffectCatalog {
  return { version: 1, effects };
}

/** A capability registry with `person_segmentation` unavailable, as shipped. */
export function shippedCapabilities(): CapabilityRegistry {
  return new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]]));
}

/** A capability registry where everything asked for is available. */
export function allCapabilities(): CapabilityRegistry {
  return {
    has: () => true,
    all: () => [{ name: PERSON_SEGMENTATION, available: true }],
  };
}

/** Build a runtime over the shipped action registry. */
export function runtimeFor(
  effects: EffectCatalog,
  options: {
    registry?: ActionRegistry;
    capabilities?: CapabilityRegistry;
    resolveAsset?: (reference: string) => string | null;
  } = {},
): EffectRuntime {
  return new EffectRuntime({
    catalog: effects,
    registry: options.registry ?? createActionRegistry(),
    capabilities: options.capabilities ?? shippedCapabilities(),
    resolveAsset: options.resolveAsset ?? ((reference) => '/fake' + reference),
  });
}
