"""Interactive pose-recording controller.

Implements the `RecordingController` port as an explicit state machine
(`IDLE → COUNTDOWN → CAPTURED → VALIDATING → SAVING → COMPLETED`). Pressing **R**
only *arms* a non-blocking countdown: the live feed keeps rendering so the user can
place **both** hands, and only when the countdown reaches zero is the frame frozen,
validated, named in the terminal, and saved. `q`/`Esc` during the countdown cancels
without writing anything. It measures the capture workflow and, on success, emits
the structured INFO log FR-016 requires; it must never raise into the live loop.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime

import cv2
from rich.console import Console
from rich.prompt import Prompt

from app.camera.source import Frame
from app.config.models import RecordingConfig
from app.core.countdown import CountdownTimer
from app.dataset.repository import PoseRepositoryError
from app.models.countdown import CountdownTick
from app.models.landmarks import FrameDetection
from app.models.pose import CaptureTiming, Pose
from app.recording.recorder import PoseRecorderService
from app.recording.state import RecordingState, RecordingStateMachine
from app.recording.validation import CaptureValidationError, PoseValidationService
from app.utils.logging import logger

__all__ = ["PoseRecordingController"]

_FONT = cv2.FONT_HERSHEY_SIMPLEX
_CANCEL = ""  # blank pose_id input cancels the recording


def _default_clock() -> datetime:
    return datetime.now(UTC)


class PoseRecordingController:
    """Drives one interactive pose recording, from countdown to save."""

    def __init__(
        self,
        recorder: PoseRecorderService,
        validator: PoseValidationService,
        config: RecordingConfig,
        console: Console,
        window_name: str,
        countdown: CountdownTimer,
        clock: Callable[[], datetime] = _default_clock,
    ) -> None:
        """Store injected collaborators, the display window name, and the countdown."""
        self._recorder = recorder
        self._validator = validator
        self._config = config
        self._console = console
        self._window_name = window_name
        self._countdown = countdown
        self._clock = clock
        self._state = RecordingStateMachine(on_transition=self._log_transition)
        self._countdown_start_time: datetime | None = None

    @property
    def state(self) -> RecordingState:
        """The current recording state (exposed for tests and diagnostics)."""
        return self._state.state

    @property
    def is_active(self) -> bool:
        """``True`` while a recording is in flight (countdown or capture)."""
        return self._state.is_active

    def request_capture(self) -> bool:
        """Arm the countdown; returns ``False`` if a recording is already running.

        Never blocks — the live loop keeps rendering while the countdown runs.
        """
        if self._state.state is not RecordingState.IDLE:
            return False

        self._state.to(RecordingState.COUNTDOWN)
        self._countdown_start_time = self._clock()
        self._countdown.start()
        seconds = self._countdown.duration_seconds
        self._console.print(
            f"[cyan]Recording in {seconds:g}s[/cyan] — pose both hands "
            "(q/Esc in the camera window to cancel)."
        )
        logger.info("Pose recording countdown started ({}s).", f"{seconds:g}")
        return True

    def update(self, frame: Frame, detection: FrameDetection) -> CountdownTick | None:
        """Advance the countdown by one frame, capturing when it reaches zero.

        Returns the current tick while counting down (for the overlay), or ``None``
        when idle. Never raises into the live loop.
        """
        if self._state.state is not RecordingState.COUNTDOWN:
            return None

        tick = self._countdown.tick()
        if not tick.finished:
            return tick

        try:
            self._capture(frame, detection)
        except Exception as error:  # the live loop must never see a recording error
            self._console.print(f"[red]Recording failed:[/red] {error}")
            logger.exception("Unexpected error during pose capture: {}", error)
            self._state.abort()
        self._countdown_start_time = None
        self._state.reset()
        return None

    def cancel(self) -> bool:
        """Abort a running countdown without creating a sample."""
        if self._state.state is not RecordingState.COUNTDOWN:
            return False

        self._countdown.cancel()
        self._state.to(RecordingState.CANCELLED)
        self._countdown_start_time = None
        self._console.print("[yellow]Countdown cancelled.[/yellow]")
        logger.warning("Pose recording countdown cancelled by user.")
        self._state.reset()
        return True

    # -- capture workflow --------------------------------------------------------

    def _capture(self, frame: Frame, detection: FrameDetection) -> None:
        """Freeze ``frame`` and run validate → prompt → save for ``detection``."""
        self._state.to(RecordingState.CAPTURED)
        capture_time = self._clock()
        started = time.monotonic()
        self._show_recording_overlay(frame)

        self._state.to(RecordingState.VALIDATING)
        try:
            self._validator.validate_capture(detection)
        except CaptureValidationError as error:
            self._state.to(RecordingState.FAILED)
            self._reject(str(error))
            return

        pose = self._prompt_for_pose()
        if pose is None:
            self._state.to(RecordingState.CANCELLED)
            self._console.print("[yellow]Recording cancelled.[/yellow]")
            logger.warning("Pose recording cancelled by user.")
            return

        self._state.to(RecordingState.SAVING)
        timing = CaptureTiming(
            capture_time=capture_time.isoformat(),
            countdown_start_time=(
                self._countdown_start_time.isoformat() if self._countdown_start_time else None
            ),
            countdown_seconds=self._countdown.duration_seconds,
        )
        try:
            ref = self._recorder.record(detection, pose, timing)
        except CaptureValidationError as error:  # defensive: already validated
            self._state.to(RecordingState.FAILED)
            self._reject(str(error))
            return
        except PoseRepositoryError as error:
            self._state.to(RecordingState.FAILED)
            self._console.print(f"[red]Could not save recording:[/red] {error}")
            logger.error("Pose recording failed to save: {}", error)
            return

        self._state.to(RecordingState.COMPLETED)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        self._console.print(
            f"[green]Saved[/green] pose '[bold]{ref.pose_id}[/bold]' "
            f"as {ref.sample_number} -> {ref.location}"
        )
        logger.bind(
            pose_id=ref.pose_id,
            sample_number=ref.sample_number,
            sample_uuid=ref.sample_uuid,
            save_location=ref.location,
            elapsed_duration_ms=round(elapsed_ms, 1),  # from capture, excluding the countdown
            countdown_seconds=self._countdown.duration_seconds,
            countdown_start_time=timing.countdown_start_time,
            capture_time=timing.capture_time,
            number_of_hands=detection.hand_count,
            normalization_strategy=self._recorder.normalization_strategy,
        ).info("Pose recorded.")

    # -- helpers -----------------------------------------------------------------

    @staticmethod
    def _log_transition(previous: RecordingState, new: RecordingState) -> None:
        """Trace every state change so the workflow is debuggable end to end."""
        logger.trace("Recording state {} -> {}.", previous.value, new.value)

    def _show_recording_overlay(self, frame: Frame) -> None:
        """Draw a small recording indicator on a copy of the frozen frame."""
        annotated = frame.copy()
        height, width = annotated.shape[:2]
        cv2.rectangle(annotated, (0, 0), (width - 1, height - 1), (0, 0, 255), 6)
        cv2.putText(
            annotated, "RECORDING", (20, height - 20), _FONT, 1.0, (0, 0, 255), 2, cv2.LINE_AA
        )
        cv2.imshow(self._window_name, annotated)
        cv2.waitKey(1)

    def _prompt_for_pose(self) -> Pose | None:
        """Prompt for pose_id (required, validated) and optional labels.

        Returns ``None`` if the user cancels (blank pose_id or Ctrl-C).
        """
        while True:
            try:
                raw_id = Prompt.ask(
                    "pose_id (blank to cancel)",
                    default=_CANCEL,
                    show_default=False,
                    console=self._console,
                )
            except KeyboardInterrupt, EOFError:
                return None
            if raw_id.strip() == _CANCEL:
                return None
            try:
                pose_id = self._validator.validate_pose_id(raw_id)
            except CaptureValidationError as error:
                self._console.print(f"[red]{error}[/red]")
                continue

            display_name = Prompt.ask(
                "display_name (optional)", default="", show_default=False, console=self._console
            ).strip()
            description = Prompt.ask(
                "description (optional)", default="", show_default=False, console=self._console
            ).strip()
            return Pose(
                pose_id=pose_id,
                display_name=display_name or None,
                description=description or None,
            )

    def _reject(self, reason: str) -> None:
        """Report a rejected capture without writing anything."""
        self._console.print(f"[red]Recording rejected:[/red] {reason}")
        logger.warning("Pose recording rejected: {}", reason)
