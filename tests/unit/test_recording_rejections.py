"""Tests for rejection/cancel paths the recording controller relies on (no GUI)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from engine.config.models import CameraConfig, RecordingConfig
from engine.models.landmarks import FrameDetection
from engine.models.pose import Pose, VersionInfo
from engine.recording.recorder import PoseRecorderService
from engine.recording.validation import CaptureValidationError, PoseValidationService

from tests.unit.factories import make_hand_detection
from tests.unit.test_recorder import FakeNormalizer, FakeRepository


def _recorder(repo: FakeRepository) -> PoseRecorderService:
    return PoseRecorderService(
        validator=PoseValidationService(RecordingConfig()),
        normalizer=FakeNormalizer(),
        repository=repo,
        versions=VersionInfo(application="0.1.0", mediapipe=None),
        camera=CameraConfig(),
        clock=lambda: datetime(2026, 7, 24, tzinfo=UTC),
        uuid_factory=lambda: "u",
    )


def test_empty_detection_never_saves() -> None:
    repo = FakeRepository()
    empty = FrameDetection(hands=(), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError):
        _recorder(repo).record(empty, Pose(pose_id="open_palm"))
    assert repo.saved is None


def test_malformed_detection_never_saves() -> None:
    repo = FakeRepository()
    bad = make_hand_detection()
    object.__setattr__(bad.landmarks, "points", bad.landmarks.points[:20])
    detection = FrameDetection(hands=(bad,), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError):
        _recorder(repo).record(detection, Pose(pose_id="open_palm"))
    assert repo.saved is None


def test_invalid_pose_id_rejected() -> None:
    validator = PoseValidationService(RecordingConfig())
    for bad in ["", "Bad Id", "../x", "up-per"]:
        with pytest.raises(CaptureValidationError):
            validator.validate_pose_id(bad)
