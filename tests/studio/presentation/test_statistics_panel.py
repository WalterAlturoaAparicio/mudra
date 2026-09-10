"""The statistics panel — FR-015, FR-016."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from studio.domain.statistics import PoseStatistics
from studio.presentation.dataset.page import DatasetPage
from studio.presentation.dataset.statistics_panel import FR015_FIELDS, StatisticsPanel


def test_panel_renders_every_fr015_field(qtbot) -> None:
    panel = StatisticsPanel()
    qtbot.addWidget(panel)

    for required in (
        "Samples",
        "Left hands",
        "Right hands",
        "Average confidence",
        "First capture",
        "Last capture",
        "Normalization",
    ):
        assert required in panel.field_names()


def test_empty_statistics_render_without_raising(qtbot) -> None:
    """FR-021: an empty pose has real statistics, not an error."""
    panel = StatisticsPanel()
    qtbot.addWidget(panel)

    panel.show_statistics(PoseStatistics())

    assert panel.value_of("Samples") == "0"
    assert panel.value_of("Average confidence") == "—"
    assert panel.value_of("Normalization") == "—"


def test_mixed_strategies_render_as_mixed(qtbot) -> None:
    panel = StatisticsPanel()
    qtbot.addWidget(panel)

    panel.show_statistics(PoseStatistics(normalization_strategies=("a", "b")))

    assert panel.value_of("Normalization") == "mixed (2)"


def test_panel_updates_when_the_selected_pose_changes(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """FR-016."""
    synthetic_pose(2, pose_id="small")
    synthetic_pose(7, pose_id="large")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("small", synchronous=True)
    assert page.statistics_panel.value_of("Samples") == "2"

    page.select_pose("large", synchronous=True)
    assert page.statistics_panel.value_of("Samples") == "7"


def test_two_handed_pose_reports_both_sides(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """The counting rule, visible in the UI rather than only in the function."""
    synthetic_pose(3, pose_id="both", two_handed=True)
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("both", synchronous=True)

    assert page.statistics_panel.value_of("Samples") == "3"
    assert page.statistics_panel.value_of("Hand observations") == "6"
    assert page.statistics_panel.value_of("Left hands") == "3"
    assert page.statistics_panel.value_of("Right hands") == "3"


def test_statistics_come_from_the_load_not_the_render(
    qtbot, make_page: Callable[[], DatasetPage], synthetic_pose: Callable[..., Path]
) -> None:
    """FR-016 / research D5: derived once per load."""
    synthetic_pose(4, pose_id="derived")
    page = make_page()
    qtbot.addWidget(page)

    page.select_pose("derived", synchronous=True)

    assert page.loaded_pose.statistics.sample_count == 4
    assert page.loaded_pose.statistics is page.loaded_pose.statistics
