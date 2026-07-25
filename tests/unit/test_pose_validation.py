"""Tests for the single pose validation service."""

from __future__ import annotations

import math

import pytest
from engine.config.models import RecordingConfig
from engine.models.landmarks import (
    FrameDetection,
    HandDetection,
    Handedness,
    HandLandmarks,
    Landmark,
)
from engine.recording.validation import CaptureValidationError, PoseValidationService

from tests.unit.factories import make_frame_detection, make_hand_detection, make_hand_landmarks


def _service() -> PoseValidationService:
    return PoseValidationService(RecordingConfig())


# -- capture validation ----------------------------------------------------------


def test_accepts_valid_capture() -> None:
    _service().validate_capture(make_frame_detection())  # must not raise


def test_rejects_no_hands() -> None:
    empty = FrameDetection(hands=(), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError, match="No hands"):
        _service().validate_capture(empty)


def test_rejects_wrong_landmark_count() -> None:
    # Bypass the 21-invariant to simulate corrupt upstream data.
    bad = make_hand_detection()
    object.__setattr__(bad.landmarks, "points", bad.landmarks.points[:20])
    detection = FrameDetection(hands=(bad,), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError, match="21 landmarks"):
        _service().validate_capture(detection)


def test_rejects_non_finite_coordinates() -> None:
    points = (Landmark(x=math.nan, y=0.0, z=0.0),) + make_hand_landmarks().points[1:]
    hand = HandDetection(
        handedness=Handedness.RIGHT, confidence=0.9, landmarks=HandLandmarks(points=points)
    )
    detection = FrameDetection(hands=(hand,), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError, match="non-finite"):
        _service().validate_capture(detection)


# -- pose_id validation ----------------------------------------------------------


@pytest.mark.parametrize("value", ["open_palm", "fist2", "a", "pose_123"])
def test_accepts_valid_pose_ids(value: str) -> None:
    assert _service().validate_pose_id(value) == value


def test_trims_whitespace() -> None:
    assert _service().validate_pose_id("  open_palm  ") == "open_palm"


@pytest.mark.parametrize(
    "value",
    ["", "   ", "Open Palm", "OpenPalm", "open-palm", "../escape", "a/b", "a\\b", "posé"],
)
def test_rejects_unsafe_pose_ids(value: str) -> None:
    with pytest.raises(CaptureValidationError):
        _service().validate_pose_id(value)


def test_rejects_over_length_pose_id() -> None:
    with pytest.raises(CaptureValidationError, match="exceeds"):
        _service().validate_pose_id("a" * 65)
