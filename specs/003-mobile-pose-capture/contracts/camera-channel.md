# Contract: Camera & Landmark Platform Channel (Kotlin ⇄ Dart)

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-26 (**Revision R1**)

**Supersedes** [platform-channel.md](./platform-channel.md), which described the pre-R1 contract
(front camera only, fixed preview size, `start`/`stop`/`dispose`).

The single platform seam in the application. Everything above it is pure Dart; everything below it is
Android-specific. An iOS implementation satisfies **this same contract** with Swift + AVFoundation and
requires no change anywhere else (research D13, FR-114).

The contract is expressed in **lens position, preview dimensions, mirroring, and lifecycle** — never
in a platform's camera API (FR-112).

## Channel names

| Channel | Name | Purpose |
|---|---|---|
| `MethodChannel` | `mudra.capture/camera` | Lens enumeration, session open/close |
| `EventChannel` | `mudra.capture/camera/frames` | Continuous landmark frame stream |

**(R1)** Renamed from `mudra.capture/landmarks*`: after R1 this channel owns camera acquisition and
lens selection, not only landmark delivery. The rename is deliberate — a name that under-describes a
platform seam is how the seam ends up misused.

## Methods (`MethodChannel`)

### `availableLenses() → List<String>`

Returns the lens positions the device can actually provide, from `{"front", "rear"}`. Never throws for
an absent lens — absence is data, and FR-064/FR-069 need it *before* a user taps something that would
fail.

Called once when the capture screen opens, so an unavailable mode can be disabled with a stated reason
rather than failing at the moment of use.

### `open({String lens, int analysisWidth, int analysisHeight}) → Map`

Acquires the camera and detector; returns once the preview surface is available.

**Lens selection is explicit and mandatory** (FR-044): the implementation MUST bind the requested lens
and MUST NOT fall back to a platform default or substitute the other lens. A requested lens the device
does not have fails with `lens_unavailable`.

**(R1) What changed**: the pre-R1 `start` took no arguments and hardcoded
`CameraSelector.DEFAULT_FRONT_CAMERA`. R1 permits either lens; the anti-corruption guarantee moved
from *refusing the rear lens* to *converting rear-lens captures into the canonical convention before
storage* (FR-053, research D17). The rejection rule survives for configurations that genuinely cannot
be recorded correctly.

**Returns**:

| Key | Type | Notes |
|---|---|---|
| `textureId` | `int` | Preview surface handle for the `Texture` widget |
| `previewWidth` / `previewHeight` | `int` | **Display-oriented** preview size, actually in use — see *Preview dimensions* below (FR-099) |
| `analysisWidth` / `analysisHeight` | `int` | Analysis frame dimensions — the resolution landmarks are normalized against, written into `metadata.camera.width/height` |
| `lens` | `String` | `"front"` or `"rear"`; MUST equal what was requested. Written into `metadata.camera.position` (FR-081) |
| `mirrored` | `bool` | Whether the delivered frames and preview are in the mirrored (canonical) convention. Written into `metadata.camera.mirrored_preview` (FR-082) |
| `platformLensId` | `int` | The platform's own lens identifier, preserved verbatim — Android `CameraSelector` lens-facing (`0` back, `1` front). Written into `metadata.camera.lens_facing` (FR-084) |
| `rotationDegrees` | `int` | Rotation applied to reach display orientation; reported so `previewWidth/Height` are auditable rather than inferred |
| `detectorVersion` | `String?` | Written into `metadata.versions.mediapipe` |
| `deviceManufacturer` / `deviceModel` / `osVersion` | `String` | Feed the export manifest's `device` block (FR-047) |

**Errors** (`PlatformException.code`), each mapping to a distinct user-facing explanation and route out
(FR-107–FR-111, SC-029):

