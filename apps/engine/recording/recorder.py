"""Pose recording orchestration.

`PoseRecorderService` turns a validated frozen capture into a persisted sample:
validate → normalize each hand → mint a `sample_uuid` → stamp the `normalization`
block → assemble metadata → save via the repository. It performs no terminal or GUI
I/O and depends only on abstractions, so it is fully unit-testable (constitution
Principle I & IV; research D6/D10/D11).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from engine.config.models import CameraConfig
from engine.dataset.repository import PoseRepository
from engine.dataset.serializer import SCHEMA_VERSION
from engine.models.landmarks import FrameDetection
from engine.models.pose import (
    CaptureTiming,
    HandMeta,
    HandSample,
    NormalizationInfo,
    Pose,
    PoseMetadata,
    PoseSample,
    SampleRef,
    VersionInfo,
)
from engine.normalization.normalizer import Normalizer
from engine.recording.validation import PoseValidationService

__all__ = ["PoseRecorderService"]


def _default_clock() -> datetime:
    return datetime.now(UTC)


def _default_uuid_factory() -> str:
    return str(uuid.uuid4())


class PoseRecorderService:
    """Builds and persists one pose sample from a frozen detection."""

    def __init__(
        self,
        validator: PoseValidationService,
        normalizer: Normalizer,
        repository: PoseRepository,
        versions: VersionInfo,
        camera: CameraConfig,
        clock: Callable[[], datetime] = _default_clock,
        uuid_factory: Callable[[], str] = _default_uuid_factory,
    ) -> None:
        """Store injected collaborators; construct nothing here."""
        self._validator = validator
        self._normalizer = normalizer
        self._repository = repository
        self._versions = versions
        self._camera = camera
        self._clock = clock
        self._uuid_factory = uuid_factory

    @property
    def normalization_strategy(self) -> str:
        """The strategy name of the injected normalizer (for logging/metadata)."""
        return self._normalizer.strategy

    def record(
        self,
        detection: FrameDetection,
        pose: Pose,
        timing: CaptureTiming | None = None,
    ) -> SampleRef:
        """Validate, normalize, and persist ``detection`` as a sample of ``pose``.

        Args:
            detection: The frozen capture to persist.
            pose: The pose identity supplied by the caller.
            timing: Optional countdown/capture timestamps recorded into metadata
                for debugging and analytics; ``None`` for an untimed capture.

        Raises:
            CaptureValidationError: if the capture is invalid (nothing is saved).
        """
        self._validator.validate_capture(detection)

        timestamp = self._clock().isoformat()
        hands = tuple(
            HandSample(
                handedness=hand.handedness,
                confidence=hand.confidence,
                raw=hand.landmarks,
                normalized=self._normalizer.normalize(hand.landmarks),
            )
            for hand in detection.hands
        )

        metadata = PoseMetadata(
            timestamp=timestamp,
            camera_index=self._camera.index,
            camera_width=detection.frame_width,
            camera_height=detection.frame_height,
            mediapipe_version=self._versions.mediapipe,
            application_version=self._versions.application,
            num_hands=detection.hand_count,
            hands=tuple(
                HandMeta(handedness=hand.handedness, confidence=hand.confidence)
                for hand in detection.hands
            ),
            capture=timing,
        )

        sample = PoseSample(
            schema_version=SCHEMA_VERSION,
            pose=pose,
            sample_uuid=self._uuid_factory(),
            timestamp=timestamp,
            normalization=NormalizationInfo(
                strategy=self._normalizer.strategy,
                version=self._normalizer.version,
            ),
            metadata=metadata,
            hands=hands,
        )

        return self._repository.save(sample)
