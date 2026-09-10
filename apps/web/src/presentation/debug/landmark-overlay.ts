/**
 * The landmark overlay: 21 points per hand, the skeleton, and the handedness label.
 *
 * Emitted as **render commands**, not drawn directly. The overlay is presentation, so it
 * *could* draw — but expressing it in the same vocabulary means the debug view goes
 * through the same renderer as everything else, and an alternative renderer inherits it
 * for free instead of needing a second implementation.
 *
 * Points are in mirrored display space already, so they land on the hand as the user sees
 * it. That is the visible half of scenario 3: if landmarks appear horizontally opposite
 * the hand, mirroring has regressed.
 */

import type { RendererConfig } from '../../domain/config/session-config';
import { HAND_CONNECTIONS } from '../../domain/landmarks/topology';
import type { LandmarkFrame } from '../../domain/landmarks/types';
import type { Point, RenderCommand } from '../../domain/runtime/frame-output';

/** Colour per hand, so left and right are distinguishable at a glance. */
const HAND_COLORS: Readonly<Record<string, string>> = {
  left: '#6EE7F9',
  right: '#FFD166',
  unknown: '#B9A7FF',
};

/** Build the overlay's commands for one frame. */
export function landmarkOverlayCommands(
  frame: LandmarkFrame,
  renderer: RendererConfig,
  width: number,
  height: number,
): readonly RenderCommand[] {
  const commands: RenderCommand[] = [];

  for (const hand of frame.hands) {
    const color = HAND_COLORS[hand.handedness] ?? HAND_COLORS['unknown']!;
    const points: Point[] = hand.landmarks.points.map((point) => ({
      x: point.x * width,
      y: point.y * height,
    }));

    for (const [from, to] of HAND_CONNECTIONS) {
      const a = points[from];
      const b = points[to];
      if (a === undefined || b === undefined) {
        continue;
      }
      commands.push({
        kind: 'drawPolyline',
        points: [a, b],
        width: renderer.connectionWidth,
        color: '#FFFFFF',
        alpha: 0.55,
      });
    }

    commands.push({
      kind: 'drawCircles',
      points,
      radii: points.map(() => renderer.landmarkRadius),
      color,
      alpha: 0.95,
    });
  }

  return commands;
}

/** The handedness labels for the DOM panel, which is where text belongs. */
export function handednessLabels(frame: LandmarkFrame): readonly string[] {
  return frame.hands.map(
    (hand) => hand.handedness + ' (' + hand.confidence.toFixed(2) + ')',
  );
}