| Code | Meaning | Route out |
|---|---|---|
| `camera_permission_denied` | Permission refused | Request again |
| `camera_permission_permanently_denied` | Refused with "don't ask again" | Open system settings (FR-110) |
| `camera_busy` | Another application holds the camera | Retry (FR-108) |
| `lens_unavailable` | Requested lens absent | Other lens / other mode stays usable |
| `model_unavailable` | Detector model failed to load | Retry |
| `camera_start_failed` | Any other platform failure | Retry |

`already_open` is **not** an error code: `open` while a session is live MUST close the existing session
first, so the single-session invariant (FR-092) cannot be violated even by a caller that misbehaves.
The Dart-side controller already serializes requests (research D15); the native guarantee is the
backstop.

### `close() → void`

Releases **everything** the session acquired: camera binding, preview surface, analysis stream,
detector, and any background worker (FR-086).

**Contract**: idempotent (FR-095); completes even when the preceding `open` failed partway; MUST NOT
leave a preview surface, an executor, or a camera binding alive; MUST emit no further frames after it
returns. After `close` returns, another application must be able to acquire the camera immediately
(FR-087, SC-020).

**(R1) What changed**: the pre-R1 contract split release across `stop` (unbind + close detector) and
`dispose` (release texture, shut down executor). That split is the leak FR-086 names — `stop` alone
left the preview surface alive, and `dispose` shut down a non-restartable executor. R1 replaces both
with one total operation.

## Preview dimensions

`previewWidth`/`previewHeight` MUST be the dimensions the preview will actually be **displayed** at:

- taken from the surface the platform provides, never from a compile-time constant;
- already adjusted for `rotationDegrees`, so a portrait screen consuming a landscape sensor stream
  receives the ratio it will render.

Dart derives the preview aspect ratio from these values alone and letterboxes or pillarboxes to it
(FR-097–FR-099). Reporting a wrong or assumed size produces a distorted preview that no amount of
Dart-side layout can correct — which is exactly the pre-R1 behaviour, where `720×1280` was hardcoded.

## Event stream (`EventChannel`)

One event per **detected frame**, including frames where zero hands were found — the capture session
must count those as discarded, so silence is not an acceptable encoding of "no hands".

**Event payload** (`Map<Object?, Object?>`):

| Key | Type | Notes |
|---|---|---|
| `t` | `int` | Capture timestamp, microseconds, monotonic |
| `w` / `h` | `int` | Analysis frame dimensions |
| `mirrored` | `bool` | **(R1)** Convention these coordinates are in. Normally constant for a session; carried per frame so the conversion is a function of the data, never of ambient state |
| `hands` | `List<Map>` | 0..N entries, detector order |

**Each hand entry**:

| Key | Type | Notes |
|---|---|---|
| `handedness` | `String` | `"left"` / `"right"` / anything else → `unknown` |
| `score` | `double` | Handedness classification confidence `[0,1]` |
| `lm` | `Float32List` | **63 floats**: `x0,y0,z0, x1,y1,z1, …, x20,y20,z20` |

`lm` is a typed data list, not a nested map or JSON string — it crosses the boundary as raw bytes,
which is what keeps the per-frame cost near zero at 30 fps (research D3).

**Native emits detector output verbatim.** Canonicalization is a Dart-side domain transform (research
D17), so the two platforms cannot drift in how they apply it and it stays unit-testable on the host.

**Stream errors** are delivered as `PlatformException` with the same codes as `open`, plus
`detector_failure`, `camera_disconnected` (the lens went away mid-session), and `orientation_changed`.
The Dart side surfaces them as a session failure; it never crashes the app.

## Ordering and lifecycle guarantees

1. `open` MUST complete before any frame is emitted.
2. Frames arrive in non-decreasing `t` order.
3. The analyzer uses **keep-only-latest** back-pressure: under load frames are *dropped*, never
   queued. A dropped frame is invisible to Dart — it simply never arrives, which is correct: a stale
   landmark set is worse than a missing one.
4. `close` MUST NOT emit further frames after it returns.
5. Losing the camera (another app, a phone call, a lens disconnect) MUST emit a stream error, not
   silence.
