"""Shared fixtures for the Mudra Studio suite.

**Every fixture writes only under ``tmp_path``.** Nothing here touches the real
``datasets/`` tree: Studio is read-only with respect to the dataset (FR-017,
SC-006), and a test suite that corrupted the project's ground truth in order to
prove Studio does not would be a poor trade.

Samples are written through Engine's own ``PoseSerializer`` rather than by
hand-assembling JSON, so a fixture cannot drift from the schema Studio will
actually read.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from pathlib import Path

import pytest
from engine.dataset.serializer import PoseSerializer
from engine.models.landmarks import Handedness, HandLandmarks, Landmark
from engine.models.pose import (
    CaptureTiming,
    HandMeta,
    HandSample,
    NormalizationInfo,
    Pose,
    PoseMetadata,
    PoseSample,
)

# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #


def make_landmarks(
    *, offset: float = 0.0, scale: float = 1.0, jitter: float = 0.0
) -> HandLandmarks:
    """Build a deterministic 21-point hand.

    Args:
        offset: Translation applied to x and y.
        scale: Multiplier applied to the base shape.
        jitter: Per-landmark deterministic wobble; index ``i`` is displaced by
            ``jitter * sin(i)``. Non-zero values are what make a pose's samples
            differ from one another, which is the variation SC-004 asks a
            developer to be able to see.
    """
    points = tuple(
        Landmark(
            x=offset + scale * (0.01 * i) + jitter * math.sin(i),
            y=offset + scale * (0.02 * i) + jitter * math.cos(i),
            z=scale * (0.005 * i),
        )
        for i in range(21)
    )
    return HandLandmarks(points=points)


def _hand_from_fingers(
    wrist: tuple[float, float],
    fingers: Sequence[tuple[float, float]],
) -> HandLandmarks:
    """Build a 21-point hand from a wrist and five ``(angle, length)`` fingers.

    Points come out in MediaPipe order — wrist, then four joints per finger from
    thumb to pinky — so Engine's ``HAND_CONNECTIONS`` describe a real skeleton
    rather than an arbitrary scatter. Angles are measured anticlockwise from the
    +x axis, with y increasing downward as in frame space.
    """
    points = [Landmark(x=wrist[0], y=wrist[1], z=0.0)]
    for angle, length in fingers:
        for step in range(1, 5):
            reach = length * step / 4.0
            points.append(
                Landmark(
                    x=wrist[0] + reach * math.cos(angle),
                    y=wrist[1] - reach * math.sin(angle),
                    z=0.0,
                )
            )
    return HandLandmarks(points=tuple(points))


#: Fingers splayed wide and fully extended, wrist low and central.
SPREAD_HAND: HandLandmarks = _hand_from_fingers(
    wrist=(0.50, 0.88),
    fingers=(
        (0.35, 0.22),  # thumb, out to the side
        (0.95, 0.34),
        (1.35, 0.38),
        (1.75, 0.34),
        (2.15, 0.28),  # pinky
    ),
)

#: Fingers curled into a tight cluster pointing one way, wrist high and to the
#: left. Deliberately dissimilar to :data:`SPREAD_HAND` in position, span and
#: direction, so any visualization that renders them alike has lost information.
FIST_HAND: HandLandmarks = _hand_from_fingers(
    wrist=(0.18, 0.24),
    fingers=(
        (5.60, 0.07),
        (5.75, 0.09),
        (5.90, 0.10),
        (6.05, 0.09),
        (6.20, 0.07),
    ),
)


def normalized_of(landmarks: HandLandmarks) -> HandLandmarks:
    """Normalize through **Engine's own** normalizer, never a local copy.

    A fixture that normalized by hand could drift from what the recorder writes,
    and then a test would be asserting against a convention the dataset does not
    use.
    """
    return TranslationScaleNormalizer(NormalizationConfig()).normalize(landmarks)


def make_geometry_hand(
    landmarks: HandLandmarks,
    *,
    handedness: Handedness = Handedness.RIGHT,
    confidence: float = 0.95,
) -> HandSample:
    """Wrap explicit ``landmarks`` as a :class:`HandSample` with both spaces."""
    return HandSample(
        handedness=handedness,
        confidence=confidence,
        raw=landmarks,
        normalized=normalized_of(landmarks),
    )


def make_hand(
    *,
    handedness: Handedness = Handedness.RIGHT,
    confidence: float = 0.97,
    jitter: float = 0.0,
) -> HandSample:
    """Build one hand observation with both raw and normalized landmark sets."""
    return HandSample(
        handedness=handedness,
        confidence=confidence,
        raw=make_landmarks(jitter=jitter),
        normalized=make_landmarks(offset=-0.1, jitter=jitter),
    )


def make_pose_sample(
    *,
    pose_id: str = "open_palm",
    display_name: str | None = "Open Palm",
    description: str | None = "Right hand open.",
    sample_number: str = "sample_000001",
    hands: tuple[HandSample, ...] | None = None,
    timestamp: str = "2026-07-24T13:20:00+00:00",
    strategy: str = "translation_scale",
    capture: CaptureTiming | None = None,
    sample_uuid: str = "550e8400-e29b-41d4-a716-446655440000",
) -> PoseSample:
    """Build a fully-populated :class:`PoseSample`."""
    if hands is None:
        hands = (make_hand(),)
    metadata = PoseMetadata(
        timestamp=timestamp,
        camera_index=0,
        camera_width=1280,
        camera_height=720,
        mediapipe_version="0.10.35",
        application_version="0.1.0",
        num_hands=len(hands),
        hands=tuple(HandMeta(handedness=h.handedness, confidence=h.confidence) for h in hands),
        capture=capture,
    )
    return PoseSample(
        schema_version=1,
        pose=Pose(pose_id=pose_id, display_name=display_name, description=description),
        sample_uuid=sample_uuid,
        sample_number=sample_number,
        timestamp=timestamp,
        normalization=NormalizationInfo(strategy=strategy, version="1.0"),
        metadata=metadata,
        hands=hands,
    )


# --------------------------------------------------------------------------- #
# Filesystem fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def dataset_root(tmp_path: Path) -> Path:
    """An empty, ``tmp_path``-backed dataset root containing a ``poses/`` dir."""
    root = tmp_path / "datasets"
    (root / "poses").mkdir(parents=True)
    return root


@pytest.fixture
def poses_dir(dataset_root: Path) -> Path:
    """The ``poses/`` directory inside :func:`dataset_root`."""
    return dataset_root / "poses"


@pytest.fixture
def write_sample(poses_dir: Path) -> Callable[..., Path]:
    """Return a callable writing one valid sample and returning its path."""
    serializer = PoseSerializer()

    def _write(sample: PoseSample, *, pose_id: str | None = None) -> Path:
        pose_dir = poses_dir / (pose_id or sample.pose.pose_id)
        pose_dir.mkdir(parents=True, exist_ok=True)
        path = pose_dir / f"{sample.sample_number}.json"
        path.write_text(serializer.to_json(sample), encoding="utf-8")
        return path

    return _write


@pytest.fixture
def write_corrupt_sample(poses_dir: Path) -> Callable[..., Path]:
    """Return a callable writing an unreadable sample, for FR-022 coverage.

    ``kind`` selects the failure mode, because they fail at different points in
    Engine's parser and Studio must survive all of them identically:

    - ``"truncated"``   — invalid JSON text; fails in ``json.loads``.
    - ``"bad_version"`` — a ``schema_version`` Engine rejects outright.
    - ``"no_normalized"`` — a hand with no ``normalized`` block. Under schema 1
      that block is mandatory, so this raises during parsing and the sample is
      skipped; it never reaches the visualization as an "unavailable" state
      (research D7, spec Assumptions).
    - ``"short_hand"``  — a hand with fewer than 21 landmarks.
    """
    serializer = PoseSerializer()

    def _write(pose_id: str, sample_number: str, *, kind: str = "truncated") -> Path:
        pose_dir = poses_dir / pose_id
        pose_dir.mkdir(parents=True, exist_ok=True)
        path = pose_dir / f"{sample_number}.json"

        if kind == "truncated":
            path.write_text('{"schema_version": 1, "pose_id": "x"', encoding="utf-8")
            return path

        data = serializer.to_dict(make_pose_sample(pose_id=pose_id, sample_number=sample_number))
        if kind == "bad_version":
            data["schema_version"] = 999
        elif kind == "no_normalized":
            del data["hands"][0]["normalized"]
        elif kind == "short_hand":
            data["hands"][0]["raw"] = data["hands"][0]["raw"][:5]
        else:  # pragma: no cover - guards against a typo in a test
            raise ValueError(f"Unknown corruption kind: {kind!r}")

        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return path

    return _write


@pytest.fixture
def synthetic_pose(poses_dir: Path) -> Callable[..., Path]:
    """Return a callable generating a pose directory of ``n`` valid samples.

    One generator serves two success criteria, so the thing being measured is
    the same in both: ``n=10`` for SC-004 (overlay ten or more samples and see
    which landmarks vary the most) and ``n=500`` for SC-007 (stay responsive at
    several hundred samples).

    Each sample carries a distinct deterministic ``jitter``, so per-landmark
    spread across the collection is real and measurable rather than zero.
    """
    serializer = PoseSerializer()

    def _generate(
        n: int,
        *,
        pose_id: str = "synthetic",
        two_handed: bool = False,
        jitter_scale: float = 0.002,
    ) -> Path:
        pose_dir = poses_dir / pose_id
        pose_dir.mkdir(parents=True, exist_ok=True)
        for i in range(1, n + 1):
            jitter = jitter_scale * i
            hands: tuple[HandSample, ...] = (
                make_hand(handedness=Handedness.RIGHT, confidence=0.90, jitter=jitter),
            )
            if two_handed:
                hands = (
                    *hands,
                    make_hand(handedness=Handedness.LEFT, confidence=0.80, jitter=jitter),
                )
            sample = make_pose_sample(
                pose_id=pose_id,
                display_name=pose_id,
                sample_number=f"sample_{i:06d}",
                hands=hands,
                timestamp=f"2026-07-24T13:{i % 60:02d}:00+00:00",
                sample_uuid=f"{i:08d}-0000-0000-0000-000000000000",
            )
            (pose_dir / f"sample_{i:06d}.json").write_text(
                serializer.to_json(sample), encoding="utf-8"
            )
        return pose_dir

    return _generate
