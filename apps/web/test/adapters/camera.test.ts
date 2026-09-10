/**
 * The camera adapter's real job: telling four failure modes apart (FR-003).
 *
 * "Could not start the camera" is useless to a person. "Another application is using the
 * camera" tells them what to do. The mapping from `DOMException` names to those situations
 * is the only place that distinction is made, so it is the part worth testing.
 */

import { describe, expect, it, vi } from 'vitest';

import { CameraError } from '../../src/domain/ports/camera';
import {
  CAMERA_MESSAGES,
  GetUserMediaCamera,
  cameraFailureReason,
} from '../../src/infrastructure/camera/get-user-media-camera';

/** A DOMException-shaped rejection, as a browser would produce. */
function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** A camera that always fails in a given way. */
function failingCamera(error: unknown): GetUserMediaCamera {
  return new GetUserMediaCamera({
    mediaDevices: { getUserMedia: () => Promise.reject(error) },
  });
}

describe('failure classification', () => {
  const cases: [string, string][] = [
    ['NotAllowedError', 'permissionDenied'],
    ['SecurityError', 'permissionDenied'],
    ['NotFoundError', 'noCamera'],
    ['DevicesNotFoundError', 'noCamera'],
    ['NotReadableError', 'deviceInUse'],
    ['TrackStartError', 'deviceInUse'],
    ['AbortError', 'permissionDismissed'],
    ['OverconstrainedError', 'noCamera'],
    ['SomethingElseEntirely', 'unknown'],
  ];

  for (const [name, reason] of cases) {
    it(`maps ${name} to ${reason}`, () => {
      expect(cameraFailureReason(domError(name))).toBe(reason);
    });
  }

  it('does not throw on a non-Error rejection', () => {
    expect(cameraFailureReason('nope')).toBe('unknown');
    expect(cameraFailureReason(null)).toBe('unknown');
    expect(cameraFailureReason(undefined)).toBe('unknown');
  });
});

describe('open()', () => {
  it('reports permission refusal as a CameraError with that reason', async () => {
    await expect(failingCamera(domError('NotAllowedError')).open()).rejects.toMatchObject({
      name: 'CameraError',
      reason: 'permissionDenied',
    });
  });

  it('reports a missing device separately from a refusal', async () => {
    await expect(failingCamera(domError('NotFoundError')).open()).rejects.toMatchObject({
      reason: 'noCamera',
    });
  });

  it('reports a device held by another application separately again', async () => {
    await expect(failingCamera(domError('NotReadableError')).open()).rejects.toMatchObject({
      reason: 'deviceInUse',
    });
  });

  it('reports a dismissed prompt as its own situation', async () => {
    await expect(failingCamera(domError('AbortError')).open()).rejects.toMatchObject({
      reason: 'permissionDismissed',
    });
  });

  it('reports an environment with no mediaDevices at all', async () => {
    const camera = new GetUserMediaCamera({ mediaDevices: undefined });
    // jsdom provides no navigator.mediaDevices, which is exactly the unsupported case.
    await expect(camera.open()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('carries a message with no technical vocabulary in it (SC-012)', async () => {
    for (const [reason, message] of Object.entries(CAMERA_MESSAGES)) {
      expect(message).not.toMatch(/getUserMedia|DOMException|NotAllowedError|MediaStream/);
      expect(message.length).toBeGreaterThan(10);
      expect(reason).toBeTruthy();
    }
  });
});

describe('a camera that opens', () => {
  function fakeStream() {
    const stop = vi.fn();
    return {
      stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
      stop,
    };
  }

  /**
   * jsdom implements no 2D canvas context, which is why `createCanvas` is an injection
   * point: the adapter should be testable without pulling a native canvas binding into a
   * browser application's dev dependencies.
   */
  function fakeCanvas(): HTMLCanvasElement {
    const context = {
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      drawImage: () => undefined,
    };
    return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  }

  function fakeVideo() {
    const video = document.createElement('video') as HTMLVideoElement & {
      requestVideoFrameCallback?: unknown;
    };
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
    video.play = () => Promise.resolve();
    video.pause = () => undefined;
    return video;
  }

  it('exposes a mirrored surface sized to the camera', async () => {
    const { stream } = fakeStream();
    const camera = new GetUserMediaCamera({
      mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
      createVideo: fakeVideo,
    });
    const session = await camera.open();
    expect(session.surface.update()).toBe(true);
    expect(session.surface.width).toBe(640);
    expect(session.surface.height).toBe(480);
  });

  it('stops every track on close, and is idempotent (FR-004)', async () => {
    const { stream, stop } = fakeStream();
    const camera = new GetUserMediaCamera({
      mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
      createVideo: fakeVideo,
    });
    const session = await camera.open();

    session.close();
    session.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops the tracks when the stream itself fails to start', async () => {
    const { stream, stop } = fakeStream();
    const camera = new GetUserMediaCamera({
      mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
      createVideo: () => {
        const video = fakeVideo();
        video.play = () => Promise.reject(new Error('interrupted'));
        return video;
      },
    });
    // A camera acquired and then abandoned would leave the light on with nothing showing.
    await expect(camera.open()).rejects.toThrow(CameraError);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('delivers frames through requestVideoFrameCallback when the browser has it', async () => {
    const { stream } = fakeStream();
    let scheduled: ((now: number) => void) | null = null;
    const camera = new GetUserMediaCamera({
      mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
      createVideo: () => {
        const video = fakeVideo();
        (video as unknown as Record<string, unknown>)['requestVideoFrameCallback'] = (
          callback: (now: number) => void,
        ) => {
          scheduled = callback;
          return 1;
        };
        return video;
      },
    });

    const session = await camera.open();
    const seen: number[] = [];
    const stopFrames = session.onFrame((t) => seen.push(t));

    expect(scheduled).not.toBeNull();
    scheduled!(16.7);
    expect(seen).toEqual([16.7]);

    stopFrames();
    scheduled!(33.4);
    expect(seen).toEqual([16.7]);
  });
});
