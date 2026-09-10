"""SC-006 as an executable assertion, not a review habit.

Hash the whole dataset tree, run a full exploration session over it, hash again,
and require byte-for-byte equality. Read-only guarantees erode quietly as an
application grows; this is the test that notices.

Run against **both** a synthetic tree and the repository's real
``datasets/poses``. The real one is only ever *read* here — the assertion is
precisely that nothing changed, so a failure of this test is also its own
evidence that the dataset was touched.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from pathlib import Path

import pytest
from engine.config.models import DatasetConfig
from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.serializer import PoseSerializer
from studio.application.build_scene_plan import build_scene_plan
from studio.application.load_pose import LoadPose
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey
from studio.infrastructure.engine_dataset.catalog_source import FilesystemPoseCatalogSource
from studio.infrastructure.engine_dataset.gateway import EngineDatasetGateway

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_POSES = REPO_ROOT / "datasets" / "poses"


def hash_tree(root: Path) -> dict[str, str]:
    """Map every file under ``root`` to a SHA-256 of its bytes."""
    digests: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digests[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return digests


def explore_everything(dataset_root: Path) -> int:
    """Do everything Studio can do, reading only. Returns poses visited.

    Deliberately exercises the whole read path: enumerate, load every pose,
    compute statistics, and build a scene plan for every sample in both
    coordinate spaces, with indices on and off.
    """
    config = DatasetConfig(root=str(dataset_root))
    repository = JsonPoseRepository(config, PoseSerializer())
    catalog_source = FilesystemPoseCatalogSource(config)
    load_pose = LoadPose(EngineDatasetGateway(config, repository))
    visualization = VisualizationConfig()

    visited = 0
    for entry in catalog_source.list_poses():
        loaded = load_pose(entry.pose_id)
        visited += 1
        keys = frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in loaded.samples)
        for space in (CoordinateSpace.RAW, CoordinateSpace.NORMALIZED):
            for indices in (False, True):
                state = DatasetViewState(
                    selected_pose_id=entry.pose_id,
                    selected_samples=keys,
                    coordinate_space=space,
                    show_landmark_indices=indices,
                )
                build_scene_plan(loaded.samples, state, visualization)
    return visited


def test_a_full_session_leaves_a_synthetic_dataset_byte_identical(
    dataset_root: Path,
    synthetic_pose: Callable[..., Path],
    write_corrupt_sample: Callable[..., Path],
) -> None:
    """Includes a corrupt file: skipping must not mean quarantining or deleting."""
    synthetic_pose(5, pose_id="alpha")
    synthetic_pose(3, pose_id="beta", two_handed=True)
    write_corrupt_sample("alpha", "sample_000099", kind="truncated")

    before = hash_tree(dataset_root)
    assert explore_everything(dataset_root) == 2
    after = hash_tree(dataset_root)

    assert before == after
    assert set(before) == set(after), "no file created or removed"


@pytest.mark.skipif(not REAL_POSES.exists(), reason="repository dataset not present")
def test_a_full_session_leaves_the_real_dataset_byte_identical() -> None:
    """SC-006 against the project's actual ground truth."""
    before = hash_tree(REAL_POSES)
    assert before, "the repository dataset should not be empty"

    visited = explore_everything(REPO_ROOT / "datasets")
    after = hash_tree(REAL_POSES)

    assert visited > 0
    assert before == after


def test_no_write_capable_operation_is_reachable_from_studio() -> None:
    """Enforcement level 2 (contracts/studio-ports.md): no mutating port exists."""
    import studio.domain.ports as ports

    for protocol_name in ("PoseCatalogSource", "PoseSampleSource"):
        protocol = getattr(ports, protocol_name)
        operations = {n for n in dir(protocol) if not n.startswith("_")}
        forbidden = {"save", "delete", "write", "next_sample_number", "create", "rename"}
        assert not (operations & forbidden)


def test_studio_never_calls_engines_write_methods() -> None:
    """Enforcement level 1: the calls are not merely unused, they are absent.

    Parsed with ``ast`` rather than grepped, so a docstring that *names* a
    prohibited method — which several deliberately do, to explain why it is
    prohibited — is not mistaken for a call to it.
    """
    import ast

    forbidden = {"save", "next_sample_number", "list_sample_refs"}
    offenders: list[str] = []

    for path in (REPO_ROOT / "apps" / "studio").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in forbidden
            ):
                offenders.append(f"{path.name}:{node.lineno} calls .{node.func.attr}()")

    assert not offenders, "Studio must not call Engine's write-capable methods: " + "; ".join(
        offenders
    )
