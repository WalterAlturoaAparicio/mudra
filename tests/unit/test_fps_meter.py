"""Tests for the rolling-average FPS meter."""

from __future__ import annotations

import pytest
from engine.core.fps_meter import FpsMeter


def test_requires_window_of_at_least_two() -> None:
    with pytest.raises(ValueError):
        FpsMeter(window=1)


def test_zero_until_two_samples() -> None:
    meter = FpsMeter(window=10)
    assert meter.fps == 0.0
    meter.update(0.0)
    assert meter.fps == 0.0


def test_constant_cadence_reports_expected_fps() -> None:
    meter = FpsMeter(window=10)
    # 30 FPS => 1/30 s per frame.
    for i in range(10):
        meter.update(i / 30.0)
    assert meter.fps == pytest.approx(30.0)


def test_window_slides_and_forgets_old_frames() -> None:
    meter = FpsMeter(window=3)
    # Slow frames first, then fast frames; only the last 3 timestamps count.
    for t in (0.0, 1.0, 2.0):
        meter.update(t)
    assert meter.fps == pytest.approx(1.0)
    for t in (2.1, 2.2):
        meter.update(t)
    # Window now holds 2.0, 2.1, 2.2 -> 2 intervals of 0.1 over 0.2s => 10 fps.
    assert meter.fps == pytest.approx(10.0)


def test_non_increasing_timestamps_are_safe() -> None:
    meter = FpsMeter(window=5)
    meter.update(1.0)
    meter.update(1.0)
    assert meter.fps == 0.0


def test_reset_clears_samples() -> None:
    meter = FpsMeter(window=5)
    meter.update(0.0)
    meter.update(1.0)
    meter.reset()
    assert meter.fps == 0.0
