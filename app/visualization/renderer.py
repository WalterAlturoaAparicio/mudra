"""Rendering interface.

Defines the ``FrameRenderer`` Protocol. Renderers consume only the neutral data
model (never backend types), keeping visualization fully decoupled from the
detector (constitution Principle I).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.camera.source import Frame
from app.models.landmarks import FrameDetection

__all__ = ["FrameRenderer"]


@runtime_checkable
class FrameRenderer(Protocol):
    """Draws the landmark overlay and HUD onto a frame."""

    def render(self, frame: Frame, detection: FrameDetection, fps: float) -> Frame:
        """Return ``frame`` annotated with the overlay and HUD.

        Draws the 21-point overlay and skeleton for every hand, plus the HUD
        (FPS and per-hand handedness + confidence). Must handle an empty
        ``detection.hands`` by drawing only the HUD, never erroring. May draw in
        place and return the same array.
        """
        ...
