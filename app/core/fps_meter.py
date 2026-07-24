"""Rolling-average frames-per-second meter.

Computes a smoothed FPS from a fixed-size window of recent frame timestamps. Pure
and clock-injectable so it is fully unit-testable without wall-clock flakiness
(research D4).
"""

from __future__ import annotations

from collections import deque

__all__ = ["FpsMeter"]


class FpsMeter:
    """Tracks a smoothed frame rate over a sliding window of timestamps."""

    def __init__(self, window: int = 30) -> None:
        """Create a meter averaging over the last ``window`` frames.

        Args:
            window: Number of recent timestamps to keep (must be >= 2).
        """
        if window < 2:
            raise ValueError("window must be >= 2")
        self._timestamps: deque[float] = deque(maxlen=window)

    def update(self, now: float) -> None:
        """Record a frame timestamp (monotonic seconds)."""
        self._timestamps.append(now)

    @property
    def fps(self) -> float:
        """Smoothed frames per second, or ``0.0`` until at least two samples exist."""
        if len(self._timestamps) < 2:
            return 0.0
        elapsed = self._timestamps[-1] - self._timestamps[0]
        if elapsed <= 0.0:
            return 0.0
        return (len(self._timestamps) - 1) / elapsed

    def reset(self) -> None:
        """Clear all recorded timestamps."""
        self._timestamps.clear()
