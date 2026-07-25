"""Tests for the countdown overlay renderer (pixel-level, no window)."""

from __future__ import annotations

import numpy as np
from app.config.models import VisualizationConfig
from app.models.countdown import CountdownTick
from app.visualization.countdown_overlay import CountdownOverlayRenderer
from app.visualization.renderer import CountdownRenderer


def _tick(remaining: float = 3.0, total: float = 3.0) -> CountdownTick:
    return CountdownTick(
        total_seconds=total,
        elapsed_seconds=total - remaining,
        remaining_seconds=remaining,
        finished=remaining <= 0.0,
    )


def _frame() -> np.ndarray:
    return np.full((480, 640, 3), 200, dtype=np.uint8)


def test_implements_the_countdown_renderer_port() -> None:
    assert isinstance(CountdownOverlayRenderer(VisualizationConfig()), CountdownRenderer)


def test_draws_something_over_the_frame() -> None:
    frame = _frame()
    before = frame.copy()
    CountdownOverlayRenderer(VisualizationConfig()).render_countdown(frame, _tick())
    assert not np.array_equal(before, frame)


def test_renders_in_place_and_returns_same_array() -> None:
    frame = _frame()
    assert CountdownOverlayRenderer(VisualizationConfig()).render_countdown(frame, _tick()) is frame


def test_dims_the_live_frame_behind_the_overlay() -> None:
    frame = _frame()
    config = VisualizationConfig(countdown_dim=0.5)
    CountdownOverlayRenderer(config).render_countdown(frame, _tick())
    assert frame[0, 0].max() < 200  # corner is background only: dimmed, no text


def test_dim_can_be_disabled() -> None:
    frame = _frame()
    config = VisualizationConfig(countdown_dim=0.0)
    CountdownOverlayRenderer(config).render_countdown(frame, _tick())
    assert frame[0, 0].max() == 200


def test_uses_the_configured_countdown_color() -> None:
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    config = VisualizationConfig(countdown_color=(255, 0, 0), countdown_dim=0.0)
    CountdownOverlayRenderer(config).render_countdown(frame, _tick())
    assert frame[:, :, 0].max() > 0  # blue channel painted
    assert frame[:, :, 2].max() == 0  # red channel untouched


def test_every_countdown_value_renders_without_error() -> None:
    renderer = CountdownOverlayRenderer(VisualizationConfig())
    for remaining in (3.0, 2.4, 1.0, 0.2, 0.0):
        renderer.render_countdown(_frame(), _tick(remaining))


def test_small_frames_are_handled() -> None:
    renderer = CountdownOverlayRenderer(VisualizationConfig())
    renderer.render_countdown(np.zeros((60, 80, 3), dtype=np.uint8), _tick())
