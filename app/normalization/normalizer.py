"""Normalizer interface.

A `Normalizer` maps a hand's landmarks into a position/scale-invariant form and
identifies itself via `strategy`/`version` so the recorder can stamp each sample's
`normalization` block truthfully (constitution Principle I & III; research D11).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.models.landmarks import HandLandmarks

__all__ = ["Normalizer"]


@runtime_checkable
class Normalizer(Protocol):
    """Transforms a hand's landmarks into a normalized form."""

    @property
    def strategy(self) -> str:
        """Strategy identifier recorded in each sample (e.g. ``"translation_scale"``)."""
        ...

    @property
    def version(self) -> str:
        """Strategy version recorded in each sample (e.g. ``"1.0"``)."""
        ...

    def normalize(self, hand: HandLandmarks) -> HandLandmarks:
        """Return a new, normalized 21-point `HandLandmarks`; never mutate the input."""
        ...
