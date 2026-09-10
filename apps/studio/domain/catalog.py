"""The list of poses the dataset holds — cheap enough to build at startup.

Building the catalog parses **no JSON**: it lists directories and counts
filenames (research D3). Studio can therefore populate the pose tree for a
dataset of any size without touching a sample file, and pays the parse cost only
for the pose the user actually opens.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["PoseCatalogEntry", "PoseCatalog"]


@dataclass(frozen=True, slots=True)
class PoseCatalogEntry:
    """One pose directory, described without reading any of its samples.

    Attributes:
        pose_id: Directory name under ``datasets/poses/``.
        display_name: ``None`` until the pose is loaded; the tree falls back to
            ``pose_id``, because a pose's human label lives inside its samples
            and the catalog deliberately does not open them.
        sample_file_count: Files matching the configured sample-name pattern.
            A **file** count, not a valid-sample count — see the note on
            :class:`PoseCatalog`.
    """

    pose_id: str
    display_name: str | None = None
    sample_file_count: int = 0

    @property
    def label(self) -> str:
        """The text to show in the tree: display name if known, else the id."""
        return self.display_name or self.pose_id


@dataclass(frozen=True, slots=True)
class PoseCatalog:
    """Every pose found under the dataset root, ordered by ``pose_id``.

    ``sample_file_count`` may exceed a loaded pose's valid ``sample_count`` when
    files are skipped (FR-022). The tree shows the file count, the statistics
    panel shows the valid count, and **that difference is itself the signal** —
    reconciling them silently would hide exactly what the skipped banner exists
    to report.

    An empty catalog is a valid state, not an error: a fresh checkout with
    nothing recorded, or a missing dataset root, both land here and the pose tree
    renders its "no poses recorded" message (FR-003, spec edge case 1).
    """

    entries: tuple[PoseCatalogEntry, ...] = ()

    def __len__(self) -> int:
        """Number of poses in the catalog."""
        return len(self.entries)

    def __iter__(self):
        """Iterate the entries in ``pose_id`` order."""
        return iter(self.entries)

    @property
    def is_empty(self) -> bool:
        """Whether the dataset holds no pose directories at all."""
        return not self.entries

    def find(self, pose_id: str) -> PoseCatalogEntry | None:
        """Return the entry for ``pose_id``, or ``None`` if absent."""
        for entry in self.entries:
            if entry.pose_id == pose_id:
                return entry
        return None
