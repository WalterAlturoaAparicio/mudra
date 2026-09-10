"""Derive a pose's summary statistics — pure arithmetic, no I/O, no Qt.

Implements FR-015. The arithmetic is simple; the *counting unit* is the part
worth being careful about, and it is stated in one place here so no caller has to
re-derive it.
"""

from __future__ import annotations

from collections.abc import Sequence

from engine.models.landmarks import Handedness
from engine.models.pose import PoseSample

from studio.domain.statistics import PoseStatistics

__all__ = ["compute_statistics"]


def compute_statistics(samples: Sequence[PoseSample]) -> PoseStatistics:
    """Summarize a pose's valid samples.

    **Counts are over hand observations, not samples.** A two-handed sample
    contributes one left *and* one right, and two confidence values. Counting per
    sample instead would under-report exactly the two-handed poses the dataset
    already contains, so the invariant to hold onto is::

        left_hand_count + right_hand_count + unknown_hand_count
        == hand_observation_count

    An empty sequence yields a valid, all-zero result rather than raising —
    FR-021's empty state renders from it.

    Args:
        samples: The pose's **valid** samples. Skipped files are already gone by
            the time this is called and are counted nowhere here.

    Returns:
        The derived :class:`PoseStatistics`.
    """
    if not samples:
        return PoseStatistics()

    left = right = unknown = 0
    confidences: list[float] = []
    strategies: set[str] = set()
    timestamps: list[str] = []

    for sample in samples:
        timestamps.append(sample.timestamp)
        strategies.add(sample.normalization.strategy)
        for hand in sample.hands:
            confidences.append(hand.confidence)
            if hand.handedness is Handedness.LEFT:
                left += 1
            elif hand.handedness is Handedness.RIGHT:
                right += 1
            else:
                unknown += 1

    observations = left + right + unknown

    return PoseStatistics(
        sample_count=len(samples),
        hand_observation_count=observations,
        left_hand_count=left,
        right_hand_count=right,
        unknown_hand_count=unknown,
        average_confidence=(sum(confidences) / len(confidences)) if confidences else None,
        # ISO-8601 UTC strings sort lexicographically, so min/max need no parsing.
        first_capture=min(timestamps) if timestamps else None,
        last_capture=max(timestamps) if timestamps else None,
        normalization_strategies=tuple(sorted(strategies)),
    )
