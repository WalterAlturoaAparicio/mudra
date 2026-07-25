"""Non-blocking countdown timer.

`CountdownTimer` is a general-purpose, poll-driven countdown: `start()` stamps a
monotonic origin and every `tick()` reports the remaining time *without sleeping*,
so the caller's loop (camera feed, UI, network) keeps running at full rate. It is
deliberately free of any recording/GUI knowledge so later workflows — sequence
recording, calibration, benchmark runs, multiplayer sync — reuse it as-is.

The clock is injected (defaults to :func:`time.monotonic`), making every timing
behaviour unit-testable without real waiting (constitution Principle I & IV).
"""

from __future__ import annotations

import time
from collections.abc import Callable

from app.models.countdown import CountdownTick

__all__ = ["CountdownTimer", "CountdownNotRunningError"]


class CountdownNotRunningError(RuntimeError):
    """Raised when a timer that was never started (or already finished) is polled."""


class CountdownTimer:
    """A restartable, non-blocking countdown over an injected monotonic clock."""

    def __init__(
        self,
        duration_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Configure the countdown length; nothing starts until :meth:`start`.

        Args:
            duration_seconds: Countdown length; ``0`` finishes on the first tick.
            clock: Monotonic seconds source (injected for tests).

        Raises:
            ValueError: If ``duration_seconds`` is negative.
        """
        if duration_seconds < 0.0:
            raise ValueError(f"duration_seconds must be >= 0, got {duration_seconds!r}.")
        self._duration = float(duration_seconds)
        self._clock = clock
        self._started_at: float | None = None

    @property
    def duration_seconds(self) -> float:
        """The configured countdown length in seconds."""
        return self._duration

    @property
    def is_running(self) -> bool:
        """``True`` between :meth:`start` and the finishing tick (or :meth:`cancel`)."""
        return self._started_at is not None

    def start(self) -> CountdownTick:
        """(Re)start the countdown and return its opening tick.

        Restarting a running timer is allowed and simply resets the origin.
        """
        self._started_at = self._clock()
        return self._tick_at(0.0)

    def tick(self) -> CountdownTick:
        """Return the current tick without blocking.

        The timer stops itself on the tick where ``finished`` is ``True``, so a
        countdown fires exactly once and :attr:`is_running` returns to ``False``.

        Raises:
            CountdownNotRunningError: If the timer is not currently running.
        """
        if self._started_at is None:
            raise CountdownNotRunningError("Countdown is not running; call start() first.")
        tick = self._tick_at(self._clock() - self._started_at)
        if tick.finished:
            self._started_at = None
        return tick

    def cancel(self) -> None:
        """Stop the countdown without firing; safe to call when already stopped."""
        self._started_at = None

    def _tick_at(self, elapsed: float) -> CountdownTick:
        """Build the tick for ``elapsed`` seconds since the start (clamped at 0)."""
        elapsed = max(elapsed, 0.0)
        remaining = max(self._duration - elapsed, 0.0)
        return CountdownTick(
            total_seconds=self._duration,
            elapsed_seconds=elapsed,
            remaining_seconds=remaining,
            finished=remaining <= 0.0,
        )
