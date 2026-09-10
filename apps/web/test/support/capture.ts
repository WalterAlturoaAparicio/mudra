/**
 * Builders for capture test data, so each test states only what it is about.
 *
 * Mirrors `test/support/hands.ts`'s role for the recognition suites.
 */

import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';
import { handLandmarks, handObservation, landmarkFrame } from '../../src/domain/landmarks/types';
import type { Handedness, LandmarkFrame } from '../../src/domain/landmarks/types';
import { normalize } from '../../src/domain/normalization/normalize';
import { captureHand } from '../../src/domain/capture/types';
import type { CaptureHand, CaptureSample, CaptureSession } from '../../src/domain/capture/types';

/** 21 deterministic, distinct, finite points. */
export function points(seed = 0): { x: number; y: number; z: number }[] {
  return Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) => ({
    x: 0.1 + (i + seed) * 0.01,
    y: 0.2 + (i + seed) * 0.015,
    z: (i + seed) * 0.001,
  }));
}

/** A frame with `handCount` well-formed hands. */
export function frameWith(handCount: number, seed = 0): LandmarkFrame {
  const hands = Array.from({ length: handCount }, (_, i) =>
    handObservation(
      (i === 0 ? 'right' : 'left') as Handedness,
      0.99,
      handLandmarks(points(seed + i * 3)),
    ),
  );
  return landmarkFrame(hands, 1000, 1280, 720);
}

/** A capture hand built through the real normalizer, never a second one. */
export function hand(handedness: Handedness = 'right', seed = 0): CaptureHand {
  const raw = handLandmarks(points(seed));
  return captureHand(handedness, 0.99, raw.points, normalize(raw).points, HAND_LANDMARK_COUNT);
}

/** An active session with sane defaults; override anything the test is about. */
export function session(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'session-0001',
    contributorLabel: 'walter',
    poseId: 'dragon',
    displayName: 'dragon',
    requiredHands: 2,
    status: 'active',
    startedAt: '2026-09-07T13:19:56.400000+00:00',
    sampleCount: 0,
    discardedCount: 0,
    ...overrides,
  };
}

/** A stored sample with sane defaults. */
export function sample(overrides: Partial<CaptureSample> = {}): CaptureSample {
  return {
    id: 'sample-0001',
    sessionId: 'session-0001',
    capturedAt: '2026-09-07T13:20:00.100000+00:00',
    frameWidth: 1280,
    frameHeight: 720,
    countdownStartedAt: '2026-09-07T13:19:57.100000+00:00',
    countdownSeconds: 3,
    countdownEnabled: true,
    hands: [hand('right', 0), hand('left', 3)],
    ...overrides,
  };
}
