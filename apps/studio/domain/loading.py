"""The outcome of loading one pose — including what could not be read.

FR-022 is the shape of this module: a sample that fails to parse must not remove
another sample from the result and must not raise out of the load. Failures are
therefore *data* (:class:`SkippedSample`) rather than exceptions, which is what
lets the Dataset page report them in a banner instead of a dialog.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from engine.models.pose import Pose, PoseSample

from studio.domain.statistics import PoseStatistics

__all__ = ["SkippedSample", "PoseLoadResult", "LoadedPose"]


@dataclass(frozen=True, slots=True)
class SkippedSample:
    """A sample file that could not be read, and why.

    Attributes:
        path: The file that failed.
        reason: Human-readable cause, taken from the caught exception. Shown to
            the developer, so it names the file's problem rather than Studio's.
    """

    path: Path
    reason: str

    @property
    def filename(self) -> str:
        """The file's basename, for compact display."""
        return self.path.name


@dataclass(frozen=True, slots=True)
class PoseLoadResult:
    """What the gateway returns for one pose.

    **Invariant** (FR-022): ``len(samples) + len(skipped)`` equals the number of
    sample files found. One unreadable file never costs another file its place.

    Attributes:
        pose_id: The pose that was loaded.
        samples: Valid samples only, ordered by ``sample_number``.
        skipped: Empty when everything parsed.
    """

    pose_id: str
    samples: tuple[PoseSample, ...] = ()
    skipped: tuple[SkippedSample, ...] = ()

    @property
    def file_count(self) -> int:
        """Total sample files considered, valid and skipped alike."""
        return len(self.samples) + len(self.skipped)


@dataclass(frozen=True, slots=True)
class LoadedPose:
    """A pose the user has opened, with its statistics already derived.

    Statistics are computed once here rather than per render (FR-016), so
    switching coordinate space or selection never recomputes them.

    The three states the Dataset page must render **distinctly** (data-model §2):

    ==============  ===========================  ==================================
    State           Condition                    UI
    ==============  ===========================  ==================================
    Populated       ``samples`` non-empty        List, statistics, visualization.
    Empty           no samples, no skipped       "No samples recorded for this pose."
    All-skipped     no samples, skipped present  Empty state **plus** the banner.
    ==============  ===========================  ==================================

    *Empty* and *All-skipped* look similar but have different causes, and
    collapsing them would tell a developer their pose is empty when in fact its
    files are broken — the opposite of what this tool is for.

    Attributes:
        pose: Identity and labels, taken from the first valid sample (D3).
        samples: Valid samples, ordered by ``sample_number``.
        skipped: Files that could not be read.
        statistics: Derived at load time; see :mod:`studio.domain.statistics`.
    """

    pose: Pose
    samples: tuple[PoseSample, ...] = ()
    skipped: tuple[SkippedSample, ...] = ()
    statistics: PoseStatistics = field(default_factory=PoseStatistics)

    @property
    def pose_id(self) -> str:
        """The pose's identity."""
        return self.pose.pose_id

    @property
    def sample_count(self) -> int:
        """Number of **valid** samples."""
        return len(self.samples)

    @property
    def has_samples(self) -> bool:
        """Whether anything can be drawn for this pose."""
        return bool(self.samples)

    @property
    def skipped_count(self) -> int:
        """Number of files that could not be read (FR-022)."""
        return len(self.skipped)

    @property
    def is_empty(self) -> bool:
        """True for the *Empty* state: nothing recorded, nothing broken."""
        return not self.samples and not self.skipped

    @property
    def is_all_skipped(self) -> bool:
        """True for the *All-skipped* state: files exist, none of them readable."""
        return not self.samples and bool(self.skipped)