6. **(R1)** Frames emitted between an `open` and its matching `close` belong to exactly that session.
   A superseded session's frames MUST NOT reach a later one — the native side stops emitting on
   `close`, and Dart drops any frame whose session is no longer current (research D15).

## Mirroring, handedness, and the canonical convention

The front lens produces a mirrored image; the rear lens does not. MediaPipe derives the `handedness`
label **assuming a mirrored input**, so:

- **Front lens** (`mirrored: true`): the label already names the user's physical hand. Dart stores it
  as received — no flipping, no relabelling. This is the canonical convention, and every sample
  collected before R1 is in it.
- **Rear lens** (`mirrored: false`): the label and the geometry are both in the opposite convention.
  Dart converts before storage — `x → 1 − x` and `left ↔ right` — so the stored sample is
  indistinguishable in convention from a front-lens one (FR-053/FR-054).

**Auditable, not invisible** (FR-058): the sample still records the lens and mirroring actually used.
What was used and what was stored are separate facts, and both are in the dataset.

**Verification, not assumption**: the Dart source asserts that the returned `lens` equals the
requested one and that `mirrored` is consistent with it, raising `CameraFailure` otherwise. A silent
substitution here would mislabel every hand in the dataset, undetectably.

## Orientation (FR-049/FR-050)

**(R1.1)** Screen orientation is locked for the whole **capture session** — from entering the capture
screen until leaving it — not merely while a take runs. A camera session therefore never observes an
orientation change, and the preview dimensions it reports at `open` stay valid for its whole life.

If the native side detects an orientation change anyway, it MUST emit a stream error with code
`orientation_changed`; Dart abandons any in-flight recording session, writes nothing, and returns to
idle **without releasing the camera** — the screen stays ready for the next take (FR-076).

## Dart-side interface

The channel is an implementation detail of `MethodChannelCameraSource` and
`MethodChannelCameraSession`, which implement the domain ports:

```dart
abstract interface class CameraSource {
  Future<Set<LensPosition>> availableLenses();
  Future<CameraSession> open(CameraRequest request);
}

abstract interface class CameraSession {
  CameraSessionInfo get info;
  Stream<LandmarkFrame> get frames;
  Future<void> close();
}
```

Tests substitute `FakeCameraSource`, which scripts the lens set, the frames, open failures, and open
latency with no platform involved (research D22) — which is what makes SC-030 ("the workflow runs with
no physical camera") verifiable rather than aspirational.

## Native implementation notes (Android)

- **One `CameraXController` instance per session** (research D16). The plugin constructs it on `open`
  and drops the reference on `close`, so the analysis executor, the preview surface entry, and the
  detector all have the session's lifetime. This is what makes `close` total by construction rather
  than by remembering to release each resource.
- **CameraX** binds `Preview` (into a `SurfaceTexture` from Flutter's `TextureRegistry`) and
  `ImageAnalysis` (`STRATEGY_KEEP_ONLY_LATEST`, RGBA_8888) from one `ProcessCameraProvider`, so the
  device has exactly one owner (research D2).
- **Preview resolution** comes from `SurfaceRequest.resolution` — the size the camera actually chose —
  and `setDefaultBufferSize` is set from it. The pre-R1 `PREVIEW_WIDTH`/`PREVIEW_HEIGHT` constants are
  removed.
- **Lens availability** is queried with `hasCamera(CameraSelector)` for both selectors, feeding
  `availableLenses()`.
- **MediaPipe Tasks** `HandLandmarker` runs in `LIVE_STREAM` mode with `numHands = 2`; results arrive
  on its result listener and are forwarded to the event sink **on the main thread**.
- The model file ships at `android/app/src/main/assets/hand_landmarker.task` — the same file the
  engine uses, so both produce identical landmarks.
- All native errors are converted to `PlatformException`; nothing throws into the Flutter engine.
