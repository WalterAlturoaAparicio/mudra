"""MediaPipe implementation of :class:`~app.detection.detector.HandDetector`.

Uses the MediaPipe **Tasks** ``HandLandmarker`` in VIDEO mode and maps its output
to the neutral :class:`~app.models.landmarks.FrameDetection` model. (The legacy
``mediapipe.solutions`` API is absent from current builds, so the Tasks API is the
supported path; the ``HandDetector`` Protocol keeps this swap localized —
constitution Principle III.)

MediaPipe assumes a mirrored (selfie) input image, so when the caller feeds the
already-mirrored frame the reported handedness names the user's physical hand
(research D3). The per-hand ``confidence`` surfaced here is the handedness
classification score, not a hand-"detection" score (spec FR-008).
"""

from __future__ import annotations

import time
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    HandLandmarker,
    HandLandmarkerOptions,
    RunningMode,
)

from app.camera.source import Frame
from app.config.models import DetectionConfig
from app.detection.detector import HandDetector
from app.models.landmarks import (
    FrameDetection,
    HandDetection,
    Handedness,
    HandLandmarks,
    Landmark,
)
from app.utils.logging import logger

__all__ = ["MediaPipeHandDetector", "resolve_model_path"]

# Repo root = two levels up from this file (app/detection/ -> repo root).
_REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_model_path(config: DetectionConfig) -> Path:
    """Return the absolute model path, downloading it once if it is absent.

    A relative ``model_path`` is resolved against the repository root so the app
    runs regardless of the current working directory.
    """
    path = Path(config.model_path)
    if not path.is_absolute():
        path = _REPO_ROOT / path

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Hand model not found at {}; downloading once...", path)
        urllib.request.urlretrieve(config.model_url, path)  # noqa: S310 (trusted Google URL)
        logger.info("Downloaded hand model to {}.", path)

    return path


class MediaPipeHandDetector(HandDetector):
    """Detects hands using MediaPipe Tasks HandLandmarker (VIDEO mode)."""

    def __init__(self, config: DetectionConfig) -> None:
        """Build the HandLandmarker from ``config`` (resolving/fetching the model)."""
        self._config = config
        model_path = resolve_model_path(config)
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=RunningMode.VIDEO,
            num_hands=config.max_num_hands,
            min_hand_detection_confidence=config.min_detection_confidence,
            min_hand_presence_confidence=config.min_detection_confidence,
            min_tracking_confidence=config.min_tracking_confidence,
        )
        self._landmarker = HandLandmarker.create_from_options(options)
        self._last_timestamp_ms = -1

    def detect(self, frame: Frame) -> FrameDetection:
        """Detect hands in ``frame`` (BGR) and map to a :class:`FrameDetection`."""
        height, width = frame.shape[:2]
        wall_time = time.monotonic()

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # VIDEO mode requires a strictly increasing millisecond timestamp.
        timestamp_ms = max(int(wall_time * 1000), self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms

        result = self._landmarker.detect_for_video(mp_image, timestamp_ms)
        hands = self._map_result(result)
        return FrameDetection(
            hands=hands,
            frame_width=width,
            frame_height=height,
            timestamp=wall_time,
        )

    @staticmethod
    def _map_result(result: object) -> tuple[HandDetection, ...]:
        """Convert a ``HandLandmarkerResult`` into neutral ``HandDetection``s."""
        hand_landmarks = getattr(result, "hand_landmarks", None)
        if not hand_landmarks:
            return ()

        handedness = getattr(result, "handedness", None) or []
        detections: list[HandDetection] = []

        for index, landmarks in enumerate(hand_landmarks):
            points = tuple(Landmark(x=lm.x, y=lm.y, z=lm.z) for lm in landmarks)

            label: str | None = None
            confidence = 0.0
            if index < len(handedness) and handedness[index]:
                category = handedness[index][0]
                label = category.category_name
                confidence = float(category.score)

            detections.append(
                HandDetection(
                    handedness=Handedness.from_label(label),
                    confidence=confidence,
                    landmarks=HandLandmarks(points=points),
                )
            )

        return tuple(detections)

    def close(self) -> None:
        """Release the HandLandmarker."""
        self._landmarker.close()

    def __enter__(self) -> MediaPipeHandDetector:
        """Return self for use as a context manager."""
        return self

    def __exit__(self, *exc: object) -> None:
        """Close the model on context exit."""
        self.close()
