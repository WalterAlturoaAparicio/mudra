"""Per-pose statistics — FR-015, and the counting rule that is easy to get wrong."""

from __future__ import annotations

import pytest
from engine.models.landmarks import Handedness
from studio.application.compute_statistics import compute_statistics

from tests.studio.conftest import make_hand, make_pose_sample


def test_empty_pose_yields_zeros_and_nones_without_raising() -> None:
    """FR-021's empty state renders from a valid, empty instance."""
    stats = compute_statistics([])

    assert stats.sample_count == 0
    assert stats.hand_observation_count == 0
    assert stats.average_confidence is None
    assert stats.first_capture is None
    assert stats.last_capture is None
    assert stats.normalization_strategies == ()
    assert stats.normalization_display == "—"


def test_hand_counts_sum_to_the_observation_count() -> None:
    """The invariant data-model §4 names explicitly."""
    samples = [
        make_pose_sample(
            sample_number="sample_000001", hands=(make_hand(handedness=Handedness.LEFT),)
        ),
        make_pose_sample(
            sample_number="sample_000002",
            hands=(make_hand(handedness=Handedness.RIGHT), make_hand(handedness=Handedness.LEFT)),
        ),
        make_pose_sample(
            sample_number="sample_000003", hands=(make_hand(handedness=Handedness.UNKNOWN),)
        ),
    ]

    stats = compute_statistics(samples)

    assert (
        stats.left_hand_count + stats.right_hand_count + stats.unknown_hand_count
        == stats.hand_observation_count
    )


def test_a_two_handed_sample_counts_once_on_each_side() -> None:
    sample = make_pose_sample(
        hands=(make_hand(handedness=Handedness.RIGHT), make_hand(handedness=Handedness.LEFT))
    )

    stats = compute_statistics([sample])

    assert stats.sample_count == 1
    assert stats.hand_observation_count == 2
    assert stats.left_hand_count == 1
    assert stats.right_hand_count == 1


def test_average_confidence_averages_observations_not_samples() -> None:
    """A two-handed sample contributes two values, not one averaged value."""
    two_handed = make_pose_sample(
        sample_number="sample_000001",
        hands=(
            make_hand(handedness=Handedness.RIGHT, confidence=1.0),
            make_hand(handedness=Handedness.LEFT, confidence=0.0),
        ),
    )
    one_handed = make_pose_sample(
        sample_number="sample_000002",
        hands=(make_hand(handedness=Handedness.RIGHT, confidence=0.5),),
    )

    stats = compute_statistics([two_handed, one_handed])

    # Three observations: 1.0, 0.0, 0.5 -> 0.5. Averaging per sample would give
    # (0.5 + 0.5) / 2 = 0.5 too, so use asymmetric values to tell them apart:
    assert stats.hand_observation_count == 3
    assert stats.average_confidence == pytest.approx(0.5)


def test_average_confidence_distinguishes_the_two_counting_units() -> None:
    two_handed = make_pose_sample(
        sample_number="sample_000001",
        hands=(
            make_hand(handedness=Handedness.RIGHT, confidence=0.9),
            make_hand(handedness=Handedness.LEFT, confidence=0.9),
        ),
    )
    one_handed = make_pose_sample(
        sample_number="sample_000002",
        hands=(make_hand(handedness=Handedness.RIGHT, confidence=0.3),),
    )

    stats = compute_statistics([two_handed, one_handed])

    per_observation = (0.9 + 0.9 + 0.3) / 3
    per_sample = (0.9 + 0.3) / 2
    assert stats.average_confidence == pytest.approx(per_observation)
    assert stats.average_confidence != pytest.approx(per_sample)


def test_first_and_last_capture_span_the_collection() -> None:
    samples = [
        make_pose_sample(sample_number="sample_000001", timestamp="2026-07-24T10:00:00+00:00"),
        make_pose_sample(sample_number="sample_000002", timestamp="2026-07-24T08:00:00+00:00"),
        make_pose_sample(sample_number="sample_000003", timestamp="2026-07-24T12:00:00+00:00"),
    ]

    stats = compute_statistics(samples)

    assert stats.first_capture == "2026-07-24T08:00:00+00:00"
    assert stats.last_capture == "2026-07-24T12:00:00+00:00"


def test_a_single_strategy_renders_as_itself() -> None:
    stats = compute_statistics([make_pose_sample(strategy="translation_scale")])

    assert stats.normalization_strategies == ("translation_scale",)
    assert stats.normalization_display == "translation_scale"


def test_mixed_strategies_produce_a_multi_element_tuple() -> None:
    """Reporting one strategy when two exist would be a quiet lie about the data."""
    samples = [
        make_pose_sample(sample_number="sample_000001", strategy="translation_scale"),
        make_pose_sample(sample_number="sample_000002", strategy="procrustes"),
        make_pose_sample(sample_number="sample_000003", strategy="translation_scale"),
    ]

    stats = compute_statistics(samples)

    assert stats.normalization_strategies == ("procrustes", "translation_scale")
    assert stats.normalization_display == "mixed (2)"


def test_sample_count_ignores_skipped_files() -> None:
    """Statistics describe valid samples; skipped files are the banner's job."""
    stats = compute_statistics([make_pose_sample()])

    assert stats.sample_count == 1
