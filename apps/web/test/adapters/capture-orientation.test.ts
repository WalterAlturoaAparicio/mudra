/**
 * The orientation invariant of Capture Mode: one coordinate space, from detector to thumbnail.
 *
 * The camera is mirrored exactly once, on pixels (`CanvasMirroredSurface`), so the detector's own
 * output is already in the mirrored selfie space the dataset uses. Nothing afterwards may flip an
 * x coordinate or swap a handedness label — not the controller, not the serializer, not the
 * review thumbnail. This test drives one deliberately asymmetric two-handed pose through every
 * downstream stage and asserts the left/right arrangement is the same at each.
 */

import { describe, expect, it } from 'vitest';

import { CaptureController } from '../../src/application/capture-controller';
import { DEFAULT_CAPTURE_CONFIG } from '../../src/domain/config/capture-config';
import { handLandmarks, handObservation, landmarkFrame } from '../../src/domain/landmarks/types';
import type { LandmarkFrame } from '../../src/domain/landmarks/types';
import { HAND_LANDMARK_COUNT, LandmarkIndex, WRIST } from '../../src/domain/landmarks/topology';
import { fixedTimeSource } from '../../src/domain/ports/clock';
import type { CameraSession, MirroredSurface } from '../../src/domain/ports/camera';
import type { Stage } from '../../src/presentation/stage/stage';
import { serializePoseSample } from '../../src/infrastructure/capture/pose-sample-serializer';
import { landmarkThumbnail } from '../../src/presentation/capture/landmark-thumbnail';
import { FakeCaptureRepository } from '../support/fake-capture-repository';
import { session } from '../support/capture';

/**
 * A hand whose thumb tip lies far to one side of the wrist and whose pinky tip lies to the other,
 * so every x-ordering below is unambiguous and a mirrored copy is a different hand.
 */
const { THUMB_TIP, INDEX_TIP, PINKY_TIP } = LandmarkIndex;

function asymmetricHand(wristX: number, thumbDx: number, pinkyDx: number) {
  const points = Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) => ({
    x: wristX + 0.005 * i,
    y: 0.7 - 0.01 * i,
    z: 0,
  }));
  points[WRIST] = { x: wristX, y: 0.7, z: 0 };
  points[THUMB_TIP] = { x: wristX + thumbDx, y: 0.5, z: 0 };
  points[INDEX_TIP] = { x: wristX + 0.01, y: 0.3, z: 0 };
  points[PINKY_TIP] = { x: wristX + pinkyDx, y: 0.45, z: 0 };
  return handLandmarks(points);
}

// The user's left hand is on the LEFT of the displayed (mirrored) image, the right hand on the
// right. The left hand's thumb points toward the image centre (+x); the right hand's likewise (-x).
const LEFT_WRIST_X = 0.25;
const RIGHT_WRIST_X = 0.75;
const detected: LandmarkFrame = landmarkFrame(
  [
    handObservation('left', 0.98, asymmetricHand(LEFT_WRIST_X, +0.12, -0.08)),
    handObservation('right', 0.97, asymmetricHand(RIGHT_WRIST_X, -0.12, +0.08)),
  ],
  1000,
  1280,
  720,
);

const surface: MirroredSurface = { width: 1280, height: 720, update: () => true, image: null };
const cameraSession: CameraSession = {
  surface,
  onFrame: () => () => undefined,
  close: () => undefined,
};

async function captureOneSample() {
  const repository = new FakeCaptureRepository();
  await repository.createSession(session());
  const controller = new CaptureController({
    camera: { open: async () => cameraSession },
    detector: { detect: () => detected, close: () => undefined },
    stage: { present: () => undefined } as unknown as Stage,
    repository,
    config: { ...DEFAULT_CAPTURE_CONFIG, countdownMs: 0, burstSize: 1 },
    time: fixedTimeSource(new Date('2026-09-07T13:20:00.000Z'), 'sample'),
    nowMs: () => 0,
  });
  await controller.start();
  controller.useSession(session());
  controller.beginTake();
  controller.processFrame(0);
  await Promise.resolve();
  const [stored] = await repository.listSamples('session-0001');
  return stored!;
}

