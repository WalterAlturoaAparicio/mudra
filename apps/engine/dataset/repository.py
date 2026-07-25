"""Pose repository interface.

`PoseRepository` is the storage boundary the recorder depends on (constitution
Principle I & III / FR-019). `JsonPoseRepository` is the Phase-2 implementation;
future SQLite/Postgres/Cloud repositories share this interface. `SampleRef` lives in
`app/models/pose.py`.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from engine.models.pose import PoseSample, SampleRef

__all__ = ["PoseRepository", "PoseRepositoryError"]


class PoseRepositoryError(RuntimeError):
    """Raised on a storage failure while saving or loading a sample."""


@runtime_checkable
class PoseRepository(Protocol):
    """Append-only storage for pose samples, keyed by ``pose_id``."""

    def save(self, sample: PoseSample) -> SampleRef:
        """Persist a sample append-only (never overwriting) and return its handle."""
        ...

    def next_sample_number(self, pose_id: str) -> int:
        """Return the next 1-based sequential number for a pose."""
        ...

    def count(self, pose_id: str) -> int:
        """Return how many samples a pose currently has."""
        ...

    def list_sample_refs(self, pose_id: str) -> list[SampleRef]:
        """Return handles to all samples of a pose, ordered by number."""
        ...

    def load(self, ref: SampleRef) -> PoseSample:
        """Load and deserialize the sample referenced by ``ref``."""
        ...
