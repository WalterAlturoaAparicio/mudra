"""FR-006 / SC-002 — every recorded field is visible in the application."""

from __future__ import annotations

from engine.models.landmarks import Handedness
from engine.models.pose import CaptureTiming
from studio.presentation.dataset.metadata_panel import FR006_FIELDS, MetadataPanel

from tests.studio.conftest import make_hand, make_pose_sample


def test_all_thirteen_fr006_fields_are_rendered(qtbot) -> None:
    panel = MetadataPanel()
    qtbot.addWidget(panel)

    assert len(FR006_FIELDS) == 13
    assert set(panel.field_names()) == set(FR006_FIELDS)


def test_every_field_is_populated_for_a_full_sample(qtbot) -> None:
    """SC-002: no field may require opening the JSON to see."""
    panel = MetadataPanel()
    qtbot.addWidget(panel)
    sample = make_pose_sample(
        capture=CaptureTiming(
            capture_time="2026-07-24T13:20:03+00:00",
            countdown_start_time="2026-07-24T13:20:00+00:00",
            countdown_seconds=3.0,
        )
    )

    panel.show_sample(sample)

    for field in FR006_FIELDS:
        value = panel.value_of(field)
        assert value not in ("", "—"), f"{field} was left blank"


def test_specific_values_reach_the_right_rows(qtbot) -> None:
    panel = MetadataPanel()
    qtbot.addWidget(panel)
    sample = make_pose_sample(pose_id="dog", display_name="perro", sample_number="sample_000007")

    panel.show_sample(sample)

    assert panel.value_of("Pose ID") == "dog"
    assert panel.value_of("Display name") == "perro"
    assert panel.value_of("Sample number") == "sample_000007"
    assert panel.value_of("Schema version") == "1"
    assert "translation_scale" in panel.value_of("Normalization")
    assert "1280×720" in panel.value_of("Camera")


def test_a_sample_without_capture_renders_not_recorded_rather_than_blank(qtbot) -> None:
    """A blank cell reads as a bug; "not recorded" reads as a fact."""
    panel = MetadataPanel()
    qtbot.addWidget(panel)

    panel.show_sample(make_pose_sample(capture=None))

    assert panel.value_of("Capture") == "not recorded"


def test_a_two_handed_sample_shows_both_hands(qtbot) -> None:
    """Showing only the first hand's confidence would misreport the sample."""
    panel = MetadataPanel()
    qtbot.addWidget(panel)
    sample = make_pose_sample(
        hands=(
            make_hand(handedness=Handedness.RIGHT, confidence=0.99),
            make_hand(handedness=Handedness.LEFT, confidence=0.88),
        )
    )

    panel.show_sample(sample)

    assert "right" in panel.value_of("Handedness")
    assert "left" in panel.value_of("Handedness")
    assert "0.99" in panel.value_of("Confidence")
    assert "0.88" in panel.value_of("Confidence")


def test_clear_resets_every_field(qtbot) -> None:
    panel = MetadataPanel()
    qtbot.addWidget(panel)
    panel.show_sample(make_pose_sample())

    panel.clear()

    assert all(panel.value_of(f) == "—" for f in FR006_FIELDS)
