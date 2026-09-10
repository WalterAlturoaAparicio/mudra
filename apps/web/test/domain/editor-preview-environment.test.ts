/**
 * The controlled preview environment (items 15 and 21).
 *
 * Two additions, both bounded on purpose:
 *
 * **A stand-in hand when no camera is attached.** Half the shipped actions anchor to a hand, so
 * without one they resolve no anchor, produce nothing, and are reported as `anchor_unresolved` —
 * correct, and completely useless for judging an effect you just authored. The stand-in makes
 * preview possible; the assertions below are the guardrails that keep it from becoming a lie:
 * it is never used while a camera is attached, and it never reaches recognition, so it can
 * never fire a trigger by itself.
 *
 * **A debug overlay hook.** Landmark visualization is the existing `landmarkOverlayCommands`,
 * handed to the controller and drawn through the `Stage.present()` overlay argument that
 * already exists — one line of wiring rather than a debugging framework. What matters
 * architecturally is that it is *separate*: with no overlay provider the presented output is
 * byte-for-byte what it would be if the feature did not exist.
 */

import { describe, expect, it } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { previewFrame, previewHand } from '../../src/domain/editor/preview-frame';
import type { SegmentationFrame } from '../../src/domain/editor/segmentation-frame';
import type { CameraTreatmentSettings } from '../../src/domain/editor/types';
import { HAND_LANDMARK_COUNT } from '../../src/domain/landmarks/topology';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { CameraSession, MirroredSurface } from '../../src/domain/ports/camera';
import type { HandDetector } from '../../src/domain/ports/detector';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { EffectCatalog } from '../../src/domain/effects/types';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { PoseMatcher } from '../../src/domain/recognition/types';

class RecordingStage implements StagePresenter {
  readonly frames: { commands: readonly RenderCommand[]; overlay: readonly RenderCommand[] }[] = [];
  present(
    _surface: MirroredSurface,
    commands: readonly RenderCommand[],
    overlay: readonly RenderCommand[] = [],
    _segmentation?: SegmentationFrame | null,
    _cameraTreatment?: CameraTreatmentSettings,
  ): void {
    this.frames.push({ commands, overlay });
  }
}

const realCamera: CameraSession = {
  surface: { width: 640, height: 480, image: null, update: () => true },
  // Frames are pushed by the test, not by the camera, so subscribing is a no-op.
  onFrame: () => () => {},
  close: () => {},
};

/** A detector that reports no hands at all — the "camera on, nothing in frame" case. */
const emptyDetector: HandDetector = {
  detect: () => landmarkFrame([], 0, 640, 480),
  close: () => {},
};

const HAND_ANCHORED_CATALOG: EffectCatalog = {
  version: 1,
  effects: [
    {
      id: 'e1',
      name: 'Hand burst',
      trigger: { on: 'confirmed', poseId: 'somepose', conditions: [] },
      timeline: {
        durationMs: 400,
        entries: [
          {
            atMs: 0,
            durationMs: 400,
            action: {
              type: 'particle_burst',
              params: { count: 10, anchor: { kind: 'handCentroid', hand: 'first' } },
            },
          },
        ],
      },
    },
  ],
};

function build(options: { synthetic?: boolean; catalog?: EffectCatalog } = {}) {
  const stage = new RecordingStage();
  const runtime = new EffectRuntime({
    catalog: options.catalog ?? { version: 1, effects: [] },
    registry: createActionRegistry(),
    capabilities: defaultCapabilities(),
  });
  const controller = new EditorRuntimeController({
    runtime,
    stage,
    matcher: { score: () => [] } as PoseMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => 0,
    scheduleTick: () => {},
    ...(options.synthetic === undefined ? {} : { syntheticInputWhenCameraless: options.synthetic }),
  });
  return { controller, stage, runtime };
}

