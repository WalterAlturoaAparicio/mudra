"""Recording port.

The `RecordingController` Protocol is the boundary `LiveApp` depends on so the core
loop never imports the `recording` package (dependency direction stays inward —
constitution Principle I). The concrete controller lives in
`app/recording/controller.py`.

The port is countdown-shaped: the live loop *requests* a capture, *updates* the
controller once per frame (never sleeping), and may *cancel* it, so the camera feed
stays responsive while the user positions both hands.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from engine.camera.source import Frame
from engine.models.countdown import CountdownTick
from engine.models.landmarks import FrameDetection

__all__ = ["RecordingController"]


@runtime_checkable
class RecordingController(Protocol):
    """Handles a recording request triggered from the live loop."""

    @property
    def is_active(self) -> bool:
        """``True`` while a recording is in flight (countdown or capture)."""
        ...

    def request_capture(self) -> bool:
        """Start the pre-capture countdown; return ``False`` if already active.

        MUST NOT block: it only arms the countdown, leaving the loop free to keep
        rendering the live feed.
        """
        ...

    def update(self, frame: Frame, detection: FrameDetection) -> CountdownTick | None:
        """Advance the workflow by one frame and report the countdown state.

        Called every tick with the current (already-mirrored) frame and detection.
        Returns the live :class:`CountdownTick` while counting down — the loop
        renders it — or ``None`` when idle. On the tick the countdown reaches zero
        the controller freezes *this* frame and runs the capture workflow
        synchronously (validate → prompt → save), then returns ``None``.

        MUST return after any outcome (save, rejection, or cancel) and MUST NOT
        raise into the loop.
        """
        ...

    def cancel(self) -> bool:
        """Abort a running countdown, returning ``True`` if one was cancelled.

        No sample is created and the controller returns to its idle state.
        """
        ...
