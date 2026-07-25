"""Rendering interfaces.

Defines the ``FrameRenderer`` and ``CountdownRenderer`` Protocols. Renderers
consume only the neutral data model (never backend types), keeping visualization
fully decoupled from the detector and from the recording workflow (constitution
Principle I).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from engine.camera.source import Frame
from engine.models.countdown import CountdownTick
from engine.models.landmarks import FrameDetection

__all__ = ["FrameRenderer", "CountdownRenderer"]


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


@runtime_checkable
class CountdownRenderer(Protocol):
    """Draws a pending-action countdown over a live frame.

    Deliberately unaware of *what* is being counted down to, so pose capture,
    sequence recording, calibration, and benchmark workflows share one overlay.
    """

    def render_countdown(self, frame: Frame, tick: CountdownTick) -> Frame:
        """Return ``frame`` with the countdown for ``tick`` drawn over it.

        Called every frame while a countdown runs, so it must be cheap and must
        never block. May draw in place and return the same array.
        """
        ...
