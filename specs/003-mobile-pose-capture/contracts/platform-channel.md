# Contract: Landmark Platform Channel (Kotlin ⇄ Dart)

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

The single platform seam in the application. Everything above it is pure Dart; everything below it is
Android-specific. An iOS implementation satisfies **this same contract** with Swift + AVFoundation
and requires no change anywhere else (research D13).

## Channel names

| Channel | Name | Purpose |
|---|---|---|
| `MethodChannel` | `mudra.capture/landmarks` | Lifecycle control, one-shot queries |
| `EventChannel` | `mudra.capture/landmarks/frames` | Continuous landmark frame stream |

## Methods (`MethodChannel`)

### `start({int? width, int? height}) → Map`

Binds the camera and the detector; returns once the preview texture is available.

**Camera selection is explicit and mandatory** (FR-044): the implementation MUST bind
`CameraSelector.DEFAULT_FRONT_CAMERA` and MUST mirror the preview. It MUST NOT fall back to a
platform default, and MUST NOT substitute the rear camera when no front camera exists — it fails with
`camera_configuration_unsupported` instead. Recording against an unverified camera configuration
produces handedness labels that are wrong in a way neither application can detect afterwards, so the
failure is deliberate and loud.

**Returns**:

| Key | Type | Notes |
|---|---|---|
| `textureId` | `int` | Flutter texture id for the preview `Texture` widget |
| `previewWidth` / `previewHeight` | `int` | Preview surface dimensions |
| `analysisWidth` / `analysisHeight` | `int` | Analysis frame dimensions — the resolution landmarks are normalized against, written into `metadata.camera` |
| `lensFacing` | `int` | `1` (front) — written verbatim into `metadata.camera.index`. Any other value is a contract violation; Dart rejects it |
| `mirrored` | `bool` | MUST be `true`; Dart refuses to start a session otherwise |
| `mediapipeVersion` | `String?` | Written into `metadata.versions.mediapipe` |
| `deviceManufacturer` / `deviceModel` / `osVersion` | `String` | Feed the export manifest's `device` block (FR-047) |

**Errors** (`PlatformException.code`): `camera_permission_denied`, `camera_unavailable`,
`camera_configuration_unsupported` (no front camera, or mirroring unavailable), `model_unavailable`,
`already_started`.

### `stop() → void`

Unbinds camera use cases and closes the detector. Idempotent.

### `dispose() → void`

Releases the texture and all native resources. Idempotent; safe after `stop`.

## Event stream (`EventChannel`)

One event per **detected frame**, including frames where zero hands were found — the capture session
must count those as discarded, so silence is not an acceptable encoding of "no hands".

**Event payload** (`Map<Object?, Object?>`):

| Key | Type | Notes |
|---|---|---|
| `t` | `int` | Capture timestamp, microseconds, monotonic |
| `w` / `h` | `int` | Analysis frame dimensions |
| `hands` | `List<Map>` | 0..N entries, detector order |

**Each hand entry**:

| Key | Type | Notes |
|---|---|---|
| `handedness` | `String` | `"left"` / `"right"` / anything else → `unknown` |
| `score` | `double` | Handedness classification confidence `[0,1]` |
| `lm` | `Float32List` | **63 floats**: `x0,y0,z0, x1,y1,z1, …, x20,y20,z20` |

`lm` is a typed data list, not a nested map or JSON string — it crosses the boundary as raw bytes,
which is what keeps the per-frame cost near zero at 30 fps (research D3).

**Stream errors** are delivered as `PlatformException` with the same codes as `start`, plus
`detector_failure`. The Dart side surfaces them as a session `Failed` state; it never crashes the app.

## Ordering and lifecycle guarantees

1. `start` MUST complete before any frame is emitted.
2. Frames arrive in non-decreasing `t` order.
3. The analyzer uses **keep-only-latest** back-pressure: under load frames are *dropped*, never
   queued. A dropped frame is invisible to Dart — it simply never arrives, which is correct: a stale
   landmark set is worse than a missing one.
4. `stop` MUST NOT emit further frames after it returns.
5. Losing the camera (another app, a phone call) MUST emit a stream error, not silence.

## Mirroring and handedness

The preview is mirrored for the front camera (FR-037a/FR-044). MediaPipe assumes a mirrored input
image, so the `handedness` label already names the user's **physical** hand and Dart stores it as
received — no flipping, no relabelling. Landmark `x` values are in the same mirrored frame space,
matching the engine's selfie-view convention exactly.

**Verification, not assumption**: `MethodChannelHandLandmarkSource` asserts `lensFacing == 1` and
`mirrored == true` on every `start()` and raises `CameraFailure` otherwise. The values are then
carried into every sample's `metadata.camera.index`, so the camera a sample was recorded with is
recoverable from the dataset rather than inferred.

## Orientation (FR-049/FR-050)

Screen orientation is locked while a session runs. If the native side detects an orientation change
mid-session anyway, it MUST emit a stream error with code `orientation_changed`; Dart aborts the
session, writes nothing, and returns to idle. The analysis frame geometry a sample's coordinates
depend on therefore never changes underneath a session in progress.

## Dart-side interface

The channel is an implementation detail of `MethodChannelHandLandmarkSource`, which implements the
domain port:

```dart
abstract interface class HandLandmarkSource {
  Future<LandmarkSourceSession> start();
  Stream<LandmarkFrame> get frames;
  Future<void> stop();
  Future<void> dispose();
}
```

`LandmarkSourceSession` carries `textureId`, analysis dimensions, `lensFacing`, and
`mediapipeVersion`. Tests substitute `FakeHandLandmarkSource`, which emits scripted `LandmarkFrame`s
with no platform involved (research D12).

## Native implementation notes (Android)

- **CameraX** binds `Preview` (into a `SurfaceTexture` from Flutter's `TextureRegistry`) and
  `ImageAnalysis` (`STRATEGY_KEEP_ONLY_LATEST`, RGBA_8888) from one `ProcessCameraProvider`, so the
  device has exactly one owner (research D2).
- **MediaPipe Tasks** `HandLandmarker` runs in `LIVE_STREAM` mode with `numHands = 2`; results
  arrive on its result listener and are forwarded to the event sink **on the main thread**.
- The model file ships at `android/app/src/main/assets/hand_landmarker.task` — the same file the
  engine uses, so both produce identical landmarks.
- All native errors are converted to `PlatformException`; nothing throws into the Flutter engine.
