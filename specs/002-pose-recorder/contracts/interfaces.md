# Internal Interface Contracts: Pose Recorder

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

Phase 2 exposes no network API. Its contracts are the internal interfaces that keep domain,
normalization, storage, and I/O independent and replaceable (constitution Principles I & III).
All are `typing.Protocol`s; concretes are injected via constructors by `cli.py`.

---

## `Normalizer` (Protocol) — `app/normalization/normalizer.py`

```python
class Normalizer(Protocol):
    @property
    def strategy(self) -> str: ...   # e.g. "translation_scale"
    @property
    def version(self) -> str: ...    # e.g. "1.0"
    def normalize(self, hand: HandLandmarks) -> HandLandmarks: ...
```

**Contract**: pure and deterministic; returns a new 21-point `HandLandmarks`; never mutates
input; must not raise on a valid 21-landmark hand (degenerate scale → identity scale, logged).
`strategy`/`version` identify the algorithm so the recorder can stamp the sample's `normalization`
block truthfully (research D11), independent of config.

**Phase-2 implementation**: `TranslationScaleNormalizer(config: NormalizationConfig)` — wrist
(index `origin_index`) to origin, uniform scale by distance to `scale_index` (research D1).

---

## `PoseSerializer` — `app/dataset/serializer.py`

```python
SCHEMA_VERSION: int = 1

class PoseSerializer:
    def to_dict(self, sample: PoseSample) -> dict: ...          # ordered, schema-versioned
    def to_json(self, sample: PoseSample, *, indent: int) -> str: ...
    def from_dict(self, data: dict) -> PoseSample: ...          # validates schema_version + shape
    def from_json(self, text: str) -> PoseSample: ...
```

**Contract**: owns the wire schema ([json-schema.md](./json-schema.md)) and the `SCHEMA_VERSION`
constant; produces human-readable, indented, stable-field-order JSON; `from_*` validates the
document (including `schema_version`) and raises `PoseSchemaError` on mismatch/corruption. Holds
**no** filesystem logic. Round-trip MUST be lossless: `from_dict(to_dict(s)) == s`.

---

## `PoseRepository` (Protocol) — `app/dataset/repository.py`

```python
class PoseRepository(Protocol):
    def save(self, sample: PoseSample) -> SampleRef: ...
    def next_sample_number(self, pose_id: str) -> int: ...
    def count(self, pose_id: str) -> int: ...
    def list_sample_refs(self, pose_id: str) -> list[SampleRef]: ...
    def load(self, ref: SampleRef) -> PoseSample: ...
```

**Contract**:
- `save` assigns the sequential `sample_number`, persists **append-only**, and MUST NEVER
  overwrite an existing sample (FR-009/SC-002); returns a `SampleRef` (with `sample_uuid` +
  `sample_number`).
- Numbering is 1-based, contiguous-after-max (tolerates gaps), zero-padded to the configured
  width (research D4).
- Creates the pose collection on first save (FR-010).
- MUST NOT write anything except landmark+metadata records — never images (Principle II).
- Raises `PoseRepositoryError` on I/O failure with a descriptive message.

**Phase-2 implementation**: `JsonPoseRepository(config: DatasetConfig, serializer: PoseSerializer)`
— writes `datasets/poses/<pose_id>/sample_NNNNNN.json` with exclusive create (`open(path, "x")`).
Future: `SQLitePoseRepository`, `PostgresPoseRepository`, `CloudPoseRepository` — same interface.

---

## `PoseValidationService` — `app/recording/validation.py`

```python
class PoseValidationService:
    def __init__(self, config: RecordingConfig) -> None: ...
    def validate_capture(self, detection: FrameDetection) -> None: ...   # raises CaptureValidationError
    def validate_pose_id(self, pose_id: str) -> str: ...                 # returns normalized id or raises
```

**Contract**: `PoseValidationService` is the **single** validation entry point — there is no
parallel module-level validation function (research D12). It holds its `RecordingConfig` (pattern,
max length), so callers pass only values. `validate_capture` enforces ≥1 hand, exactly 21
landmarks per hand, and finite coordinates (data-model rules), raising `CaptureValidationError(
reason)` on the first failure (FR-003/FR-004). `validate_pose_id` enforces `^[a-z0-9_]+$` and
length, returning the safe id or raising `CaptureValidationError`. Future validation rules extend
this service. Pure; no I/O; unit-tested.

