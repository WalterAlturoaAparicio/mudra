/**
 * `person_visibility`'s three modes (items 2 and 3), and what each one is *not*.
 *
 * The rule this file defends is FR-046's: a segmentation-dependent action must never fake
 * per-pixel separation. "Replace the person" and "keep the person, change the background" are
 * only honest if they are **region-scoped commands** the renderer clips with the real mask —
 * a full-frame fill or image would cover the person, which is exactly the shortcut that would
 * make "keep the person" a lie. So the assertions are about the commands emitted, not about
 * pixels: `test/adapters/renderer-regions.test.ts` covers what the renderer then does with
 * them, and `test/architecture/no-fake-segmentation.test.ts` scans the source for the shortcut.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { ActionContext, ResolvedParams } from '../../src/domain/runtime/action-registry';
import { personVisibilityAction } from '../../src/domain/runtime/actions/person-visibility';
import { PERSON_SEGMENTATION } from '../../src/domain/runtime/capabilities';
import { resolveParams } from '../../src/domain/runtime/param-schema';
import type { SegmentationFrame } from '../../src/domain/editor/segmentation-frame';

const MASK: SegmentationFrame = { mask: { synthetic: true }, width: 640, height: 480 };

function contextFor(
  overrides: Readonly<Record<string, number | string>>,
  options: {
    segmentation?: SegmentationFrame | null;
    resolveAsset?: (reference: string) => string | null;
  } = {},
): ActionContext {
  const params: ResolvedParams = resolveParams(
    personVisibilityAction.params,
    overrides,
    'person_visibility',
  );
  return {
    effectId: 'e',
    params,
    elapsedMs: 100,
    progress: 0.5,
    durationMs: 400,
    justFired: false,
    frame: landmarkFrame([], 0, 640, 480),
    segmentation: options.segmentation === undefined ? MASK : options.segmentation,
    width: 640,
    height: 480,
    anchor: null,
    resolveAsset: options.resolveAsset ?? (() => null),
    state: {},
  };
}

describe('capability gating is unchanged', () => {
  it('declares the person-segmentation requirement', () => {
    expect(personVisibilityAction.requiresCapability).toBe(PERSON_SEGMENTATION);
  });

  it('is inert AND reported when the runtime hands it no segmentation', () => {
    const output = personVisibilityAction.update(contextFor({}, { segmentation: null }));
    expect(output.commands).toEqual([]);
    expect(output.diagnostics).toEqual([
      { reason: 'capability_unavailable', detail: PERSON_SEGMENTATION },
    ]);
  });
});

describe('mode: opacity — the original behaviour, still the default', () => {
  it('erases the person in proportion to 1 − opacity', () => {
    expect(personVisibilityAction.update(contextFor({ opacity: 0.25 })).commands).toEqual([
      { kind: 'maskedErase', region: 'person', alpha: 0.75 },
    ]);
  });

  it('is what an existing catalog entry with only `opacity` gets', () => {
    expect(personVisibilityAction.update(contextFor({ opacity: 1 })).commands).toEqual([
      { kind: 'maskedErase', region: 'person', alpha: 0 },
    ]);
  });
});

describe('mode: replace_person (item 2)', () => {
  it('with no asset, fills the PERSON region with the configured colour', () => {
    const output = personVisibilityAction.update(
      contextFor({ mode: 'replace_person', color: '#ff0000', intensity: 0.8 }),
    );
    expect(output.commands).toEqual([
      { kind: 'fillMaskedRegion', region: 'person', color: '#ff0000', alpha: 0.8 },
    ]);
  });

  it('with an asset, draws the image clipped to the PERSON region', () => {
    const output = personVisibilityAction.update(
      contextFor(
        { mode: 'replace_person', asset: '@image/cat', fit: 'contain', intensity: 1 },
        { resolveAsset: (reference) => (reference === '@image/cat' ? 'blob:cat' : null) },
      ),
    );
    expect(output.commands).toEqual([
      { kind: 'drawMaskedImage', region: 'person', source: 'blob:cat', alpha: 1, fit: 'contain' },
    ]);
  });

  it('never emits a full-frame fill or camera draw — that would cover the person (FR-046)', () => {
    for (const mode of ['replace_person', 'replace_background']) {
      const output = personVisibilityAction.update(contextFor({ mode }));
      for (const command of output.commands) {
        expect(command.kind).not.toBe('fillScreen');
        expect(command.kind).not.toBe('drawCamera');
      }
    }
  });

  it('reports an unresolvable asset and draws nothing, rather than quietly using the colour', () => {
    const output = personVisibilityAction.update(
      contextFor({ mode: 'replace_person', asset: '@image/missing' }),
    );
    expect(output.commands).toEqual([]);
    expect(output.diagnostics).toEqual([
      { reason: 'asset_unresolved', detail: '@image/missing' },
    ]);
  });

  it('at zero intensity, produces nothing at all', () => {
    expect(
      personVisibilityAction.update(contextFor({ mode: 'replace_person', intensity: 0 })).commands,
    ).toEqual([]);
  });
});

describe('mode: replace_background — keep the person (item 3)', () => {
  it('fills the BACKGROUND region, so the person cannot be covered', () => {
    const output = personVisibilityAction.update(
      contextFor({ mode: 'replace_background', color: '#00ff00', intensity: 1 }),
    );
    expect(output.commands).toEqual([
      { kind: 'fillMaskedRegion', region: 'background', color: '#00ff00', alpha: 1 },
    ]);
  });

  it('draws a background image into the BACKGROUND region only', () => {
    const output = personVisibilityAction.update(
      contextFor(
        { mode: 'replace_background', asset: '@image/beach', fit: 'cover' },
        { resolveAsset: () => 'blob:beach' },
      ),
    );
    expect(output.commands).toEqual([
      {
        kind: 'drawMaskedImage',
        region: 'background',
        source: 'blob:beach',
        alpha: 1,
        fit: 'cover',
      },
    ]);
  });
});

describe('the parameter schema', () => {
  it('makes the optional image genuinely optional, and round-trippable as "none"', () => {
    const spec = personVisibilityAction.params.find((entry) => entry.name === 'asset')!;
    expect(spec.kind).toBe('asset');
    expect(spec.allowEmpty).toBe(true);
    expect(spec.assetPrefix).toBe('@image/');
    // "None" survives validation, so a saved project reloads unchanged.
    expect(() =>
      resolveParams(personVisibilityAction.params, { asset: '' }, 'person_visibility'),
    ).not.toThrow();
    // A physical path never does (FR-062).
    expect(() =>
      resolveParams(
        personVisibilityAction.params,
        { asset: '/images/cat.png' },
        'person_visibility',
      ),
    ).toThrow();
  });

  it('gates the replacement fields on the mode, so the inspector shows only what applies', () => {
    const gated = personVisibilityAction.params.filter(
      (spec) => spec.visibleWhen !== undefined,
    );
    expect(gated.map((spec) => spec.name).sort()).toEqual([
      'asset',
      'color',
      'fit',
      'intensity',
      'opacity',
    ]);
    for (const spec of gated) {
      expect(spec.visibleWhen!.param).toBe('mode');
    }
  });
});
