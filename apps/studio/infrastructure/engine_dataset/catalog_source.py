"""Filesystem-backed pose discovery.

Engine's ``PoseRepository`` protocol has **no pose-enumeration operation** —
every method takes a ``pose_id`` the caller already knows, because Engine's
recorder always does. Studio's premise is the opposite (FR-003), so this adapter
enumerates directories itself.

That does not weaken FR-019: no JSON is decoded here. Discovery is a directory
listing and a filename count; every *parse* still goes through Engine
(:mod:`studio.infrastructure.engine_dataset.gateway`). When Engine gains a
``list_pose_ids()`` in a separately-authorized change, this adapter delegates
instead — a change invisible above ``infrastructure/`` (research D3).
"""

from __future__ import annotations

from pathlib import Path

from engine.config.models import DatasetConfig

from studio.domain.catalog import PoseCatalog, PoseCatalogEntry

__all__ = ["FilesystemPoseCatalogSource"]


class FilesystemPoseCatalogSource:
    """Discovers poses by listing ``<root>/<poses_dirname>``.

    Implements :class:`studio.domain.ports.PoseCatalogSource`.
    """

    def __init__(self, config: DatasetConfig, *, base_dir: Path | None = None) -> None:
        """Store the dataset configuration.

        Args:
            config: Engine's dataset settings — the location, the filename
                prefix, and the zero-pad width, reused rather than redeclared.
            base_dir: Directory that ``config.root`` is resolved against when it
                is relative. Defaults to the process's working directory.
        """
        self._config = config
        self._base_dir = base_dir

    @property
    def poses_dir(self) -> Path:
        """The resolved poses directory. Not guaranteed to exist."""
        root = Path(self._config.root)
        if not root.is_absolute() and self._base_dir is not None:
            root = self._base_dir / root
        return root / self._config.poses_dirname

    def list_poses(self) -> PoseCatalog:
        """Return every pose directory, ordered ascending by ``pose_id``.

        A missing or unreadable poses directory yields an **empty catalog**
        rather than an exception: a fresh checkout with nothing recorded is a
        normal state for this tool to render, not a failure (spec edge case 1).

        Returns:
            The catalog. Parses no sample file.
        """
        directory = self.poses_dir
        try:
            children = sorted(p for p in directory.iterdir() if p.is_dir())
        except OSError, ValueError:
            return PoseCatalog()

        entries = tuple(
            PoseCatalogEntry(
                pose_id=child.name,
                display_name=None,
                sample_file_count=self._count_sample_files(child),
            )
            for child in children
        )
        return PoseCatalog(entries=entries)

    def _count_sample_files(self, pose_dir: Path) -> int:
        """Count files matching the configured sample pattern. Opens none."""
        try:
            return sum(1 for _ in pose_dir.glob(f"{self._config.filename_prefix}*.json"))
        except OSError:
            return 0
