"""Tests for the live loop's countdown wiring (OpenCV window calls stubbed)."""

from __future__ import annotations

import numpy as np
import pytest
from engine.camera.source import Frame
from engine.config.models import AppConfig
from engine.core import live_app as live_app_module
from engine.core.fps_meter import FpsMeter
from engine.core.live_app import LiveApp
from engine.core.recording_port import RecordingController
from engine.models.countdown import CountdownTick
from engine.models.landmarks import FrameDetection

from tests.unit.factories import make_frame_detection

_KEY_NONE = 255
_KEY_R = ord("r")
_KEY_Q = ord("q")
_KEY_ESC = 27


class FakeSource:
    """Yields a fixed number of frames, then a sentinel that ends nothing."""

    def __init__(self) -> None:
        self.released = False

    def open(self) -> None:
        pass

    def read(self) -> Frame:
        return np.zeros((48, 64, 3), dtype=np.uint8)

    def release(self) -> None:
        self.released = True


class FakeDetector:
    """Returns the same one-hand detection for every frame."""

    def __init__(self) -> None:
        self.closed = False

    def detect(self, frame: Frame) -> FrameDetection:
        return make_frame_detection()

    def close(self) -> None:
        self.closed = True


class FakeRenderer:
    """Passes the frame through untouched."""

    def render(self, frame: Frame, detection: FrameDetection, fps: float) -> Frame:
        return frame


class FakeCountdownRenderer:
    """Records the ticks it was asked to draw."""

    def __init__(self) -> None:
        self.ticks: list[CountdownTick] = []

    def render_countdown(self, frame: Frame, tick: CountdownTick) -> Frame:
        self.ticks.append(tick)
        return frame


class FakeController(RecordingController):
    """A scripted recording controller that counts down over N update() calls."""

    def __init__(self, frames_to_capture: int = 2) -> None:
        self.frames_to_capture = frames_to_capture
        self.remaining = 0
        self.requests = 0
        self.cancels = 0
        self.captured_detections: list[FrameDetection] = []

    @property
    def is_active(self) -> bool:
        return self.remaining > 0

    def request_capture(self) -> bool:
        if self.is_active:
            return False
        self.requests += 1
        self.remaining = self.frames_to_capture
        return True

    def update(self, frame: Frame, detection: FrameDetection) -> CountdownTick | None:
        if not self.is_active:
            return None
        self.remaining -= 1
        if self.remaining == 0:
            self.captured_detections.append(detection)
            return None
        return CountdownTick(
            total_seconds=3.0, elapsed_seconds=1.0, remaining_seconds=2.0, finished=False
        )

    def cancel(self) -> bool:
        if not self.is_active:
            return False
        self.remaining = 0
        self.cancels += 1
        return True


@pytest.fixture
def keys(monkeypatch: pytest.MonkeyPatch):
    """Script the keys cv2.waitKey returns, and stub the window calls."""

    def install(sequence: list[int]) -> None:
        pending = list(sequence)

        def wait_key(_delay: int) -> int:
            return pending.pop(0) if pending else _KEY_Q  # always terminates

        monkeypatch.setattr(live_app_module.cv2, "waitKey", wait_key)
        monkeypatch.setattr(live_app_module.cv2, "imshow", lambda *args: None)
        monkeypatch.setattr(live_app_module.cv2, "namedWindow", lambda *args: None)
        monkeypatch.setattr(live_app_module.cv2, "destroyAllWindows", lambda: None)
        monkeypatch.setattr(live_app_module.cv2, "getWindowProperty", lambda *args: 1.0)
        monkeypatch.setattr(live_app_module.cv2, "flip", lambda frame, _code: frame)

    return install


def _app(controller: FakeController | None, overlay: FakeCountdownRenderer | None) -> LiveApp:
    return LiveApp(
        FakeSource(),
        FakeDetector(),
        FakeRenderer(),
        AppConfig(),
        FpsMeter(window=30),
        controller,
        overlay,
    )


def test_r_arms_the_countdown_and_the_loop_keeps_running(keys) -> None:
    keys([_KEY_R, _KEY_NONE, _KEY_NONE, _KEY_Q])
    controller, overlay = FakeController(frames_to_capture=3), FakeCountdownRenderer()

    assert _app(controller, overlay).run() == 0
    assert controller.requests == 1
    assert len(controller.captured_detections) == 1  # captured, without blocking on R
    assert len(overlay.ticks) == 2  # live frames drawn with the countdown overlay


def test_countdown_overlay_is_optional(keys) -> None:
    keys([_KEY_R, _KEY_NONE, _KEY_NONE, _KEY_Q])
    controller = FakeController(frames_to_capture=3)

    assert _app(controller, None).run() == 0
    assert len(controller.captured_detections) == 1


def test_q_cancels_a_pending_countdown_instead_of_exiting(keys) -> None:
    keys([_KEY_R, _KEY_Q, _KEY_NONE, _KEY_Q])
    controller = FakeController(frames_to_capture=5)

    assert _app(controller, FakeCountdownRenderer()).run() == 0
    assert controller.cancels == 1
    assert controller.captured_detections == []  # nothing captured


def test_esc_cancels_a_pending_countdown(keys) -> None:
    keys([_KEY_R, _KEY_ESC, _KEY_NONE, _KEY_Q])
    controller = FakeController(frames_to_capture=5)

    assert _app(controller, FakeCountdownRenderer()).run() == 0
    assert controller.cancels == 1


def test_q_exits_when_no_recording_is_pending(keys) -> None:
    keys([_KEY_NONE, _KEY_Q])
    controller = FakeController()
    app = _app(controller, FakeCountdownRenderer())

    assert app.run() == 0
    assert controller.cancels == 0
    assert controller.requests == 0


def test_loop_without_a_recording_controller_ignores_r(keys) -> None:
    keys([_KEY_R, _KEY_NONE, _KEY_Q])
    assert _app(None, None).run() == 0  # Phase-1 behaviour preserved
