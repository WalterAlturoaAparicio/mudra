"""What the user has selected, and how they want it drawn.

Pure state: no Qt, no Engine, no I/O. The widgets in ``studio.presentation``
mutate this by producing a new instance; the scene builder reads it. Keeping the
view state a plain immutable value is what lets FR-014's clear-on-pose-change
rule be asserted in a test with no display attached.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import StrEnum

__all__ = [
    "CoordinateSpace",
    "EmphasisLevel",
    "SampleKey",
    "DatasetViewState",
]


class CoordinateSpace(StrEnum):
    """Which landmark set to draw — the single input FR-010's switch changes.

    Attributes:
        RAW: ``HandSample.raw`` — frame-relative, x/y in [0, 1], y-down.
        NORMALIZED: ``HandSample.normalized`` — wrist-centred and
            scale-normalized, therefore unbounded.
    """

    RAW = "raw"
    NORMALIZED = "normalized"


class EmphasisLevel(StrEnum):
    """Per-sample visual emphasis — FR-018's extension point.

    A future outlier detector becomes a new *producer* of an emphasis mapping and
    nothing else changes: no visualization rework, which is exactly what FR-018
    asks for. **No code in this milestone produces anything but ``NORMAL``** — the
    mapping's type is the whole extension point, and inventing a detector
    interface here would be the speculative surface Principle VI rejects.
    """

    NORMAL = "normal"
    HIGHLIGHTED = "highlighted"
    MUTED = "muted"


@dataclass(frozen=True, slots=True, order=True)
class SampleKey:
    """Stable identity of one sample within the dataset.

    ``sample_uuid`` is *displayed* (FR-006) but is deliberately not the key:
    ``sample_number`` is what the repository assigns and what orders the list.

    Attributes:
        pose_id: The pose this sample belongs to.
        sample_number: Zero-padded stem, e.g. ``sample_000023``. Unique per pose.
    """

    pose_id: str
    sample_number: str


@dataclass(frozen=True, slots=True)
class DatasetViewState:
    """Everything the Dataset page needs to decide what to draw.

    The viewport transform (zoom, pan, fit) is deliberately **not** here: it is a
    property of the widget, not of the data, so FR-011's controls never
    invalidate a scene (data-model §3).

    Attributes:
        selected_pose_id: The pose whose samples are listed, or ``None``.
        selected_samples: The sample(s) currently drawn (FR-012).
        coordinate_space: Raw or normalized (FR-010).
        show_landmark_indices: Whether to label the 21 points (FR-009).
        emphasis: Per-sample emphasis (FR-018). Empty in this milestone.
    """

    selected_pose_id: str | None = None
    selected_samples: frozenset[SampleKey] = frozenset()
    coordinate_space: CoordinateSpace = CoordinateSpace.RAW
    show_landmark_indices: bool = False
    emphasis: Mapping[SampleKey, EmphasisLevel] = field(default_factory=dict)

    def select_pose(self, pose_id: str) -> DatasetViewState:
        """Return the state after selecting ``pose_id``.

        Selecting a *different* pose clears the sample selection and the emphasis
        mapping (FR-014). Re-selecting the pose already current is a **no-op** —
        it must not discard a multi-selection the user has built up.

        ``coordinate_space`` and ``show_landmark_indices`` survive either way:
        they are user preferences about how to look at data, not facts about
        which data is being looked at.
        """
        if pose_id == self.selected_pose_id:
            return self
        return replace(
            self,
            selected_pose_id=pose_id,
            selected_samples=frozenset(),
            emphasis={},
        )

    def select_samples(self, keys: frozenset[SampleKey]) -> DatasetViewState:
        """Return the state with ``keys`` as the selection. No I/O is implied."""
        return replace(self, selected_samples=keys)

    def with_coordinate_space(self, space: CoordinateSpace) -> DatasetViewState:
        """Return the state in ``space``, preserving the selection (FR-010)."""
        return replace(self, coordinate_space=space)

    def with_indices_shown(self, shown: bool) -> DatasetViewState:
        """Return the state with index labels toggled, preserving selection."""
        return replace(self, show_landmark_indices=shown)

    def with_emphasis(self, emphasis: Mapping[SampleKey, EmphasisLevel]) -> DatasetViewState:
        """Return the state with a new emphasis mapping (FR-018)."""
        return replace(self, emphasis=dict(emphasis))
