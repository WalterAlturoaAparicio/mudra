"""The left navigation rail (FR-001).

Renders the section registry; holds no knowledge of what any section does.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QListWidget, QListWidgetItem

from studio.presentation.shell.sections import SECTION_SPECS, NavigationSection

__all__ = ["NavigationRail"]

_SECTION_ROLE = Qt.ItemDataRole.UserRole


class NavigationRail(QListWidget):
    """Lists every section and reports which one is chosen.

    Signals:
        section_selected: Emitted with the chosen :class:`NavigationSection`.
    """

    section_selected = Signal(object)

    def __init__(self) -> None:
        """Build the rail from the section registry."""
        super().__init__()
        self.setObjectName("navigationRail")
        for spec in SECTION_SPECS:
            item = QListWidgetItem(spec.label)
            item.setData(_SECTION_ROLE, spec.section)
            if not spec.implemented:
                item.setToolTip("Not yet implemented")
            self.addItem(item)
        self.currentItemChanged.connect(self._on_current_changed)
        self.setCurrentRow(0)

    def labels(self) -> list[str]:
        """Every rail label, in display order."""
        return [self.item(i).text() for i in range(self.count())]

    def sections(self) -> list[NavigationSection]:
        """Every listed section, in display order."""
        return [self._section_at(i) for i in range(self.count())]

    def select(self, section: NavigationSection) -> None:
        """Programmatically select ``section``."""
        for i in range(self.count()):
            if self._section_at(i) is section:
                self.setCurrentRow(i)
                return

    def _section_at(self, row: int) -> NavigationSection:
        """Read row ``row``'s section, rebuilding the enum member.

        Qt stores a ``StrEnum`` as a plain string — it *is* a ``str``, so it
        round-trips through ``QVariant`` as one and comes back without its
        identity. Reconstructing here means callers can compare with ``is``,
        which is what one expects of an enum.
        """
        return NavigationSection(self.item(row).data(_SECTION_ROLE))

    def _on_current_changed(self, current: QListWidgetItem | None) -> None:
        if current is not None:
            self.section_selected.emit(NavigationSection(current.data(_SECTION_ROLE)))
