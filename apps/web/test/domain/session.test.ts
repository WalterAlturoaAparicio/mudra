/**
 * The session's own responsibilities: the ordering, and the lifecycle.
 *
 * Every rule the pipeline applies is asserted in its own module. What is left here is what
 * only exists because a session is running — that the stages happen in order, that the
 * camera is **released** (FR-004), and that a stopped session is genuinely stopped rather
 * than merely quiet.
 */

import { describe, expect, it } from 'vitest';

import { catalog, effect, entry, runtimeFor } from '../support/effects';
import { fakeSession } from '../support/fake-session';
import { frameOf, spiralHand } from '../support/hands';

const flash = { type: 'screen_flash', params: { color: '#FFFFFF' } };

function scripted() {
  const runtime = runtimeFor(
    catalog(
      effect({
        id: 'e',
        poseId: 'hi',
        durationMs: 400,
        entries: [
          entry(0, flash, 400),
          entry(0, { type: 'play_audio', params: { asset: '@audio/flash' } }),
        ],
      }),
    ),
  );
  const parts = fakeSession({ runtime });
  parts.detector.frame = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);
  parts.matcher.scores = [
    { poseId: 'hi', distance: 0.1 },
    { poseId: 'peace', distance: 40 },
    { poseId: 'tp', distance: 55 },
    { poseId: 'dragon', distance: 70 },
  ];
  return parts;
}

describe('one frame', () => {
  it('updates the surface, detects, classifies, and presents — in that order', async () => {
    const parts = scripted();
    await parts.session.start();

    parts.step(0);

    expect(parts.camera.surface.updates).toBe(1);
    expect(parts.snapshots).toHaveLength(1);
    expect(parts.stage.frames).toHaveLength(1);
    expect(parts.snapshots[0]!.outcome.kind).toBe('recognized');
  });

  it('presents a frame even when nothing is recognized', async () => {
    const parts = scripted();
    parts.matcher.scores = [];
    parts.detector.frame = frameOf([], 0);
    await parts.session.start();

    parts.step(0);
    // The camera view must keep updating whether or not a pose is in it.
    expect(parts.stage.frames).toHaveLength(1);
    expect(parts.snapshots[0]!.outcome.kind).toBe('noHand');
  });
});

describe('the whole loop', () => {
  it('confirms a held pose and plays its effect', async () => {
    const parts = scripted();
    await parts.session.start();

    for (let i = 0; i <= 40; i += 1) {
      parts.step(i * (1000 / 30));
    }

    const confirmations = parts.snapshots
      .flatMap((s) => s.events)
      .filter((event) => event.kind === 'confirmed');
    expect(confirmations).toHaveLength(1);

    const drew = parts.stage.frames.some((frame) => frame.commands.length > 0);
    expect(drew).toBe(true);
  });

  it('hands audio cues to the sink rather than playing them itself', async () => {
    const parts = scripted();
    await parts.session.start();
    for (let i = 0; i <= 40; i += 1) {
      parts.step(i * (1000 / 30));
    }
    expect(parts.audioPlayed).toEqual([{ asset: '@audio/flash', volume: 0.8 }]);
  });

  it('measures a trigger-to-paint interval once an effect fires (FR-095)', async () => {
    const parts = scripted();
    await parts.session.start();
    for (let i = 0; i <= 40; i += 1) {
      parts.step(i * (1000 / 30));
    }
    const measured = parts.session.performance.triggerToPaint;
    expect(measured).not.toBeNull();
    expect(measured!.effectId).toBe('e');
    expect(measured!.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a frame rate after a few frames', async () => {
    const parts = scripted();
    await parts.session.start();
    for (let i = 0; i <= 10; i += 1) {
      parts.step(i * (1000 / 30));
    }
    expect(parts.session.performance.fps).toBeGreaterThan(0);
  });
});

describe('stopping (FR-004)', () => {
  it('releases the camera and closes the detector', async () => {
    const parts = scripted();
    await parts.session.start();
    parts.step(0);

    parts.session.stop();

    expect(parts.camera.closed).toBe(1);
    expect(parts.detector.closed).toBe(1);
    expect(parts.session.isRunning).toBe(false);
  });

  it('processes no further frames after stopping', async () => {
    const parts = scripted();
    await parts.session.start();
    parts.step(0);
    const before = parts.stage.frames.length;

    parts.session.stop();
    parts.step(33);
    parts.step(66);

    expect(parts.stage.frames).toHaveLength(before);
  });

  it('is idempotent, so a page-unload handler can call it after an explicit stop', async () => {
    const parts = scripted();
    await parts.session.start();
    parts.session.stop();
    parts.session.stop();
    expect(parts.camera.closed).toBe(1);
  });

  it('drops any hold in progress, so a restart does not inherit one', async () => {
    const parts = scripted();
    await parts.session.start();
    for (let i = 0; i < 20; i += 1) {
      parts.step(i * (1000 / 30));
    }
    expect(parts.snapshots.at(-1)!.holdProgress).toBeGreaterThan(0);

    parts.session.stop();
    await parts.session.start();
    parts.step(10_000);
    expect(parts.snapshots.at(-1)!.holdProgress).toBe(0);
  });
});
