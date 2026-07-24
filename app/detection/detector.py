"""Hand detection interface.

Defines the ``HandDetector`` Protocol that maps a raw frame to the neutral
:class:`~app.models.landmarks.FrameDetection` model. Concrete backends (MediaPipe
today, the Tasks API or others later) implement this without leaking their types
upstream (constitution Principles I & III).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.camera.source import Frame
from app.models.landmarks import FrameDetection

__all__ = ["HandDetector"]


@runtime_checkable
class HandDetector(Protocol):
    """Detects hands in a frame and returns a backend-agnostic result."""

    def detect(self, frame: Frame) -> FrameDetection:
        """Analyze ``frame`` and return the detected hands.

        Must not mutate ``frame`` and must not persist, draw, or log per-hand at
        INFO or above. Returns 0..``max_num_hands`` hands, each with exactly 21
        landmarks and a handedness classification confidence in ``[0, 1]``.
        """
        ...

    def close(self) -> None:
        """Release model resources."""
        ...

    def __enter__(self) -> HandDetector:
        """Return self for use as a context manager."""
        ...

    def __exit__(self, *exc: object) -> None:
        """Close the model on context exit."""
        ...
