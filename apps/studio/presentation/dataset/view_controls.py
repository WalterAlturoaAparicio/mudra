"""Coordinate-space and index-label toggles, plus the FR-011 view buttons.

Every control here mutates ``DatasetViewState`` and triggers a **pure re-render**
— no file is read, no pose is reloaded (SC-003: "visibly instantaneous update,
with no separate loading step"). That property comes from the pose already being
resident in memory (research D5), not from the widgets being clever.
"""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QCheckBox, QHBoxLayout, QPushButton, QRadioButton, QWidget

from studio.domain.selection import CoordinateSpace

__all__ = ["ViewControls"]


class ViewControls(QWidget):
    """The canvas's control strip.

    Signals:
        space_changed: Emitted with the newly chosen :class:`CoordinateSpace`.
        indices_toggled: Emitted with the new index-label visibility.
        zoom_in_requested / zoom_out_requested / reset_requested / fit_requested:
            FR-011's four view actions.
    """

    space_changed = Signal(object)
    indices_toggled = Signal(bool)
    zoom_in_requested = Signal()
    zoom_out_requested = Signal()
    reset_requested = Signal()
    fit_requested = Signal()

    def __init__(self) -> None:
        """Build the controls."""
        super().__init__()

        self.raw_button = QRadioButton("Raw")
        self.normalized_button = QRadioButton("Normalized")
        self.raw_button.setChecked(True)
        self.raw_button.toggled.connect(self._on_space_toggled)

        self.indices_box = QCheckBox("Landmark indices")
        self.indices_box.toggled.connect(self.indices_toggled.emit)

        self.zoom_in_button = QPushButton("Zoom in")
        self.zoom_out_button = QPushButton("Zoom out")
        self.reset_button = QPushButton("Reset")
        self.fit_button = QPushButton("Fit")
        self.zoom_in_button.clicked.connect(self.zoom_in_requested.emit)
        self.zoom_out_button.clicked.connect(self.zoom_out_requested.emit)
        self.reset_button.clicked.connect(self.reset_requested.emit)
        self.fit_button.clicked.connect(self.fit_requested.emit)

        layout = QHBoxLayout(self)
        layout.addWidget(self.raw_button)
        layout.addWidget(self.normalized_button)
        layout.addStretch(1)
        layout.addWidget(self.indices_box)
        layout.addStretch(1)
        for button in (
            self.zoom_in_button,
            self.zoom_out_button,
            self.reset_button,
            self.fit_button,
        ):
            layout.addWidget(button)

    @property
    def coordinate_space(self) -> CoordinateSpace:
        """The currently selected coordinate space."""
        return CoordinateSpace.RAW if self.raw_button.isChecked() else CoordinateSpace.NORMALIZED

    def _on_space_toggled(self, raw_checked: bool) -> None:
        """Emit once per change — ``QRadioButton`` toggles fire in pairs."""
        self.space_changed.emit(
            CoordinateSpace.RAW if raw_checked else CoordinateSpace.NORMALIZED
        )