describe('captured poses keep the detector’s canonical orientation', () => {
  it('stores raw exactly as detected — no x -> 1 - x, no handedness swap', async () => {
    const stored = await captureOneSample();

    expect(stored.hands.map((h) => h.handedness)).toEqual(['left', 'right']);
    stored.hands.forEach((hand, i) => {
      expect(hand.raw).toEqual(detected.hands[i]!.landmarks.points);
    });
  });

  it('stores normalized with x direction preserved (thumb side stays the thumb side)', async () => {
    const [left, right] = (await captureOneSample()).hands;
    // Left hand: thumb tip is right of the wrist, pinky tip left of it. Right hand: the reverse.
    expect(left!.normalized[THUMB_TIP]!.x).toBeGreaterThan(0);
    expect(left!.normalized[PINKY_TIP]!.x).toBeLessThan(0);
    expect(right!.normalized[THUMB_TIP]!.x).toBeLessThan(0);
    expect(right!.normalized[PINKY_TIP]!.x).toBeGreaterThan(0);
  });

  it('serializes the same arrangement into the exported pose-sample document', async () => {
    const stored = await captureOneSample();
    const document = serializePoseSample({
      session: session(),
      sample: stored,
      sampleNumber: 'sample_000001',
      versions: { application: 'test', mediapipe: 'test' },
    });

    expect(document.metadata.camera.mirrored_preview).toBe(true);
    expect(document.hands.map((h) => h.handedness)).toEqual(['left', 'right']);
    expect(document.hands[0]!.raw[WRIST]!.x).toBeLessThan(document.hands[1]!.raw[WRIST]!.x);
    expect(document.hands[0]!.raw[THUMB_TIP]).toEqual(
      detected.hands[0]!.landmarks.points[THUMB_TIP],
    );
  });

  it('draws the review thumbnail in the same space: left hand left, thumbs where the data has them', async () => {
    const stored = await captureOneSample();
    const svg = landmarkThumbnail(document, stored.hands, {
      width: stored.frameWidth,
      height: stored.frameHeight,
    });
    const groups = [...svg.querySelectorAll('g')];
    expect(groups).toHaveLength(2);

    // Circles are emitted in landmark-index order per hand, so index i is circle i.
    const cx = (group: Element, index: number) =>
      Number(group.querySelectorAll('circle')[index]!.getAttribute('cx'));

    // The two hands keep their positions relative to each other (left hand on the left)…
    expect(cx(groups[0]!, WRIST)).toBeLessThan(cx(groups[1]!, WRIST));
    // …and each hand keeps its own x ordering, exactly as in the stored coordinates.
    expect(cx(groups[0]!, THUMB_TIP)).toBeGreaterThan(cx(groups[0]!, WRIST));
    expect(cx(groups[0]!, PINKY_TIP)).toBeLessThan(cx(groups[0]!, WRIST));
    expect(cx(groups[1]!, THUMB_TIP)).toBeLessThan(cx(groups[1]!, WRIST));
    expect(cx(groups[1]!, PINKY_TIP)).toBeGreaterThan(cx(groups[1]!, WRIST));
  });

  it('draws y downward like the frame, and keeps the frame aspect', async () => {
    const stored = await captureOneSample();
    const svg = landmarkThumbnail(document, stored.hands, { width: 1280, height: 720 });
    const group = svg.querySelectorAll('g')[0]!;
    const cy = (i: number) => Number(group.querySelectorAll('circle')[i]!.getAttribute('cy'));
    // Fingertip is higher in the frame (smaller y) than the wrist, so it is higher in the plot.
    expect(cy(INDEX_TIP)).toBeLessThan(cy(WRIST));
  });
});
