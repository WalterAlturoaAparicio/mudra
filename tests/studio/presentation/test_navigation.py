"""The navigation shell — FR-001, FR-002."""

from __future__ import annotations

from collections.abc import Callable

from studio.config.models import StudioConfig
from studio.presentation.dataset.page import DatasetPage
from studio.presentation.shell.main_window import MainWindow
from studio.presentation.shell.navigation_rail import NavigationRail
from studio.presentation.shell.placeholder_page import PlaceholderPage
from studio.presentation.shell.sections import SECTION_SPECS, NavigationSection


def test_all_six_sections_are_listed(qtbot) -> None:
    """FR-001."""
    rail = NavigationRail()
    qtbot.addWidget(rail)

    assert rail.labels() == [
        "Dataset",
        "Capture",
        "Recognition",
        "Training",
        "Calibration",
        "Settings",
    ]
    assert len(rail.sections()) == 6


def test_only_dataset_is_implemented() -> None:
    """FR-002: exactly one real page in this milestone."""
    implemented = [s.section for s in SECTION_SPECS if s.implemented]

    assert implemented == [NavigationSection.DATASET]


def test_selecting_each_section_succeeds(
    qtbot, studio_config: StudioConfig, make_page: Callable[[], DatasetPage]
) -> None:
    """Every entry must be clickable and none may error (User Story 4)."""
    window = MainWindow(studio_config.window, make_page())
    qtbot.addWidget(window)

    for section in NavigationSection:
        window.show_section(section)
        assert window.current_section is section


def test_only_dataset_resolves_to_the_real_page(
    qtbot, studio_config: StudioConfig, make_page: Callable[[], DatasetPage]
) -> None:
    page = make_page()
    window = MainWindow(studio_config.window, page)
    qtbot.addWidget(window)

    assert window.page_for(NavigationSection.DATASET) is page
    for section in NavigationSection:
        if section is not NavigationSection.DATASET:
            assert isinstance(window.page_for(section), PlaceholderPage)


def test_window_opens_on_the_dataset_section(
    qtbot, studio_config: StudioConfig, make_page: Callable[[], DatasetPage]
) -> None:
    window = MainWindow(studio_config.window, make_page())
    qtbot.addWidget(window)

    assert window.current_section is NavigationSection.DATASET


def test_rail_emits_the_section_it_selected(qtbot) -> None:
    rail = NavigationRail()
    qtbot.addWidget(rail)
    seen: list[NavigationSection] = []
    rail.section_selected.connect(seen.append)

    rail.select(NavigationSection.TRAINING)

    assert seen[-1] is NavigationSection.TRAINING
