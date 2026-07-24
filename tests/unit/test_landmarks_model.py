"""Tests for the neutral hand-detection value objects."""

from __future__ import annotations

import pytest
from app.models.landmarks import (
    FrameDetection,
    HandDetection,
    Handedness,
    HandLandmarks,
    Landmark,
)
from app.models.topology import HAND_LANDMARK_COUNT


def _make_points(count: int = HAND_LANDMARK_COUNT) -> tuple[Landmark, ...]:
    return tuple(Landmark(x=i / 100, y=i / 100, z=0.0) for i in range(count))


def test_handlandmarks_requires_exactly_21() -> None:
    with pytest.raises(ValueError):
        HandLandmarks(points=_make_points(20))
    with pytest.raises(ValueError):
        HandLandmarks(points=_make_points(22))
    # Exactly 21 is accepted.
    HandLandmarks(points=_make_points(21))


def test_to_pixel_maps_and_clips() -> None:
    assert Landmark(x=0.5, y=0.5, z=0.0).to_pixel(200, 100) == (100, 50)
    # Out-of-range values are clipped to frame bounds.
    assert Landmark(x=-0.2, y=1.5, z=0.0).to_pixel(200, 100) == (0, 99)


def test_mirrored_flips_x_only() -> None:
    points = tuple(Landmark(x=0.25, y=0.4, z=0.1) for _ in range(HAND_LANDMARK_COUNT))
    mirrored = HandLandmarks(points=points).mirrored()
    for original, flipped in zip(points, mirrored.points, strict=True):
        assert flipped.x == pytest.approx(1.0 - original.x)
        assert flipped.y == original.y
        assert flipped.z == original.z


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Left", Handedness.LEFT),
        ("right", Handedness.RIGHT),
        (" RIGHT ", Handedness.RIGHT),
        ("nonsense", Handedness.UNKNOWN),
        (None, Handedness.UNKNOWN),
    ],
)
def test_handedness_from_label(label: str | None, expected: Handedness) -> None:
    assert Handedness.from_label(label) is expected


def test_confidence_label_two_decimals() -> None:
    hand = HandDetection(
        handedness=Handedness.LEFT,
        confidence=0.976,
        landmarks=HandLandmarks(points=_make_points()),
    )
    assert hand.confidence_label == "0.98"


def test_frame_detection_hand_count() -> None:
    empty = FrameDetection(hands=(), frame_width=640, frame_height=480, timestamp=0.0)
    assert empty.hand_count == 0

    hand = HandDetection(
        handedness=Handedness.RIGHT,
        confidence=0.9,
        landmarks=HandLandmarks(points=_make_points()),
    )
    two = FrameDetection(hands=(hand, hand), frame_width=640, frame_height=480, timestamp=1.0)
    assert two.hand_count == 2
