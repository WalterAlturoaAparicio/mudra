"""Recording state machine.

Declares the explicit lifecycle of one recording — `IDLE → COUNTDOWN → CAPTURED →
VALIDATING → SAVING → COMPLETED`, with `CANCELLED` (user aborted) and `FAILED`
(rejected capture or save error) as the other terminal outcomes — on top of the
generic :class:`~app.core.state_machine.StateMachine`. Keeping the states here
(rather than as ad-hoc booleans in the controller) makes the flow inspectable and
reusable by later capture workflows.
"""

from __future__ import annotations

from collections.abc import Callable
from enum import Enum

from engine.core.state_machine import StateMachine

__all__ = ["RecordingState", "RecordingStateMachine", "RECORDING_TRANSITIONS", "ACTIVE_STATES"]


class RecordingState(Enum):
    """The lifecycle of a single recording attempt."""

    IDLE = "idle"
    COUNTDOWN = "countdown"
    CAPTURED = "captured"
    VALIDATING = "validating"
    SAVING = "saving"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


#: Allowed transitions. States mapped to an empty set are terminal and reset to IDLE.
RECORDING_TRANSITIONS: dict[RecordingState, frozenset[RecordingState]] = {
    RecordingState.IDLE: frozenset({RecordingState.COUNTDOWN}),
    RecordingState.COUNTDOWN: frozenset(
        {RecordingState.CAPTURED, RecordingState.CANCELLED, RecordingState.FAILED}
    ),
    RecordingState.CAPTURED: frozenset(
        {RecordingState.VALIDATING, RecordingState.CANCELLED, RecordingState.FAILED}
    ),
    RecordingState.VALIDATING: frozenset(
        {RecordingState.SAVING, RecordingState.CANCELLED, RecordingState.FAILED}
    ),
    RecordingState.SAVING: frozenset({RecordingState.COMPLETED, RecordingState.FAILED}),
    RecordingState.COMPLETED: frozenset(),
    RecordingState.CANCELLED: frozenset(),
    RecordingState.FAILED: frozenset(),
}

#: States in which a recording is in flight (the live loop must keep feeding it).
ACTIVE_STATES: frozenset[RecordingState] = frozenset(
    {
        RecordingState.COUNTDOWN,
        RecordingState.CAPTURED,
        RecordingState.VALIDATING,
        RecordingState.SAVING,
    }
)


class RecordingStateMachine(StateMachine[RecordingState]):
    """The recording lifecycle, starting (and resetting) at ``IDLE``."""

    def __init__(
        self, on_transition: Callable[[RecordingState, RecordingState], None] | None = None
    ) -> None:
        """Build the machine over :data:`RECORDING_TRANSITIONS`."""
        super().__init__(RECORDING_TRANSITIONS, RecordingState.IDLE, on_transition)

    @property
    def is_active(self) -> bool:
        """``True`` while a recording is in flight (see :data:`ACTIVE_STATES`)."""
        return self.state in ACTIVE_STATES

    @property
    def is_counting_down(self) -> bool:
        """``True`` only while the pre-capture countdown is running."""
        return self.state is RecordingState.COUNTDOWN

    def abort(self) -> RecordingState:
        """Fail an in-flight recording and return to ``IDLE``.

        The recovery path for unexpected errors: every active state can reach
        ``FAILED``, so the controller can never get stuck mid-workflow.
        """
        if self.is_active:
            self.to(RecordingState.FAILED)
        return self.reset()
