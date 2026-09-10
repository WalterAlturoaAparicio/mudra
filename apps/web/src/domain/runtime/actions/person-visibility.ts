/**
 * `person_visibility` — capability-gated compositing against the live person mask (FR-042,
 * FR-046, FR-047, research D8; items 2 and 3).
 *
 * Milestone 1 reserved this action and declared `person_segmentation` permanently
 * unavailable, so it was permanently inert. Milestone 2 made availability a real,
 * runtime-probed question and gave the action a genuine per-pixel erase. This pass gives it
 * the other two things a segmentation mask is actually *for*, still without ever faking one:
 *
 * - `opacity` — erase the person, proportionally to the mask (unchanged; the default).
 * - `replace_person` — paint an image or colour **inside** the person's own region.
 * - `replace_background` — paint an image or colour **outside** it, leaving the person alone.
 *
 * Every one of those is a region-scoped command. This action still emits no `fillScreen` and
 * no `drawCamera`: a full-frame fill over the top would cover the person, which is precisely
 * the substitute FR-046 forbids and `test/architecture/no-fake-segmentation.test.ts` catches.
 * "Keep the person, change the background" is correct here because the *renderer* clips to the
 * inverse of the mask — not because this action draws something and hopes.
 *
 * Nothing here carries pixels. An image is named by a **logical** reference (`@image/…`),
 * resolved through `ActionContext.resolveAsset` exactly as `play_audio` resolves a sound; an
 * unresolvable reference is reported and the effect carries on (FR-064) rather than silently
 * painting something else.
 */

import type { ActionContext, ActionDescriptor, ActionOutput } from '../action-registry';
import { PERSON_SEGMENTATION } from '../capabilities';
import type { DrawMaskedImageCommand, RenderCommand } from '../frame-output';
import { numberParam, stringParam } from '../param-schema';

/** How the action treats the segmented person. */
type VisibilityMode = 'opacity' | 'replace_person' | 'replace_background';

const REGION_FOR: Readonly<Record<VisibilityMode, 'person' | 'background'>> = {
  opacity: 'person',
  replace_person: 'person',
  replace_background: 'background',
};

/** The registration record for `person_visibility`. */
export const personVisibilityAction: ActionDescriptor = {
  type: 'person_visibility',
  behaviour: 'duration',
  requiresCapability: PERSON_SEGMENTATION,
  params: [
    {
      name: 'mode',
      kind: 'enum',
      defaultValue: 'opacity',
      values: ['opacity', 'replace_person', 'replace_background'],
      description:
        'opacity: fade the person out. replace_person: paint over the person’s own region. ' +
        'replace_background: keep the person and paint everything else.',
    },
    {
      name: 'opacity',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 1,
      visibleWhen: { param: 'mode', values: ['opacity'] },
      description: 'How visible the person is — 1 = fully visible, 0 = fully erased.',
    },
    {
      name: 'intensity',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 1,
      visibleWhen: { param: 'mode', values: ['replace_person', 'replace_background'] },
      description:
        'How strongly the replacement covers its region — 1 hides what was there, lower ' +
        'values let it show through.',
    },
    {
      name: 'asset',
      kind: 'asset',
      defaultValue: '',
      assetPrefix: '@image/',
      allowEmpty: true,
      visibleWhen: { param: 'mode', values: ['replace_person', 'replace_background'] },
      description:
        'The image painted into the region. Leave it as None to paint a flat colour instead.',
    },
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#101014',
      visibleWhen: { param: 'mode', values: ['replace_person', 'replace_background'] },
      description: 'The colour painted into the region when no image is chosen.',
    },
    {
      name: 'fit',
      kind: 'enum',
      defaultValue: 'cover',
      values: ['cover', 'contain', 'stretch'],
      visibleWhen: { param: 'mode', values: ['replace_person', 'replace_background'] },
      description: 'How the image is scaled into the frame before it is clipped to the region.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    // The runtime already skips this action, with a `capability_unavailable` diagnostic,
    // when `person_segmentation` is unavailable — this line is never reached in that case.
    // `context.segmentation` being null here would be a runtime inconsistency, not a normal
    // path, so it is treated the same way: inert, and reported, never a silent no-op.
    if (context.segmentation === null) {
      return {
        commands: [],
        diagnostics: [{ reason: 'capability_unavailable', detail: PERSON_SEGMENTATION }],
      };
    }

    const mode = (stringParam(context.params, 'mode') || 'opacity') as VisibilityMode;
    const region = REGION_FOR[mode] ?? 'person';

    if (mode === 'opacity') {
      const opacity = numberParam(context.params, 'opacity');
      return {
        commands: [{ kind: 'maskedErase', region: 'person', alpha: 1 - opacity }],
      };
    }

    const intensity = numberParam(context.params, 'intensity');
    if (intensity <= 0) {
      return { commands: [] };
    }

    const reference = stringParam(context.params, 'asset');
    if (reference === '') {
      const commands: readonly RenderCommand[] = [
        {
          kind: 'fillMaskedRegion',
          region,
          color: stringParam(context.params, 'color'),
          alpha: intensity,
        },
      ];
      return { commands };
    }

    const source = context.resolveAsset(reference);
    if (source === null) {
      // Reported, and nothing drawn — never quietly substituted with the colour, which would
      // look like the effect working and hide a broken reference (FR-064).
      return {
        commands: [],
        diagnostics: [{ reason: 'asset_unresolved', detail: reference }],
      };
    }

    const fit = stringParam(context.params, 'fit') as DrawMaskedImageCommand['fit'];
    return {
      commands: [{ kind: 'drawMaskedImage', region, source, alpha: intensity, fit }],
    };
  },
};