describe('the stand-in hand', () => {
  it('is a complete, valid hand — not a partial one downstream code must special-case', () => {
    const hand = previewHand(0);
    expect(hand.landmarks.points).toHaveLength(HAND_LANDMARK_COUNT);
    for (const point of hand.landmarks.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it('drifts over time, so a continuous action has a path rather than a point', () => {
    const first = previewFrame(0, 640, 480).hands[0]!.landmarks.points[0]!;
    const later = previewFrame(650, 640, 480).hands[0]!.landmarks.points[0]!;
    expect(later.x).not.toBeCloseTo(first.x, 5);
  });

  it('lets a hand-anchored effect actually preview with no camera attached', () => {
    const { controller, stage } = build({ catalog: HAND_ANCHORED_CATALOG });
    controller.testTrigger(HAND_ANCHORED_CATALOG.effects[0]!);

    const last = stage.frames[stage.frames.length - 1]!;
    expect(last.commands.length).toBeGreaterThan(0);
  });

  it('without it, the same effect resolves no anchor and is reported — the old behaviour', () => {
    const { controller, runtime } = build({
      catalog: HAND_ANCHORED_CATALOG,
      synthetic: false,
    });
    controller.testTrigger(HAND_ANCHORED_CATALOG.effects[0]!);

    const frame = runtime.advance([], landmarkFrame([], 0, 640, 480), 10);
    expect(frame.commands).toEqual([]);
    expect(frame.diagnostics.map((diagnostic) => diagnostic.reason)).toContain('anchor_unresolved');
  });

  it('is never substituted while a camera is attached — a real empty frame stays empty', () => {
    const { controller } = build();
    controller.attachCamera(realCamera, emptyDetector, null);

    const snapshot = controller.tick(0);

    expect(snapshot.syntheticInput).toBe(false);
    expect(snapshot.cameraAttached).toBe(true);
  });

  it('never reaches recognition, so it fires no trigger by itself', () => {
    const { controller } = build({ catalog: HAND_ANCHORED_CATALOG });

    const snapshot = controller.tick(0);

    expect(snapshot.syntheticInput).toBe(true);
    expect(snapshot.outcome).toBeNull();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.activePlaybacks).toBe(0);
  });

  it('is reported as synthetic, so the editor can say so rather than implying a camera', () => {
    expect(build().controller.tick(0).syntheticInput).toBe(true);
    expect(build({ synthetic: false }).controller.tick(0).syntheticInput).toBe(false);
  });
});

describe('the debug overlay hook (item 21)', () => {
  it('presents no overlay at all until one is provided', () => {
    const { controller, stage } = build();
    controller.tick(0);
    expect(stage.frames[0]!.overlay).toEqual([]);
  });

  it('presents whatever the provider returns, over the effect output', () => {
    const { controller, stage } = build();
    const marker: RenderCommand = {
      kind: 'drawCircles',
      points: [{ x: 1, y: 2 }],
      radii: [3],
      color: '#fff',
      alpha: 1,
    };
    controller.setOverlayProvider(() => [marker]);

    controller.tick(0);

    expect(stage.frames[0]!.overlay).toEqual([marker]);
    // Overlay and effect output stay separate arguments: the overlay never becomes part of the
    // effect's own command list, which is what keeps debug output neutral (FR-091).
    expect(stage.frames[0]!.commands).not.toContain(marker);
  });

  it('is given the frame that was actually presented', () => {
    const { controller } = build();
    let seenHands = -1;
    controller.setOverlayProvider((frame) => {
      seenHands = frame.hands.length;
      return [];
    });

    controller.tick(0);

    expect(seenHands).toBe(1); // the stand-in hand
  });

  it('turning it off restores exactly the previous output', () => {
    const { controller, stage } = build();
    controller.setOverlayProvider(() => [
      { kind: 'fillScreen', color: '#f00', alpha: 1, blend: 'normal' },
    ]);
    controller.tick(0);
    controller.setOverlayProvider(null);
    controller.tick(16);

    expect(stage.frames[1]!.overlay).toEqual([]);
    expect(stage.frames[1]!.commands).toEqual(stage.frames[0]!.commands);
  });
});

describe('frame listeners (what drives the editor’s own panels)', () => {
  it('notifies every listener with the tick’s snapshot, and unsubscribes cleanly', () => {
    const { controller } = build();
    const seen: number[] = [];
    const unsubscribe = controller.addFrameListener((snapshot) => seen.push(snapshot.nowMs));

    controller.tick(10);
    controller.tick(20);
    unsubscribe();
    controller.tick(30);

    expect(seen).toEqual([10, 20]);
  });
});
