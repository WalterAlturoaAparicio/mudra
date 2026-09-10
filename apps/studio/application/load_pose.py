"""The ``LoadPose`` use case — turn a port's result into a renderable pose.

Loading happens once per pose and the result is held for the session (research
D5). Everything downstream — switching coordinate space, toggling indices,
changing the selection — is a pure re-render over what is already in memory,
which is how SC-003 ("visibly instantaneous") and SC-007 (several hundred
samples, responsive) are both met without virtualization.

This module imports no ``engine`` and no ``PySide6``: it depends only on the
``PoseSampleSource`` protocol.
"""

from __future__ import annotations

from engine.models.pose import Pose

from studio.application.compute_statistics import compute_statistics
from studio.domain.loading import LoadedPose
from studio.domain.ports import PoseSampleSource

__all__ = ["LoadPose"]


class LoadPose:
    """Loads one pose and derives its statistics."""

    def __init__(self, source: PoseSampleSource) -> None:
        """Store the sample source.

        Args:
            source: Any implementation of the ``PoseSampleSource`` port.
        """
        self._source = source

    def __call__(self, pose_id: str) -> LoadedPose:
        """Load ``pose_id`` and return it with statistics attached.

        The pose's identity and labels come from the **first valid sample**:
        ``display_name`` and ``description`` live inside the samples, not in the
        directory, so a pose with no readable samples has no label to show and
        falls back to its ``pose_id`` (research D3).

        Statistics are computed here, once per load, rather than per render
        (FR-016).

        Args:
            pose_id: The pose to load.

        Returns:
            A :class:`LoadedPose`, possibly empty or all-skipped. Never raises
            for an unreadable sample.
        """
        result = self._source.load_pose(pose_id)

        if result.samples:
            pose = result.samples[0].pose
        else:
            pose = Pose(pose_id=pose_id, display_name=None, description=None)

        return LoadedPose(
            pose=pose,
            samples=result.samples,
            skipped=result.skipped,
            statistics=compute_statistics(result.samples),
        )
