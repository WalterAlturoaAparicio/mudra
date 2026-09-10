"""The pose tree — every pose in the dataset, with its file count (FR-003).

Also owns the **empty-catalog** state: a fresh checkout with nothing recorded,
or a missing dataset root, shows an explicit message rather than an empty box
(spec edge case 1). That is distinct from a pose which exists but holds no
samples, which the Dataset page reports separately (FR-021) — collapsing the two
would tell a developer their pose is empty when in fact their dataset is.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QLabel, QStackedWidget, QTreeWidget, QTreeWidgetItem

from studio.config.models import WindowConfig
from studio.domain.catalog import PoseCatalog

__all__ = ["PoseTree"]

_POSE_ID_ROLE = Qt.ItemDataRole.UserRole


class PoseTree(QStackedWidget):
    """Lists poses, or says there are none.

    Signals:
        pose_selected: Emitted with the ``pose_id`` the user picked.
    """

    pose_selected = Signal(str)

    def __init__(self, config: WindowConfig) -> None:
        """Build the tree and its empty-state page."""
        super().__init__()
        self._config = config

        self._tree = QTreeWidget()
        self._tree.setHeaderLabels(["Pose", "Samples"])
        self._tree.setRootIsDecorated(False)
        self._tree.itemSelectionChanged.connect(self._on_selection_changed)

        self._empty = QLabel(config.empty_catalog_message)
        self._empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._empty.setWordWrap(True)
        self._empty.setObjectName("emptyCatalogLabel")

        self.addWidget(self._tree)  # index 0
        self.addWidget(self._empty)  # index 1
        self.setCurrentIndex(1)

    # -- state ---------------------------------------------------------------

    @property
    def is_showing_empty_state(self) -> bool:
        """Whether the "no poses recorded" message is the visible page."""
        return self.currentIndex() == 1

    @property
    def empty_message(self) -> str:
        """The text shown when the catalog holds no poses."""
        return self._empty.text()

    def set_catalog(self, catalog: PoseCatalog) -> None:
        """Populate the tree, or switch to the empty state if there is nothing.

        An empty catalog is a **valid state**, never an error (FR-003, spec edge
        case 1).
        """
        self._tree.clear()
        if catalog.is_empty:
            self.setCurrentIndex(1)
            return

        for entry in catalog:
            item = QTreeWidgetItem([entry.label, str(entry.sample_file_count)])
            item.setData(0, _POSE_ID_ROLE, entry.pose_id)
            self._tree.addTopLevelItem(item)
        self.setCurrentIndex(0)

    def selected_pose_id(self) -> str | None:
        """The currently selected ``pose_id``, or ``None``."""
        items = self._tree.selectedItems()
        if not items:
            return None
        return items[0].data(0, _POSE_ID_ROLE)

    def pose_ids(self) -> list[str]:
        """Every ``pose_id`` currently listed, in display order."""
        return [
            self._tree.topLevelItem(i).data(0, _POSE_ID_ROLE)
            for i in range(self._tree.topLevelItemCount())
        ]

    def _on_selection_changed(self) -> None:
        pose_id = self.selected_pose_id()
        if pose_id is not None:
            self.pose_selected.emit(pose_id)
