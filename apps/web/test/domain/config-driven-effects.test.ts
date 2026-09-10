/**
 * SC-006: changing configuration changes behaviour, with no runtime source involved.
 *
 * The test loads two catalogs that differ only as data — a colour, a timing, an anchor,
 * plus one entirely new effect — through the same production loader and the same
 * production runtime, and asserts the `FrameOutput` differs. Nothing here constructs a
 * special runtime or a special registry, because a proof that used one would be proving
 * something about the test rather than about the application.
 */

import { describe, expect, it } from 'vitest';

import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { DrawCirclesCommand, FillScreenCommand } from '../../src/domain/runtime/frame-output';
import { parseCatalog } from '../../src/infrastructure/effects/catalog-loader';
import { poseEvent } from '../support/effects';
import { frameOf, spiralHand } from '../support/hands';

const frame = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);

/** The baseline catalog, as a document a person could have written. */
function baseline(): Record<string, unknown> {
  return {
    catalog_version: 1,
    effects: [
      {
        id: 'demo.flash',
        name: 'Demo Flash',
        trigger: { on: 'confirmed', pose_id: 'demo_pose', conditions: [] },
        timeline: {
          duration_ms: 600,
          entries: [
            {
              at_ms: 0,
              duration_ms: 400,
              action: { type: 'screen_flash', params: { color: '#FFFFFF', intensity: 0.8 } },
            },
          ],
        },
      },
    ],
  };
}

/** The same catalog, edited: different colour, different timing, plus a new effect. */
function edited(): Record<string, unknown> {
  return {
    catalog_version: 1,
    effects: [
      {
        id: 'demo.flash',
        name: 'Demo Flash',
        trigger: { on: 'confirmed', pose_id: 'demo_pose', conditions: [] },
        timeline: {
          duration_ms: 900,
          entries: [
            {
              at_ms: 0,
              duration_ms: 800,
              action: { type: 'screen_flash', params: { color: '#FF3366', intensity: 0.4 } },
            },
          ],
        },
      },
      {
        id: 'demo.added',
        name: 'Added Burst',
        trigger: { on: 'confirmed', pose_id: 'demo_pose', conditions: [] },
        timeline: {
          duration_ms: 500,
          entries: [
            {
              at_ms: 0,
              duration_ms: 500,
              action: {
                type: 'particle_burst',
                params: {
                  count: 12,
                  color: '#00FFAA',
                  anchor: { kind: 'handCentroid', hand: 'first' },
                },
              },
            },
          ],
        },
      },
    ],
  };
}

function outputFor(document: Record<string, unknown>, atMs: number) {
  const registry = createActionRegistry();
  const runtime = new EffectRuntime({
    catalog: parseCatalog(document, registry),
    registry,
    capabilities: defaultCapabilities(),
    resolveAsset: () => null,
  });
  const first = runtime.advance([poseEvent('confirmed', 'demo_pose', 0)], frame, 0);
  return atMs === 0 ? first : runtime.advance([], frame, atMs);
}

describe('editing only the catalog', () => {
  it('changes the colour that is drawn', () => {
    const before = outputFor(baseline(), 0).commands[0] as FillScreenCommand;
    const after = outputFor(edited(), 0).commands[0] as FillScreenCommand;
    expect(before.color).toBe('#FFFFFF');
    expect(after.color).toBe('#FF3366');
  });

  it('changes the intensity that is drawn', () => {
    const before = outputFor(baseline(), 0).commands[0] as FillScreenCommand;
    const after = outputFor(edited(), 0).commands[0] as FillScreenCommand;
    expect(before.alpha).toBeCloseTo(0.8, 6);
    expect(after.alpha).toBeCloseTo(0.4, 6);
  });

  it('changes how long the effect lasts', () => {
    // At 700 ms the baseline has finished and the edit is still running.
    expect(outputFor(baseline(), 700).activePlaybacks).toBe(0);
    expect(outputFor(edited(), 700).activePlaybacks).toBeGreaterThan(0);
  });

  it('adds a whole new effect with no runtime change', () => {
    const before = outputFor(baseline(), 0);
    const after = outputFor(edited(), 0);
    expect(before.commands).toHaveLength(1);
    expect(after.commands).toHaveLength(2);

    const circles = after.commands.find(
      (command): command is DrawCirclesCommand => command.kind === 'drawCircles',
    );
    expect(circles).toBeDefined();
    expect(circles!.color).toBe('#00FFAA');
    expect(circles!.points).toHaveLength(12);
  });

  it('produces a different FrameOutput overall (SC-006)', () => {
    expect(outputFor(edited(), 0).commands).not.toEqual(outputFor(baseline(), 0).commands);
  });
});

describe('an anchor is data too', () => {
  it('moves the burst by editing the anchor and nothing else', () => {
    const withCentroid = edited();
    const atScreenCentre = JSON.parse(JSON.stringify(edited())) as typeof withCentroid;
    const effects = atScreenCentre['effects'] as Record<string, unknown>[];
    const timeline = effects[1]!['timeline'] as { entries: Record<string, unknown>[] };
    const action = timeline.entries[0]!['action'] as { params: Record<string, unknown> };
    action.params['anchor'] = { kind: 'screen', x: 0.1, y: 0.1 };

    const centroid = outputFor(withCentroid, 0).commands.find(
      (c): c is DrawCirclesCommand => c.kind === 'drawCircles',
    )!;
    const screen = outputFor(atScreenCentre, 0).commands.find(
      (c): c is DrawCirclesCommand => c.kind === 'drawCircles',
    )!;

    expect(screen.points[0]).not.toEqual(centroid.points[0]);
    expect(screen.points).toHaveLength(centroid.points.length);
  });
});
