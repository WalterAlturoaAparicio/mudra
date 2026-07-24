"""Neutral hand-detection value objects.

These frozen dataclasses are the backend-agnostic shape produced by any
:class:`~app.detection.detector.HandDetector` and consumed by any
:class:`~app.visualization.renderer.FrameRenderer`. They are deliberately the
persistence-ready shape later phases (pose/sequence recording) will serialize,
so the seam is established now (constitution Principle III). Nothing here is
serialized or written to disk in Phase 1.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.models.topology import HAND_LANDMARK_COUNT

__all__ = ["Handedness", "Landmark", "HandLandmarks", "HandDetection", "FrameDetection"]


class Handedness(StrEnum):
    """The physical hand a detection corresponds to.

    Correct under selfie mirroring: MediaPipe assumes a mirrored input image, so
    when the frame is flipped for the selfie preview the reported label already
    names the user's physical hand.
    """

    LEFT = "left"
    RIGHT = "right"
    UNKNOWN = "unknown"

    @classmethod
    def from_label(cls, label: str | None) -> Handedness:
        """Map a backend label (``"Left"``/``"Right"``) to a member.

        Unknown or missing labels map to :attr:`UNKNOWN` (never raises).
        """
        if label is None:
            return cls.UNKNOWN
        normalized = label.strip().lower()
        if normalized == "left":
            return cls.LEFT
        if normalized == "right":
            return cls.RIGHT
        return cls.UNKNOWN


@dataclass(frozen=True, slots=True)
class Landmark:
    """A single tracked point on a hand.

    ``x`` and ``y`` are normalized to ``[0, 1]`` in (already-mirrored) frame
    space; ``z`` is relative depth (smaller = closer). ``visibility`` is
    reserved for backends that provide it (MediaPipe Hands does not).
    """

    x: float
    y: float
    z: float
    visibility: float | None = None

    def to_pixel(self, width: int, height: int) -> tuple[int, int]:
        """Map normalized coordinates to integer pixel coordinates.

        The result is clipped to the frame bounds because detectors may emit
        values slightly outside ``[0, 1]`` for partially out-of-frame points.
        """
        px = min(max(int(round(self.x * width)), 0), max(width - 1, 0))
        py = min(max(int(round(self.y * height)), 0), max(height - 1, 0))
        return px, py


@dataclass(frozen=True, slots=True)
class HandLandmarks:
    """The fixed set of 21 landmarks for one hand."""

    points: tuple[Landmark, ...]

    def __post_init__(self) -> None:
        """Enforce the 21-landmark invariant every downstream phase relies on."""
        if len(self.points) != HAND_LANDMARK_COUNT:
            raise ValueError(
                f"HandLandmarks requires exactly {HAND_LANDMARK_COUNT} points, "
                f"got {len(self.points)}."
            )

    def mirrored(self) -> HandLandmarks:
        """Return a copy with each ``x`` replaced by ``1 - x`` (horizontal flip)."""
        flipped = tuple(
            Landmark(x=1.0 - p.x, y=p.y, z=p.z, visibility=p.visibility) for p in self.points
        )
        return HandLandmarks(points=flipped)


@dataclass(frozen=True, slots=True)
class HandDetection:
    """One detected hand: its handedness, confidence, and landmarks."""

    handedness: Handedness
    confidence: float
    landmarks: HandLandmarks

    @property
    def confidence_label(self) -> str:
        """Two-decimal string for the HUD (e.g. ``"0.98"`` → shown as ``Left 0.98``)."""
        return f"{self.confidence:.2f}"


@dataclass(frozen=True, slots=True)
class FrameDetection:
    """The full result of processing one frame (0..N hands)."""

    hands: tuple[HandDetection, ...]
    frame_width: int
    frame_height: int
    timestamp: float

    @property
    def hand_count(self) -> int:
        """Number of hands detected in this frame (0 is valid — no hands)."""
        return len(self.hands)
