"""The sample list — every sample of the selected pose (FR-004, FR-012).

Extended selection is enabled from the start, because FR-012's multi-select and
FR-005's single-select are the same widget in two states rather than two
features: selecting one item is just a selection of size one, and the scene
builder already treats it that way.
"""

from __future__ import annotations

from collections.abc import Sequence

from engine.models.pose import PoseSample
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QAbstractItemView, QListWidget, QListWidgetItem

from studio.domain.selection import SampleKey

__all__ = ["SampleList"]

_KEY_ROLE = Qt.ItemDataRole.UserRole


class SampleList(QListWidget):
    """Lists a pose's valid samples, ordered by ``sample_number``.

    Signals:
        selection_changed: Emitted with the current ``frozenset[SampleKey]``.
    """

    selection_changed = Signal(object)

    def __init__(self) -> None:
        """Build the list in extended-selection mode (FR-012)."""
        super().__init__()
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.itemSelectionChanged.connect(self._on_selection_changed)

    def set_samples(self, samples: Sequence[PoseSample]) -> None:
        """Replace the list's contents.

        Blocks selection signals while repopulating, so switching pose emits one
        deliberate selection change from the page rather than a burst of
        incidental ones from Qt.
        """
        self.blockSignals(True)
        self.clear()
        for sample in sorted(samples, key=lambda s: s.sample_number):
            item = QListWidgetItem(sample.sample_number)
            item.setData(_KEY_ROLE, SampleKey(sample.pose.pose_id, sample.sample_number))
            self.addItem(item)
        self.blockSignals(False)

    def selected_keys(self) -> frozenset[SampleKey]:
        """The current selection as a set of :class:`SampleKey`."""
        return frozenset(item.data(_KEY_ROLE) for item in self.selectedItems())

    def all_keys(self) -> list[SampleKey]:
        """Every listed key, in display order."""
        return [self.item(i).data(_KEY_ROLE) for i in range(self.count())]

    def select_all_samples(self) -> None:
        """Select every listed sample — the multi-overlay case (FR-013)."""
        self.selectAll()

    def _on_selection_changed(self) -> None:
        self.selection_changed.emit(self.selected_keys())
