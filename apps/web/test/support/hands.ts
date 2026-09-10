/**
 * Synthetic hands for tests that need *a* hand rather than a particular one.
 *
 * Nothing here is a fixture in the golden-fixture sense: the recorded dataset and Engine's
 * generated cases cover agreement with Engine. These builders exist so a test about
 * anchoring, matching or event timing can say "a hand, here, at this moment" without
 * carrying 21 hand-written coordinates, and so two tests that want *different* hands can
 * ask for them by seed.
 *
 * Every builder is deterministic — no randomness, no clock — so a failure reproduces.
 */

import type {
  HandLandmarks,
  Handedness,
  Landmark,
  LandmarkFrame,
} from '../../src/domain/landmarks/types';
import { handLandmarks, handObservation, landmarkFrame } from '../../src/domain/landmarks/types';
import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';

/** The surface a synthetic frame claims to come from, in device pixels. */
export const DEFAULT_FRAME_WIDTH = 1280;
/** The surface a synthetic frame claims to come from, in device pixels. */
export const DEFAULT_FRAME_HEIGHT = 720;

/**
 * A hand whose 21 points spiral outward from the palm.
 *
 * Curved and non-degenerate, so it exercises the normalizer for real: no two points
 * coincide, the wrist-to-middle-MCP span is comfortably above `DEGENERATE_SPAN`, and the
 * shape is asymmetric enough that a mirrored or index-shuffled hand is a different hand.
 *
 * `seed` rotates the spiral. Two different seeds are two different poses, which is what
 * tests about "a nearer exemplar wins" rely on.
 */
export function spiralHand(seed = 0): HandLandmarks {
  const points: Landmark[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i += 1) {
    const angle = seed + i * 0.7;
    const radius = 0.02 + i * 0.012;
    points.push({
      x: 0.5 + radius * Math.cos(angle),
      y: 0.5 + radius * Math.sin(angle),
      z: (i - 10) * 0.004,
    });
  }
  return handLandmarks(points);
}

/**
 * A hand whose points lie on a straight ray from the wrist, scaled by `scale`.
 *
 * The shape is fixed and only its size changes with `scale`, so `linearHand(s, 1)` and
 * `linearHand(s, 2.5)` are the same hand at two distances — exactly the pair a scale
 * invariance test needs. `seed` tilts the ray, so different seeds are different shapes.
 */
export function linearHand(seed = 0, scale = 1): HandLandmarks {
  const dx = Math.cos(seed + 0.3) * 0.01;
  const dy = Math.sin(seed + 0.3) * 0.01;
  const points: Landmark[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i += 1) {
    points.push({
      x: 0.2 + scale * i * dx,
      y: 0.8 + scale * i * dy,
      z: scale * i * 0.002,
    });
  }
  return handLandmarks(points);
}

/** The same hand moved in frame. Returns a new hand; the input is untouched. */
export function translated(hand: HandLandmarks, dx: number, dy: number): HandLandmarks {
  return handLandmarks(hand.points.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z })));
}

/** One hand in a synthetic frame, named the way tests read most clearly. */
export interface SyntheticHand {
  readonly handedness: Handedness;
  readonly landmarks: HandLandmarks;
  /** Defaults to full confidence — tests that care about it say so. */
  readonly confidence?: number;
}

/**
 * A {@link LandmarkFrame} carrying `hands` at `timestampMs`.
 *
 * The surface defaults to 1280×720 because anchor resolution scales normalized landmark
 * coordinates by it, and a test that never mentions a surface still needs a real one.
 */
export function frameOf(
  hands: readonly SyntheticHand[],
  timestampMs: number,
  width = DEFAULT_FRAME_WIDTH,
  height = DEFAULT_FRAME_HEIGHT,
): LandmarkFrame {
  return landmarkFrame(
    hands.map((h) => handObservation(h.handedness, h.confidence ?? 1, h.landmarks)),
    timestampMs,
    width,
    height,
  );
}
