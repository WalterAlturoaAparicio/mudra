/**
 * A stored sample, drawn from its coordinates as inline SVG (research D8, FR-052).
 *
 * Sample review shows the operator what they recorded — but a *picture* of what they recorded is
 * exactly what Capture Mode may never keep. So the thumbnail is built from the landmark numbers
 * already in the store, as vector output, touching no canvas API at all.
 *
 * That makes the review list fully testable in jsdom, and it means there is structurally no place a
 * camera pixel could appear in it: this module has no access to a surface, a frame, or an image.
 */

import { HAND_CONNECTIONS } from '../../domain/landmarks/topology';
import type { Landmark } from '../../domain/landmarks/types';
import type { CaptureHand } from '../../domain/capture/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The source frame's size, so raw `[0,1]` coordinates keep their real aspect ratio. */
export interface ThumbnailFrame {
  readonly width: number;
  readonly height: number;
}

/** Viewport the coordinates are fitted into. */
const SIZE = 72;
const PADDING = 6;

/** Colours per hand, so a two-handed sample is legible at thumbnail size. */
const HAND_COLOURS = ['#7cc7ff', '#ffb37c'];

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A point in frame pixels: `raw` scaled by the frame, never flipped. */
function framePoint(point: Landmark, frame: ThumbnailFrame): { x: number; y: number } {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

function boundsOf(hands: readonly CaptureHand[], frame: ThumbnailFrame): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const hand of hands) {
    for (const landmark of hand.raw) {
      const point = framePoint(landmark, frame);
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  return bounds;
}

/** Fit the frame-space cloud into the viewport, preserving aspect. Translation and uniform scale only. */
function projector(
  bounds: Bounds,
  frame: ThumbnailFrame,
): (point: Landmark) => { x: number; y: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const span = Math.max(spanX, spanY);
  // A collapsed hand (the degenerate-span case) would divide by zero; centre it instead.
  const scale = span > 1e-9 ? (SIZE - PADDING * 2) / span : 0;
  const offsetX = (SIZE - spanX * scale) / 2;
  const offsetY = (SIZE - spanY * scale) / 2;
  return (landmark) => {
    const point = framePoint(landmark, frame);
    return {
      x: (point.x - bounds.minX) * scale + offsetX,
      y: (point.y - bounds.minY) * scale + offsetY,
    };
  };
}

/**
 * Build an SVG rendering of one sample's hands.
 *
 * Plots each hand's `raw` landmarks, which are in the mirrored frame space the live view and its
 * overlay use. Nothing is flipped here, and no handedness or landmark index is touched: a point
 * left of another in the live view is left of it in the thumbnail, and two hands keep their
 * positions relative to each other. (`normalized` is wrist-relative, so plotting it stacked every
 * hand on one origin and lost the arrangement of a two-handed pose.)
 *
 * @param document The owning document; injected so this stays testable without a global.
 * @param frame The sample's source frame size; defaults to square when unknown.
 */
export function landmarkThumbnail(
  document: Document,
  hands: readonly CaptureHand[],
  frame: ThumbnailFrame = { width: 1, height: 1 },
): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.setAttribute('class', 'capture-thumbnail');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    hands.length === 1 ? 'Landmark plot, one hand' : `Landmark plot, ${hands.length} hands`,
  );

  if (hands.length === 0) {
    return svg;
  }

  const project = projector(boundsOf(hands, frame), frame);

  hands.forEach((hand, index) => {
    const colour = HAND_COLOURS[index % HAND_COLOURS.length]!;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('stroke', colour);
    group.setAttribute('fill', colour);

    for (const [from, to] of HAND_CONNECTIONS) {
      const a = hand.raw[from];
      const b = hand.raw[to];
      if (a === undefined || b === undefined) {
        continue;
      }
      const start = project(a);
      const end = project(b);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', start.x.toFixed(2));
      line.setAttribute('y1', start.y.toFixed(2));
      line.setAttribute('x2', end.x.toFixed(2));
      line.setAttribute('y2', end.y.toFixed(2));
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0.55');
      group.appendChild(line);
    }

    for (const point of hand.raw) {
      const projected = project(point);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', projected.x.toFixed(2));
      dot.setAttribute('cy', projected.y.toFixed(2));
      dot.setAttribute('r', '1.4');
      group.appendChild(dot);
    }

    svg.appendChild(group);
  });

  return svg;
}
