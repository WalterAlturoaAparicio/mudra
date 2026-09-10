/**
 * FR-073, proved rather than asserted.
 *
 * *"Adding a new action type MUST NOT require modifying the timeline scheduler, the event
 * system, or renderer dispatch."* A comment saying so is worth nothing. So this test
 * **registers a genuinely new action** through the **production** registry — not a second
 * registry built for the test — puts it on a timeline, and watches the production runtime
 * schedule it at its `atMs` and emit its commands.
 *
 * If someone later adds a central switch on action type, this file fails: the new type
 * would not be in the switch.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { ActionContext, ActionDescriptor } from '../../src/domain/runtime/action-registry';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import type { DrawPolylineCommand, FillScreenCommand } from '../../src/domain/runtime/frame-output';
import { parseCatalog } from '../../src/infrastructure/effects/catalog-loader';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { poseEvent } from '../support/effects';

const frame = landmarkFrame([], 0, 1000, 500);

/**
 * A new action type that did not exist when the runtime was written.
 *
 * Deliberately not a variation of a shipped one: a different behaviour class, a different
 * parameter schema, and a command shape no shipped action emits.
 */
const horizonAction: ActionDescriptor = {
  type: 'horizon_line',
  behaviour: 'duration',
  params: [
    {
      name: 'height',
      kind: 'number',
      defaultValue: 0.5,
      min: 0,
      max: 1,
      description: 'Where the line sits, as a fraction of the surface height.',
    },
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#00FF00',
      description: 'Colour of the line.',
    },
  ],
  update(context: ActionContext) {
    const height = context.params['height'] as number;
    const y = height * context.height;
    return {
      commands: [
        {
          kind: 'drawPolyline',
          points: [
            { x: 0, y },
            { x: context.width, y },
          ],
          width: 3,
          color: context.params['color'] as string,
          alpha: 1 - context.progress,
        } satisfies DrawPolylineCommand,
      ],
    };
  },
};

/** A catalog using the new type alongside a shipped one. */
function catalogDocument(): Record<string, unknown> {
  return {
    catalog_version: 1,
    effects: [
      {
        id: 'ext.demo',
        name: 'Extensibility Demo',
        trigger: { on: 'confirmed', pose_id: 'some_pose', conditions: [] },
        timeline: {
          duration_ms: 1000,
          entries: [
            {
              at_ms: 0,
              duration_ms: 200,
              action: { type: 'screen_flash', params: { color: '#FFFFFF' } },
            },
            {
              at_ms: 400,
              duration_ms: 400,
              action: { type: 'horizon_line', params: { height: 0.25, color: '#FF00FF' } },
            },
          ],
        },
      },
    ],
  };
}

function buildRuntime() {
  // The production registry, with one extra registration. Nothing else is special.
  const registry = createActionRegistry([horizonAction]);
  const catalog = parseCatalog(catalogDocument(), registry);
  return new EffectRuntime({
    catalog,
    registry,
    capabilities: defaultCapabilities(),
    resolveAsset: () => null,
  });
}

describe('a brand-new action type', () => {
  it('is accepted by the production catalog loader', () => {
    expect(() => parseCatalog(catalogDocument(), createActionRegistry([horizonAction]))).not.toThrow();
  });

  it('is rejected when it is *not* registered — proving the loader really checks', () => {
    expect(() => parseCatalog(catalogDocument(), createActionRegistry())).toThrow(
      /unknown action type "horizon_line"/,
    );
  });

  it('is validated against its own declared schema', () => {
    const document = catalogDocument();
    const effects = document['effects'] as Record<string, unknown>[];
    const timeline = effects[0]!['timeline'] as { entries: Record<string, unknown>[] };
    const action = timeline.entries[1]!['action'] as { params: Record<string, unknown> };
    action.params['height'] = 5;
    expect(() => parseCatalog(document, createActionRegistry([horizonAction]))).toThrow(
      /must be at most 1/,
    );
  });

  it('is scheduled at its at_ms by the unmodified timeline scheduler', () => {
    const runtime = buildRuntime();
    runtime.advance([poseEvent('confirmed', 'some_pose', 0)], frame, 0);

    // Before its offset: only the shipped action is running.
    const early = runtime.advance([], frame, 100);
    expect(early.commands.some((c) => c.kind === 'drawPolyline')).toBe(false);

    // After its offset: the new action produces output, with no scheduler change.
    const active = runtime.advance([], frame, 500);
    const line = active.commands.find(
      (c): c is DrawPolylineCommand => c.kind === 'drawPolyline',
    );
    expect(line).toBeDefined();
    expect(line!.color).toBe('#FF00FF');
  });

  it('produces exactly the RenderCommands it declared', () => {
    const runtime = buildRuntime();
    runtime.advance([poseEvent('confirmed', 'some_pose', 0)], frame, 0);
    const line = runtime
      .advance([], frame, 500)
      .commands.find((c): c is DrawPolylineCommand => c.kind === 'drawPolyline')!;

    expect(line.points).toEqual([
      { x: 0, y: 125 },
      { x: 1000, y: 125 },
    ]);
    expect(line.width).toBe(3);
  });

  it('deactivates at its own end, leaving the rest of the timeline alone', () => {
    const runtime = buildRuntime();
    runtime.advance([poseEvent('confirmed', 'some_pose', 0)], frame, 0);
    expect(
      runtime.advance([], frame, 850).commands.some((c) => c.kind === 'drawPolyline'),
    ).toBe(false);
    expect(runtime.activePlaybacks).toBe(1);
  });

  it('required no change to the event system — the same trigger path started it', () => {
    const runtime = buildRuntime();
    const started = runtime.advance([poseEvent('confirmed', 'some_pose', 0)], frame, 0);
    expect(started.started.map((s) => s.effectId)).toEqual(['ext.demo']);
    // And the shipped action in the same timeline still behaves normally.
    expect((started.commands[0] as FillScreenCommand).kind).toBe('fillScreen');
  });
});
