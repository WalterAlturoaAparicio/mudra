"""Load a pose off the UI thread, and remember what was loaded.

A pose of several hundred samples is several hundred JSON parses, which is the
one genuinely slow thing this milestone does. Doing it on the UI thread would
freeze the window — exactly what SC-007 forbids — so it runs on a ``QThreadPool``
and the result arrives as a signal.

The session cache is the other half of SC-007 and all of SC-003: a pose is parsed
once, and every subsequent interaction (coordinate space, index labels,
selection) is a pure re-render over objects already in memory (research D5).
"""

from __future__ import annotations

from PySide6.QtCore import QObject, QRunnable, Signal

from studio.application.load_pose import LoadPose
from studio.domain.loading import LoadedPose

__all__ = ["PoseLoaderTask", "PoseCache"]


class _TaskSignals(QObject):
    """``QRunnable`` cannot carry signals itself; this holds them."""

    loaded = Signal(str, object)
    failed = Signal(str, str)


class PoseLoaderTask(QRunnable):
    """Runs :class:`LoadPose` for one pose on a worker thread."""

    def __init__(self, load_pose: LoadPose, pose_id: str) -> None:
        """Prepare the task.

        Args:
            load_pose: The use case to run.
            pose_id: The pose to load.
        """
        super().__init__()
        self._load_pose = load_pose
        self._pose_id = pose_id
        self.signals = _TaskSignals()

    def run(self) -> None:
        """Load the pose and emit the outcome.

        A malformed *sample* never reaches here as an exception — the gateway
        turns it into a ``SkippedSample`` (FR-022). The guard is for the
        genuinely unexpected: an unreadable directory, or a bug. Letting that
        escape a worker thread would kill it silently.
        """
        try:
            self.signals.loaded.emit(self._pose_id, self._load_pose(self._pose_id))
        except Exception as error:  # noqa: BLE001 - a worker must not die silently
            self.signals.failed.emit(self._pose_id, str(error))


class PoseCache:
    """Per-session memo of loaded poses.

    Deliberately unbounded: the dataset is the repository's own, a pose holds at
    most a few hundred samples, and a developer inspecting a dataset revisits
    poses constantly. An eviction policy would add a knob to tune with no problem
    to solve (Principle VI).
    """

    def __init__(self) -> None:
        """Start empty."""
        self._entries: dict[str, LoadedPose] = {}

    def get(self, pose_id: str) -> LoadedPose | None:
        """Return the cached pose, or ``None``."""
        return self._entries.get(pose_id)

    def put(self, pose_id: str, pose: LoadedPose) -> None:
        """Cache ``pose`` under ``pose_id``."""
        self._entries[pose_id] = pose

    def __contains__(self, pose_id: object) -> bool:
        """Whether ``pose_id`` has already been loaded this session."""
        return pose_id in self._entries

    def __len__(self) -> int:
        """Number of poses cached."""
        return len(self._entries)
