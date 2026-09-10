/**
 * A stand-in hand, for previewing effects with no camera attached (item 15).
 *
 * Half the shipped actions are anchored to a hand — a particle burst at a palm's centroid, a
 * trail following a fingertip. With no camera, `EditorRuntimeController` has only an empty
 * `LandmarkFrame`, so those actions resolve no anchor, produce nothing, and are reported as
 * `anchor_unresolved`: correct, honest, and completely useless for judging whether the effect
 * you just authored looks right.
 *
 * This builds a plainly-synthetic hand so preview has something to anchor to. Three rules keep
 * it from becoming a lie:
 *
 * - It is **only** ever used when no camera is attached. A live camera's real hands are the
 *   frame; nothing here is blended with them or substituted for them.
 * - It is **not** recognition input. It never reaches the matcher, never produces a
 *   `RecognitionOutcome`, and never fires a trigger on its own — Test Trigger injects an
 *   explicit `PoseEvent` for that, exactly as before.
 * - It is a **posture**, not a pose. The geometry below is a neutral open hand, deliberately
 *   not any pose in the dataset, because a synthetic hand that happened to resemble a real
 *   pose would be an invitation to read something into it.
 *
 * The gentle motion is a function of time, so a continuous action (a trail) has a path to
 * draw rather than a single stationary point.
 */

import type { HandObservation, Landmark, LandmarkFrame } from '../landmarks/types';
import { handLandmarks, handObservation, landmarkFrame } from '../landmarks/types';

/**
 * A neutral open right hand in normalized `[0,1]` frame space, wrist-down, fingers up.
 *
 * Indices follow MediaPipe's standard hand topology (`domain/landmarks/topology.ts`): 0 wrist,
 * 1–4 thumb, 5–8 index, 9–12 middle, 13–16 ring, 17–20 pinky.
 */
const NEUTRAL_HAND: readonly (readonly [number, number])[] = [
  [0.5, 0.78],
  [0.435, 0.75],
  [0.395, 0.7],
  [0.37, 0.655],
  [0.35, 0.615],
  [0.455, 0.63],
  [0.44, 0.56],
  [0.432, 0.515],
  [0.427, 0.475],
  [0.5, 0.62],
  [0.5, 0.545],
  [0.5, 0.495],
  [0.5, 0.452],
  [0.545, 0.632],
  [0.553, 0.562],
  [0.558, 0.515],
  [0.562, 0.475],
  [0.588, 0.66],
  [0.605, 0.605],
  [0.615, 0.567],
  [0.622, 0.532],
];

/** How far, in normalized units, the stand-in hand drifts as it idles. */
const DRIFT = 0.045;
/** One full drift cycle, in milliseconds. */
const CYCLE_MS = 2600;

/** Build the stand-in hand at `nowMs`. */
export function previewHand(nowMs: number): HandObservation {
  const phase = (nowMs % CYCLE_MS) / CYCLE_MS;
  const dx = Math.sin(phase * Math.PI * 2) * DRIFT;
  const dy = Math.sin(phase * Math.PI * 4) * DRIFT * 0.4;
  const points: Landmark[] = NEUTRAL_HAND.map(([x, y]) => ({ x: x + dx, y: y + dy, z: 0 }));
  return handObservation('right', 1, handLandmarks(points));
}

/**
 * A complete frame containing only the stand-in hand.
 *
 * @param nowMs Drives the idle drift, so a continuous action has a path rather than a point.
 */
export function previewFrame(nowMs: number, width: number, height: number): LandmarkFrame {
  return landmarkFrame([previewHand(nowMs)], nowMs, width, height);
}
