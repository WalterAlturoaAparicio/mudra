"""FR-022, the core of it: one bad file costs exactly one sample.

Also pins the decision not to use ``JsonPoseRepository.list_sample_refs()``
(research D4) by asserting the behaviour that method cannot provide.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from engine.config.models import DatasetConfig
from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.serializer import PoseSerializer
from studio.domain.ports import PoseSampleSource
from studio.infrastructure.engine_dataset.gateway import EngineDatasetGateway


def _gateway(dataset_root: Path) -> EngineDatasetGateway:
    config = DatasetConfig(root=str(dataset_root))
    return EngineDatasetGateway(config, JsonPoseRepository(config, PoseSerializer()))


def test_satisfies_the_port() -> None:
    assert isinstance(_gateway(Path(".")), PoseSampleSource)


def test_loads_every_valid_sample_in_order(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(5, pose_id="ordered")

    result = _gateway(dataset_root).load_pose("ordered")

    assert result.pose_id == "ordered"
    assert not result.skipped
    assert [s.sample_number for s in result.samples] == [
        f"sample_{i:06d}" for i in range(1, 6)
    ]


@pytest.mark.parametrize("kind", ["truncated", "bad_version", "no_normalized", "short_hand"])
def test_a_corrupt_sample_is_skipped_while_the_rest_survive(
    dataset_root: Path,
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
    kind: str,
) -> None:
    """FR-022 across every failure mode Engine's parser can produce."""
    synthetic_pose(4, pose_id="mixed")
    bad_path = write_corrupt_sample("mixed", "sample_000099", kind=kind)

    result = _gateway(dataset_root).load_pose("mixed")

    assert len(result.samples) == 4, "a bad file must not cost another sample its place"
    assert len(result.skipped) == 1
    assert result.skipped[0].path == bad_path
    assert result.skipped[0].reason, "the developer must be told why it was skipped"


def test_missing_normalized_block_is_a_load_concern_not_a_render_one(
    dataset_root: Path,
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
) -> None:
    """Research D7 / spec Assumptions, asserted.

    Under schema 1 the normalized block is mandatory, so such a sample never
    becomes something the visualization has to render as "unavailable".
    """
    synthetic_pose(1, pose_id="nonorm")
    write_corrupt_sample("nonorm", "sample_000050", kind="no_normalized")

    result = _gateway(dataset_root).load_pose("nonorm")

    assert len(result.samples) == 1
    assert len(result.skipped) == 1
    assert "normalized" in result.skipped[0].reason.lower()


def test_completeness_invariant(
    dataset_root: Path,
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
) -> None:
    """``len(samples) + len(skipped)`` equals the file count. Nothing vanishes."""
    pose_dir = synthetic_pose(6, pose_id="complete")
    write_corrupt_sample("complete", "sample_000091", kind="truncated")
    write_corrupt_sample("complete", "sample_000092", kind="bad_version")
    file_count = len(list(pose_dir.glob("sample_*.json")))

    result = _gateway(dataset_root).load_pose("complete")

    assert result.file_count == file_count == 8
    assert len(result.samples) == 6
    assert len(result.skipped) == 2


def test_all_samples_corrupt_yields_only_skipped_without_raising(
    dataset_root: Path, write_corrupt_sample: Callable[..., Path]
) -> None:
    write_corrupt_sample("broken", "sample_000001", kind="truncated")
    write_corrupt_sample("broken", "sample_000002", kind="bad_version")

    result = _gateway(dataset_root).load_pose("broken")

    assert result.samples == ()
    assert len(result.skipped) == 2


def test_unknown_pose_returns_empty_without_raising(dataset_root: Path) -> None:
    result = _gateway(dataset_root).load_pose("never_recorded")

    assert result.samples == ()
    assert result.skipped == ()
    assert result.file_count == 0


def test_gateway_never_writes(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    """FR-017 at the adapter level, before the tree-hash test at T056."""
    pose_dir = synthetic_pose(3, pose_id="readonly")
    before = {p: p.read_bytes() for p in sorted(pose_dir.iterdir())}

    _gateway(dataset_root).load_pose("readonly")

    after = {p: p.read_bytes() for p in sorted(pose_dir.iterdir())}
    assert before == after
