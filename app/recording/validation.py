"""Pose capture and identifier validation.

`PoseValidationService` is the single validation entry point for the project
(research D12): capture validation and `pose_id` validation both live here, and
future rules extend this one service. Pure; no I/O.
"""

from __future__ import annotations

import math
import re

from app.config.models import RecordingConfig
from app.models.landmarks import FrameDetection
from app.models.topology import HAND_LANDMARK_COUNT

__all__ = ["PoseValidationService", "CaptureValidationError"]


class CaptureValidationError(ValueError):
    """Raised when a capture or `pose_id` fails validation, carrying a human reason."""


class PoseValidationService:
    """Validates frozen captures and pose identifiers before a recording is saved."""

    def __init__(self, config: RecordingConfig) -> None:
        """Store the recording config (pose_id pattern + max length)."""
        self._config = config
        self._pose_id_re = re.compile(config.pose_id_pattern)

    def validate_capture(self, detection: FrameDetection) -> None:
        """Ensure the capture is savable.

        Raises:
            CaptureValidationError: if no hands are present, any hand lacks exactly
                21 landmarks, or any coordinate is non-finite.
        """
        if detection.hand_count == 0:
            raise CaptureValidationError("No hands detected.")

        for hand in detection.hands:
            points = hand.landmarks.points
            if len(points) != HAND_LANDMARK_COUNT:
                raise CaptureValidationError(
                    f"Invalid hand data: expected {HAND_LANDMARK_COUNT} landmarks, "
                    f"got {len(points)}."
                )
            for p in points:
                if not (math.isfinite(p.x) and math.isfinite(p.y) and math.isfinite(p.z)):
                    raise CaptureValidationError(
                        "Invalid hand data: non-finite landmark coordinates."
                    )

    def validate_pose_id(self, pose_id: str) -> str:
        """Return the trimmed, validated `pose_id` or raise.

        Raises:
            CaptureValidationError: if the id is empty, too long, or contains
                characters outside the configured (folder-safe) pattern.
        """
        candidate = pose_id.strip()
        if not candidate:
            raise CaptureValidationError("Invalid pose_id: must not be empty.")
        if len(candidate) > self._config.pose_id_max_length:
            raise CaptureValidationError(
                f"Invalid pose_id: exceeds {self._config.pose_id_max_length} characters."
            )
        if not self._pose_id_re.match(candidate):
            raise CaptureValidationError(
                "Invalid pose_id: use lowercase letters, digits, and underscores only."
            )
        return candidate
