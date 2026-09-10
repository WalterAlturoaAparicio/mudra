"""FR-018's extension point — a mapping, not a subsystem (research D10)."""

from __future__ import annotations

from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.selection import DatasetViewState, EmphasisLevel, SampleKey

from tests.studio.conftest import make_pose_sample

CONFIG = VisualizationConfig()


def _samples(n: int):
    return [make_pose_sample(sample_number=f"sample_{i:06d}") for i in range(1, n + 1)]


def _state(samples) -> DatasetViewState:
    return DatasetViewState(
        selected_pose_id=samples[0].pose.pose_id,
        selected_samples=frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in samples),
    )


def test_an_empty_mapping_renders_everything_normal() -> None:
    """This milestone produces nothing but NORMAL, and that must be the default."""
    samples = _samples(3)
    plan = build_scene_plan(samples, _state(samples), CONFIG, emphasis={})

    assert all(h.style.emphasis is EmphasisLevel.NORMAL for h in plan.hands)


def test_highlighted_and_muted_resolve_to_distinct_styles() -> None:
    samples = _samples(3)
    keys = sorted(SampleKey(s.pose.pose_id, s.sample_number) for s in samples)
    emphasis = {
        keys[0]: EmphasisLevel.HIGHLIGHTED,
        keys[1]: EmphasisLevel.MUTED,
    }

    plan = build_scene_plan(samples, _state(samples), CONFIG, emphasis=emphasis)
    by_key = {h.sample_key: h.style for h in plan.hands}

    assert by_key[keys[0]].color == CONFIG.highlight_color
    assert by_key[keys[1]].color == CONFIG.muted_color
    assert by_key[keys[2]].color == CONFIG.right_hand_color
    assert len({by_key[k].color for k in keys}) == 3


def test_emphasis_for_an_unselected_sample_is_ignored_not_an_error() -> None:
    """A future detector will flag samples the user has not selected."""
    samples = _samples(2)
    stranger = SampleKey("some_other_pose", "sample_999999")

    plan = build_scene_plan(
        samples, _state(samples), CONFIG, emphasis={stranger: EmphasisLevel.HIGHLIGHTED}
    )

    assert len(plan.hands) == 2
    assert all(h.style.emphasis is EmphasisLevel.NORMAL for h in plan.hands)


def test_emphasis_defaults_to_the_view_state_mapping() -> None:
    samples = _samples(1)
    key = SampleKey(samples[0].pose.pose_id, samples[0].sample_number)
    state = _state(samples).with_emphasis({key: EmphasisLevel.HIGHLIGHTED})

    plan = build_scene_plan(samples, state, CONFIG)

    assert plan.hands[0].style.emphasis is EmphasisLevel.HIGHLIGHTED


def test_no_outlier_detector_interface_exists() -> None:
    """Principle VI: the mapping is the whole extension point (research D10)."""
    import studio.domain.ports as ports

    names = {n.lower() for n in dir(ports)}
    assert not any("outlier" in n or "detector" in n for n in names)
