/**
 * The action types this milestone ships.
 *
 * A list, not a switch. Adding an action means adding a descriptor and a line here — and
 * nothing in the timeline scheduler, the event system, or the renderer changes (FR-073).
 * `test/domain/registry-extensibility.test.ts` proves that by registering a *new* action
 * through this same registry and watching it get scheduled and rendered.
 *
 * The set demonstrates all three behaviour classes rather than three variations of one
 * (FR-056): instantaneous (`screen_flash`, `play_audio`), duration (`background_wash`,
 * `particle_burst`), and continuous (`landmark_trail`).
 */

import { ActionRegistry } from '../action-registry';
import type { ActionDescriptor } from '../action-registry';
import { backgroundWashAction } from './background-wash';
import { landmarkTrailAction } from './landmark-trail';
import { particleBurstAction } from './particle-burst';
import { personVisibilityAction } from './person-visibility';
import { playAudioAction } from './play-audio';
import { screenFlashAction } from './screen-flash';

/** Every descriptor this milestone ships, in a stable order. */
export const SHIPPED_ACTIONS: readonly ActionDescriptor[] = [
  screenFlashAction,
  backgroundWashAction,
  particleBurstAction,
  landmarkTrailAction,
  playAudioAction,
  personVisibilityAction,
];

/** Build a registry holding the shipped actions. */
export function createActionRegistry(extra: readonly ActionDescriptor[] = []): ActionRegistry {
  const registry = new ActionRegistry();
  for (const descriptor of [...SHIPPED_ACTIONS, ...extra]) {
    registry.register(descriptor);
  }
  return registry;
}

export {
  backgroundWashAction,
  landmarkTrailAction,
  particleBurstAction,
  personVisibilityAction,
  playAudioAction,
  screenFlashAction,
};
