# Internal Interface Contracts: Live Camera Hand Detection

**Feature**: 001-live-camera-detection | **Date**: 2026-07-24

Phase 1 exposes no network/API surface. Its "contracts" are the **internal Protocol interfaces**
that make backends swappable (constitution Principles I & III). Each is a `typing.Protocol`;
concrete classes implement them and are wired via constructor injection by `LiveApp`.

These signatures are the stable seams later phases (recording, recognition) build against — they
MUST NOT leak their backend types (no MediaPipe / OpenCV types in signatures except the raw frame
ndarray, which is the agreed transport type).

---

## `Frame` (type alias) — `app/camera/source.py`

```python
Frame = numpy.ndarray  # HxWx3, BGR, uint8 (OpenCV convention)
```

The single raw-pixel transport type. It is NOT persisted and NOT part of any saved artifact.

---

## `VideoSource` (Protocol) — `app/camera/source.py`

```python
class VideoSource(Protocol):
    def open(self) -> None: ...
    def read(self) -> Frame | None: ...       # None = no frame available this tick
    def release(self) -> None: ...
    @property
    def width(self) -> int: ...
    @property
    def height(self) -> int: ...
    def __enter__(self) -> "VideoSource": ...
    def __exit__(self, *exc: object) -> None: ...  # MUST release the device
```

**Contract**:
- `open()` MUST raise a clear, typed error (e.g. `CameraUnavailableError`) if the device cannot
  be opened — spec FR-012 / SC-006 (clean message, no crash; caller converts to exit).
- After `release()` / `__exit__`, the OS camera handle MUST be freed (spec SC-005).
- `read()` returning `None` is a transient miss, not fatal; the loop skips the frame.

**Phase-1 implementation**: `OpenCVCameraSource` (`cv2.VideoCapture`). Backend-swappable.

---

## `HandDetector` (Protocol) — `app/detection/detector.py`

```python
class HandDetector(Protocol):
    def detect(self, frame: Frame) -> FrameDetection: ...
    def close(self) -> None: ...
    def __enter__(self) -> "HandDetector": ...
    def __exit__(self, *exc: object) -> None: ...  # MUST close the model
```

**Contract**:
- Input `frame` is the frame to analyze (in Phase 1 the caller passes the already-mirrored frame;
  see research D3). `detect` MUST NOT mutate the input frame.
- Output is a `FrameDetection` with 0..`max_num_hands` `HandDetection`s. Each carries `handedness`
  (physical hand), `confidence` in `[0,1]` = the MediaPipe **handedness classification**
  confidence (the Left/Right label score, not a hand-"detection" score) (FR-008), and exactly 21
  landmarks (data-model invariant).
- MUST NOT persist, log per-hand at INFO+, or draw anything — detection only (Principles V & VI).
- Deterministic w.r.t. a given frame + config; no hidden global state (Principle I).

**Phase-1 implementation**: `MediaPipeHandDetector` — maps MediaPipe Tasks `HandLandmarker`
(VIDEO mode) output to `FrameDetection`. Backend-swappable.

---

## `FrameRenderer` (Protocol) — `app/visualization/renderer.py`

```python
class FrameRenderer(Protocol):
    def render(self, frame: Frame, detection: FrameDetection, fps: float) -> Frame: ...
```

**Contract**:
- Draws the 21-point overlay + skeleton (using `HAND_CONNECTIONS`) for every hand, plus the HUD:
  FPS, and per-hand handedness + handedness-classification confidence rendered as `Left 0.98` /
  `Right 0.96` (spec FR-005/006/007/008).
- Consumes ONLY the neutral data model — no MediaPipe types (Principle I, research D2).
- Returns the annotated frame for display; may draw in place. MUST handle `detection.hands == ()`
  by drawing just the HUD (no overlay), never erroring (spec Edge Cases).

**Phase-1 implementation**: `OpenCVOverlayRenderer` (cv2 primitives).

---

## `HandDetector` mapping requirements (backend adapter contract)

The MediaPipe adapter MUST, per detected hand (MediaPipe **Tasks** `HandLandmarkerResult`):

| Source (MediaPipe Tasks HandLandmarker) | Target (data model) |
|-----------------------------------------|---------------------|
| `result.hand_landmarks[i][k]` (x,y,z) | `Landmark(x, y, z, visibility=None)` |
| 21 landmarks | `HandLandmarks(points=tuple(...))` (len asserted 21) |
| `result.handedness[i][0].category_name` ("Left"/"Right") | `Handedness.LEFT/RIGHT` |
| `result.handedness[i][0].score` (handedness classification confidence) | `HandDetection.confidence` |
| frame shape | `FrameDetection.frame_width/height` |
| monotonic clock at capture | `FrameDetection.timestamp` |

If a label is missing/unrecognized → `Handedness.UNKNOWN` (never raise). VIDEO mode requires a
strictly increasing millisecond timestamp per `detect_for_video` call; the adapter enforces this.

---

## Error types — `app/core/` (or `app/camera/`)

| Error | Raised when | Handled by |
|-------|-------------|-----------|
| `CameraUnavailableError` | `VideoSource.open()` cannot open/access the device | `LiveApp` / CLI → log clear message, exit code ≠ 0, no traceback (FR-012, SC-006) |

## Orchestration contract — `LiveApp` — `app/core/live_app.py`

```python
class LiveApp:
    def __init__(self, source: VideoSource, detector: HandDetector,
                 renderer: FrameRenderer, config: AppConfig,
                 fps_meter: FpsMeter) -> None: ...
    def run(self) -> int: ...   # returns process exit code
```

**Contract**:
- Dependencies are **injected** (Principle I) — `LiveApp` constructs none of its collaborators,
  enabling tests with fakes.
- `run()` loops: read → (mirror if configured) → detect → render → show → poll key/window; exits
  on `q`/`Esc`/window-close; ALWAYS releases source + detector + windows in `finally`
  (SC-005); logs one startup and one shutdown line (FR-011); returns `0` on clean exit, non-zero
  on unrecoverable startup failure (e.g. `CameraUnavailableError`).
