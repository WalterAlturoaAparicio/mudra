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

/** Viewport the normalized coordinates are fitted into. */
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

function boundsOf(hands: readonly CaptureHand[]): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const hand of hands) {
    for (const point of hand.normalized) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  return bounds;
}

/** Fit the normalized cloud into the viewport, preserving aspect. */
function projector(bounds: Bounds): (point: Landmark) => { x: number; y: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const span = Math.max(spanX, spanY);
  // A collapsed hand (the degenerate-span case) would divide by zero; centre it instead.
  const scale = span > 1e-9 ? (SIZE - PADDING * 2) / span : 0;
  const offsetX = (SIZE - spanX * scale) / 2;
  const offsetY = (SIZE - spanY * scale) / 2;
  return (point) => ({
    x: (point.x - bounds.minX) * scale + offsetX,
    y: (point.y - bounds.minY) * scale + offsetY,
  });
}

/**
 * Build an SVG rendering of one sample's hands.
 *
 * @param document The owning document; injected so this stays testable without a global.
 */
export function landmarkThumbnail(document: Document, hands: readonly CaptureHand[]): SVGElement {
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

  const project = projector(boundsOf(hands));

  hands.forEach((hand, index) => {
    const colour = HAND_COLOURS[index % HAND_COLOURS.length]!;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('stroke', colour);
    group.setAttribute('fill', colour);

    for (const [from, to] of HAND_CONNECTIONS) {
      const a = hand.normalized[from];
      const b = hand.normalized[to];
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

    for (const point of hand.normalized) {
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
