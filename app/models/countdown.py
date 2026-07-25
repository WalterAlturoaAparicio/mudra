"""Countdown value objects.

Neutral, frozen data describing "how far along is a countdown right now". It has
no timing, GUI, or recording knowledge, so any workflow that needs a delayed
action (pose capture, sequence recording, calibration, benchmarks, multiplayer
sync) and any renderer can share it (constitution Principle I & IV).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

__all__ = ["CountdownTick"]


@dataclass(frozen=True, slots=True)
class CountdownTick:
    """An immutable snapshot of a countdown at one instant.

    Produced by :class:`~app.core.countdown.CountdownTimer` on every poll and
    consumed by renderers/controllers; it is a pure value, never a live handle.
    """

    total_seconds: float
    elapsed_seconds: float
    remaining_seconds: float
    finished: bool

    @property
    def display_value(self) -> int:
        """The number to show on screen: ``3, 2, 1`` then ``0`` at zero.

        Rounds *up* so the whole first second displays ``3`` for a 3-second
        countdown, matching how people read a countdown aloud.
        """
        return max(math.ceil(self.remaining_seconds), 0)

    @property
    def progress(self) -> float:
        """Fraction of the countdown already elapsed, clamped to ``[0.0, 1.0]``.

        Useful for progress rings/bars; ``1.0`` for a zero-length countdown.
        """
        if self.total_seconds <= 0.0:
            return 1.0
        return min(max(self.elapsed_seconds / self.total_seconds, 0.0), 1.0)
