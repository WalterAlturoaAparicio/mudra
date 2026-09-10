"""The interfaces Studio's use cases depend on.

Both are ``typing.Protocol``s, matching Engine's own ``PoseRepository`` style and
constitution Principle I ("dependencies flow toward abstractions").

**Why they exist at all**: they are what keeps FR-019 (consume Engine) and FR-023
(never modify Engine) satisfiable at the same time. Engine is imported in exactly
one package — ``studio.infrastructure.engine_dataset`` — which implements these
protocols. Nothing in ``domain/``, ``application/``, or ``presentation/`` imports
``engine.*``, so if Engine's API moves, one adapter moves.

**Ports deliberately not defined** (Principle VI rejects speculative surface):
no write/save port, because FR-017 requires the dataset to be unchanged and a
port that is never declared cannot be accidentally called; no outlier-detection
port, because FR-018 needs only that the *visualization* can express emphasis,
which is a parameter rather than an interface (research D10); and no export,
training, recognition, or camera port (FR-024).

The full contract, rule by rule, is in
``specs/006-studio-dataset-explorer/contracts/studio-ports.md``.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from studio.domain.catalog import PoseCatalog
from studio.domain.loading import PoseLoadResult

__all__ = ["PoseCatalogSource", "PoseSampleSource"]


@runtime_checkable
class PoseCatalogSource(Protocol):
    """Discovers which poses exist, without parsing any sample."""

    def list_poses(self) -> PoseCatalog:
        """Return every pose in the dataset, ordered ascending by ``pose_id``.

        Contract:
            - MUST NOT parse sample JSON; ``sample_file_count`` comes from
              filenames only (FR-003, research D3).
            - A non-existent or empty poses directory returns an **empty
              catalog**, never raises — the pose tree renders its "no poses
              recorded" state (spec edge case 1).
            - A pose directory with no matching files still appears, with
              ``sample_file_count == 0`` (FR-021).
            - **No side effects**: no file created, modified, or deleted
              (FR-017).
        """
        ...


@runtime_checkable
class PoseSampleSource(Protocol):
    """Loads one pose's samples, fault-tolerantly."""

    def load_pose(self, pose_id: str) -> PoseLoadResult:
        """Load every sample of ``pose_id``, skipping any that cannot be read.

        This is the FR-022 contract, and the rules are the point of the port.

        Contract:
            - MUST delegate parsing to Engine. Studio decodes no sample JSON
              itself (FR-019).
            - A file raising ``PoseSchemaError``, ``PoseRepositoryError``, or
              ``OSError`` MUST be recorded in ``skipped`` and MUST NOT abort the
              load or cost any other sample its place (FR-022).
            - MUST NOT raise for a bad *sample*. It may raise only if the pose
              directory itself is unreadable.
            - ``samples`` ordered ascending by ``sample_number``.
            - ``len(samples) + len(skipped)`` equals the number of files matching
              the sample filename pattern. Nothing is silently dropped.
            - An unknown ``pose_id`` returns an empty result, never raises.
            - **No side effects** (FR-017).
        """
        ...
