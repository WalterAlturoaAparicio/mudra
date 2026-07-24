"""Live application orchestrator.

Wires a :class:`~app.camera.source.VideoSource`, a
:class:`~app.detection.detector.HandDetector`, and a
:class:`~app.visualization.renderer.FrameRenderer` into a single real-time loop:
read -> (mirror) -> detect -> render -> display -> poll for exit. Collaborators
are injected (constitution Principle I); shutdown always releases the camera and
destroys windows (spec FR-010, SC-005).
"""

from __future__ import annotations

import time

import cv2

from app.camera.source import CameraUnavailableError, VideoSource
from app.config.models import AppConfig
from app.core.fps_meter import FpsMeter
from app.detection.detector import HandDetector
from app.utils.logging import logger
from app.visualization.renderer import FrameRenderer

__all__ = ["LiveApp"]

_WINDOW_NAME = "Mudra - Live Camera"
_KEY_Q = ord("q")
_KEY_ESC = 27


class LiveApp:
    """Runs the Phase-1 live camera hand-detection loop."""

    def __init__(
        self,
        source: VideoSource,
        detector: HandDetector,
        renderer: FrameRenderer,
        config: AppConfig,
        fps_meter: FpsMeter,
    ) -> None:
        """Store injected collaborators; construct nothing here."""
        self._source = source
        self._detector = detector
        self._renderer = renderer
        self._config = config
        self._fps_meter = fps_meter

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
        cv2.namedWindow(_WINDOW_NAME, cv2.WINDOW_AUTOSIZE)
        mirror = self._config.visualization.mirror

        while True:
            frame = self._source.read()
            if frame is None:
                logger.trace("No frame this tick; skipping.")
                if self._should_exit():
                    break
                continue

            if mirror:
                frame = cv2.flip(frame, 1)

            detection = self._detector.detect(frame)
            self._fps_meter.update(time.monotonic())
            annotated = self._renderer.render(frame, detection, self._fps_meter.fps)

            cv2.imshow(_WINDOW_NAME, annotated)
            logger.trace("Rendered frame with {} hand(s).", detection.hand_count)

            if self._should_exit():
                break

    @staticmethod
    def _should_exit() -> bool:
        """Return ``True`` if the user pressed q/Esc or closed the window."""
        key = cv2.waitKey(1) & 0xFF
        if key in (_KEY_Q, _KEY_ESC):
            return True
        # Window closed via the native X button.
        try:
            if cv2.getWindowProperty(_WINDOW_NAME, cv2.WND_PROP_VISIBLE) < 1:
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
