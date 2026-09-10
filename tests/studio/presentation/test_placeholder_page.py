"""FR-002 — a placeholder offers nothing that looks interactive."""

from __future__ import annotations

import pytest
from PySide6.QtWidgets import (
    QAbstractButton,
    QAbstractItemView,
    QComboBox,
    QLabel,
    QLineEdit,
    QSlider,
)
from studio.presentation.shell.placeholder_page import PlaceholderPage
from studio.presentation.shell.sections import SECTION_SPECS

_INTERACTIVE = (QAbstractButton, QAbstractItemView, QComboBox, QLineEdit, QSlider)

PLACEHOLDERS = [spec for spec in SECTION_SPECS if not spec.implemented]


@pytest.mark.parametrize("spec", PLACEHOLDERS, ids=lambda s: s.section.value)
def test_placeholder_exposes_no_interactive_widget(qtbot, spec) -> None:
    """Structural, not a habit: the class never creates a control to disable."""
    page = PlaceholderPage(spec)
    qtbot.addWidget(page)

    for widget_type in _INTERACTIVE:
        assert page.findChildren(widget_type) == []


@pytest.mark.parametrize("spec", PLACEHOLDERS, ids=lambda s: s.section.value)
def test_placeholder_states_it_is_not_implemented(qtbot, spec) -> None:
    page = PlaceholderPage(spec)
    qtbot.addWidget(page)

    text = " ".join(label.text() for label in page.findChildren(QLabel))

    assert "not yet implemented" in text.lower()
    assert spec.label in text


def test_all_five_non_dataset_sections_have_placeholders() -> None:
    assert len(PLACEHOLDERS) == 5
