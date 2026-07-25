"""Generic, table-driven finite state machine.

`StateMachine` enforces a declared transition table over any `Enum`, turning
illegal transitions into an explicit error instead of silent corruption. It is
domain-agnostic on purpose: pose recording uses it today, and sequence recording,
calibration, and benchmark workflows can declare their own tables against the same
class (constitution Principle I).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from enum import Enum

__all__ = ["StateMachine", "InvalidStateTransitionError"]


class InvalidStateTransitionError(RuntimeError):
    """Raised when a transition is not declared in the machine's table."""


class StateMachine[StateT: Enum]:
    """Tracks the current state and permits only declared transitions."""

    def __init__(
        self,
        transitions: Mapping[StateT, frozenset[StateT]],
        initial: StateT,
        on_transition: Callable[[StateT, StateT], None] | None = None,
    ) -> None:
        """Store the transition table, the starting state, and an optional hook.

        Args:
            transitions: Allowed targets per state; states absent from the mapping
                are terminal (no outgoing transitions).
            initial: The state the machine starts (and resets) to.
            on_transition: Called as ``(previous, new)`` after every successful
                transition — e.g. for logging or analytics.
        """
        self._transitions = dict(transitions)
        self._initial = initial
        self._state = initial
        self._on_transition = on_transition

    @property
    def state(self) -> StateT:
        """The current state."""
        return self._state

    def can(self, target: StateT) -> bool:
        """Return ``True`` if moving from the current state to ``target`` is declared."""
        return target in self._transitions.get(self._state, frozenset())

    def to(self, target: StateT) -> StateT:
        """Transition to ``target`` and return it.

        Raises:
            InvalidStateTransitionError: If the transition is not declared.
        """
        if not self.can(target):
            raise InvalidStateTransitionError(
                f"Illegal transition {self._state.name} -> {target.name}."
            )
        previous, self._state = self._state, target
        if self._on_transition is not None:
            self._on_transition(previous, target)
        return target

    def reset(self) -> StateT:
        """Return to the initial state.

        Raises:
            InvalidStateTransitionError: If the current state can still transition
                (resetting mid-workflow would drop work in progress).
        """
        if self._state is not self._initial and self._transitions.get(self._state):
            raise InvalidStateTransitionError(
                f"Cannot reset from non-terminal state {self._state.name}."
            )
        previous, self._state = self._state, self._initial
        if self._on_transition is not None and previous is not self._initial:
            self._on_transition(previous, self._initial)
        return self._state
