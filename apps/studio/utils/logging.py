"""Loguru-based logging configuration for Mudra Studio.

Mirrors ``engine.utils.logging`` so both applications log the same way
(constitution Principle V — Centralized Configuration & Structured
Observability), with one deliberate difference: :func:`configure_logging` takes
plain typed arguments rather than a configuration object.

That keeps this module free of any dependency on ``studio.config``. Studio's
``LoggingConfig`` is Studio-owned — declared in :mod:`studio.config.models`, not
imported from ``engine.config.models``, which the feature's Engine-consumption
contract authorizes only for ``DatasetConfig``. The two meet at exactly one
place, the composition root in :mod:`studio.main`.
"""

from __future__ import annotations

import sys
from typing import TextIO

from loguru import logger

__all__ = ["configure_logging", "logger"]


def configure_logging(
    *,
    level: str,
    format: str,  # noqa: A002 - mirrors Loguru's own parameter name
    sink: TextIO | None = None,
    colorize: bool = True,
) -> None:
    """Configure the global Loguru logger.

    Removes any pre-existing handlers and installs a single sink with the given
    level and format. Safe to call more than once, which is what makes it usable
    from tests as well as from the composition root.

    Args:
        level: Minimum log level, e.g. ``"INFO"``.
        format: Loguru message format string.
        sink: Where to write. Defaults to ``sys.stderr``.
        colorize: Whether to emit ANSI colour codes.
    """
    logger.remove()
    logger.add(
        sink if sink is not None else sys.stderr,
        level=level,
        format=format,
        colorize=colorize,
        backtrace=False,
        diagnose=False,
    )
