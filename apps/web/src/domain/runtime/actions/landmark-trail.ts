/**
 * `landmark_trail` — a line following a live landmark (FR-055).
 *
 * The one **continuous** action: it is re-resolved every frame against the live hand, so
 * it tracks the user rather than replaying a recorded path. That is what makes it the
 * action that proves the third behaviour class actually exists.
 *
 * It keeps its own history in the per-playback scratch space the runtime hands it, rather
 * than in module state — two concurrent trails on two hands must not share a tail.
 */

import type { ActionContext, ActionDescriptor, ActionOutput } from '../action-registry';
import type { Point } from '../frame-output';
import { numberParam, stringParam } from '../param-schema';

interface TrailState {
  points: Point[];
}

function trailState(context: ActionContext): TrailState {
  const existing = context.state['trail'];
  if (existing !== undefined) {
    return existing as TrailState;
  }
  const created: TrailState = { points: [] };
  context.state['trail'] = created;
  return created;
}

/** The registration record for `landmark_trail`. */
export const landmarkTrailAction: ActionDescriptor = {
  type: 'landmark_trail',
  behaviour: 'continuous',
  params: [
    {
      name: 'anchor',
      kind: 'anchor',
      defaultValue: { kind: 'landmark', hand: 'first', index: 8 },
      description: 'The landmark the trail follows.',
    },
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#6EE7F9',
      description: 'Colour of the trail.',
    },
    {
      name: 'width',
      kind: 'number',
      defaultValue: 6,
      min: 0.5,
      max: 100,
      description: 'Stroke width of the trail in pixels.',
    },
    {
      name: 'length',
      kind: 'number',
      defaultValue: 24,
      min: 2,
      max: 400,
      description: 'How many past positions the trail remembers.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    const anchor = context.anchor;
    if (anchor === null) {
      return { commands: [] };
    }

    const state = trailState(context);
    const length = Math.round(numberParam(context.params, 'length'));

    const last = state.points[state.points.length - 1];
    // Skip a duplicate point: a stationary hand would otherwise fill the whole history
    // with one position and the trail would vanish the moment it moved again.
    if (last === undefined || last.x !== anchor.x || last.y !== anchor.y) {
      state.points.push(anchor);
    }
    while (state.points.length > length) {
      state.points.shift();
    }

    if (state.points.length < 2) {
      return { commands: [] };
    }

    return {
      commands: [
        {
          kind: 'drawPolyline',
          points: [...state.points],
          width: numberParam(context.params, 'width'),
          color: stringParam(context.params, 'color'),
          alpha: 1 - 0.4 * context.progress,
        },
      ],
    };
  },
};
