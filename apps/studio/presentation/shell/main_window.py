"""The application's main window — rail on the left, section stack on the right.

Built from the section registry rather than from six hand-written branches, so
the rail and the stack cannot disagree about which sections exist (research D11).

This started life in the Foundational phase as a bare window hosting one widget,
which is what let the Dataset page be delivered before the shell existed. The
upgrade replaced its centre with a stack; nothing outside this file changed.
"""

from __future__ import annotations

from PySide6.QtWidgets import QMainWindow, QSplitter, QStackedWidget, QWidget
from PySide6.QtCore import Qt

from studio.config.models import WindowConfig
from studio.presentation.shell.navigation_rail import NavigationRail
from studio.presentation.shell.placeholder_page import PlaceholderPage
from studio.presentation.shell.sections import SECTION_SPECS, NavigationSection

__all__ = ["MainWindow"]

_RAIL_STRETCH = 1
_STACK_STRETCH = 6


class MainWindow(QMainWindow):
    """Hosts the navigation rail and one page per section."""

    def __init__(self, config: WindowConfig, dataset_page: QWidget) -> None:
        """Build the window.

        Args:
            config: Title and initial geometry — no literal dimensions here
                (Principle V).
            dataset_page: The one real page. Every other section gets a
                :class:`PlaceholderPage`, built from the same registry entry that
                names it in the rail.
        """
        super().__init__()
        self._config = config
        self.setWindowTitle(config.title)
        self.resize(config.initial_width, config.initial_height)

        self.rail = NavigationRail()
        self.stack = QStackedWidget()

        self._pages: dict[NavigationSection, QWidget] = {}
        for spec in SECTION_SPECS:
            page = dataset_page if spec.implemented else PlaceholderPage(spec)
            self._pages[spec.section] = page
            self.stack.addWidget(page)

        self.rail.section_selected.connect(self.show_section)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(self.rail)
        splitter.addWidget(self.stack)
        splitter.setStretchFactor(0, _RAIL_STRETCH)
        splitter.setStretchFactor(1, _STACK_STRETCH)
        self.setCentralWidget(splitter)

        self.show_section(NavigationSection.DATASET)

    def show_section(self, section: NavigationSection) -> None:
        """Bring ``section``'s page to the front."""
        page = self._pages.get(section)
        if page is not None:
            self.stack.setCurrentWidget(page)

    def page_for(self, section: NavigationSection) -> QWidget:
        """The page registered for ``section``."""
        return self._pages[section]

    @property
    def current_section(self) -> NavigationSection:
        """Which section is currently displayed."""
        current = self.stack.currentWidget()
        for section, page in self._pages.items():
            if page is current:
                return section
        return NavigationSection.DATASET
