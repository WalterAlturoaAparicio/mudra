"""The four states the Dataset page must render distinctly.

Empty catalog (spec edge case 1), populated, empty pose (FR-021/SC-005), and
all-skipped (FR-022). The last two look alike but mean different things —
nothing recorded versus nothing readable — and telling a developer their pose is
empty when its files are broken is the opposite of what this tool is for.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from studio.presentation.dataset.page import DatasetPage


def test_empty_catalog_shows_no_poses_recorded(qtbot, make_page: Callable[[], DatasetPage]) -> None:
    """A fresh checkout is a valid state, not an error (spec edge case 1)."""
    page = make_page()
    qtbot.addWidget(page)

    assert page.pose_count == 0
    assert page.pose_tree.is_showing_empty_state
    assert page.pose_tree.empty_message == "No poses recorded"


def test_populated_pose_lists_its_samples(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(4, pose_id="full")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("full", synchronous=True)

    assert not page.pose_tree.is_showing_empty_state
    assert page.sample_list.count() == 4
    assert page.loaded_pose.sample_count == 4
    assert page.skipped_banner.isHidden()


def test_pose_with_zero_samples_shows_its_own_empty_state(
    qtbot, make_page: Callable[[], DatasetPage], poses_dir: Path
) -> None:
    """FR-021, SC-005: never a blank panel, never an error."""
    (poses_dir / "hollow").mkdir()
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("hollow", synchronous=True)

    assert page.loaded_pose.is_empty
    assert page.canvas_message == "No samples recorded for this pose"
    assert not page.is_showing_canvas


def test_all_skipped_is_distinct_from_empty(
    qtbot, make_page: Callable[[], DatasetPage], write_corrupt_sample: Callable[..., Path]
) -> None:
    """FR-022: broken files must not read as an empty pose."""
    write_corrupt_sample("broken", "sample_000001", kind="truncated")
    write_corrupt_sample("broken", "sample_000002", kind="bad_version")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("broken", synchronous=True)

    assert page.loaded_pose.is_all_skipped
    assert page.canvas_message == "No readable samples for this pose"
    assert page.canvas_message != "No samples recorded for this pose"


def test_the_two_empty_states_use_different_text(
    qtbot,
    make_page: Callable[[], DatasetPage],
    poses_dir: Path,
    write_corrupt_sample: Callable[..., Path],
) -> None:
    (poses_dir / "hollow").mkdir()
    write_corrupt_sample("broken", "sample_000001", kind="truncated")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("hollow", synchronous=True)
    empty_text = page.canvas_message
    page.select_pose("broken", synchronous=True)
    skipped_text = page.canvas_message

    assert empty_text != skipped_text


def test_skipped_banner_appears_and_names_the_count(
    qtbot,
    make_page: Callable[[], DatasetPage],
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
) -> None:
    """FR-022's "visibly indicate" — a banner, never a modal dialog."""
    synthetic_pose(3, pose_id="mixed")
    write_corrupt_sample("mixed", "sample_000090", kind="truncated")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("mixed", synchronous=True)

    assert not page.skipped_banner.isHidden()
    assert "1" in page.skipped_banner.text()
    assert page.sample_list.count() == 3, "valid samples still load (FR-022)"


def test_banner_clears_when_moving_to_a_clean_pose(
    qtbot,
    make_page: Callable[[], DatasetPage],
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
) -> None:
    synthetic_pose(2, pose_id="dirty")
    write_corrupt_sample("dirty", "sample_000090", kind="truncated")
    synthetic_pose(2, pose_id="clean")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("dirty", synchronous=True)
    assert not page.skipped_banner.isHidden()

    page.select_pose("clean", synchronous=True)
    assert page.skipped_banner.isHidden()


def test_pose_tree_lists_every_pose_with_its_file_count(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(2, pose_id="alpha")
    synthetic_pose(5, pose_id="beta")
    page = make_page()
    qtbot.addWidget(page)

    assert page.pose_tree.pose_ids() == ["alpha", "beta"]
    assert page.pose_count == 2
