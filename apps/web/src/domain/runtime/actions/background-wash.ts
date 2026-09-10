/**
 * `background_wash` — a full-surface colour composited **over** the camera view (FR-053).
 *
 * Over, never behind. The user is the camera image; a wash drawn behind it would be
 * invisible, and a wash that replaced it would be a background *replacement*, which is
 * segmentation and explicitly out of scope for this milestone.
 *
 * Duration-based, with in and out transitions so it arrives and leaves rather than
 * snapping. The transitions are expressed as fractions of the wash's own duration, so an
 * author changing `duration_ms` gets a proportionally longer fade for free.
 */

import type { ActionContext, ActionDescriptor, ActionOutput } from '../action-registry';
import type { BlendMode } from '../frame-output';
import { numberParam, stringParam } from '../param-schema';

/** The registration record for `background_wash`. */
export const backgroundWashAction: ActionDescriptor = {
  type: 'background_wash',
  behaviour: 'duration',
  params: [
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#2B2D6E',
      description: 'Colour washed over the camera view.',
    },
    {
      name: 'opacity',
      kind: 'number',
      defaultValue: 0.5,
      min: 0,
      max: 1,
      description: 'Opacity at the wash’s plateau, between its transitions.',
    },
    {
      name: 'blend',
      kind: 'enum',
      defaultValue: 'normal',
      values: ['normal', 'add', 'multiply', 'screen'],
      description: 'How the wash combines with the camera view beneath it.',
    },
    {
      name: 'fadeInFraction',
      kind: 'number',
      defaultValue: 0.2,
      min: 0,
      max: 1,
      description: 'Fraction of the wash spent fading in.',
    },
    {
      name: 'fadeOutFraction',
      kind: 'number',
      defaultValue: 0.3,
      min: 0,
      max: 1,
      description: 'Fraction of the wash spent fading out.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    const opacity = numberParam(context.params, 'opacity');
    const fadeIn = numberParam(context.params, 'fadeInFraction');
    const fadeOut = numberParam(context.params, 'fadeOutFraction');
    const progress = context.progress;

    let envelope = 1;
    if (fadeIn > 0 && progress < fadeIn) {
      envelope = progress / fadeIn;
    } else if (fadeOut > 0 && progress > 1 - fadeOut) {
      envelope = (1 - progress) / fadeOut;
    }

    const alpha = opacity * clamp01(envelope);
    if (alpha <= 0) {
      return { commands: [] };
    }

    return {
      commands: [
        {
          kind: 'fillScreen',
          color: stringParam(context.params, 'color'),
          alpha,
          blend: stringParam(context.params, 'blend') as BlendMode,
        },
      ],
    };
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
