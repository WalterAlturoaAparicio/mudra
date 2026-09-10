/**
 * Using an asset from an action (item 17's "use it from action inspectors").
 *
 * The asset library and the inspector meet at exactly one place — the `asset`-kind control —
 * and what has to be true there is small but easy to get wrong: pick by **name**, write a
 * **logical reference**, never a filename or a path (FR-034, FR-035, FR-062); and, for a
 * parameter that is genuinely optional, offer a "None" that is a real, round-trippable value
 * rather than a reference that fails to resolve on purpose.
 */

import { describe, expect, it } from 'vitest';

import type { AssetLibraryEntry } from '../../src/domain/editor/types';
import type { ParamSpec } from '../../src/domain/runtime/action-registry';
import type { ParamValue } from '../../src/domain/effects/types';
import { renderControl } from '../../src/presentation/editor/inspector-controls';

const LIBRARY: readonly AssetLibraryEntry[] = [
  { reference: '@image/beach', displayName: 'Beach photo', kind: 'image', storageKey: 'k1' },
  { reference: '@image/wall', displayName: 'Brick wall', kind: 'image', storageKey: 'k2' },
  { reference: '@audio/whoosh', displayName: 'Whoosh', kind: 'audio', storageKey: 'k3' },
];

const IMAGE_SPEC: ParamSpec = {
  name: 'asset',
  kind: 'asset',
  defaultValue: '',
  assetPrefix: '@image/',
  allowEmpty: true,
  description: 'The image painted into the region.',
};

const AUDIO_SPEC: ParamSpec = {
  name: 'asset',
  kind: 'asset',
  defaultValue: '@audio/flash',
  assetPrefix: '@audio/',
  description: 'The sound to play.',
};

function build(spec: ParamSpec, value: ParamValue, library = LIBRARY) {
  const changes: ParamValue[] = [];
  const control = renderControl({
    document,
    spec,
    value,
    assetLibrary: library,
    onChange: (next) => changes.push(next),
  });
  const select = control.root.querySelector<HTMLSelectElement>('select')!;
  const input = control.root.querySelector<HTMLInputElement>('input[type="text"]')!;
  return { control, changes, select, input };
}

describe('picking from the project library', () => {
  it('lists only assets of the right kind, by display name', () => {
    const { select } = build(IMAGE_SPEC, '');
    const options = [...select.options].map((option) => option.textContent);
    expect(options).toEqual(['None', 'Beach photo', 'Brick wall']);
  });

  it('writes the logical reference, never the display name', () => {
    const { select, changes } = build(IMAGE_SPEC, '');
    select.value = '@image/beach';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changes).toEqual(['@image/beach']);
  });

  it('reflects the chosen reference into the free-text field too, so both agree', () => {
    const { select, input } = build(IMAGE_SPEC, '');
    select.value = '@image/wall';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(input.value).toBe('@image/wall');
  });

  it('shows the current value selected when it is one of the library’s own', () => {
    const { select, input } = build(IMAGE_SPEC, '@image/wall');
    expect(select.value).toBe('@image/wall');
    expect(input.value).toBe('@image/wall');
  });

  it('leaves the picker unselected for a reference outside the library, keeping the text', () => {
    // e.g. one of the shipped defaults, which is not a project asset.
    const { select, input } = build(AUDIO_SPEC, '@audio/flash');
    expect(select.value).toBe('');
    expect(input.value).toBe('@audio/flash');
  });
});

describe('the optional "None"', () => {
  it('is offered for an allowEmpty parameter, and is the empty string', () => {
    const { select, changes } = build(IMAGE_SPEC, '@image/beach');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changes).toEqual(['']);
  });

  it('is not offered as a value for a required one — the placeholder invites a choice', () => {
    const { select } = build(AUDIO_SPEC, '@audio/flash');
    expect(select.options[0]!.textContent).toMatch(/Pick from the library/);
  });
});

describe('when the project has no assets of this kind yet', () => {
  it('says so, rather than showing an empty picker with no explanation', () => {
    const { control } = build(IMAGE_SPEC, '', []);
    const note = control.root.querySelector('.mudra-editor__asset-picker-note')!;
    expect(note.textContent).toMatch(/no image assets yet/i);
    expect((note as HTMLElement).hidden).toBe(false);
  });

  it('still allows a reference to be typed — a project may reference a shipped default', () => {
    const { input, changes } = build(AUDIO_SPEC, '', []);
    input.value = '@audio/burst';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(changes).toEqual(['@audio/burst']);
  });
});

describe('external updates', () => {
  it('setValue reflects a reference chosen elsewhere without reporting a change', () => {
    const { control, changes, select, input } = build(IMAGE_SPEC, '');
    control.setValue('@image/beach');

    expect(select.value).toBe('@image/beach');
    expect(input.value).toBe('@image/beach');
    expect(changes).toEqual([]);
  });
});
