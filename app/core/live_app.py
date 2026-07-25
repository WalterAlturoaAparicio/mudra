"""Live application orchestrator.

Wires a :class:`~app.camera.source.VideoSource`, a
:class:`~app.detection.detector.HandDetector`, and a
:class:`~app.visualization.renderer.FrameRenderer` into a single real-time loop:
read -> (mirror) -> detect -> render -> drive the recording countdown -> display ->
poll keys. Collaborators are injected (constitution Principle I); shutdown always
releases the camera and destroys windows (spec FR-010, SC-005).

Recording is countdown-driven: **R** arms the countdown and the loop keeps running
at full rate (never sleeping), so the preview stays live while the user positions
both hands; ``q``/``Esc`` cancels the countdown instead of exiting the app.
"""

from __future__ import annotations

import time

import cv2

from app.camera.source import CameraUnavailableError, Frame, VideoSource
from app.config.models import AppConfig
from app.core.fps_meter import FpsMeter
from app.core.recording_port import RecordingController
from app.detection.detector import HandDetector
from app.models.countdown import CountdownTick
from app.models.landmarks import FrameDetection
from app.utils.logging import logger
from app.visualization.renderer import CountdownRenderer, FrameRenderer

__all__ = ["LiveApp", "WINDOW_NAME"]

#: Title of the OpenCV display window (shared with the recording controller).
WINDOW_NAME = "Mudra - Live Camera"
_KEY_Q = ord("q")
_KEY_ESC = 27
_KEY_R = ord("r")


class LiveApp:
    """Runs the live camera hand-detection loop (and, if configured, pose recording)."""

    def __init__(
        self,
        source: VideoSource,
        detector: HandDetector,
        renderer: FrameRenderer,
        config: AppConfig,
        fps_meter: FpsMeter,
        recording_controller: RecordingController | None = None,
        countdown_renderer: CountdownRenderer | None = None,
    ) -> None:
        """Store injected collaborators; construct nothing here.

        When ``recording_controller`` is ``None`` the loop behaves exactly as
        Phase 1 (display only) and the R key does nothing. ``countdown_renderer``
        draws the pre-capture overlay; without it the countdown still runs, just
        without on-screen feedback.
        """
        self._source = source
        self._detector = detector
        self._renderer = renderer
        self._config = config
        self._fps_meter = fps_meter
        self._recording_controller = recording_controller
        self._countdown_renderer = countdown_renderer

    def run(self) -> int:
        """Execute the live loop until the user exits.

        Returns:
            Process exit code: ``0`` on a clean exit, ``1`` if the camera could
            not be opened.
        """
        logger.info(
            "Mudra live camera starting (camera index={}, mirror={}, model_complexity={}).",
            self._config.camera.index,
            self._config.visualization.mirror,
            self._config.detection.model_complexity,
        )
        try:
            self._source.open()
        except CameraUnavailableError as error:
            logger.error(str(error))
            self._detector.close()
            return 1

        try:
            self._loop()
        finally:
            self._shutdown()
        return 0

    def _loop(self) -> None:
        """Main capture/detect/render/display loop."""
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_AUTOSIZE)
        mirror = self._config.visualization.mirror
        counting_down = False

        while True:
            frame = self._source.read()
            if frame is None:
                logger.trace("No frame this tick; skipping.")
                if self._exit_requested(cv2.waitKey(1) & 0xFF):
                    break
                continue

            if mirror:
                frame = cv2.flip(frame, 1)

            detection = self._detector.detect(frame)
            self._fps_meter.update(time.monotonic())
            annotated = self._renderer.render(frame, detection, self._fps_meter.fps)

            # Drive the recording workflow before display: on the frame the countdown
            # reaches zero this captures *this* frame (and blocks for the prompts).
            tick = self._update_recording(frame, detection)
            if tick is not None and self._countdown_renderer is not None:
                annotated = self._countdown_renderer.render_countdown(annotated, tick)
            if counting_down and tick is None:
                # Capture or cancel just finished: drop the paused interval from the FPS average.
                self._fps_meter.reset()
            counting_down = tick is not None

            cv2.imshow(WINDOW_NAME, annotated)
            logger.trace("Rendered frame with {} hand(s).", detection.hand_count)

            key = cv2.waitKey(1) & 0xFF
            if key == _KEY_R and self._recording_controller is not None:
                self._recording_controller.request_capture()
                continue
            if key in (_KEY_Q, _KEY_ESC) and self._cancel_recording():
                continue  # q/Esc aborts a pending capture instead of exiting
            if self._exit_requested(key):
                break

    def _update_recording(self, frame: Frame, detection: FrameDetection) -> CountdownTick | None:
        """Advance the recording controller by one frame; ``None`` when inactive."""
        if self._recording_controller is None:
            return None
        return self._recording_controller.update(frame, detection)

    def _cancel_recording(self) -> bool:
        """Cancel a pending countdown, returning ``True`` if one was cancelled."""
        return self._recording_controller is not None and self._recording_controller.cancel()

    @staticmethod
    def _exit_requested(key: int) -> bool:
        """Return ``True`` if ``key`` is q/Esc or the window was closed."""
        if key in (_KEY_Q, _KEY_ESC):
            return True
        # Window closed via the native X button.
        try:
            if cv2.getWindowProperty(WINDOW_NAME, cv2.WND_PROP_VISIBLE) < 1:
                return True
        except cv2.error:
            return True
        return False

    def _shutdown(self) -> None:
        """Release all resources and log a clean shutdown line."""
        self._source.release()
        self._detector.close()
        cv2.destroyAllWindows()
        logger.info("Mudra live camera stopped cleanly.")
