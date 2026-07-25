"""Tests for the reusable, non-blocking countdown timer."""

from __future__ import annotations

import pytest
from app.core.countdown import CountdownNotRunningError, CountdownTimer


class FakeClock:
    """A manually advanced monotonic clock (no real waiting in tests)."""

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _timer(duration: float = 3.0) -> tuple[CountdownTimer, FakeClock]:
    clock = FakeClock()
    return CountdownTimer(duration, clock), clock


def test_negative_duration_rejected() -> None:
    with pytest.raises(ValueError):
        CountdownTimer(-1.0)


def test_not_running_before_start() -> None:
    timer, _ = _timer()
    assert timer.is_running is False
    with pytest.raises(CountdownNotRunningError):
        timer.tick()


def test_start_returns_full_remaining() -> None:
    timer, _ = _timer()
    tick = timer.start()
    assert timer.is_running is True
    assert tick.remaining_seconds == 3.0
    assert tick.finished is False
    assert tick.display_value == 3


def test_display_counts_down_3_2_1() -> None:
    timer, clock = _timer()
    timer.start()
    assert timer.tick().display_value == 3  # 3.0 remaining
    clock.advance(1.5)
    assert timer.tick().display_value == 2  # 1.5 remaining
    clock.advance(1.0)
    assert timer.tick().display_value == 1  # 0.5 remaining


def test_tick_does_not_block_and_reports_progress() -> None:
    timer, clock = _timer(4.0)
    timer.start()
    clock.advance(1.0)
    tick = timer.tick()
    assert tick.elapsed_seconds == 1.0
    assert tick.remaining_seconds == 3.0
    assert tick.progress == pytest.approx(0.25)


def test_finishes_exactly_once_and_stops() -> None:
    timer, clock = _timer()
    timer.start()
    clock.advance(3.0)
    tick = timer.tick()
    assert tick.finished is True
    assert tick.remaining_seconds == 0.0
    assert tick.display_value == 0
    assert timer.is_running is False
    with pytest.raises(CountdownNotRunningError):
        timer.tick()  # cannot fire twice


def test_overshoot_clamps_to_zero() -> None:
    timer, clock = _timer()
    timer.start()
    clock.advance(10.0)
    tick = timer.tick()
    assert tick.remaining_seconds == 0.0
    assert tick.finished is True


def test_zero_duration_fires_on_first_tick() -> None:
    timer, _ = _timer(0.0)
    timer.start()
    assert timer.tick().finished is True


def test_cancel_stops_without_firing() -> None:
    timer, clock = _timer()
    timer.start()
    clock.advance(1.0)
    timer.cancel()
    assert timer.is_running is False
    with pytest.raises(CountdownNotRunningError):
        timer.tick()
    timer.cancel()  # idempotent


def test_restart_resets_the_origin() -> None:
    timer, clock = _timer()
    timer.start()
    clock.advance(2.0)
    timer.start()
    assert timer.tick().remaining_seconds == 3.0
