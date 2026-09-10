/**
 * `screen_flash` — a burst of colour over the whole surface (FR-052).
 *
 * Instantaneous in **scheduling**: it fires once at its `atMs`. Its `duration_ms` governs
 * the decay curve it renders over, which is the distinction FR-048 draws between when an
 * action starts and how long its output persists.
 *
 * The decay is `(1 − progress)²` rather than linear, because a linear fade reads as a slab
 * of colour sliding away while a quadratic one reads as a flash.
 */

import type { ActionContext, ActionDescriptor, ActionOutput } from '../action-registry';
import { numberParam, stringParam } from '../param-schema';

/** The registration record for `screen_flash`. */
export const screenFlashAction: ActionDescriptor = {
  type: 'screen_flash',
  behaviour: 'instantaneous',
  params: [
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#FFFFFF',
      description: 'Colour of the flash.',
    },
    {
      name: 'intensity',
      kind: 'number',
      defaultValue: 0.85,
      min: 0,
      max: 1,
      description: 'Peak opacity of the flash, at its start.',
    },
    {
      name: 'blend',
      kind: 'enum',
      defaultValue: 'add',
      values: ['normal', 'add', 'multiply', 'screen'],
      description: 'How the flash combines with the camera view beneath it.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    const intensity = numberParam(context.params, 'intensity');
    const decay = 1 - context.progress;
    const alpha = intensity * decay * decay;
    if (alpha <= 0) {
      return { commands: [] };
    }
    return {
      commands: [
        {
          kind: 'fillScreen',
          color: stringParam(context.params, 'color'),
          alpha,
          blend: stringParam(context.params, 'blend') as 'normal' | 'add' | 'multiply' | 'screen',
        },
      ],
    };
  },
};
