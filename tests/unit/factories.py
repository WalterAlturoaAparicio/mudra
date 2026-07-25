"""Test factories for Phase-2 pose domain objects (not a test module)."""

from __future__ import annotations

from engine.models.landmarks import (
    FrameDetection,
    HandDetection,
    Handedness,
    HandLandmarks,
    Landmark,
)
from engine.models.pose import (
    HandMeta,
    HandSample,
    NormalizationInfo,
    Pose,
    PoseMetadata,
    PoseSample,
)


def make_hand_landmarks(offset: float = 0.0, scale: float = 1.0) -> HandLandmarks:
    """Build a deterministic 21-point hand, optionally translated and scaled."""
    points = tuple(
        Landmark(
            x=offset + scale * (0.01 * i),
            y=offset + scale * (0.02 * i),
            z=scale * (0.005 * i),
        )
        for i in range(21)
    )
    return HandLandmarks(points=points)


def make_hand_detection(
    handedness: Handedness = Handedness.RIGHT, confidence: float = 0.97
) -> HandDetection:
    """Build a single detected hand with 21 landmarks."""
    return HandDetection(
        handedness=handedness,
        confidence=confidence,
        landmarks=make_hand_landmarks(),
    )


def make_frame_detection(
    hands: tuple[HandDetection, ...] | None = None,
    width: int = 1280,
    height: int = 720,
    timestamp: float = 0.0,
) -> FrameDetection:
    """Build a FrameDetection; defaults to a single right hand."""
    if hands is None:
        hands = (make_hand_detection(),)
    return FrameDetection(hands=hands, frame_width=width, frame_height=height, timestamp=timestamp)


def make_pose_sample(
    sample_number: str = "sample_000001", pose_id: str = "open_palm"
) -> PoseSample:
    """Build a fully-populated PoseSample for serializer/repository tests."""
    hand = HandSample(
        handedness=Handedness.RIGHT,
        confidence=0.97,
        raw=make_hand_landmarks(),
        normalized=make_hand_landmarks(offset=-0.1),
    )
    metadata = PoseMetadata(
        timestamp="2026-07-24T13:20:00+00:00",
        camera_index=0,
        camera_width=1280,
        camera_height=720,
        mediapipe_version="0.10.35",
        application_version="0.1.0",
        num_hands=1,
        hands=(HandMeta(handedness=Handedness.RIGHT, confidence=0.97),),
    )
    return PoseSample(
        schema_version=1,
        pose=Pose(pose_id=pose_id, display_name="Open Palm", description="Right hand open."),
        sample_uuid="550e8400-e29b-41d4-a716-446655440000",
        sample_number=sample_number,
        timestamp="2026-07-24T13:20:00+00:00",
        normalization=NormalizationInfo(strategy="translation_scale", version="1.0"),
        metadata=metadata,
        hands=(hand,),
    )
