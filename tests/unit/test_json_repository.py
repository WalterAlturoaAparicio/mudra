"""Tests for the append-only JSON pose repository."""

from __future__ import annotations

from pathlib import Path

from app.config.models import DatasetConfig
from app.dataset.json_repository import JsonPoseRepository
from app.dataset.serializer import PoseSerializer

from tests.unit.factories import make_pose_sample


def _repo(tmp_path: Path) -> JsonPoseRepository:
    config = DatasetConfig(root=str(tmp_path))
    return JsonPoseRepository(config, PoseSerializer())


def test_first_save_creates_collection_and_file(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    ref = repo.save(make_pose_sample())
    assert ref.sample_number == "sample_000001"
    path = tmp_path / "poses" / "open_palm" / "sample_000001.json"
    assert path.is_file()
    assert ref.location == str(path.resolve())


def test_second_save_increments_and_preserves_first(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    first = repo.save(make_pose_sample())
    first_bytes = Path(first.location).read_bytes()
    second = repo.save(make_pose_sample())
    assert second.sample_number == "sample_000002"
    # First file is untouched.
    assert Path(first.location).read_bytes() == first_bytes
    assert repo.count("open_palm") == 2


def test_numbering_continues_past_gaps(tmp_path: Path) -> None:
    pose_dir = tmp_path / "poses" / "open_palm"
    pose_dir.mkdir(parents=True)
    (pose_dir / "sample_000005.json").write_text("{}", encoding="utf-8")
    repo = _repo(tmp_path)
    ref = repo.save(make_pose_sample())
    assert ref.sample_number == "sample_000006"


def test_never_overwrites_existing(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    ref = repo.save(make_pose_sample())
    original = Path(ref.location).read_text(encoding="utf-8")
    # Force a collision: pre-create the next expected file with sentinel content.
    collision = tmp_path / "poses" / "open_palm" / "sample_000002.json"
    collision.write_text("SENTINEL", encoding="utf-8")
    new_ref = repo.save(make_pose_sample())
    assert new_ref.sample_number == "sample_000003"  # skipped the pre-existing 000002
    assert collision.read_text(encoding="utf-8") == "SENTINEL"  # untouched
    assert Path(ref.location).read_text(encoding="utf-8") == original


def test_distinct_poses_get_separate_collections(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.save(make_pose_sample())
    ref = repo.save(make_pose_sample(pose_id="closed_fist"))
    assert (tmp_path / "poses" / "closed_fist" / "sample_000001.json").is_file()
    assert ref.pose_id == "closed_fist"
    assert repo.count("open_palm") == 1
    assert repo.count("closed_fist") == 1


def test_cross_session_numbering_continues(tmp_path: Path) -> None:
    # A fresh repository instance over an existing directory = a new "session".
    _repo(tmp_path).save(make_pose_sample())
    _repo(tmp_path).save(make_pose_sample())
    third = _repo(tmp_path).save(make_pose_sample())
    assert third.sample_number == "sample_000003"
    assert _repo(tmp_path).count("open_palm") == 3


def test_save_load_round_trip(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    sample = make_pose_sample()
    ref = repo.save(sample)
    loaded = repo.load(ref)
    assert loaded.pose.pose_id == "open_palm"
    assert loaded.sample_number == "sample_000001"
    assert loaded.sample_uuid == sample.sample_uuid


def test_list_sample_refs(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.save(make_pose_sample())
    repo.save(make_pose_sample())
    refs = repo.list_sample_refs("open_palm")
    assert [r.sample_number for r in refs] == ["sample_000001", "sample_000002"]


def test_count_zero_for_unknown_pose(tmp_path: Path) -> None:
    assert _repo(tmp_path).count("does_not_exist") == 0
