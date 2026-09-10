"""Multi-sample overlay opacity — FR-013, research D9."""

from __future__ import annotations

from studio.application.build_scene_plan import build_scene_plan, resolve_opacity
from studio.config.models import VisualizationConfig
from studio.domain.selection import DatasetViewState, SampleKey

from tests.studio.conftest import make_pose_sample

CONFIG = VisualizationConfig()


def _samples(n: int):
    return [make_pose_sample(sample_number=f"sample_{i:06d}") for i in range(1, n + 1)]


def _state(samples) -> DatasetViewState:
    return DatasetViewState(
        selected_pose_id=samples[0].pose.pose_id,
        selected_samples=frozenset(
            SampleKey(s.pose.pose_id, s.sample_number) for s in samples
        ),
    )


def test_a_single_sample_renders_fully_opaque() -> None:
    samples = _samples(1)
    plan = build_scene_plan(samples, _state(samples), CONFIG)

    assert plan.hands[0].style.opacity == 1.0


def test_opacity_decreases_monotonically_as_the_selection_grows() -> None:
    values = [resolve_opacity(n, CONFIG) for n in (1, 2, 5, 10, 25, 100)]

    assert all(a >= b for a, b in zip(values, values[1:], strict=False))
    assert values[0] > values[-1], "a growing overlay must actually get more transparent"


def test_opacity_never_falls_below_the_configured_floor() -> None:
    """A 500-sample overlay must still render something (spec assumption)."""
    assert resolve_opacity(500, CONFIG) >= CONFIG.min_opacity
    assert resolve_opacity(10_000, CONFIG) == CONFIG.min_opacity


def test_opacity_is_never_zero_or_negative() -> None:
    for n in (0, 1, 3, 500):
        assert 0.0 < resolve_opacity(n, CONFIG) <= 1.0


def test_every_selected_sample_appears_in_the_plan() -> None:
    samples = _samples(7)
    plan = build_scene_plan(samples, _state(samples), CONFIG)

    assert len({h.sample_key for h in plan.hands}) == 7


def test_all_overlaid_hands_share_the_same_opacity() -> None:
    samples = _samples(4)
    plan = build_scene_plan(samples, _state(samples), CONFIG)

    assert len({h.style.opacity for h in plan.hands}) == 1


def test_no_opacity_coefficient_is_hardcoded() -> None:
    """Principle V: changing the config must change the outcome."""
    generous = VisualizationConfig(min_opacity=0.5)

    assert resolve_opacity(500, generous) == 0.5
    assert resolve_opacity(500, generous) != resolve_opacity(500, CONFIG)
