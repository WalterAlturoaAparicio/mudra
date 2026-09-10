"""The metadata panel — every field recorded with a sample (FR-006, SC-002).

SC-002 is the bar: *every* metadata field must be visible in the application,
with no need to open the underlying JSON. So this panel enumerates all thirteen
FR-006 fields explicitly rather than iterating whatever a sample happens to
expose — an explicit list is what a test can assert against, and what makes a
missing field a failure instead of an omission nobody notices.

``capture`` is nullable in the schema and renders as "not recorded" rather than
blank, because a blank cell reads as a bug while "not recorded" reads as a fact.
"""

from __future__ import annotations

from engine.models.pose import PoseSample
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFormLayout, QLabel, QScrollArea, QWidget

__all__ = ["MetadataPanel", "FR006_FIELDS"]

#: The thirteen fields FR-006 requires, in display order. Exported so a test can
#: assert the panel's completeness against the requirement rather than against
#: the implementation.
FR006_FIELDS: tuple[str, ...] = (
    "Pose ID",
    "Display name",
    "Description",
    "Timestamp",
    "Sample UUID",
    "Sample number",
    "Handedness",
    "Confidence",
    "Normalization",
    "Application version",
    "Camera",
    "Capture",
    "Schema version",
)

_NOT_RECORDED = "not recorded"
_EM_DASH = "—"


class MetadataPanel(QScrollArea):
    """Shows all of FR-006's fields for the sample in focus."""

    def __init__(self) -> None:
        """Build one read-only row per FR-006 field."""
        super().__init__()
        self.setWidgetResizable(True)

        body = QWidget()
        self._form = QFormLayout(body)
        self._form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._values: dict[str, QLabel] = {}
        for name in FR006_FIELDS:
            value = QLabel(_EM_DASH)
            value.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            value.setWordWrap(True)
            self._values[name] = value
            self._form.addRow(QLabel(name), value)

        self.setWidget(body)

    # -- inspection ----------------------------------------------------------

    def field_names(self) -> tuple[str, ...]:
        """Every field the panel renders."""
        return FR006_FIELDS

    def value_of(self, field: str) -> str:
        """The text currently shown for ``field``."""
        return self._values[field].text()

    # -- population ----------------------------------------------------------

    def clear(self) -> None:
        """Reset every field to the em-dash placeholder."""
        for label in self._values.values():
            label.setText(_EM_DASH)

    def show_sample(self, sample: PoseSample) -> None:
        """Populate every field from ``sample``.

        A sample may hold more than one hand, so handedness and confidence are
        rendered as one line per hand rather than collapsing to the first — the
        two-handed case is in the real dataset, and showing only one hand's
        confidence would misreport it.
        """
        meta = sample.metadata
        hands = sample.hands

        self._values["Pose ID"].setText(sample.pose.pose_id)
        self._values["Display name"].setText(sample.pose.display_name or _NOT_RECORDED)
        self._values["Description"].setText(sample.pose.description or _NOT_RECORDED)
        self._values["Timestamp"].setText(sample.timestamp)
        self._values["Sample UUID"].setText(sample.sample_uuid)
        self._values["Sample number"].setText(sample.sample_number or _NOT_RECORDED)

        self._values["Handedness"].setText(
            ", ".join(str(h.handedness) for h in hands) if hands else _NOT_RECORDED
        )
        self._values["Confidence"].setText(
            ", ".join(f"{h.confidence:.4f}" for h in hands) if hands else _NOT_RECORDED
        )
        self._values["Normalization"].setText(
            f"{sample.normalization.strategy} (v{sample.normalization.version})"
        )
        self._values["Application version"].setText(meta.application_version)
        self._values["Camera"].setText(
            f"index {meta.camera_index}, {meta.camera_width}×{meta.camera_height}"
            + (f", MediaPipe {meta.mediapipe_version}" if meta.mediapipe_version else "")
        )
        self._values["Capture"].setText(self._capture_text(sample))
        self._values["Schema version"].setText(str(sample.schema_version))

    @staticmethod
    def _capture_text(sample: PoseSample) -> str:
        """Render the nullable capture block without leaving a blank cell."""
        capture = sample.metadata.capture
        if capture is None:
            return _NOT_RECORDED
        parts = [f"at {capture.capture_time}"]
        if capture.countdown_start_time:
            parts.append(f"armed {capture.countdown_start_time}")
        parts.append(f"countdown {capture.countdown_seconds:g}s")
        return ", ".join(parts)
