"""The page shown for every section that is not yet implemented (FR-002).

One class, holding two labels and **no controls whatsoever**. FR-002 requires
that a placeholder "offers no non-functional controls that appear interactive",
and the way to guarantee that is structural: there is no button to forget to
disable, because the class never creates one.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget

from studio.presentation.shell.sections import SectionSpec

__all__ = ["PlaceholderPage"]


class PlaceholderPage(QWidget):
    """Says a section is not yet implemented, and offers nothing to click."""

    def __init__(self, spec: SectionSpec) -> None:
        """Build the page from its section spec.

        Args:
            spec: The section this page stands in for.
        """
        super().__init__()
        self._spec = spec

        title = QLabel(f"{spec.label} is not yet implemented")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setObjectName("placeholderTitle")

        detail = QLabel(spec.placeholder_detail)
        detail.setAlignment(Qt.AlignmentFlag.AlignCenter)
        detail.setWordWrap(True)
        detail.setObjectName("placeholderDetail")

        layout = QVBoxLayout(self)
        layout.addStretch(1)
        layout.addWidget(title)
        layout.addWidget(detail)
        layout.addStretch(1)

    @property
    def section_label(self) -> str:
        """The label of the section this page stands in for."""
        return self._spec.label
