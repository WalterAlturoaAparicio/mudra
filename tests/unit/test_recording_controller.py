"""Tests for the countdown-driven recording controller (GUI calls stubbed)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import StringIO

import numpy as np
import pytest
from engine.config.models import CameraConfig, RecordingConfig
from engine.core.countdown import CountdownTimer
from engine.core.recording_port import RecordingController
from engine.models.landmarks import FrameDetection, Handedness
from engine.models.pose import VersionInfo
from engine.recording import controller as controller_module
from engine.recording.controller import PoseRecordingController
from engine.recording.recorder import PoseRecorderService
from engine.recording.state import RecordingState
from engine.recording.validation import PoseValidationService
from rich.console import Console

from tests.unit.factories import make_frame_detection, make_hand_detection
from tests.unit.test_countdown import FakeClock
from tests.unit.test_recorder import FakeNormalizer, FakeRepository


@pytest.fixture(autouse=True)
def _no_gui(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the OpenCV window calls so the workflow runs headless."""
    monkeypatch.setattr(controller_module.cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(controller_module.cv2, "waitKey", lambda *args: -1)


class FakePrompts:
    """Scripted terminal answers; ``None`` entries cancel the prompt."""

    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.calls = 0

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def ask(*_args: object, **_kwargs: object) -> str:
            self.calls += 1
            return self.answers.pop(0) if self.answers else ""

        monkeypatch.setattr(controller_module.Prompt, "ask", ask)


class WallClock:
    """A manually advanced UTC clock for the recorded timestamps."""

    def __init__(self) -> None:
        self.now = datetime(2026, 7, 24, 13, 20, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def _frame() -> np.ndarray:
    return np.zeros((48, 64, 3), dtype=np.uint8)


def _build(
    countdown_seconds: float = 3.0,
) -> tuple[PoseRecordingController, FakeRepository, FakeClock, WallClock]:
    repo = FakeRepository()
    monotonic, wall = FakeClock(), WallClock()
    recorder = PoseRecorderService(
        validator=PoseValidationService(RecordingConfig()),
        normalizer=FakeNormalizer(),
        repository=repo,
        versions=VersionInfo(application="0.1.0", mediapipe=None),
        camera=CameraConfig(),
        clock=wall,
        uuid_factory=lambda: "u",
    )
    controller = PoseRecordingController(
        recorder=recorder,
        validator=PoseValidationService(RecordingConfig()),
        config=RecordingConfig(recording_countdown_seconds=countdown_seconds),
        console=Console(file=StringIO(), width=120),
        window_name="test",
        countdown=CountdownTimer(countdown_seconds, monotonic),
        clock=wall,
    )
    return controller, repo, monotonic, wall


def _advance(
    controller: PoseRecordingController,
    monotonic: FakeClock,
    wall: WallClock,
    seconds: float,
    steps: int = 1,
) -> None:
    """Feed the controller ``steps`` live frames spanning ``seconds``."""
    for _ in range(steps):
        monotonic.advance(seconds / steps)
        wall.advance(seconds / steps)
        controller.update(_frame(), make_frame_detection())


def test_controller_satisfies_the_recording_port() -> None:
    controller, _, _, _ = _build()
    assert isinstance(controller, RecordingController)


def test_request_starts_countdown_without_capturing() -> None:
    controller, repo, _, _ = _build()
    assert controller.request_capture() is True
    assert controller.state is RecordingState.COUNTDOWN
    assert controller.is_active is True
    assert repo.saved is None


def test_update_reports_ticks_and_captures_nothing_before_zero() -> None:
    controller, repo, monotonic, _ = _build()
    controller.request_capture()

    assert controller.update(_frame(), make_frame_detection()).display_value == 3
    monotonic.advance(1.0)
    assert controller.update(_frame(), make_frame_detection()).display_value == 2
    monotonic.advance(1.0)
    assert controller.update(_frame(), make_frame_detection()).display_value == 1
    assert repo.saved is None
    assert controller.state is RecordingState.COUNTDOWN


def test_capture_fires_at_zero_and_saves(monkeypatch: pytest.MonkeyPatch) -> None:
    FakePrompts("open_palm", "", "").install(monkeypatch)
    controller, repo, monotonic, wall = _build()
    controller.request_capture()

    _advance(controller, monotonic, wall, 3.0, steps=3)

    assert repo.saved is not None
    assert repo.saved.pose.pose_id == "open_palm"
    assert controller.state is RecordingState.IDLE
    assert controller.is_active is False


def test_the_frame_at_zero_is_the_one_captured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hands seen mid-countdown are ignored; only the zero-instant detection counts."""
    FakePrompts("open_palm", "", "").install(monkeypatch)
    controller, repo, monotonic, _ = _build()
    two_hands = make_frame_detection(
        hands=(
            make_hand_detection(handedness=Handedness.LEFT),
            make_hand_detection(handedness=Handedness.RIGHT),
        )
    )
    empty = FrameDetection(hands=(), frame_width=64, frame_height=48, timestamp=0.0)

    controller.request_capture()
    controller.update(_frame(), empty)  # no hands yet — must not reject or capture
    monotonic.advance(3.0)
    controller.update(_frame(), two_hands)

    assert repo.saved is not None
    assert repo.saved.metadata.num_hands == 2


def test_timestamps_are_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    FakePrompts("open_palm", "", "").install(monkeypatch)
    controller, repo, monotonic, wall = _build()
    controller.request_capture()
    _advance(controller, monotonic, wall, 3.0, steps=3)

    capture = repo.saved.metadata.capture
    assert capture is not None
    assert capture.countdown_start_time == "2026-07-24T13:20:00+00:00"
    assert capture.capture_time == "2026-07-24T13:20:03+00:00"
    assert capture.countdown_seconds == 3.0


def test_cancel_during_countdown_saves_nothing() -> None:
    controller, repo, monotonic, _ = _build()
    controller.request_capture()
    monotonic.advance(1.0)
    controller.update(_frame(), make_frame_detection())

    assert controller.cancel() is True
    assert controller.state is RecordingState.IDLE
    assert controller.is_active is False
    assert repo.saved is None

    monotonic.advance(5.0)
    assert controller.update(_frame(), make_frame_detection()) is None  # never fires
    assert repo.saved is None


def test_cancel_when_idle_is_a_no_op() -> None:
    controller, _, _, _ = _build()
    assert controller.cancel() is False


def test_request_ignored_while_already_counting_down() -> None:
    controller, _, monotonic, _ = _build()
    controller.request_capture()
    monotonic.advance(2.0)
    assert controller.request_capture() is False
    # The original countdown is untouched: 1s left, not 3.
    assert controller.update(_frame(), make_frame_detection()).display_value == 1


def test_update_is_inert_when_idle() -> None:
    controller, repo, _, _ = _build()
    assert controller.update(_frame(), make_frame_detection()) is None
    assert repo.saved is None


def test_invalid_capture_is_rejected_and_returns_to_idle() -> None:
    controller, repo, monotonic, _ = _build()
    empty = FrameDetection(hands=(), frame_width=64, frame_height=48, timestamp=0.0)
    controller.request_capture()
    monotonic.advance(3.0)
    controller.update(_frame(), empty)

    assert repo.saved is None
    assert controller.state is RecordingState.IDLE  # ready for another attempt


def test_blank_pose_id_cancels_without_saving(monkeypatch: pytest.MonkeyPatch) -> None:
    FakePrompts("").install(monkeypatch)
    controller, repo, monotonic, _ = _build()
    controller.request_capture()
    monotonic.advance(3.0)
    controller.update(_frame(), make_frame_detection())

    assert repo.saved is None
    assert controller.state is RecordingState.IDLE


def test_zero_countdown_captures_on_the_next_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    FakePrompts("open_palm", "", "").install(monkeypatch)
    controller, repo, _, _ = _build(countdown_seconds=0.0)
    controller.request_capture()
    assert controller.update(_frame(), make_frame_detection()) is None
    assert repo.saved is not None


def test_recording_can_be_repeated(monkeypatch: pytest.MonkeyPatch) -> None:
    FakePrompts("open_palm", "", "", "closed_fist", "", "").install(monkeypatch)
    controller, repo, monotonic, wall = _build()

    for _ in range(2):
        controller.request_capture()
        _advance(controller, monotonic, wall, 3.0, steps=3)

    assert repo.saved is not None
    assert repo.saved.pose.pose_id == "closed_fist"
