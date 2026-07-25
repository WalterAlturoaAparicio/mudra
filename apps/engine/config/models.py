"""Centralized, validated application configuration.

All tunable values live here as Pydantic models (constitution Principle V) so
nothing is hardcoded at call sites and invalid values are rejected early
(Principle IV). Fields reserved for later phases (e.g. future model settings)
are added to their respective sub-models as those phases arrive.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

__all__ = [
    "CameraConfig",
    "DetectionConfig",
    "VisualizationConfig",
    "LoggingConfig",
    "NormalizationConfig",
    "DatasetConfig",
    "RecordingConfig",
    "AppConfig",
]


class CameraConfig(BaseModel):
    """Webcam capture settings."""

    index: int = Field(default=0, ge=0, description="Camera device index to open.")
    width: int = Field(default=1280, gt=0, description="Requested capture width in pixels.")
    height: int = Field(default=720, gt=0, description="Requested capture height in pixels.")
    target_fps: int = Field(default=30, gt=0, description="Requested capture frame rate.")


class DetectionConfig(BaseModel):
    """MediaPipe Hands detection settings.

    Phase 1 uses the MediaPipe Tasks ``HandLandmarker`` (VIDEO mode). ``model_path``
    points at the bundled ``.task`` model; if missing it is fetched once from
    ``model_url``. ``model_complexity`` is retained as a backend-agnostic config
    knob (0 = fastest) but is not consumed by the Tasks backend, whose model file
    fixes complexity; it remains for legacy/alternate backends.
    """

    max_num_hands: int = Field(default=2, ge=1, description="Maximum hands to detect per frame.")
    model_complexity: int = Field(
        default=0, ge=0, le=1, description="Backend-agnostic complexity hint (0 = fastest)."
    )
    model_path: str = Field(
        default="assets/hand_landmarker.task",
        description="Path to the HandLandmarker .task model (resolved against the repo assets).",
    )
    model_url: str = Field(
        default=(
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
            "hand_landmarker/float16/1/hand_landmarker.task"
        ),
        description="Fallback download URL used once if the model file is absent.",
    )
    min_detection_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum confidence for initial hand detection."
    )
    min_tracking_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum confidence for hand tracking."
    )


class VisualizationConfig(BaseModel):
    """Overlay and HUD rendering settings."""

    mirror: bool = Field(default=True, description="Mirror the preview (selfie view).")
    show_fps: bool = Field(default=True, description="Draw the FPS readout.")
    show_handedness: bool = Field(default=True, description="Draw per-hand handedness + score.")
    landmark_color: tuple[int, int, int] = Field(
        default=(0, 255, 0), description="BGR color for landmark points."
    )
    connection_color: tuple[int, int, int] = Field(
        default=(255, 255, 255), description="BGR color for skeleton connections."
    )
    hud_color: tuple[int, int, int] = Field(
        default=(0, 255, 255), description="BGR color for HUD text."
    )
    landmark_radius: int = Field(default=3, gt=0, description="Landmark point radius in pixels.")
    connection_thickness: int = Field(default=2, gt=0, description="Skeleton line thickness.")
    countdown_color: tuple[int, int, int] = Field(
        default=(0, 215, 255), description="BGR color for the countdown overlay (amber)."
    )
    countdown_prompt: str = Field(
        default="Recording pose in", description="Caption drawn above the countdown digit."
    )
    countdown_hint: str = Field(
        default="q / Esc to cancel", description="Hint drawn below the countdown digit."
    )
    countdown_digit_scale: float = Field(
        default=0.4,
        gt=0.0,
        le=1.0,
        description="Countdown digit height as a fraction of the frame height.",
    )
    countdown_dim: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="How much to darken the live frame behind the countdown (0 = none).",
    )


class LoggingConfig(BaseModel):
    """Structured logging settings (Loguru)."""

    level: str = Field(default="INFO", description="Minimum log level.")
    format: str = Field(
        default=(
            "<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | "
            "<cyan>{name}</cyan> - <level>{message}</level>"
        ),
        description="Loguru message format.",
    )


class NormalizationConfig(BaseModel):
    """Landmark normalization settings (Phase 2)."""

    algorithm: str = Field(
        default="translation_scale", description="Normalization strategy identifier."
    )
    origin_index: int = Field(
        default=0, ge=0, le=20, description="Landmark used as the translation origin (wrist)."
    )
    scale_index: int = Field(
        default=9, ge=0, le=20, description="Landmark whose distance from origin sets the scale."
    )


class DatasetConfig(BaseModel):
    """Dataset location and file-format settings (Phase 2)."""

    root: str = Field(default="datasets", description="Dataset root directory.")
    poses_dirname: str = Field(default="poses", description="Sub-directory for pose collections.")
    json_indent: int = Field(default=2, ge=0, description="JSON indentation for saved samples.")
    filename_prefix: str = Field(default="sample_", description="Sample filename prefix.")
    filename_digits: int = Field(
        default=6, ge=1, description="Zero-padded width of the sample number."
    )


class RecordingConfig(BaseModel):
    """Pose recording behaviour settings (Phase 2)."""

    record_key: str = Field(default="r", description="Key that enters pose-recording mode.")
    pose_id_pattern: str = Field(
        default=r"^[a-z0-9_]+$", description="Allowed pose_id pattern (folder-safe)."
    )
    pose_id_max_length: int = Field(default=64, gt=0, description="Maximum pose_id length.")
    recording_countdown_seconds: float = Field(
        default=3.0,
        ge=0.0,
        le=60.0,
        description=(
            "Seconds to count down after the record key before the pose is captured, "
            "leaving both hands free to pose. 0 captures on the next frame."
        ),
    )


class AppConfig(BaseModel):
    """Root application configuration composed of all sub-configs."""

    camera: CameraConfig = Field(default_factory=CameraConfig)
    detection: DetectionConfig = Field(default_factory=DetectionConfig)
    visualization: VisualizationConfig = Field(default_factory=VisualizationConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    normalization: NormalizationConfig = Field(default_factory=NormalizationConfig)
    dataset: DatasetConfig = Field(default_factory=DatasetConfig)
    recording: RecordingConfig = Field(default_factory=RecordingConfig)
