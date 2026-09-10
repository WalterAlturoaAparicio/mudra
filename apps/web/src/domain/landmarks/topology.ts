/**
 * Hand landmark topology constants — a port of Engine's `engine/models/topology.py`.
 *
 * Defines the fixed 21-point hand model and the skeleton edges used for drawing,
 * independent of any detection backend (constitution Principle I). Centralizing these
 * removes magic numbers from the renderer and the normalizer alike (Principle IV).
 *
 * The indices are MediaPipe Hands ordering and are **not** free to change: the recorded
 * dataset, Engine's exemplar bundles and this module all agree on them, and a divergence
 * would silently mis-normalize every hand rather than fail loudly.
 */

/** The fixed number of landmarks per hand. */
export const HAND_LANDMARK_COUNT = 21;

/** Named indices for the 21 hand landmarks (MediaPipe Hands ordering). */
export const LandmarkIndex = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** The normalization origin: every normalized hand puts this point on `(0,0,0)`. */
export const WRIST: number = LandmarkIndex.WRIST;

/**
 * The normalization scale reference — the wrist-to-middle-MCP span.
 *
 * Named separately from `LandmarkIndex.MIDDLE_MCP` because the normalizer's contract is
 * about *this* role, not about which finger happens to fill it.
 */
export const MIDDLE_FINGER_MCP: number = LandmarkIndex.MIDDLE_MCP;

/**
 * The five fingertips, in thumb-to-pinky order.
 *
 * They move the most between poses and so carry the most shape information, which is why
 * the default landmark weights lift them above every other point.
 */
export const FINGERTIPS: readonly number[] = [
  LandmarkIndex.THUMB_TIP,
  LandmarkIndex.INDEX_TIP,
  LandmarkIndex.MIDDLE_TIP,
  LandmarkIndex.RING_TIP,
  LandmarkIndex.PINKY_TIP,
];

/** Edges of the hand skeleton as `[startIndex, endIndex]` pairs. */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  // Thumb
  [LandmarkIndex.WRIST, LandmarkIndex.THUMB_CMC],
  [LandmarkIndex.THUMB_CMC, LandmarkIndex.THUMB_MCP],
  [LandmarkIndex.THUMB_MCP, LandmarkIndex.THUMB_IP],
  [LandmarkIndex.THUMB_IP, LandmarkIndex.THUMB_TIP],
  // Index finger
  [LandmarkIndex.WRIST, LandmarkIndex.INDEX_MCP],
  [LandmarkIndex.INDEX_MCP, LandmarkIndex.INDEX_PIP],
  [LandmarkIndex.INDEX_PIP, LandmarkIndex.INDEX_DIP],
  [LandmarkIndex.INDEX_DIP, LandmarkIndex.INDEX_TIP],
  // Middle finger
  [LandmarkIndex.MIDDLE_MCP, LandmarkIndex.MIDDLE_PIP],
  [LandmarkIndex.MIDDLE_PIP, LandmarkIndex.MIDDLE_DIP],
  [LandmarkIndex.MIDDLE_DIP, LandmarkIndex.MIDDLE_TIP],
  // Ring finger
  [LandmarkIndex.RING_MCP, LandmarkIndex.RING_PIP],
  [LandmarkIndex.RING_PIP, LandmarkIndex.RING_DIP],
  [LandmarkIndex.RING_DIP, LandmarkIndex.RING_TIP],
  // Pinky
  [LandmarkIndex.WRIST, LandmarkIndex.PINKY_MCP],
  [LandmarkIndex.PINKY_MCP, LandmarkIndex.PINKY_PIP],
  [LandmarkIndex.PINKY_PIP, LandmarkIndex.PINKY_DIP],
  [LandmarkIndex.PINKY_DIP, LandmarkIndex.PINKY_TIP],
  // Palm
  [LandmarkIndex.INDEX_MCP, LandmarkIndex.MIDDLE_MCP],
  [LandmarkIndex.MIDDLE_MCP, LandmarkIndex.RING_MCP],
  [LandmarkIndex.RING_MCP, LandmarkIndex.PINKY_MCP],
];
