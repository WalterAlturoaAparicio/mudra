/**
 * `play_audio` — emits an {@link AudioCue}. It never calls `play()` (FR-054a, research D6).
 *
 * Sound is not drawing, so a cue is not a render command. But letting the runtime start
 * playback directly would break the same rule for the same reason: an irreversible side
 * effect inside a pure scheduler, and untestable headlessly. The cue is a value; a
 * separate audio sink consumes it.
 *
 * The asset is a **logical** reference (`@audio/…`), resolved through the manifest. An
 * unresolvable reference is reported and the effect carries on (FR-064) — a missing sound
 * should not take a visual effect down with it.
 */

import type { ActionContext, ActionDescriptor, ActionOutput } from '../action-registry';
import { numberParam, stringParam } from '../param-schema';

/** The registration record for `play_audio`. */
export const playAudioAction: ActionDescriptor = {
  type: 'play_audio',
  behaviour: 'instantaneous',
  params: [
    {
      name: 'asset',
      kind: 'asset',
      defaultValue: '@audio/flash',
      assetPrefix: '@audio/',
      description: 'Logical identifier of the sound to play.',
    },
    {
      name: 'volume',
      kind: 'number',
      defaultValue: 0.8,
      min: 0,
      max: 1,
      description: 'Playback volume.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    // Only on the frame it fires. Re-emitting on every frame of a window would restart
    // the sound continuously, which is the classic way an instantaneous cue becomes a buzz.
    if (!context.justFired) {
      return { commands: [] };
    }

    const reference = stringParam(context.params, 'asset');
    if (context.resolveAsset(reference) === null) {
      return {
        commands: [],
        diagnostics: [{ reason: 'asset_unresolved', detail: reference }],
      };
    }

    return {
      commands: [],
      audioCues: [{ asset: reference, volume: numberParam(context.params, 'volume') }],
    };
  },
};
