"""Raw vs. normalized model space — FR-010, FR-007, FR-009 (research D6)."""

from __future__ import annotations

from engine.models.landmarks import Handedness, HandLandmarks, Landmark
from engine.models.pose import HandSample
from engine.models.topology import HAND_CONNECTIONS
from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey

from tests.studio.conftest import make_pose_sample

CONFIG = VisualizationConfig()


def _frame_like_sample():
    """A sample whose raw hand sits in the frame and whose normalized hand is centred."""
    raw = HandLandmarks(
        points=tuple(Landmark(x=0.60 + 0.005 * i, y=0.40 + 0.004 * i, z=0.0) for i in range(21))
    )
    normalized = HandLandmarks(
        points=tuple(Landmark(x=-0.05 + 0.005 * i, y=-0.04 + 0.004 * i, z=0.0) for i in range(21))
    )
    hand = HandSample(handedness=Handedness.RIGHT, confidence=0.95, raw=raw, normalized=normalized)
    return make_pose_sample(hands=(hand,))


def _state(sample, **kwargs) -> DatasetViewState:
    return DatasetViewState(
        selected_pose_id=sample.pose.pose_id,
        selected_samples=frozenset({SampleKey(sample.pose.pose_id, sample.sample_number)}),
        **kwargs,
    )


def test_raw_space_stays_inside_the_unit_square() -> None:
    """Raw coordinates are frame-relative, so the hand sits where the camera saw it."""
    sample = _frame_like_sample()
    plan = build_scene_plan([sample], _state(sample, coordinate_space=CoordinateSpace.RAW), CONFIG)

    for point in plan.hands[0].points:
        assert 0.0 <= point.x <= 1.0
        assert 0.0 <= point.y <= 1.0


def test_normalized_space_is_wrist_centred_near_the_origin() -> None:
    sample = _frame_like_sample()
    plan = build_scene_plan(
        [sample], _state(sample, coordinate_space=CoordinateSpace.NORMALIZED), CONFIG
    )

    wrist = plan.hands[0].points[0]
    assert abs(wrist.x) < 0.5
    assert abs(wrist.y) < 0.5


def test_the_two_spaces_produce_different_geometry() -> None:
    sample = _frame_like_sample()

    raw = build_scene_plan([sample], _state(sample, coordinate_space=CoordinateSpace.RAW), CONFIG)
    norm = build_scene_plan(
        [sample], _state(sample, coordinate_space=CoordinateSpace.NORMALIZED), CONFIG
    )

    assert raw.hands[0].points[0] != norm.hands[0].points[0]
    assert raw.bounds != norm.bounds


def test_both_spaces_produce_21_points_and_the_full_edge_set() -> None:
    """FR-007 holds in either mode — switching space changes geometry, not topology."""
    sample = _frame_like_sample()

    for space in (CoordinateSpace.RAW, CoordinateSpace.NORMALIZED):
        plan = build_scene_plan([sample], _state(sample, coordinate_space=space), CONFIG)
        assert len(plan.hands[0].points) == 21
        assert plan.hands[0].edges == HAND_CONNECTIONS


def test_switching_space_preserves_the_selection() -> None:
    """FR-010 / data-model §3: a mode toggle is not a selection change."""
    state = DatasetViewState(
        selected_pose_id="p",
        selected_samples=frozenset({SampleKey("p", "sample_000001")}),
    )

    switched = state.with_coordinate_space(CoordinateSpace.NORMALIZED)

    assert switched.selected_samples == state.selected_samples
    assert switched.coordinate_space is CoordinateSpace.NORMALIZED


def test_toggling_indices_preserves_the_selection() -> None:
    state = DatasetViewState(
        selected_pose_id="p",
        selected_samples=frozenset({SampleKey("p", "sample_000001")}),
    )

    toggled = state.with_indices_shown(True)

    assert toggled.selected_samples == state.selected_samples
    assert toggled.show_landmark_indices is True
