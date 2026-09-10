"""Pose discovery: ordering, empty states, and the promise not to parse."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from engine.config.models import DatasetConfig
from studio.domain.ports import PoseCatalogSource
from studio.infrastructure.engine_dataset.catalog_source import FilesystemPoseCatalogSource


def _source(dataset_root: Path) -> FilesystemPoseCatalogSource:
    return FilesystemPoseCatalogSource(DatasetConfig(root=str(dataset_root)))


def test_satisfies_the_port() -> None:
    assert isinstance(_source(Path(".")), PoseCatalogSource)


def test_lists_poses_in_ascending_id_order(poses_dir: Path, dataset_root: Path) -> None:
    for name in ("zebra", "alpha", "mango"):
        (poses_dir / name).mkdir()

    catalog = _source(dataset_root).list_poses()

    assert [e.pose_id for e in catalog] == ["alpha", "mango", "zebra"]


def test_counts_sample_files_without_opening_them(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(4, pose_id="counted")

    catalog = _source(dataset_root).list_poses()

    assert catalog.find("counted").sample_file_count == 4


def test_display_name_is_unknown_until_loaded(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    """The catalog opens no file, so it cannot know a pose's label (D3)."""
    synthetic_pose(1, pose_id="unlabelled")

    entry = _source(dataset_root).list_poses().find("unlabelled")

    assert entry.display_name is None
    assert entry.label == "unlabelled"


def test_no_sample_file_is_opened_during_enumeration(
    dataset_root: Path, synthetic_pose: Callable[..., Path], monkeypatch
) -> None:
    """The load-bearing promise of D3, asserted rather than assumed."""
    synthetic_pose(3, pose_id="untouched")

    opened: list[str] = []
    original = Path.read_text

    def spy(self: Path, *args, **kwargs):
        opened.append(str(self))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", spy)
    _source(dataset_root).list_poses()

    assert opened == []


def test_zero_sample_pose_still_appears(poses_dir: Path, dataset_root: Path) -> None:
    """FR-021: an empty pose is a state to render, not a pose to hide."""
    (poses_dir / "empty_pose").mkdir()

    entry = _source(dataset_root).list_poses().find("empty_pose")

    assert entry is not None
    assert entry.sample_file_count == 0


def test_missing_root_returns_empty_catalog_without_raising(tmp_path: Path) -> None:
    """Spec edge case 1: a fresh checkout is a normal state, not a failure."""
    catalog = _source(tmp_path / "does_not_exist").list_poses()

    assert catalog.is_empty
    assert len(catalog) == 0


def test_empty_root_returns_empty_catalog(dataset_root: Path) -> None:
    assert _source(dataset_root).list_poses().is_empty


def test_files_at_the_poses_root_are_ignored(poses_dir: Path, dataset_root: Path) -> None:
    (poses_dir / "stray.json").write_text("{}", encoding="utf-8")
    (poses_dir / "real_pose").mkdir()

    catalog = _source(dataset_root).list_poses()

    assert [e.pose_id for e in catalog] == ["real_pose"]


def test_find_returns_none_for_unknown_pose(dataset_root: Path) -> None:
    assert _source(dataset_root).list_poses().find("nope") is None
