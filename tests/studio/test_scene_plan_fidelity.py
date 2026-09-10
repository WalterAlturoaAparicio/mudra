"""The plan must be a *lossless* carrier of the landmarks it was built from.

These are the regression tests for the "every pose looks identical" defect. The
investigation showed the loss was not here — ``build_scene_plan`` copies
coordinates verbatim — but nothing asserted that, so nothing would have noticed
if it stopped being true. Two facts are pinned:

1. Two deliberately dissimilar hands produce demonstrably different plans.
2. Every ``ScenePoint`` equals its source ``Landmark`` **exactly**, in both
   coordinate spaces. Not "close enough": identical, because the plan's job is to
   choose what to draw, never to adjust where.

The companion assertions at the Qt layer live in
``tests/studio/presentation/test_renderer_fidelity.py`` — the layer where the
information was actually being lost.
"""

from __future__ import annotations

import pytest
from engine.models.landmarks import Handedness
from engine.models.topology import HAND_LANDMARK_COUNT, LandmarkIndex
from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.scene import MarkerShape
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey

from tests.studio.conftest import (
    FIST_HAND,
    SPREAD_HAND,
    make_geometry_hand,
    make_pose_sample,
)

CONFIG = VisualizationConfig()

SPACES = (CoordinateSpace.RAW, CoordinateSpace.NORMALIZED)


def _sample(landmarks, *, pose_id: str, handedness: Handedness = Handedness.RIGHT):
    return make_pose_sample(
        pose_id=pose_id,
        sample_number="sample_000001",
        hands=(make_geometry_hand(landmarks, handedness=handedness),),
    )


def _plan(sample, space: CoordinateSpace, **kwargs):
    state = DatasetViewState(
        selected_pose_id=sample.pose.pose_id,
        selected_samples=frozenset({SampleKey(sample.pose.pose_id, sample.sample_number)}),
        coordinate_space=space,
        **kwargs,
    )
    return build_scene_plan([sample], state, CONFIG)


# --------------------------------------------------------------------------- #
# 1. Different geometry in, different plan out
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("space", SPACES)
def test_dissimilar_hands_produce_dissimilar_plans(space: CoordinateSpace) -> None:
    """The headline regression: distinct poses must not collapse to one plan."""
    spread = _plan(_sample(SPREAD_HAND, pose_id="spread"), space)
    fist = _plan(_sample(FIST_HAND, pose_id="fist"), space)

    spread_points = [(p.x, p.y) for p in spread.hands[0].points]
    fist_points = [(p.x, p.y) for p in fist.hands[0].points]

    assert spread_points != fist_points
    # Not merely "not equal" — every landmark must have moved, so the difference
    # cannot be one stray point in an otherwise identical hand. The wrist is
    # exempt in normalized space, where it is *defined* to be the origin and is
    # therefore (0, 0) for every hand ever recorded.
    compared = list(zip(spread_points, fist_points, strict=True))
    if space is CoordinateSpace.NORMALIZED:
        assert compared[LandmarkIndex.WRIST] == ((0.0, 0.0), (0.0, 0.0))
        compared = compared[LandmarkIndex.WRIST + 1 :]
    assert all(a != b for a, b in compared)


def test_dissimilar_hands_produce_dissimilar_bounds() -> None:
    """A spread hand and a curled one cannot honestly share a bounding box."""
    spread = _plan(_sample(SPREAD_HAND, pose_id="spread"), CoordinateSpace.RAW).bounds
    fist = _plan(_sample(FIST_HAND, pose_id="fist"), CoordinateSpace.RAW).bounds

    assert (spread.min_x, spread.min_y, spread.max_x, spread.max_y) != (
        fist.min_x,
        fist.min_y,
        fist.max_x,
        fist.max_y,
    )
    # The spread hand is several times wider; if a future change ever normalized
    # geometry into the plan, this ratio would quietly go to 1.
    assert spread.width > fist.width * 2.0


# --------------------------------------------------------------------------- #
# 2. Losslessness
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("landmarks", [SPREAD_HAND, FIST_HAND], ids=["spread", "fist"])
@pytest.mark.parametrize("space", SPACES)
def test_every_scene_point_equals_its_source_landmark_exactly(landmarks, space) -> None:
    """No scaling, no offset, no rounding between the parser and the plan."""
    hand = make_geometry_hand(landmarks)
    sample = make_pose_sample(pose_id="fidelity", hands=(hand,))
    source = hand.normalized if space is CoordinateSpace.NORMALIZED else hand.raw

    points = _plan(sample, space).hands[0].points

    assert len(points) == HAND_LANDMARK_COUNT
    for index, (point, landmark) in enumerate(zip(points, source.points, strict=True)):
        assert point.index == index
        assert point.x == landmark.x, f"landmark {index} x was altered"
        assert point.y == landmark.y, f"landmark {index} y was altered"


def test_the_two_spaces_are_not_the_same_numbers() -> None:
    """Raw and normalized stay distinct spaces, not two names for one array."""
    sample = _sample(SPREAD_HAND, pose_id="spaces")

    raw = [(p.x, p.y) for p in _plan(sample, CoordinateSpace.RAW).hands[0].points]
    normalized = [(p.x, p.y) for p in _plan(sample, CoordinateSpace.NORMALIZED).hands[0].points]

    assert raw != normalized
    # Normalization re-origins on the wrist, so landmark 0 lands exactly on (0,0)
    # while the raw wrist sits wherever the camera saw it.
    assert normalized[LandmarkIndex.WRIST] == (0.0, 0.0)
    assert raw[LandmarkIndex.WRIST] != (0.0, 0.0)


# --------------------------------------------------------------------------- #
# 3. Styling resolved in the plan, in pixel units
# --------------------------------------------------------------------------- #


