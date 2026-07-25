"""Pose-recording domain value objects.

Frozen, slotted dataclasses with no I/O or JSON knowledge (constitution Principle
IV). They reuse the Phase-1 neutral types (`Landmark`, `HandLandmarks`,
`Handedness`) and are the persistence-ready shape the serializer maps to JSON. The
wire schema itself lives in the serializer, never here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.landmarks import Handedness, HandLandmarks

__all__ = [
    "CaptureTiming",
    "Pose",
    "HandMeta",
    "HandSample",
    "NormalizationInfo",
    "PoseMetadata",
    "PoseSample",
    "SampleRef",
    "VersionInfo",
]


@dataclass(frozen=True, slots=True)
class Pose:
    """Identity of a reusable pose.

    ``pose_id`` is the permanent internal key; ``display_name`` and ``description``
    are optional human-facing labels that are never used as identifiers.
    """

    pose_id: str
    display_name: str | None = None
    description: str | None = None


@dataclass(frozen=True, slots=True)
class HandMeta:
    """Per-hand summary carried in a sample's metadata block."""

    handedness: Handedness
    confidence: float


@dataclass(frozen=True, slots=True)
class HandSample:
    """One detected hand, with both its raw and normalized landmark sets."""

    handedness: Handedness
    confidence: float
    raw: HandLandmarks
    normalized: HandLandmarks


@dataclass(frozen=True, slots=True)
class NormalizationInfo:
    """How a sample was normalized — independent of the implementation."""

    strategy: str
    version: str


@dataclass(frozen=True, slots=True)
class CaptureTiming:
    """When a capture was armed and when it actually fired.

    Kept for debugging and future analytics (e.g. "did the user settle before the
    shutter?"). ``countdown_start_time`` is ``None`` for captures taken without a
    countdown; both times are UTC ISO-8601 strings.
    """

    capture_time: str
    countdown_start_time: str | None = None
    countdown_seconds: float = 0.0


@dataclass(frozen=True, slots=True)
class PoseMetadata:
    """Reproducibility context for a sample."""

    timestamp: str
    camera_index: int
    camera_width: int
    camera_height: int
    mediapipe_version: str | None
    application_version: str
    num_hands: int
    hands: tuple[HandMeta, ...]
    capture: CaptureTiming | None = None


@dataclass(frozen=True, slots=True)
class PoseSample:
    """The atomic dataset unit and the object the repository persists.

    ``sample_uuid`` is minted by the recorder at capture; ``sample_number`` (the
    zero-padded stem, e.g. ``sample_000023``) is assigned by the repository on save
    and is blank on a draft.
    """

    schema_version: int
    pose: Pose
    sample_uuid: str
    timestamp: str
    normalization: NormalizationInfo
    metadata: PoseMetadata
    hands: tuple[HandSample, ...]
    sample_number: str = ""


@dataclass(frozen=True, slots=True)
class SampleRef:
    """A lightweight handle to a persisted sample."""

    pose_id: str
    sample_uuid: str
    sample_number: str
    location: str


@dataclass(frozen=True, slots=True)
class VersionInfo:
    """Library/application versions captured into sample metadata."""

    application: str
    mediapipe: str | None = field(default=None)
