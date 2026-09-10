"""The navigation rail's six sections (FR-001).

A data-driven registry rather than six hand-written pages: adding a section is a
tuple, and every placeholder is the *same* class, so "not yet implemented" cannot
drift into five subtly different half-features (research D11).

The five non-Dataset entries are placeholders **only**. Capture, Recognition,
Training, and Calibration each name a capability the constitution has not
authorized; listing them communicates the product's shape without pretending any
of it works (FR-002).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

__all__ = ["NavigationSection", "SectionSpec", "SECTION_SPECS"]


class NavigationSection(StrEnum):
    """The six entries in the navigation rail."""

    DATASET = "dataset"
    CAPTURE = "capture"
    RECOGNITION = "recognition"
    TRAINING = "training"
    CALIBRATION = "calibration"
    SETTINGS = "settings"


@dataclass(frozen=True, slots=True)
class SectionSpec:
    """One rail entry.

    Attributes:
        section: Its identity.
        label: The rail text.
        implemented: Whether a real page exists. Exactly one is ``True`` in this
            milestone, and that is the point of the field.
        placeholder_detail: What the placeholder page says. Ignored when
            ``implemented``.
    """

    section: NavigationSection
    label: str
    implemented: bool = False
    placeholder_detail: str = ""


SECTION_SPECS: tuple[SectionSpec, ...] = (
    SectionSpec(NavigationSection.DATASET, "Dataset", implemented=True),
    SectionSpec(
        NavigationSection.CAPTURE,
        "Capture",
        placeholder_detail="Recording new samples happens in the Mudra Capture mobile app.",
    ),
    SectionSpec(
        NavigationSection.RECOGNITION,
        "Recognition",
        placeholder_detail="Pose recognition is not part of this milestone.",
    ),
    SectionSpec(
        NavigationSection.TRAINING,
        "Training",
        placeholder_detail="Model training is not part of this milestone.",
    ),
    SectionSpec(
        NavigationSection.CALIBRATION,
        "Calibration",
        placeholder_detail="Camera calibration is not part of this milestone.",
    ),
    SectionSpec(
        NavigationSection.SETTINGS,
        "Settings",
        placeholder_detail="Studio is configured from its JSON config file for now.",
    ),
)