---

## `PoseRecorderService` — `app/recording/recorder.py`

```python
class PoseRecorderService:
    def __init__(self, validator: PoseValidationService, normalizer: Normalizer,
                 repository: PoseRepository, versions: VersionInfo,
                 camera: CameraConfig, clock: Callable[[], datetime],
                 uuid_factory: Callable[[], str] = lambda: str(uuid.uuid4())) -> None: ...
    def record(self, detection: FrameDetection, pose: Pose,
               timing: CaptureTiming | None = None) -> SampleRef: ...
```

**Contract**: orchestrates one recording — `validate_capture` → `normalize` each hand → mint
`sample_uuid` via `uuid_factory` → stamp `NormalizationInfo` from `normalizer.strategy/version` →
build `PoseMetadata` (from detection + camera config + injected `versions` + `clock` + the optional
`timing` block, which carries `countdown_start_time`/`capture_time`) → build
`PoseSample` → `repository.save` (which assigns `sample_number`); returns the `SampleRef`. Raises
`CaptureValidationError` (caught by the controller) if invalid; performs NO terminal or GUI I/O
(that is the controller's job). Fully unit-testable with fake
validator/normalizer/repository/clock and a deterministic `uuid_factory` (Principle I/IV).

---

## `CountdownTimer` — `app/core/countdown.py`

```python
class CountdownTimer:
    def __init__(self, duration_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    @property
    def duration_seconds(self) -> float: ...
    @property
    def is_running(self) -> bool: ...
    def start(self) -> CountdownTick: ...
    def tick(self) -> CountdownTick: ...   # raises CountdownNotRunningError when stopped
    def cancel(self) -> None: ...
```

**Contract**: a **poll-driven, non-blocking** countdown — `tick()` never sleeps, so the caller's
loop keeps running at full frame rate. It fires exactly once: the tick where `finished` is `True`
stops the timer (`is_running` → `False`). `cancel()` stops it without firing and is idempotent;
`start()` may be called again to restart. Duration `0` finishes on the first tick; a negative
duration raises `ValueError`. The clock is injected, so all timing is unit-testable without real
waiting. Deliberately **domain-agnostic** — sequence recording, calibration, benchmark runs, and
multiplayer sync reuse it unchanged. `CountdownTick` (`app/models/countdown.py`) is a frozen value
with `total_seconds`, `elapsed_seconds`, `remaining_seconds`, `finished`, `display_value` (`ceil`
of remaining → 3, 2, 1, 0), and `progress` (0..1).

---

## `StateMachine` / `RecordingStateMachine` — `app/core/state_machine.py`, `app/recording/state.py`

```python
class StateMachine[StateT: Enum]:
    def __init__(self, transitions: Mapping[StateT, frozenset[StateT]], initial: StateT,
                 on_transition: Callable[[StateT, StateT], None] | None = None) -> None: ...
    @property
    def state(self) -> StateT: ...
    def can(self, target: StateT) -> bool: ...
    def to(self, target: StateT) -> StateT: ...   # raises InvalidStateTransitionError
    def reset(self) -> StateT: ...                # terminal states only

class RecordingState(Enum):
    IDLE | COUNTDOWN | CAPTURED | VALIDATING | SAVING | COMPLETED | CANCELLED | FAILED
```

**Contract**: `StateMachine` is a generic, table-driven FSM over any `Enum`; undeclared transitions
raise `InvalidStateTransitionError` instead of silently corrupting the workflow, and `reset()` is
refused mid-workflow. `RecordingStateMachine` declares the recording lifecycle
`IDLE → COUNTDOWN → CAPTURED → VALIDATING → SAVING → COMPLETED`, with `CANCELLED` (user aborted)
and `FAILED` (rejected capture, save error, unexpected error) as the other terminal outcomes; every
active state can reach `FAILED`, and `abort()` is the recovery path back to `IDLE`. `is_active`
covers COUNTDOWN/CAPTURED/VALIDATING/SAVING.

---

## `CountdownRenderer` (Protocol) — `app/visualization/renderer.py`

```python
class CountdownRenderer(Protocol):
    def render_countdown(self, frame: Frame, tick: CountdownTick) -> Frame: ...
```

**Contract**: draws a pending-action countdown over the **live** frame; called every frame while a
countdown runs, so it must be cheap and must never block. It knows nothing about *what* is being
counted down to, so every future countdown workflow shares one overlay. May draw in place.

**Phase-2 implementation**: `CountdownOverlayRenderer(config: VisualizationConfig)` — dims the
frame (`countdown_dim`), then draws the caption (`countdown_prompt`), a large centered digit sized
by `countdown_digit_scale`, and the cancel hint (`countdown_hint`) in `countdown_color`.

---

## `RecordingController` (Protocol) — `app/core/recording_port.py`

```python
class RecordingController(Protocol):
    @property
    def is_active(self) -> bool: ...
    def request_capture(self) -> bool: ...
    def update(self, frame: Frame, detection: FrameDetection) -> CountdownTick | None: ...
    def cancel(self) -> bool: ...
```

**Contract**: the **port** `LiveApp` depends on, shaped around a countdown so the live feed is
never frozen while the user is still posing.
- `request_capture()` — called on **R**; arms the countdown and returns immediately (MUST NOT
  block); returns `False` if a recording is already in flight.
- `update(frame, detection)` — called **every** loop tick with the current (already-mirrored) frame
  and last `FrameDetection`. Returns the live `CountdownTick` while counting down (the loop renders
  it) or `None` when idle. On the tick the countdown reaches zero it freezes *that* frame and runs
  the capture workflow synchronously (validate → prompt → save).
- `cancel()` — aborts a running countdown, returning `True` if one was cancelled; no sample is
  created.

Implementations MUST resume cleanly (return) after any outcome and MUST NOT raise into the loop
(they handle/annotate their own errors → FR-017).

**Phase-2 implementation**: `PoseRecordingController(recorder, validator, config, console,
window_name, countdown, clock)` — drives a `RecordingStateMachine`; **R** starts the injected
`CountdownTimer` (`recording.recording_countdown_seconds`, default 3) and announces the pending
capture; at zero it stamps `capture_time`, draws the "RECORDING" overlay on the frozen frame,
validates, prompts in the terminal for `pose_id`/`display_name`/`description`, calls
`PoseRecorderService.record` with a `CaptureTiming(countdown_start_time, capture_time,
countdown_seconds)` block, and on success prints the result AND emits a structured INFO log with
`pose_id`, `sample_number`, `sample_uuid`, save location, `elapsed_duration_ms` (measured from the
capture instant, excluding the countdown), the countdown fields, hand count, and normalization
strategy (FR-016). Rejections/cancels return without saving and log a warning with the reason;
every outcome ends back at `IDLE`, ready for the next capture.

---

## `LiveApp` integration — `app/core/live_app.py` (modified)

- Constructor gains optional `recording_controller: RecordingController | None = None` and
  `countdown_renderer: CountdownRenderer | None = None` (both `None` preserves exact Phase-1
  behavior; without the renderer the countdown still runs, just unseen).
- Each tick, after rendering the landmark overlay, the loop calls `recording_controller.update(
  frame, detection)` and draws the returned tick (if any) via `countdown_renderer.render_countdown`
  — so the **preview stays live during the countdown** and is frozen only at the capture instant.
  The FPS average is reset when a workflow ends, discarding the paused interval.
- The **R** key (`ord("r")` = 114) calls `request_capture()`. `q`/`Esc` first try `cancel()`: while
  a countdown is pending they abort it (staying in the app), otherwise they exit as before.
  Window-close behavior is unchanged.

---

## Error types

| Error | Module | Raised when | Handled by |
|-------|--------|-------------|-----------|
| `CaptureValidationError(reason)` | `recording/validation.py` | invalid capture or `pose_id` | controller → shows reason, no save (FR-004) |
| `PoseSchemaError` | `dataset/serializer.py` | corrupt/incompatible document on load | callers/tests |
| `PoseRepositoryError` | `dataset/repository.py` | I/O failure during save/load | controller → shows error, logs |

---

## Supporting types

- **`VersionInfo`** (`app/recording/recorder.py` or `models/pose.py`): frozen `(application:
  str, mediapipe: str | None)`; built in `cli.py` from `app.__version__` and
  `getattr(mediapipe, "__version__", None)`, keeping the dataset/recording layers free of a
  mediapipe import (research D6).
- **`SampleRef`**: see [data-model.md](./data-model.md).
