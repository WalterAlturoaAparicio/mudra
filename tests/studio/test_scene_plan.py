"""Core ``ScenePlan`` invariants — data-model §5, asserted without Qt."""

from __future__ import annotations

from engine.models.landmarks import Handedness
from engine.models.topology import HAND_LANDMARK_COUNT
from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey

from tests.studio.conftest import make_hand, make_pose_sample

CONFIG = VisualizationConfig()


def _state(samples, **kwargs) -> DatasetViewState:
    keys = frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in samples)
    return DatasetViewState(
        selected_pose_id=samples[0].pose.pose_id if samples else None,
        selected_samples=keys,
        **kwargs,
    )


def test_every_hand_has_exactly_21_points() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    assert len(plan.hands) == 1
    assert len(plan.hands[0].points) == HAND_LANDMARK_COUNT


def test_points_are_never_partial() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    for hand in plan.hands:
        assert len(hand.points) in (0, HAND_LANDMARK_COUNT)


def test_point_indices_are_zero_to_twenty_in_order() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    assert [p.index for p in plan.hands[0].points] == list(range(21))


def test_every_edge_index_is_within_the_landmark_range() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    for hand in plan.hands:
        assert hand.edges, "FR-007 requires the connecting topology, not just points"
        for a, b in hand.edges:
            assert 0 <= a < HAND_LANDMARK_COUNT
            assert 0 <= b < HAND_LANDMARK_COUNT


def test_bounds_contain_every_point() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    for hand in plan.hands:
        for point in hand.points:
            assert plan.bounds.contains(point.x, point.y)


def test_bounds_are_non_degenerate_for_a_single_point_scene() -> None:
    """``fitInView`` on a zero-span rectangle would divide by zero inside Qt."""
    from engine.models.landmarks import HandLandmarks, Landmark
    from engine.models.pose import HandSample

    flat = HandLandmarks(points=tuple(Landmark(x=0.5, y=0.5, z=0.0) for _ in range(21)))
    hand = HandSample(
        handedness=Handedness.RIGHT, confidence=0.9, raw=flat, normalized=flat
    )
    sample = make_pose_sample(hands=(hand,))

    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    assert plan.bounds.width > 0
    assert plan.bounds.height > 0


def test_the_three_handedness_colours_are_distinct() -> None:
    """FR-008: left and right must be tellable apart at a glance."""
    samples = [
        make_pose_sample(
            sample_number=f"sample_00000{i}",
            hands=(make_hand(handedness=h),),
        )
        for i, h in enumerate((Handedness.LEFT, Handedness.RIGHT, Handedness.UNKNOWN), start=1)
    ]
    plan = build_scene_plan(samples, _state(samples), CONFIG)

    colors = {hand.style.color for hand in plan.hands}
    assert len(colors) == 3


def test_two_handed_sample_produces_two_hands_with_distinct_indices() -> None:
    """The dataset already contains two-handed samples; both must be drawn."""
    sample = make_pose_sample(
        hands=(make_hand(handedness=Handedness.RIGHT), make_hand(handedness=Handedness.LEFT))
    )
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    assert len(plan.hands) == 2
    assert {h.hand_index for h in plan.hands} == {0, 1}
    assert plan.hands[0].style.color != plan.hands[1].style.color


def test_empty_selection_yields_an_empty_plan_with_valid_bounds() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan([sample], DatasetViewState(), CONFIG)

    assert plan.is_empty
    assert plan.bounds.width > 0 and plan.bounds.height > 0


def test_unselected_samples_are_not_drawn() -> None:
    a = make_pose_sample(sample_number="sample_000001")
    b = make_pose_sample(sample_number="sample_000002")

    plan = build_scene_plan([a, b], _state([a]), CONFIG)

    assert {h.sample_key.sample_number for h in plan.hands} == {"sample_000001"}


def test_show_indices_is_carried_into_the_plan() -> None:
    sample = make_pose_sample()

    on = build_scene_plan([sample], _state([sample], show_landmark_indices=True), CONFIG)
    off = build_scene_plan([sample], _state([sample], show_landmark_indices=False), CONFIG)

    assert on.show_indices is True
    assert off.show_indices is False


def test_space_is_recorded_on_the_plan() -> None:
    sample = make_pose_sample()
    plan = build_scene_plan(
        [sample], _state([sample], coordinate_space=CoordinateSpace.NORMALIZED), CONFIG
    )

    assert plan.space is CoordinateSpace.NORMALIZED


def test_unavailable_reason_is_never_produced() -> None:
    """R1: the seam is reserved and unreachable under schema 1 (data-model §5)."""
    sample = make_pose_sample(
        hands=(make_hand(handedness=Handedness.RIGHT), make_hand(handedness=Handedness.LEFT))
    )
    plan = build_scene_plan([sample], _state([sample]), CONFIG)

    assert all(hand.unavailable_reason is None for hand in plan.hands)