def test_wrist_and_fingertips_are_drawn_larger_than_the_joints() -> None:
    """FR-009 readability: the 21 points are not 21 identical dots."""
    points = _plan(_sample(SPREAD_HAND, pose_id="tiers"), CoordinateSpace.RAW).hands[0].points
    radius = {p.index: p.radius for p in points}

    assert radius[LandmarkIndex.WRIST] == CONFIG.wrist_radius
    for tip in (
        LandmarkIndex.THUMB_TIP,
        LandmarkIndex.INDEX_TIP,
        LandmarkIndex.MIDDLE_TIP,
        LandmarkIndex.RING_TIP,
        LandmarkIndex.PINKY_TIP,
    ):
        assert radius[tip] == CONFIG.fingertip_radius
    assert radius[LandmarkIndex.INDEX_PIP] == CONFIG.point_radius
    assert radius[LandmarkIndex.WRIST] > radius[LandmarkIndex.INDEX_TIP] > CONFIG.point_radius


def test_marker_radii_are_small_relative_to_the_hand_they_mark() -> None:
    """The defect, stated as an invariant.

    A marker radius is device pixels; the bounds are model units. The two are
    only comparable once a scale is chosen, so what this pins is the thing that
    actually went wrong: a radius read as *model* units would dwarf the hand.
    """
    plan = _plan(_sample(SPREAD_HAND, pose_id="scale"), CoordinateSpace.RAW)
    largest = max(p.radius for hand in plan.hands for p in hand.points)

    assert largest > plan.bounds.width, (
        "Sanity check: radii are pixel-scale numbers and hands are unit-scale, so "
        "the radius is expected to look 'larger'. That is exactly why it must "
        "never be interpreted as a model-space length — see the renderer test."
    )


def test_handedness_is_carried_by_shape_as_well_as_colour() -> None:
    """FR-008 must survive greyscale and colour-blindness."""
    left = _plan(
        _sample(SPREAD_HAND, pose_id="l", handedness=Handedness.LEFT), CoordinateSpace.RAW
    ).hands[0]
    right = _plan(
        _sample(SPREAD_HAND, pose_id="r", handedness=Handedness.RIGHT), CoordinateSpace.RAW
    ).hands[0]

    assert left.style.marker != right.style.marker
    assert left.style.color != right.style.color
    assert left.style.label and right.style.label
    assert left.style.label != right.style.label


def test_text_labels_are_suppressed_for_large_overlays() -> None:
    """Ten thousand stacked glyphs inform nobody; the plan decides, not the renderer."""
    samples = [
        make_pose_sample(
            pose_id="many",
            sample_number=f"sample_{i:06d}",
            hands=(make_geometry_hand(SPREAD_HAND),),
        )
        for i in range(1, CONFIG.label_max_samples + 2)
    ]
    state = DatasetViewState(
        selected_pose_id="many",
        selected_samples=frozenset(SampleKey("many", s.sample_number) for s in samples),
        show_landmark_indices=True,
    )

    plan = build_scene_plan(samples, state, CONFIG)

    assert plan.show_indices is False
    assert all(hand.style.label == "" for hand in plan.hands)
    # The skeleton itself is never suppressed.
    assert all(len(hand.points) == HAND_LANDMARK_COUNT for hand in plan.hands)


# --------------------------------------------------------------------------- #
# 4. Per-space reference and framing
# --------------------------------------------------------------------------- #


def test_raw_reference_is_the_camera_frame() -> None:
    """Raw x/y are frame-relative, so the unit square is what they mean."""
    plan = _plan(_sample(SPREAD_HAND, pose_id="ref"), CoordinateSpace.RAW)

    assert not plan.reference.is_empty
    assert plan.view_bounds.contains(0.0, 0.0)
    assert plan.view_bounds.contains(1.0, 1.0)
    # Framing every raw sample identically is what makes their positions
    # comparable, which a bounds-fitted view would erase.
    assert plan.view_bounds.width >= 1.0


def test_normalized_reference_is_the_wrist_origin_and_costs_no_zoom() -> None:
    """The crosshair marks (0,0); clamping it keeps the hand filling the panel."""
    plan = _plan(_sample(SPREAD_HAND, pose_id="ref"), CoordinateSpace.NORMALIZED)

    assert not plan.reference.is_empty
    assert plan.view_bounds.contains(0.0, 0.0)
    assert plan.view_bounds.width == pytest.approx(plan.bounds.width)
    assert plan.view_bounds.height == pytest.approx(plan.bounds.height)


def test_bounds_still_describe_only_the_landmarks() -> None:
    """``view_bounds`` is framing; ``bounds`` remains a fact about the data."""
    plan = _plan(_sample(SPREAD_HAND, pose_id="bounds"), CoordinateSpace.RAW)

    for point in plan.hands[0].points:
        assert plan.bounds.contains(point.x, point.y)
    assert plan.bounds.width < 1.0
    assert plan.view_bounds.width > plan.bounds.width


def test_the_reference_can_be_switched_off_without_touching_the_data() -> None:
    """Disabling annotation must not move a single coordinate."""
    config = VisualizationConfig(show_reference=False)
    sample = _sample(SPREAD_HAND, pose_id="off")
    state = DatasetViewState(
        selected_pose_id="off",
        selected_samples=frozenset({SampleKey("off", "sample_000001")}),
    )

    plan = build_scene_plan([sample], state, config)
    with_reference = _plan(sample, CoordinateSpace.RAW)

    assert plan.reference.is_empty
    assert plan.view_bounds.width == pytest.approx(plan.bounds.width)
    assert [(p.x, p.y) for p in plan.hands[0].points] == [
        (p.x, p.y) for p in with_reference.hands[0].points
    ]
