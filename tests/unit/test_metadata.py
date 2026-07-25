"""Field-by-field validation of reproducibility metadata (FR-015)."""

from __future__ import annotations

from datetime import UTC, datetime

from app.config.models import CameraConfig, NormalizationConfig, RecordingConfig
from app.models.landmarks import FrameDetection, Handedness
from app.models.pose import Pose, VersionInfo
from app.normalization.translation_scale import TranslationScaleNormalizer
from app.recording.recorder import PoseRecorderService
from app.recording.validation import PoseValidationService

from tests.unit.factories import make_hand_detection
from tests.unit.test_recorder import FakeRepository


def _two_hand_detection() -> FrameDetection:
    left = make_hand_detection(handedness=Handedness.LEFT, confidence=0.91)
    right = make_hand_detection(handedness=Handedness.RIGHT, confidence=0.98)
    return FrameDetection(hands=(left, right), frame_width=1920, frame_height=1080, timestamp=0.0)


def _record() -> object:
    repo = FakeRepository()
    recorder = PoseRecorderService(
        validator=PoseValidationService(RecordingConfig()),
        normalizer=TranslationScaleNormalizer(NormalizationConfig()),
        repository=repo,
        versions=VersionInfo(application="0.1.0", mediapipe="0.10.35"),
        camera=CameraConfig(index=3),
        clock=lambda: datetime(2026, 7, 24, 13, 20, 0, tzinfo=UTC),
        uuid_factory=lambda: "abc-123",
    )
    recorder.record(_two_hand_detection(), Pose(pose_id="two_hands"))
    return repo.saved


def test_timestamp_is_iso_utc() -> None:
    meta = _record().metadata
    assert meta.timestamp == "2026-07-24T13:20:00+00:00"


def test_camera_fields() -> None:
    meta = _record().metadata
    assert meta.camera_index == 3
    assert meta.camera_width == 1920
    assert meta.camera_height == 1080


def test_version_fields() -> None:
    meta = _record().metadata
    assert meta.application_version == "0.1.0"
    assert meta.mediapipe_version == "0.10.35"


def test_num_hands_and_per_hand_summary() -> None:
    meta = _record().metadata
    assert meta.num_hands == 2
    assert [(h.handedness, h.confidence) for h in meta.hands] == [
        (Handedness.LEFT, 0.91),
        (Handedness.RIGHT, 0.98),
    ]


def test_sample_carries_uuid_and_normalization() -> None:
    sample = _record()
    assert sample.sample_uuid == "abc-123"
    assert sample.normalization.strategy == "translation_scale"
    assert sample.normalization.version == "1.0"
