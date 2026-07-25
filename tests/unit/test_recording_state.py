"""Tests for the generic state machine and the recording lifecycle."""

from __future__ import annotations

import pytest
from engine.core.state_machine import InvalidStateTransitionError
from engine.recording.state import RecordingState, RecordingStateMachine


def test_starts_idle_and_inactive() -> None:
    machine = RecordingStateMachine()
    assert machine.state is RecordingState.IDLE
    assert machine.is_active is False
    assert machine.is_counting_down is False


def test_happy_path_transitions() -> None:
    machine = RecordingStateMachine()
    for state in (
        RecordingState.COUNTDOWN,
        RecordingState.CAPTURED,
        RecordingState.VALIDATING,
        RecordingState.SAVING,
        RecordingState.COMPLETED,
    ):
        machine.to(state)
    assert machine.state is RecordingState.COMPLETED
    assert machine.reset() is RecordingState.IDLE


def test_countdown_is_active_and_counting_down() -> None:
    machine = RecordingStateMachine()
    machine.to(RecordingState.COUNTDOWN)
    assert machine.is_active is True
    assert machine.is_counting_down is True


def test_cancel_from_countdown_returns_to_idle() -> None:
    machine = RecordingStateMachine()
    machine.to(RecordingState.COUNTDOWN)
    machine.to(RecordingState.CANCELLED)
    assert machine.is_active is False
    machine.reset()
    assert machine.state is RecordingState.IDLE


def test_illegal_transition_raises() -> None:
    machine = RecordingStateMachine()
    with pytest.raises(InvalidStateTransitionError):
        machine.to(RecordingState.SAVING)  # cannot save straight from IDLE


def test_cannot_reset_mid_workflow() -> None:
    machine = RecordingStateMachine()
    machine.to(RecordingState.COUNTDOWN)
    with pytest.raises(InvalidStateTransitionError):
        machine.reset()


def test_abort_recovers_from_any_active_state() -> None:
    machine = RecordingStateMachine()
    machine.to(RecordingState.COUNTDOWN)
    machine.to(RecordingState.CAPTURED)
    assert machine.abort() is RecordingState.IDLE


def test_abort_is_safe_when_idle() -> None:
    assert RecordingStateMachine().abort() is RecordingState.IDLE


def test_transitions_are_reported() -> None:
    seen: list[tuple[RecordingState, RecordingState]] = []
    machine = RecordingStateMachine(on_transition=lambda old, new: seen.append((old, new)))
    machine.to(RecordingState.COUNTDOWN)
    machine.to(RecordingState.CANCELLED)
    machine.reset()
    assert seen == [
        (RecordingState.IDLE, RecordingState.COUNTDOWN),
        (RecordingState.COUNTDOWN, RecordingState.CANCELLED),
        (RecordingState.CANCELLED, RecordingState.IDLE),
    ]


def test_can_reports_declared_transitions() -> None:
    machine = RecordingStateMachine()
    assert machine.can(RecordingState.COUNTDOWN) is True
    assert machine.can(RecordingState.COMPLETED) is False
