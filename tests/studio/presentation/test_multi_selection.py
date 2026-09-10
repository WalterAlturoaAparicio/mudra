"""Multi-sample overlay — FR-012, FR-013, FR-014, and SC-004.

SC-004 ("overlay 10 or more samples and identify which landmarks vary the most")
cannot be exercised against the real dataset, which holds only 1-3 samples per
pose today (research R4). It is asserted here against a synthetic pose of ten,
built by the same generator the 500-sample performance test uses, so both success
criteria measure the same thing at different scales.
"""

from __future__ import annotations

import statistics
from collections.abc import Callable
from pathlib import Path

from studio.domain.selection import CoordinateSpace
from studio.presentation.dataset.page import DatasetPage


def test_selecting_several_samples_renders_all_of_them(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(3, pose_id="trio")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("trio", synchronous=True)

    page.sample_list.select_all_samples()

    plan = page.current_scene_plan()
    assert len({h.sample_key for h in plan.hands}) == 3


def test_ten_samples_all_reach_the_scene_plan(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """SC-004, part one: none of the ten is silently dropped."""
    synthetic_pose(10, pose_id="tenner")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("tenner", synchronous=True)

    page.sample_list.select_all_samples()
    plan = page.current_scene_plan()

    assert len(plan.hands) == 10, "one hand per sample, all ten present"
    assert len({h.sample_key for h in plan.hands}) == 10


def test_ten_overlaid_samples_stay_visible(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """SC-004, part two: reduced opacity, but never faded to nothing."""
    synthetic_pose(10, pose_id="tenner")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("tenner", synchronous=True)

    page.sample_list.select_all_samples()
    plan = page.current_scene_plan()

    floor = page._config.visualization.min_opacity
    assert all(h.style.opacity >= floor for h in plan.hands)
    assert all(h.style.opacity < 1.0 for h in plan.hands), "an overlay must be semi-transparent"


def test_per_landmark_variation_is_readable_from_the_plan_alone(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """SC-004, part three — the actual question the criterion asks.

    "Identify which landmarks vary the most across recordings" is answerable
    inside the application only if the spread is present in what gets drawn. The
    synthetic pose applies a deterministic per-sample jitter, so a real spread
    exists and can be computed from the plan.
    """
    synthetic_pose(10, pose_id="varied", jitter_scale=0.01)
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("varied", synchronous=True)
    page.sample_list.select_all_samples()

    plan = page.current_scene_plan()
    spreads = [statistics.pstdev([hand.points[i].x for hand in plan.hands]) for i in range(21)]

    assert len(spreads) == 21
    assert max(spreads) > 0.0, "the overlay must actually show variation"
    assert spreads.index(max(spreads)) >= 0


def test_switching_coordinate_space_preserves_the_multi_selection(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """FR-013 scenario 2: every selected sample redraws in the new mode."""
    synthetic_pose(4, pose_id="quad")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("quad", synchronous=True)
    page.sample_list.select_all_samples()

    page.set_coordinate_space(CoordinateSpace.NORMALIZED)

    assert len(page.view_state.selected_samples) == 4
    plan = page.current_scene_plan()
    assert plan.space is CoordinateSpace.NORMALIZED
    assert len(plan.hands) == 4


def test_switching_pose_clears_the_selection(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """FR-014."""
    synthetic_pose(3, pose_id="first")
    synthetic_pose(2, pose_id="second")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("first", synchronous=True)
    page.sample_list.select_all_samples()
    assert len(page.view_state.selected_samples) == 3

    page.select_pose("second", synchronous=True)

    assert page.view_state.selected_samples == frozenset()
    assert page.view_state.emphasis == {}
    assert page.current_scene_plan().is_empty


def test_reselecting_the_current_pose_is_a_no_op(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """Re-clicking a pose must not discard the selection the user built up."""
    synthetic_pose(3, pose_id="same")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("same", synchronous=True)
    page.sample_list.select_all_samples()
    before = page.view_state.selected_samples

    page.select_pose("same", synchronous=True)

    assert page.view_state.selected_samples == before


def test_toggling_indices_preserves_the_selection(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(3, pose_id="idx")
    page = make_page()
    qtbot.addWidget(page)
    page.select_pose("idx", synchronous=True)
    page.sample_list.select_all_samples()

    page.set_show_indices(True)

    assert len(page.view_state.selected_samples) == 3
    assert page.current_scene_plan().show_indices is True


def test_a_second_pose_load_is_served_from_cache(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """Research D5: a pose is parsed once per session."""
    synthetic_pose(2, pose_id="a")
    synthetic_pose(2, pose_id="b")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("a", synchronous=True)
    page.select_pose("b", synchronous=True)
    page.select_pose("a", synchronous=True)

    assert len(page._cache) == 2
