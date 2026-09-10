"""Aggregated, derived facts about one pose's samples — never persisted.

This module holds the *shape* only; the computation lives in
``studio.application.compute_statistics``. Keeping the dataclass here lets
:class:`studio.domain.loading.LoadedPose` carry statistics without the domain
layer depending on a use case.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["PoseStatistics"]


@dataclass(frozen=True, slots=True)
class PoseStatistics:
    """Summary of a pose's valid samples (FR-015).

    **The counting rule that is easy to get wrong**: left, right, and unknown
    counts — and ``average_confidence`` — are computed over **hand
    observations**, not samples. A two-handed sample contributes one left *and*
    one right, and two confidence values. Hence the invariant worth asserting:

        ``left_hand_count + right_hand_count + unknown_hand_count
        == hand_observation_count``

    The defaults describe an empty pose: all counts zero, all optionals ``None``.
    Constructing statistics for a pose with no samples must not raise, because
    FR-021's empty state renders from a valid, empty instance.

    Attributes:
        sample_count: Number of valid samples.
        hand_observation_count: ``Σ len(sample.hands)`` — at least
            ``sample_count`` whenever any sample holds two hands.
        left_hand_count: Observations with ``Handedness.LEFT``.
        right_hand_count: Observations with ``Handedness.RIGHT``.
        unknown_hand_count: Observations with ``Handedness.UNKNOWN``.
        average_confidence: Mean over observations, or ``None`` if there are none.
        first_capture: Earliest sample timestamp (ISO-8601 UTC sorts
            lexicographically), or ``None``.
        last_capture: Latest sample timestamp, or ``None``.
        normalization_strategies: Distinct strategies, sorted. FR-015 assumes one
            per pose, but samples recorded across an Engine change could
            disagree, so this is a tuple: one element renders as itself, more
            than one renders as ``"mixed (n)"``. Reporting a single strategy when
            two exist would be a quiet lie about the data — precisely what this
            tool exists to expose.
    """

    sample_count: int = 0
    hand_observation_count: int = 0
    left_hand_count: int = 0
    right_hand_count: int = 0
    unknown_hand_count: int = 0
    average_confidence: float | None = None
    first_capture: str | None = None
    last_capture: str | None = None
    normalization_strategies: tuple[str, ...] = ()

    @property
    def normalization_display(self) -> str:
        """The strategy text for the statistics panel (FR-015).

        Renders the single strategy when there is one, ``"mixed (n)"`` when the
        pose's samples disagree, and an em dash when there are no samples.
        """
        count = len(self.normalization_strategies)
        if count == 0:
            return "—"
        if count == 1:
            return self.normalization_strategies[0]
        return f"mixed ({count})"
