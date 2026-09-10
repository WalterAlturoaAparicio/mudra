"""Per-pose statistics — is this pose ready? (FR-015, FR-016).

Renders all seven FR-015 fields plus the hand-observation total, because
left + right does not equal the sample count whenever a sample holds two hands,
and a panel that showed only the first would look like it had a rounding bug.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFormLayout, QGroupBox, QLabel

from studio.domain.statistics import PoseStatistics

__all__ = ["StatisticsPanel", "FR015_FIELDS"]

#: The seven fields FR-015 requires, plus the observation total that makes the
#: left/right split add up. Exported for tests.
FR015_FIELDS: tuple[str, ...] = (
    "Samples",
    "Hand observations",
    "Left hands",
    "Right hands",
    "Unknown hands",
    "Average confidence",
    "First capture",
    "Last capture",
    "Normalization",
)

_EM_DASH = "—"


class StatisticsPanel(QGroupBox):
    """Summarizes the selected pose."""

    def __init__(self) -> None:
        """Build one read-only row per field."""
        super().__init__("Pose statistics")
        form = QFormLayout(self)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._values: dict[str, QLabel] = {}
        for name in FR015_FIELDS:
            label = QLabel(_EM_DASH)
            self._values[name] = label
            form.addRow(QLabel(name), label)

    def field_names(self) -> tuple[str, ...]:
        """Every field the panel renders."""
        return FR015_FIELDS

    def value_of(self, field: str) -> str:
        """The text currently shown for ``field``."""
        return self._values[field].text()

    def show_statistics(self, stats: PoseStatistics) -> None:
        """Populate from ``stats``.

        An empty pose renders a valid all-zero panel rather than raising — the
        statistics for "nothing recorded yet" are a real answer (FR-021).
        """
        self._values["Samples"].setText(str(stats.sample_count))
        self._values["Hand observations"].setText(str(stats.hand_observation_count))
        self._values["Left hands"].setText(str(stats.left_hand_count))
        self._values["Right hands"].setText(str(stats.right_hand_count))
        self._values["Unknown hands"].setText(str(stats.unknown_hand_count))
        self._values["Average confidence"].setText(
            f"{stats.average_confidence:.4f}" if stats.average_confidence is not None else _EM_DASH
        )
        self._values["First capture"].setText(stats.first_capture or _EM_DASH)
        self._values["Last capture"].setText(stats.last_capture or _EM_DASH)
        self._values["Normalization"].setText(stats.normalization_display)
        self.setToolTip(
            ", ".join(stats.normalization_strategies)
            if len(stats.normalization_strategies) > 1
            else ""
        )

    def clear(self) -> None:
        """Reset every field to the placeholder."""
        for label in self._values.values():
            label.setText(_EM_DASH)
