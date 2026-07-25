"""Typer command-line interface.

Mudra is a multi-command CLI. A callback with ``invoke_without_command=True``
makes the bare entry point (``python -m engine.main``) run the same logic as
``mudra run`` (contracts/cli.md). Heavy imports (OpenCV / MediaPipe) are deferred
into the run path so ``--help`` and future lightweight commands work even where
those wheels are unavailable.

Only ``run`` is implemented in Phase 1. ``record-pose``, ``record-sequence``,
``dataset info``/``validate``, ``camera info``, and ``doctor`` are reserved for
later phases (constitution Principle VI).
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

__all__ = ["app"]

app = typer.Typer(
    add_completion=False,
    no_args_is_help=False,
    help="Mudra - AI-powered hand gesture recognition engine.",
)

_CameraOption = Annotated[int | None, typer.Option("--camera", help="Camera device index to open.")]
_ConfigOption = Annotated[Path | None, typer.Option("--config", help="Optional JSON config file.")]
_LogLevelOption = Annotated[
    str | None, typer.Option("--log-level", help="Log level (TRACE..ERROR).")
]
_NoMirrorOption = Annotated[bool, typer.Option("--no-mirror", help="Disable selfie mirroring.")]


def _run_live(
    camera: int | None,
    config_path: Path | None,
    log_level: str | None,
    no_mirror: bool,
) -> None:
    """Build the live application from config + overrides and run it.

    Shared by the default callback and the explicit ``run`` command so both entry
    points behave identically. Exits the process with the app's return code.
    """
    # Deferred imports: keep the CLI importable without OpenCV/MediaPipe.
    import mediapipe
    from rich.console import Console

    from engine import __version__ as app_version
    from engine.camera.opencv_source import OpenCVCameraSource
    from engine.config.loader import load_config
    from engine.core.countdown import CountdownTimer
    from engine.core.fps_meter import FpsMeter
    from engine.core.live_app import WINDOW_NAME, LiveApp
    from engine.dataset.json_repository import JsonPoseRepository
    from engine.dataset.serializer import PoseSerializer
    from engine.detection.mediapipe_detector import MediaPipeHandDetector
    from engine.models.pose import VersionInfo
    from engine.normalization.translation_scale import TranslationScaleNormalizer
    from engine.recording.controller import PoseRecordingController
    from engine.recording.recorder import PoseRecorderService
    from engine.recording.validation import PoseValidationService
    from engine.utils.logging import configure_logging
    from engine.visualization.countdown_overlay import CountdownOverlayRenderer
    from engine.visualization.opencv_overlay import OpenCVOverlayRenderer

    overrides: dict[str, object] = {}
    if camera is not None:
        overrides["camera"] = {"index": camera}
    if log_level is not None:
        overrides["logging"] = {"level": log_level}
    if no_mirror:
        overrides["visualization"] = {"mirror": False}

    config = load_config(config_path, **overrides)
    configure_logging(config.logging)

    source = OpenCVCameraSource(config.camera)
    detector = MediaPipeHandDetector(config.detection)
    renderer = OpenCVOverlayRenderer(config.visualization)
    fps_meter = FpsMeter(window=max(config.camera.target_fps, 2))

    # Pose-recording stack (Phase 2), wired behind the RecordingController port.
    versions = VersionInfo(
        application=app_version, mediapipe=getattr(mediapipe, "__version__", None)
    )
    validator = PoseValidationService(config.recording)
    normalizer = TranslationScaleNormalizer(config.normalization)
    repository = JsonPoseRepository(config.dataset, PoseSerializer())
    recorder = PoseRecorderService(
        validator=validator,
        normalizer=normalizer,
        repository=repository,
        versions=versions,
        camera=config.camera,
    )
    recording_controller = PoseRecordingController(
        recorder=recorder,
        validator=validator,
        config=config.recording,
        console=Console(),
        window_name=WINDOW_NAME,
        countdown=CountdownTimer(config.recording.recording_countdown_seconds),
    )
    countdown_renderer = CountdownOverlayRenderer(config.visualization)

    live_app = LiveApp(
        source,
        detector,
        renderer,
        config,
        fps_meter,
        recording_controller,
        countdown_renderer,
    )
    raise typer.Exit(live_app.run())


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    camera: _CameraOption = None,
    config: _ConfigOption = None,
    log_level: _LogLevelOption = None,
    no_mirror: _NoMirrorOption = False,
) -> None:
    """Run the live camera when invoked with no subcommand (== ``mudra run``)."""
    if ctx.invoked_subcommand is None:
        _run_live(camera, config, log_level, no_mirror)


@app.command()
def run(
    camera: _CameraOption = None,
    config: _ConfigOption = None,
    log_level: _LogLevelOption = None,
    no_mirror: _NoMirrorOption = False,
) -> None:
    """Open the webcam and show live hand detection with a landmark overlay.

    Press R to record a pose after a countdown (q/Esc cancels it); q/Esc/close-window
    to exit.
    """
    _run_live(camera, config, log_level, no_mirror)
