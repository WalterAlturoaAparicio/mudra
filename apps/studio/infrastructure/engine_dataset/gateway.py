"""Fault-tolerant pose loading, with every parse delegated to Engine.

This module is the whole of FR-019 and the whole of FR-022, in one place.

**Why it does not use** ``JsonPoseRepository.list_sample_refs()``: that method
calls ``load_path`` for every sample in order to build its refs, so the first
malformed file raises out of the entire call and the caller loses the pose —
and every surviving sample gets parsed twice. FR-022 requires the opposite
behaviour, so this gateway globs the directory itself and calls ``load_path``
per file inside a ``try``/``except``. One bad file costs exactly one sample
(research D4).

Engine's ``save()`` and ``next_sample_number()`` are never called from here.
They are on the Engine-consumption contract's prohibited list, and the reason is
SC-006: a read-only tool has no business holding a write handle.
"""

from __future__ import annotations

from pathlib import Path

from engine.config.models import DatasetConfig
from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.repository import PoseRepositoryError
from engine.dataset.serializer import PoseSchemaError

from studio.domain.loading import PoseLoadResult, SkippedSample

__all__ = ["EngineDatasetGateway"]


class EngineDatasetGateway:
    """Loads one pose's samples through Engine, skipping unreadable files.

    Implements :class:`studio.domain.ports.PoseSampleSource`.
    """

    def __init__(
        self,
        config: DatasetConfig,
        repository: JsonPoseRepository,
        *,
        base_dir: Path | None = None,
    ) -> None:
        """Store the dataset configuration and Engine's repository.

        Args:
            config: Engine's dataset settings.
            repository: Engine's repository. **Only** ``load_path`` is used.
            base_dir: Directory a relative ``config.root`` resolves against.
        """
        self._config = config
        self._repository = repository
        self._base_dir = base_dir

    @property
    def poses_dir(self) -> Path:
        """The resolved poses directory. Not guaranteed to exist."""
        root = Path(self._config.root)
        if not root.is_absolute() and self._base_dir is not None:
            root = self._base_dir / root
        return root / self._config.poses_dirname

    def load_pose(self, pose_id: str) -> PoseLoadResult:
        """Load every sample of ``pose_id``, skipping any that cannot be read.

        Never raises for a bad sample. An unknown pose, or a directory that
        cannot be listed, yields an empty result — both are states the Dataset
        page renders rather than errors it reports.

        Args:
            pose_id: The pose directory to load.

        Returns:
            A :class:`PoseLoadResult` in which
            ``len(samples) + len(skipped)`` equals the number of matching files.
            Nothing is silently dropped.
        """
        pose_dir = self.poses_dir / pose_id
        try:
            paths = sorted(pose_dir.glob(f"{self._config.filename_prefix}*.json"))
        except OSError:
            return PoseLoadResult(pose_id=pose_id)

        samples = []
        skipped = []
        for path in paths:
            try:
                samples.append(self._repository.load_path(path))
            except (PoseSchemaError, PoseRepositoryError, OSError) as error:
                # A failure here costs exactly one sample. It must not abort the
                # pose, and it must not vanish — FR-022 requires the developer to
                # see that something was skipped, and why.
                skipped.append(SkippedSample(path=path, reason=str(error)))

        samples.sort(key=lambda s: s.sample_number)
        return PoseLoadResult(
            pose_id=pose_id,
            samples=tuple(samples),
            skipped=tuple(skipped),
        )
