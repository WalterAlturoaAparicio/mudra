/**
 * FR-091: toggling debug mode alters no recognition and no effect behaviour.
 *
 * The whole session is run twice over an identical scripted sequence — once with the
 * overlay off, once with it on — and the two runs are compared. Recognition outcomes,
 * pose events, hold progress, and the effect command list must be **identical**; only the
 * overlay list may differ.
 *
 * This is what stops a well-meaning "let's stabilize it a bit while the overlay is up"
 * from ever landing.
 */

import { describe, expect, it } from 'vitest';

import type { DebugOverlay, SessionSnapshot } from '../../src/application/session';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { HAND_CONNECTIONS } from '../../src/domain/landmarks/topology';
import type { LandmarkFrame } from '../../src/domain/landmarks/types';
import { landmarkOverlayCommands } from '../../src/presentation/debug/landmark-overlay';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import { catalog, effect, entry, runtimeFor } from '../support/effects';
import { fakeSession } from '../support/fake-session';
import { frameOf, spiralHand } from '../support/hands';

const flash = { type: 'screen_flash', params: { color: '#FFFFFF' } };

/** An overlay that draws the real landmark commands when on, and nothing when off. */
class TestOverlay implements DebugOverlay {
  constructor(public enabled: boolean) {}

  commandsFor(frame: LandmarkFrame, _snapshot: SessionSnapshot): readonly RenderCommand[] {
    if (!this.enabled) {
      return [];
    }
    return landmarkOverlayCommands(
      frame,
      DEFAULT_SESSION_CONFIG.renderer,
      frame.width,
      frame.height,
    );
  }
}

/** Run 60 frames holding a recognized pose, and return what came out. */
async function run(debugOn: boolean) {
  const runtime = runtimeFor(
    catalog(effect({ id: 'e', poseId: 'hi', durationMs: 600, entries: [entry(0, flash, 600)] })),
  );
  const parts = fakeSession({ runtime, debug: new TestOverlay(debugOn) });
  await parts.session.start();

  parts.detector.frame = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);
  // One clear winner, so every frame is `recognized` and the hold completes.
  parts.matcher.scores = [
    { poseId: 'hi', distance: 0.1 },
    { poseId: 'peace', distance: 40 },
    { poseId: 'tp', distance: 55 },
    { poseId: 'dragon', distance: 70 },
  ];

  for (let i = 0; i < 60; i += 1) {
    parts.step(i * (1000 / 30));
  }

  return {
    outcomes: parts.snapshots.map((s) => ({
      kind: s.outcome.kind,
      candidates: s.outcome.topCandidates,
      hold: s.holdProgress,
      playbacks: s.activePlaybacks,
    })),
    events: parts.snapshots.flatMap((s) => s.events),
    commands: parts.stage.frames.map((f) => f.commands),
    overlays: parts.stage.frames.map((f) => f.overlay),
  };
}

describe('debug mode on versus off', () => {
  it('produces identical recognition outcomes', async () => {
    const off = await run(false);
    const on = await run(true);
    expect(on.outcomes).toEqual(off.outcomes);
  });

  it('produces identical pose events', async () => {
    const off = await run(false);
    const on = await run(true);
    expect(on.events).toEqual(off.events);
    expect(on.events.filter((e) => e.kind === 'confirmed')).toHaveLength(1);
  });

  it('produces identical effect commands', async () => {
    const off = await run(false);
    const on = await run(true);
    expect(on.commands).toEqual(off.commands);
    expect(on.commands.flat().length).toBeGreaterThan(0);
  });

  it('differs only in the overlay list', async () => {
    const off = await run(false);
    const on = await run(true);
    expect(off.overlays.every((overlay) => overlay.length === 0)).toBe(true);
    expect(on.overlays.some((overlay) => overlay.length > 0)).toBe(true);
  });
});

describe('the overlay itself', () => {
  const frame = frameOf(
    [
      { handedness: 'left', landmarks: spiralHand() },
      { handedness: 'right', landmarks: spiralHand(1.2) },
    ],
    0,
  );

  it('draws all 21 points and every skeleton edge, per hand (US4 acceptance 2)', () => {
    const commands = landmarkOverlayCommands(
      frame,
      DEFAULT_SESSION_CONFIG.renderer,
      frame.width,
      frame.height,
    );
    const circles = commands.filter((c) => c.kind === 'drawCircles');
    const lines = commands.filter((c) => c.kind === 'drawPolyline');

    expect(circles).toHaveLength(2);
    for (const batch of circles) {
      expect(batch.kind === 'drawCircles' && batch.points.length).toBe(21);
    }
    expect(lines).toHaveLength(HAND_CONNECTIONS.length * 2);
  });

  it('places points in mirrored display space, where the hand appears', () => {
    // The visible half of quickstart scenario 3: landmarks that landed horizontally
    // opposite the hand would mean the single-surface design had been broken.
    const commands = landmarkOverlayCommands(
      frame,
      DEFAULT_SESSION_CONFIG.renderer,
      frame.width,
      frame.height,
    );
    const circles = commands.find((c) => c.kind === 'drawCircles')!;
    const first = circles.kind === 'drawCircles' ? circles.points[0]! : { x: -1, y: -1 };
    const landmark = frame.hands[0]!.landmarks.points[0]!;
    expect(first.x).toBeCloseTo(landmark.x * frame.width, 6);
    expect(first.y).toBeCloseTo(landmark.y * frame.height, 6);
  });

  it('draws nothing for a frame with no hands', () => {
    const empty = frameOf([], 0);
    expect(
      landmarkOverlayCommands(empty, DEFAULT_SESSION_CONFIG.renderer, empty.width, empty.height),
    ).toEqual([]);
  });
});
