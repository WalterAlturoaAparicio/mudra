/**
 * Which capability an *authored anchor* needs (Spec 011).
 *
 * `ActionDescriptor.requiresCapability` is decided per action **type**. A face anchor is a
 * parameter **value**: `landmark_trail` with a hand anchor needs nothing, the same action with a
 * face anchor needs `face_landmarks`. So the requirement is read off the anchor, by kind — never
 * off the action type and never by a face-specific action.
 *
 * Pure and framework-free. The runtime uses it to gate an action instance, and the editor's
 * action-status uses it to badge one, so the two cannot disagree.
 */

import { FACE_LANDMARKS } from '../runtime/capabilities';
import type { Anchor } from './types';

/**
 * The capability `anchor` requires, or `undefined` when it requires none.
 *
 * Screen and hand anchors need no capability, so every existing use of every existing action is
 * unaffected.
 */
export function requiredCapabilityOf(anchor: Anchor): string | undefined {
  return anchor.kind === 'faceLandmark' ? FACE_LANDMARKS : undefined;
}
