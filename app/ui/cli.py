"""Typer command-line interface.

Mudra is a multi-command CLI. A callback with ``invoke_without_command=True``
makes the bare entry point (``python -m app.main``) run the same logic as
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
    from app.camera.opencv_source import OpenCVCameraSource
    from app.config.loader import load_config
    from app.core.fps_meter import FpsMeter
    from app.core.live_app import LiveApp
    from app.detection.mediapipe_detector import MediaPipeHandDetector
    from app.utils.logging import configure_logging
    from app.visualization.opencv_overlay import OpenCVOverlayRenderer

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

    live_app = LiveApp(source, detector, renderer, config, fps_meter)
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
    """Open the webcam and show live hand detection with a landmark overlay."""
    _run_live(camera, config, log_level, no_mirror)
