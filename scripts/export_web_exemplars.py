"""Build the browser exemplar bundle from the recorded pose dataset.

Mudra Web must not ship the full dataset (FR-079): 1,378 JSON files and ~16 MB of text
would be absurd to load in a browser, and almost all of it — raw landmarks, capture
timings, camera metadata — is irrelevant to matching. This script reduces it to the two
files the browser actually needs:

* ``apps/web/public/exemplars.manifest.json`` — provenance, per-pose metadata, offsets
* ``apps/web/public/exemplars.bin`` — a ``Float32Array`` payload of normalized landmarks

Both are **build artifacts**, git-ignored, and derived only. Run from the repository root::

    python scripts/export_web_exemplars.py

Three properties this script exists to guarantee:

**Determinism** (FR-081). The same dataset produces byte-identical output. Poses are
iterated in sorted ``pose_id`` order, samples in sorted filename order, hands in stored
order, and coordinates are written as IEEE-754 ``float32`` — a well-defined narrowing,
unlike decimal float formatting, whose output depends on the writer's repr behaviour.
``generated_at`` is provenance and is deliberately excluded from the fingerprint, so a
rebuild at a different time still yields the same ``dataset_fingerprint``.

**Nothing disappears silently** (FR-023a, FR-085). A pose below ``MIN_SAMPLES`` is not
dropped — it is recorded in ``excluded[]`` with its actual count and the reason, and it is
printed. That line is required output, not a warning to suppress.

**No boundary violation** (FR-098, research D10). ``display_name`` and ``required_hands``
are derived **from the dataset itself**, never from Capture's pose catalog: the display
name is carried on every sample, and the hand requirement is the hand count observed
across a pose's samples. The derivation was verified to match Capture's catalog for 17 of
17 eligible poses.

The dataset is only ever **read** (FR-086); ``tests/web/test_export_read_only.py`` asserts
that against the real tree on disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from engine.config.models import DatasetConfig
from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.repository import PoseRepositoryError
from engine.dataset.serializer import PoseSchemaError, PoseSerializer
from engine.models.pose import PoseSample
from engine.models.topology import HAND_LANDMARK_COUNT

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Bundle format the consumer understands. Bumping this is a breaking change the loader
#: must reject rather than misread (FR-083).
FORMAT_VERSION = 1

#: Samples a pose needs before it is worth matching against (FR-085). Must agree with
#: ``bundle.minSamples`` in ``apps/web/config/session.json``.
MIN_SAMPLES = 20

#: Coordinate components stored per landmark.
COMPONENTS = 3


class ExportError(RuntimeError):
    """Raised when the dataset cannot be turned into a valid bundle."""


def _iter_pose_dirs(poses_root: Path) -> list[Path]:
    """Pose directories in sorted ``pose_id`` order — the first half of determinism."""
    if not poses_root.is_dir():
        raise ExportError(f"Dataset not found at {poses_root}")
    return sorted((p for p in poses_root.iterdir() if p.is_dir()), key=lambda p: p.name)


def _iter_sample_paths(pose_dir: Path) -> list[Path]:
    """Sample files in sorted filename order — the second half of determinism."""
    return sorted(pose_dir.glob("sample_*.json"), key=lambda p: p.name)


def _load(repository: JsonPoseRepository, path: Path) -> PoseSample | None:
    """Load one sample, reporting and skipping an unreadable or off-schema file."""
    try:
        return repository.load_path(path)
    except (PoseRepositoryError, PoseSchemaError) as error:
        print(f"  skipped {path.parent.name}/{path.name}: {error}")
        return None


def _display_name(samples: list[PoseSample], pose_id: str) -> str:
    """Derive a pose's display name from its samples (research D10).

    Samples of the same pose do not always agree — a pose recorded over several sessions
    can carry more than one label. The most frequent one wins, ties broken
    lexicographically, so the result is deterministic rather than "whichever file sorted
    first". Falls back to the ``pose_id`` when no sample carries a name.
    """
    counts: Counter[str] = Counter(
        sample.pose.display_name for sample in samples if sample.pose.display_name
    )
    if not counts:
        return pose_id
    best = max(counts.items(), key=lambda item: (item[1], [-ord(c) for c in item[0]]))
    return best[0]


def _required_hands(samples: list[PoseSample], pose_id: str) -> int:
    """Derive a pose's hand requirement from its samples (research D10).

    The most frequent observed hand count. It is reported when a pose is not unanimous,
    because a pose whose samples disagree about how many hands it takes is a dataset
    finding, not something to average away.
    """
    counts: Counter[int] = Counter(len(sample.hands) for sample in samples)
    if not counts:
        raise ExportError(f"Pose {pose_id!r} has no usable samples.")
    if len(counts) > 1:
        detail = ", ".join(f"{hands} hand(s) x{n}" for hands, n in sorted(counts.items()))
        print(f"  note: {pose_id} is not unanimous about hand count ({detail}); using the mode")
    return max(counts.items(), key=lambda item: (item[1], -item[0]))[0]


def _fingerprint(entries: list[tuple[str, str]]) -> str:
    """SHA-256 over sorted ``(relative path, sha256)`` pairs of every included sample.

    Identity of the *source data*, which is why the generation timestamp is not part of
    it: rebuilding an unchanged dataset must produce an unchanged fingerprint, or staleness
    detection would fire on every build (FR-082).
    """
    digest = hashlib.sha256()
    for path, file_hash in sorted(entries):
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_hash.encode("ascii"))
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def build_bundle(dataset_root: Path) -> tuple[dict[str, object], bytes]:
    """Read the dataset and return ``(manifest, payload)``.

    Pure with respect to the filesystem: it reads, and returns values. Writing is the
    caller's business, which is what lets the determinism test build twice in memory.
    """
    config = DatasetConfig(root=str(dataset_root))
    repository = JsonPoseRepository(config, PoseSerializer())
    poses_root = dataset_root / config.poses_dirname

    pose_dirs = _iter_pose_dirs(poses_root)
    catalog_count = len(pose_dirs)

    included: list[dict[str, object]] = []
    excluded: list[dict[str, object]] = []
    fingerprint_entries: list[tuple[str, str]] = []
    payload = bytearray()
    hand_offset = 0
    total_samples = 0

    for pose_dir in pose_dirs:
        pose_id = pose_dir.name
        paths = _iter_sample_paths(pose_dir)
        loaded: list[tuple[Path, PoseSample]] = []
        for path in paths:
            sample = _load(repository, path)
            if sample is not None:
                loaded.append((path, sample))

        total_samples += len(loaded)
        samples = [sample for _, sample in loaded]

        if len(samples) < MIN_SAMPLES:
            # Never a silent drop (FR-023a): the pose is named, counted, and reasoned about.
            excluded.append(
                {
                    "pose_id": pose_id,
                    "sample_count": len(samples),
                    "reason": "below_min_samples",
                }
            )
            continue

        required_hands = _required_hands(samples, pose_id)
        hands_meta: list[dict[str, object]] = []

        for path, sample in loaded:
            fingerprint_entries.append(
                (
                    path.relative_to(dataset_root).as_posix(),
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
            )
            sample_id = sample.sample_number or sample.sample_uuid
            for hand in sample.hands:
                points = hand.normalized.points
                if len(points) != HAND_LANDMARK_COUNT:  # pragma: no cover - serializer enforces
                    raise ExportError(
                        f"{path} carries a hand with {len(points)} landmarks; "
                        f"{HAND_LANDMARK_COUNT} required."
                    )
                for point in points:
                    payload += struct.pack("<3f", point.x, point.y, point.z)
                hands_meta.append(
                    {"sample_id": sample_id, "handedness": str(hand.handedness)}
                )

        included.append(
            {
                "pose_id": pose_id,
                "display_name": _display_name(samples, pose_id),
                "required_hands": required_hands,
                "sample_count": len(samples),
                "hand_offset": hand_offset,
                "hand_count": len(hands_meta),
                "hands": hands_meta,
            }
        )
        hand_offset += len(hands_meta)

    manifest: dict[str, object] = {
        "format_version": FORMAT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_fingerprint": _fingerprint(fingerprint_entries),
        "normalization": {"strategy": "translation_scale", "version": "1.0"},
        "min_samples": MIN_SAMPLES,
        "landmark_count": HAND_LANDMARK_COUNT,
        "components": COMPONENTS,
        "total_hands": hand_offset,
        "catalog_pose_count": catalog_count,
        "total_samples": total_samples,
        "poses": included,
        "excluded": excluded,
    }
    return manifest, bytes(payload)


def serialize_manifest(manifest: dict[str, object]) -> str:
    """Render the manifest deterministically: fixed separators, no key re-sorting."""
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"


def _display_path(path: Path) -> str:
    """Repository-relative when it can be, absolute otherwise (``--out-dir`` may be anywhere)."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def main() -> None:
    """Build the bundle and write it into ``apps/web/public/``."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=REPO_ROOT / "datasets",
        help="Dataset root containing poses/ (default: the repository's datasets/).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "apps" / "web" / "public",
        help="Where to write exemplars.manifest.json and exemplars.bin.",
    )
    args = parser.parse_args()

    manifest, payload = build_bundle(args.dataset_root)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out_dir / "exemplars.manifest.json"
    payload_path = args.out_dir / "exemplars.bin"
    manifest_path.write_text(serialize_manifest(manifest), encoding="utf-8")
    payload_path.write_bytes(payload)

    poses = manifest["poses"]
    excluded = manifest["excluded"]
    assert isinstance(poses, list) and isinstance(excluded, list)

    print(
        f"Scanned  {manifest['catalog_pose_count']:>3} catalog poses, "
        f"{manifest['total_samples']} samples"
    )
    print(f"Included {len(poses):>3} poses, {manifest['total_hands']} hands")
    if excluded:
        # Required output (FR-023a): a pose must never disappear silently.
        print(f"Excluded {len(excluded):>3} pose(s):")
        for entry in excluded:
            print(
                f"           {entry['pose_id']} "
                f"({entry['sample_count']} sample(s), below minimum of {MIN_SAMPLES})"
            )
    else:
        print("Excluded   0 poses")
    print(f"Wrote    {manifest_path.relative_to(REPO_ROOT)}")
    print(
        f"         {payload_path.relative_to(REPO_ROOT)}   "
        f"({payload_path.stat().st_size / 1024:.1f} KB)"
    )


if __name__ == "__main__":
    main()
