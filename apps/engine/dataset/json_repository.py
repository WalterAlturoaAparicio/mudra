"""Filesystem JSON implementation of `PoseRepository`.

Writes one human-readable JSON file per sample under
``<root>/<poses_dirname>/<pose_id>/sample_NNNNNN.json``. Numbering is sequential
(max-existing + 1, tolerating gaps) and writes use exclusive creation so an existing
sample is never overwritten (research D4; FR-009/FR-010/SC-002).
"""

from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

from engine.config.models import DatasetConfig
from engine.dataset.repository import PoseRepositoryError
from engine.dataset.serializer import PoseSerializer
from engine.models.pose import PoseSample, SampleRef

__all__ = ["JsonPoseRepository"]


class JsonPoseRepository:
    """Append-only pose storage backed by indented JSON files on disk."""

    def __init__(self, config: DatasetConfig, serializer: PoseSerializer) -> None:
        """Store dataset configuration and the serializer used for file contents."""
        self._config = config
        self._serializer = serializer
        self._poses_root = Path(config.root) / config.poses_dirname
        self._number_re = re.compile(rf"^{re.escape(config.filename_prefix)}(\d+)\.json$")

    # -- paths / numbering -------------------------------------------------------

    def _pose_dir(self, pose_id: str) -> Path:
        return self._poses_root / pose_id

    def _format_number(self, number: int) -> str:
        return f"{self._config.filename_prefix}{number:0{self._config.filename_digits}d}"

    def _existing_numbers(self, pose_id: str) -> list[int]:
        pose_dir = self._pose_dir(pose_id)
        if not pose_dir.is_dir():
            return []
        numbers: list[int] = []
        for entry in pose_dir.iterdir():
            match = self._number_re.match(entry.name)
            if match:
                numbers.append(int(match.group(1)))
        return sorted(numbers)

    def next_sample_number(self, pose_id: str) -> int:
        """Return max-existing + 1 (starting at 1), tolerating gaps."""
        numbers = self._existing_numbers(pose_id)
        return (numbers[-1] + 1) if numbers else 1

    def count(self, pose_id: str) -> int:
        """Return the number of stored samples for ``pose_id``."""
        return len(self._existing_numbers(pose_id))

    # -- persistence -------------------------------------------------------------

    def save(self, sample: PoseSample) -> SampleRef:
        """Write ``sample`` append-only and return its `SampleRef`.

        Assigns the sequential ``sample_number`` and writes with exclusive creation;
        on the rare name collision it advances the number and retries.
        """
        pose_id = sample.pose.pose_id
        pose_dir = self._pose_dir(pose_id)
        try:
            pose_dir.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise PoseRepositoryError(
                f"Could not create pose directory {pose_dir}: {error}"
            ) from error

        number = self.next_sample_number(pose_id)
        while True:
            stem = self._format_number(number)
            path = pose_dir / f"{stem}.json"
            stored = replace(sample, sample_number=stem)
            text = self._serializer.to_json(stored, indent=self._config.json_indent)
            try:
                with path.open("x", encoding="utf-8") as handle:
                    handle.write(text)
                break
            except FileExistsError:
                number += 1  # never overwrite; advance and retry
            except OSError as error:
                raise PoseRepositoryError(f"Could not write sample {path}: {error}") from error

        return SampleRef(
            pose_id=pose_id,
            sample_uuid=sample.sample_uuid,
            sample_number=stem,
            location=str(path.resolve()),
        )

    def list_sample_refs(self, pose_id: str) -> list[SampleRef]:
        """Return handles to all samples of ``pose_id``, ordered by number."""
        refs: list[SampleRef] = []
        for number in self._existing_numbers(pose_id):
            stem = self._format_number(number)
            path = self._pose_dir(pose_id) / f"{stem}.json"
            sample = self.load_path(path)
            refs.append(
                SampleRef(
                    pose_id=pose_id,
                    sample_uuid=sample.sample_uuid,
                    sample_number=stem,
                    location=str(path.resolve()),
                )
            )
        return refs

    def load(self, ref: SampleRef) -> PoseSample:
        """Load the sample referenced by ``ref``."""
        return self.load_path(Path(ref.location))

    def load_path(self, path: Path) -> PoseSample:
        """Load and deserialize a sample from an explicit path."""
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as error:
            raise PoseRepositoryError(f"Could not read sample {path}: {error}") from error
        return self._serializer.from_json(text)
