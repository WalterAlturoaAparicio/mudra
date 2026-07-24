"""OpenCV-backed :class:`~app.camera.source.VideoSource` implementation."""

from __future__ import annotations

import cv2

from app.camera.source import CameraUnavailableError, Frame, VideoSource
from app.config.models import CameraConfig

__all__ = ["OpenCVCameraSource"]


class OpenCVCameraSource(VideoSource):
    """Captures frames from a webcam via ``cv2.VideoCapture``."""

    def __init__(self, config: CameraConfig) -> None:
        """Store configuration; the device is opened lazily in :meth:`open`."""
        self._config = config
        self._capture: cv2.VideoCapture | None = None
        self._width = config.width
        self._height = config.height

    def open(self) -> None:
        """Open the configured camera index and apply capture settings.

        Raises:
            CameraUnavailableError: If the device cannot be opened.
        """
        capture = cv2.VideoCapture(self._config.index)
        if not capture.isOpened():
            capture.release()
            raise CameraUnavailableError(
                f"Could not open camera at index {self._config.index}. "
                "Is a webcam connected and not in use by another application?"
            )

        capture.set(cv2.CAP_PROP_FRAME_WIDTH, self._config.width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self._config.height)
        capture.set(cv2.CAP_PROP_FPS, self._config.target_fps)

        self._width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or self._config.width
        self._height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or self._config.height
        self._capture = capture

    def read(self) -> Frame | None:
        """Return the next frame, or ``None`` on a transient read miss."""
        if self._capture is None:
            raise CameraUnavailableError("read() called before open().")
        ok, frame = self._capture.read()
        if not ok or frame is None:
            return None
        return frame

    def release(self) -> None:
        """Release the underlying device if open."""
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    @property
    def width(self) -> int:
        """Actual capture width in pixels."""
        return self._width

    @property
    def height(self) -> int:
        """Actual capture height in pixels."""
        return self._height

    def __enter__(self) -> OpenCVCameraSource:
        """Open the device on context entry."""
        self.open()
        return self

    def __exit__(self, *exc: object) -> None:
        """Release the device on context exit."""
        self.release()
