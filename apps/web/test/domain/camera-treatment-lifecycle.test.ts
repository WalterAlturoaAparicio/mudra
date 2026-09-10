/**
 * A project's camera treatment reaches the renderer **before** the first frame (item 7).
 *
 * The bug: brightness/contrast/saturation/zoom were restored into the controls when a project
 * loaded, but the controller only learned about them from the editor's "a project changed"
 * callback — which does not fire on load. So the sliders showed the saved values while the
 * viewport rendered untreated, until the author happened to move one. Nothing was lost; nothing
 * was applied either.
 *
 * These assertions are about the *lifecycle*, not the arithmetic (`camera-treatment.test.ts`
 * already covers what the treatment does to an image): the settings must be in effect on frame
 * one, survive a camera being attached and detached, and never cause the camera stream itself to
 * be touched.
 */

import { describe, expect, it } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { DEFAULT_CAMERA_TREATMENT } from '../../src/domain/editor/types';
import type { CameraTreatmentSettings } from '../../src/domain/editor/types';
import type { SegmentationFrame } from '../../src/domain/editor/segmentation-frame';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { CameraSession, MirroredSurface } from '../../src/domain/ports/camera';
import type { HandDetector } from '../../src/domain/ports/detector';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { PoseMatcher } from '../../src/domain/recognition/types';

const PROJECT_TREATMENT: CameraTreatmentSettings = {
  brightness: 0.4,
  contrast: -0.2,
  saturation: 0.6,
  mirror: true,
  zoom: 1.8,
  crop: null,
};

class RecordingStage implements StagePresenter {
  readonly treatments: (CameraTreatmentSettings | undefined)[] = [];
  present(
    _surface: MirroredSurface,
    _commands: readonly RenderCommand[],
    _overlay?: readonly RenderCommand[],
    _segmentation?: SegmentationFrame | null,
    cameraTreatment?: CameraTreatmentSettings,
  ): void {
    this.treatments.push(cameraTreatment);
  }
}

/** A camera that records whether anything ever asked it to stop. */
class RecordingCameraSession implements CameraSession {
  closed = 0;
  readonly surface: MirroredSurface = {
    width: 640,
    height: 480,
    image: null,
    update: () => true,
  };
  /** Nothing here drives frames — the controller is advanced directly by each test. */
  onFrame(): () => void {
    return () => {};
  }
  close(): void {
    this.closed += 1;
  }
}

const stubDetector: HandDetector = {
  detect: () => landmarkFrame([], 0, 640, 480),
  close: () => {},
};

function buildController(options: { cameraTreatment?: CameraTreatmentSettings } = {}) {
  const stage = new RecordingStage();
  const registry = createActionRegistry();
  const controller = new EditorRuntimeController({
    runtime: new EffectRuntime({
      catalog: { version: 1, effects: [] },
      registry,
      capabilities: defaultCapabilities(),
    }),
    stage,
    matcher: { score: () => [] } as PoseMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => 0,
    scheduleTick: () => {},
    ...(options.cameraTreatment === undefined ? {} : { cameraTreatment: options.cameraTreatment }),
  });
  return { controller, stage };
}

describe('initialization', () => {
  it('applies the project’s treatment on the very first frame — no interaction required', () => {
    const { controller, stage } = buildController({ cameraTreatment: PROJECT_TREATMENT });

    controller.tick(0);

    expect(stage.treatments).toEqual([PROJECT_TREATMENT]);
  });

  it('a controller given no treatment presents the identity transform, not undefined', () => {
    const { controller, stage } = buildController();
    controller.tick(0);
    expect(stage.treatments[0]).toEqual(DEFAULT_CAMERA_TREATMENT);
  });

  it('also applies it to a direct preview command, not only to ticks', () => {
    const { controller, stage } = buildController({ cameraTreatment: PROJECT_TREATMENT });

    controller.playTimeline('nothing-with-this-id');
    controller.testTrigger({
      id: 'e',
      name: 'E',
      trigger: { on: 'confirmed', poseId: 'p', conditions: [] },
      timeline: { durationMs: 1, entries: [] },
    });

    expect(stage.treatments.every((treatment) => treatment === PROJECT_TREATMENT)).toBe(true);
    expect(stage.treatments.length).toBeGreaterThan(0);
  });
});

describe('changing a setting', () => {
  it('takes effect on the next frame, with no camera restart', () => {
    const { controller, stage } = buildController({ cameraTreatment: PROJECT_TREATMENT });
    const camera = new RecordingCameraSession();
    controller.attachCamera(camera, stubDetector, null);
    controller.tick(0);

    const changed: CameraTreatmentSettings = { ...PROJECT_TREATMENT, brightness: -0.9 };
    controller.setCameraTreatment(changed);
    controller.tick(16);

    expect(stage.treatments[stage.treatments.length - 1]).toEqual(changed);
    // The whole point: a display-only adjustment must never touch the stream (FR-049).
    expect(camera.closed).toBe(0);
    expect(controller.hasCamera).toBe(true);
  });
});

describe('camera lifecycle', () => {
  it('survives attach → detach → re-attach unchanged', () => {
    const { controller, stage } = buildController({ cameraTreatment: PROJECT_TREATMENT });

    controller.attachCamera(new RecordingCameraSession(), stubDetector, null);
    controller.tick(0);
    controller.detachCamera();
    controller.tick(16);
    controller.attachCamera(new RecordingCameraSession(), stubDetector, null);
    controller.tick(32);

    expect(stage.treatments).toEqual([PROJECT_TREATMENT, PROJECT_TREATMENT, PROJECT_TREATMENT]);
  });

  it('presents a null-image placeholder surface with no camera, so nothing reaches drawImage', () => {
    // The regression this guards is the "invalid drawImage source" one: with no camera there is
    // no image, and the treatment path must handle that rather than passing a wrapper object on.
    const { controller } = buildController({ cameraTreatment: PROJECT_TREATMENT });
    expect(() => controller.tick(0)).not.toThrow();
    expect(controller.hasCamera).toBe(false);
  });
});
