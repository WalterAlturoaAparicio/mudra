"""Video capture interface.

Defines the neutral ``VideoSource`` Protocol that the live loop depends on, so
capture backends are swappable (constitution Principles I & III). The only
pixel-transport type in the system is :data:`Frame`.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

__all__ = ["Frame", "VideoSource", "CameraUnavailableError"]

#: Raw pixel frame: an ``HxWx3`` BGR ``uint8`` array (OpenCV convention).
Frame = np.ndarray


class CameraUnavailableError(RuntimeError):
    """Raised when a camera device cannot be opened or accessed."""


@runtime_checkable
class VideoSource(Protocol):
    """A source of video frames with an explicit open/read/release lifecycle."""

    def open(self) -> None:
        """Open the underlying device. Raises :class:`CameraUnavailableError` on failure."""
        ...

    def read(self) -> Frame | None:
        """Return the next frame, or ``None`` if none is available this tick."""
        ...

    def release(self) -> None:
        """Release the device and free its OS handle."""
        ...

    @property
    def width(self) -> int:
        """Actual capture width in pixels."""
        ...

    @property
    def height(self) -> int:
        """Actual capture height in pixels."""
        ...

    def __enter__(self) -> VideoSource:
        """Open on context entry."""
        ...

    def __exit__(self, *exc: object) -> None:
        """Release on context exit (must free the device)."""
        ...
