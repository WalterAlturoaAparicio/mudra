/**
 * Anchors resolved centrally, once per frame, never by actions (FR-058–FR-060, D9).
 *
 * Two things follow from doing it here rather than inside each action. A new anchor kind
 * benefits every existing action without touching one of them. And there is exactly one
 * place to define what happens when an anchor cannot be resolved (FR-061), rather than
 * each action inventing its own fallback.
 *
 * **The documented unresolvable behaviour**: the action holds its last resolved position;
 * if it never resolved one, the action is skipped for that frame and the reason is
 * reported in diagnostics. Holding the last position is what stops a trail from snapping
 * to the origin when a hand blinks out for two frames.
 */

import type { FaceFrame } from '../landmarks/face';
import type { LandmarkFrame, HandObservation } from '../landmarks/types';
import type { Point } from '../runtime/frame-output';
import type { Anchor, HandSelector } from './types';

/** The result of trying to resolve one anchor. */
export interface AnchorResolution {
  /** The point to use, or `null` when there is none and none was remembered. */
  readonly point: Point | null;
  /** `true` when the point came from memory rather than from this frame. */
  readonly stale: boolean;
  /** Set when the anchor could not be resolved; names what was missing. */
  readonly unresolvedDetail?: string;
}

function selectHand(frame: LandmarkFrame, selector: HandSelector): HandObservation | undefined {
  if (selector === 'any' || selector === 'first') {
    return frame.hands[0];
  }
  return frame.hands.find((hand) => hand.handedness === selector);
}

function centroid(hand: HandObservation, width: number, height: number): Point {
  let sx = 0;
  let sy = 0;
  for (const point of hand.landmarks.points) {
    sx += point.x;
    sy += point.y;
  }
  const count = hand.landmarks.points.length;
  return { x: (sx / count) * width, y: (sy / count) * height };
}

/**
 * Remembers the last point each anchor resolved to.
 *
 * One instance per playback, so two concurrent effects anchored to the same hand never
 * share a memory and never inherit one another's staleness.
 */
export class AnchorResolver {
  private readonly lastKnown = new Map<string, Point>();

  /**
   * Resolve `anchor` against `frame`.
   *
   * @param key Identifies the anchor within this playback, so two actions anchored
   *   differently keep separate memories.
   * @param face This frame's face, or `null` when there is none. Consulted **only** for a
   *   `faceLandmark` anchor; every other kind ignores it. It is transient and never stored
   *   here — only the resolved point is remembered.
   */
  resolve(
    key: string,
    anchor: Anchor,
    frame: LandmarkFrame,
    face: FaceFrame | null = null,
  ): AnchorResolution {
    const width = frame.width;
    const height = frame.height;

    if (anchor.kind === 'screen') {
      // A screen anchor is in normalized surface coordinates, so it survives a resize with
      // the effect still where the author put it (FR-011).
      const point = { x: anchor.x * width, y: anchor.y * height };
      this.lastKnown.set(key, point);
      return { point, stale: false };
    }

    if (anchor.kind === 'faceLandmark') {
      if (face === null) {
        return this.fallback(key, 'face is not in frame');
      }
      const landmark = face.points[anchor.index];
      if (landmark === undefined) {
        // Outside what the detected face has: no point. Never clamped, wrapped or remapped to
        // another landmark, and never fabricated (spec D21, FR-015c).
        return this.fallback(key, 'face landmark ' + anchor.index + ' does not exist');
      }
      // Scaled by the face's own surface size, in the same mirrored space as hands — no flip.
      const point = { x: landmark.x * face.width, y: landmark.y * face.height };
      this.lastKnown.set(key, point);
      return { point, stale: false };
    }

    const hand = selectHand(frame, anchor.hand);
    if (hand === undefined) {
      return this.fallback(key, 'hand "' + anchor.hand + '" is not in frame');
    }

    if (anchor.kind === 'handCentroid') {
      const point = centroid(hand, width, height);
      this.lastKnown.set(key, point);
      return { point, stale: false };
    }

    const landmark = hand.landmarks.points[anchor.index];
    if (landmark === undefined) {
      return this.fallback(key, 'landmark ' + anchor.index + ' does not exist');
    }
    const point = { x: landmark.x * width, y: landmark.y * height };
    this.lastKnown.set(key, point);
    return { point, stale: false };
  }

  /** Forget every remembered position — for a playback ending. */
  clear(): void {
    this.lastKnown.clear();
  }

  private fallback(key: string, detail: string): AnchorResolution {
    const remembered = this.lastKnown.get(key);
    if (remembered !== undefined) {
      return { point: remembered, stale: true };
    }
    return { point: null, stale: false, unresolvedDetail: detail };
  }
}

/** A stable key for one action's anchor within a playback. */
export function anchorKey(entryIndex: number, paramName: string): string {
  return entryIndex + ':' + paramName;
}
