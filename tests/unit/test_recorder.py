"""Tests for the pose recorder service (with fakes)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.config.models import CameraConfig, RecordingConfig
from app.models.landmarks import FrameDetection, HandLandmarks
from app.models.pose import Pose, PoseSample, SampleRef, VersionInfo
from app.recording.recorder import PoseRecorderService
from app.recording.validation import CaptureValidationError, PoseValidationService

from tests.unit.factories import make_frame_detection, make_hand_landmarks


class FakeNormalizer:
    """Records its identity and returns a distinct normalized set."""

    strategy = "fake_norm"
    version = "9.9"

    def normalize(self, hand: HandLandmarks) -> HandLandmarks:
        return make_hand_landmarks(offset=0.5)


class FakeRepository:
    """Captures the saved sample and returns a fixed ref."""

    def __init__(self) -> None:
        self.saved: PoseSample | None = None

    def save(self, sample: PoseSample) -> SampleRef:
        self.saved = sample
        return SampleRef(
            pose_id=sample.pose.pose_id,
            sample_uuid=sample.sample_uuid,
            sample_number="sample_000001",
            location="/tmp/open_palm/sample_000001.json",
        )


def _recorder(repo: FakeRepository) -> PoseRecorderService:
    return PoseRecorderService(
        validator=PoseValidationService(RecordingConfig()),
        normalizer=FakeNormalizer(),
        repository=repo,
        versions=VersionInfo(application="0.1.0", mediapipe="0.10.35"),
        camera=CameraConfig(index=2),
        clock=lambda: datetime(2026, 7, 24, 13, 20, tzinfo=UTC),
        uuid_factory=lambda: "fixed-uuid-1234",
    )


def test_valid_detection_is_saved_with_uuid_and_normalization() -> None:
    repo = FakeRepository()
    ref = _recorder(repo).record(make_frame_detection(), Pose(pose_id="open_palm"))

    assert ref.sample_number == "sample_000001"
    saved = repo.saved
    assert saved is not None
    assert saved.sample_uuid == "fixed-uuid-1234"
    assert saved.normalization.strategy == "fake_norm"
    assert saved.normalization.version == "9.9"


def test_saved_hands_carry_raw_and_normalized_21() -> None:
    repo = FakeRepository()
    _recorder(repo).record(make_frame_detection(), Pose(pose_id="open_palm"))
    hand = repo.saved.hands[0]
    assert len(hand.raw.points) == 21
    assert len(hand.normalized.points) == 21
    # Normalized came from the (fake) normalizer, not equal to raw.
    assert hand.normalized.points[0].x != hand.raw.points[0].x


def test_invalid_detection_raises_without_saving() -> None:
    repo = FakeRepository()
    empty = FrameDetection(hands=(), frame_width=640, frame_height=480, timestamp=0.0)
    with pytest.raises(CaptureValidationError):
        _recorder(repo).record(empty, Pose(pose_id="open_palm"))
    assert repo.saved is None
