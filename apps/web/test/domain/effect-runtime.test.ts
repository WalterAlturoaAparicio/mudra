/**
 * FR-069: the runtime is exercisable with **no browser, no display, and no camera**.
 *
 * That is the point of the whole render-command design, so it is asserted directly: this
 * file imports nothing from `presentation/`, touches no canvas, and asserts the complete
 * per-frame output as data.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { FillScreenCommand, DrawCirclesCommand } from '../../src/domain/runtime/frame-output';
import { catalog, effect, entry, poseEvent, runtimeFor } from '../support/effects';
import { frameOf, spiralHand } from '../support/hands';

const emptyFrame = landmarkFrame([], 0, 1280, 720);

function flash(color = '#FFFFFF'): Parameters<typeof entry>[1] {
  return { type: 'screen_flash', params: { color, intensity: 0.8 } };
}

describe('a scripted effect, start to finish, with no browser present', () => {
  it('produces the full FrameOutput sequence', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.flash',
          poseId: 'p',
          durationMs: 400,
          entries: [entry(0, flash(), 400)],
        }),
      ),
    );

    // Frame 0: the trigger arrives and the flash is at full strength.
    const first = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(first.started.map((s) => s.effectId)).toEqual(['e.flash']);
    expect(first.commands).toHaveLength(1);
    expect(first.commands[0]!.kind).toBe('fillScreen');
    expect((first.commands[0] as FillScreenCommand).alpha).toBeCloseTo(0.8, 6);
    expect(first.activePlaybacks).toBe(1);

    // Halfway: decayed, still playing.
    const middle = runtime.advance([], emptyFrame, 200);
    expect(middle.commands).toHaveLength(1);
    expect((middle.commands[0] as FillScreenCommand).alpha).toBeLessThan(0.8);
    expect((middle.commands[0] as FillScreenCommand).alpha).toBeGreaterThan(0);

    // Past the end: nothing, and the playback is released (FR-051).
    const after = runtime.advance([], emptyFrame, 500);
    expect(after.commands).toEqual([]);
    expect(after.activePlaybacks).toBe(0);
    expect(runtime.activePlaybacks).toBe(0);
  });

  it('does nothing at all until a matching event arrives', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 400, entries: [entry(0, flash(), 400)] })),
    );
    expect(runtime.advance([], emptyFrame, 0).commands).toEqual([]);
    expect(runtime.advance([poseEvent('confirmed', 'other', 0)], emptyFrame, 16).commands).toEqual([]);
    expect(runtime.advance([poseEvent('entered', 'p', 0)], emptyFrame, 32).commands).toEqual([]);
  });

  it('matches each of the four event kinds', () => {
    for (const kind of ['entered', 'held', 'confirmed', 'exited'] as const) {
      const runtime = runtimeFor(
        catalog(
          effect({ id: 'e', poseId: 'p', on: kind, durationMs: 100, entries: [entry(0, flash(), 100)] }),
        ),
      );
      expect(runtime.advance([poseEvent(kind, 'p', 0)], emptyFrame, 0).commands).toHaveLength(1);
    }
  });
});

describe('multiple matching effects (FR-044)', () => {
  it('all play, in catalog order', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'a', poseId: 'p', durationMs: 200, entries: [entry(0, flash('#AAAAAA'), 200)] }),
        effect({ id: 'b', poseId: 'p', durationMs: 200, entries: [entry(0, flash('#BBBBBB'), 200)] }),
      ),
    );
    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(output.started.map((s) => s.effectId)).toEqual(['a', 'b']);
    expect(output.commands.map((c) => (c as FillScreenCommand).color)).toEqual([
      '#AAAAAA',
      '#BBBBBB',
    ]);
  });

  it('keeps that order stable across frames', () => {
    const runtime = runtimeFor(
      catalog(
        effect({ id: 'a', poseId: 'p', durationMs: 400, entries: [entry(0, flash('#AAAAAA'), 400)] }),
        effect({ id: 'b', poseId: 'p', durationMs: 400, entries: [entry(0, flash('#BBBBBB'), 400)] }),
      ),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    for (const t of [100, 200, 300]) {
      const output = runtime.advance([], emptyFrame, t);
      expect(output.commands.map((c) => (c as FillScreenCommand).color)).toEqual([
        '#AAAAAA',
        '#BBBBBB',
      ]);
    }
  });
});

describe('conditions (FR-043)', () => {
  it('refuses a trigger below the confidence condition', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          conditions: [{ type: 'confidenceAtLeast', value: 0.8 }],
          durationMs: 100,
          entries: [entry(0, flash(), 100)],
        }),
      ),
    );
    expect(
      runtime.advance([poseEvent('confirmed', 'p', 0, 0.7)], emptyFrame, 0).started,
    ).toHaveLength(0);
    expect(
      runtime.advance([poseEvent('confirmed', 'p', 0, 0.85)], emptyFrame, 16).started,
    ).toHaveLength(1);
  });

  it('enforces a cooldown from the last start', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e',
          poseId: 'p',
          conditions: [{ type: 'cooldown', ms: 1000 }],
          durationMs: 100,
          entries: [entry(0, flash(), 100)],
        }),
      ),
    );
    expect(runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0).started).toHaveLength(1);
    expect(runtime.advance([poseEvent('confirmed', 'p', 500)], emptyFrame, 500).started).toHaveLength(0);
    expect(runtime.advance([poseEvent('confirmed', 'p', 1000)], emptyFrame, 1000).started).toHaveLength(1);
  });
});

describe('audio cues (FR-054a, research D6)', () => {
  it('are emitted as values, once, and never played by the runtime', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.sound',
          poseId: 'p',
          durationMs: 500,
          entries: [entry(0, { type: 'play_audio', params: { asset: '@audio/flash', volume: 0.5 } })],
        }),
      ),
    );

    const first = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(first.audioCues).toEqual([{ asset: '@audio/flash', volume: 0.5 }]);
    // Frames after the firing frame must not re-emit — that is how a cue becomes a buzz.
    expect(runtime.advance([], emptyFrame, 100).audioCues).toEqual([]);
    expect(runtime.advance([], emptyFrame, 200).audioCues).toEqual([]);
  });

  it('reports an unresolvable asset and keeps the effect playing (FR-064)', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.sound',
          poseId: 'p',
          durationMs: 500,
          entries: [
            entry(0, { type: 'play_audio', params: { asset: '@audio/missing' } }),
            entry(0, flash(), 500),
          ],
        }),
      ),
      { resolveAsset: () => null },
    );

    const output = runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(output.audioCues).toEqual([]);
    expect(output.diagnostics).toEqual([
      {
        effectId: 'e.sound',
        actionType: 'play_audio',
        reason: 'asset_unresolved',
        detail: '@audio/missing',
      },
    ]);
    // The visual half still played.
    expect(output.commands).toHaveLength(1);
  });
});

describe('particle bursts', () => {
  it('emit one batched command carrying every particle (contracts/render-commands.md)', () => {
    const runtime = runtimeFor(
      catalog(
        effect({
          id: 'e.burst',
          poseId: 'p',
          durationMs: 400,
          entries: [
            entry(
              0,
              {
                type: 'particle_burst',
                params: { count: 60, anchor: { kind: 'screen', x: 0.5, y: 0.5 } },
              },
              400,
            ),
          ],
        }),
      ),
    );

    const output = runtime.advance(
      [poseEvent('confirmed', 'p', 0)],
      frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0),
      0,
    );
    expect(output.commands).toHaveLength(1);
    const circles = output.commands[0] as DrawCirclesCommand;
    expect(circles.kind).toBe('drawCircles');
    expect(circles.points).toHaveLength(60);
    expect(circles.radii).toHaveLength(60);
  });

  it('is deterministic — the same effect twice produces the same picture', () => {
    const build = () =>
      runtimeFor(
        catalog(
          effect({
            id: 'e',
            poseId: 'p',
            durationMs: 400,
            entries: [
              entry(
                0,
                { type: 'particle_burst', params: { count: 12, anchor: { kind: 'screen', x: 0.5, y: 0.5 } } },
                400,
              ),
            ],
          }),
        ),
      );

    const a = build().advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    const b = build().advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(a.commands).toEqual(b.commands);
  });
});

describe('reset', () => {
  it('drops every playback', () => {
    const runtime = runtimeFor(
      catalog(effect({ id: 'e', poseId: 'p', durationMs: 5000, entries: [entry(0, flash(), 5000)] })),
    );
    runtime.advance([poseEvent('confirmed', 'p', 0)], emptyFrame, 0);
    expect(runtime.activePlaybacks).toBe(1);
    runtime.reset();
    expect(runtime.activePlaybacks).toBe(0);
    expect(runtime.advance([], emptyFrame, 100).commands).toEqual([]);
  });
});
