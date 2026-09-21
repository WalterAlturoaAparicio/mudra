/**
 * The FaceMark overlay (Spec 011 development gate): the face-mesh points and, prominently, each
 * face-anchored action's resolved landmark — answering "is landmark 33 where I expect it?" and
 * "does it follow me when I move?".
 *
 * Render commands only, through the same `Stage.present()` overlay slot the hand overlay uses.
 * Observational: it draws what the runtime already resolved (`AnchorResolver`'s own point) and
 * whatever face the pipeline already analysed; it never asks for either. Editor-only — nothing
 * here is reachable from Capture Mode.
 */

import type { FaceFrame } from '../../domain/landmarks/face';
import type { FaceAnchorTrace } from '../../domain/runtime/effect-runtime';
import type { Point, RenderCommand } from '../../domain/runtime/frame-output';

const MESH_COLOR = '#FF7AC6';
const ANCHOR_COLOR = '#7CFFB2';

/** Commands for one frame: the mesh if a fresh face is available, plus a marker per resolved
 *  face anchor. `face` may be `null` (no fresh analysis) and `anchors` empty; both are normal. */
export function faceOverlayCommands(
  face: FaceFrame | null,
  anchors: readonly FaceAnchorTrace[],
): readonly RenderCommand[] {
  const commands: RenderCommand[] = [];

  if (face !== null) {
    const points: Point[] = face.points.map((p) => ({ x: p.x * face.width, y: p.y * face.height }));
    commands.push({
      kind: 'drawCircles',
      points,
      radii: points.map(() => 1.5),
      color: MESH_COLOR,
      alpha: 0.45,
    });
  }

  for (const anchor of anchors) {
    if (!anchor.resolved || anchor.point === null) {
      continue;
    }
    const { x, y } = anchor.point;
    const arm = 14;
    commands.push(
      {
        kind: 'drawPolyline',
        points: [
          { x: x - arm, y },
          { x: x + arm, y },
        ],
        width: 2,
        color: ANCHOR_COLOR,
        alpha: 0.95,
      },
      {
        kind: 'drawPolyline',
        points: [
          { x, y: y - arm },
          { x, y: y + arm },
        ],
        width: 2,
        color: ANCHOR_COLOR,
        alpha: 0.95,
      },
      { kind: 'drawCircles', points: [{ x, y }], radii: [7], color: ANCHOR_COLOR, alpha: 0.9 },
    );
  }
  return commands;
}
