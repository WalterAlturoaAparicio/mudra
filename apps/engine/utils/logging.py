"""Loguru-based logging configuration.

Provides a single entry point, :func:`configure_logging`, so logging setup lives
in one place (constitution Principle V — Centralized Configuration & Structured
Observability). The live loop must not log per-frame at INFO or above; per-frame
diagnostics belong at DEBUG/TRACE.
"""

from __future__ import annotations

import sys

from loguru import logger

from engine.config.models import LoggingConfig

__all__ = ["configure_logging", "logger"]


def configure_logging(config: LoggingConfig) -> None:
    """Configure the global Loguru logger from a :class:`LoggingConfig`.

    Removes any pre-existing handlers and installs a single ``stderr`` sink with
    the configured level and format. Safe to call more than once.

    Args:
        config: The resolved logging configuration.
    """
    logger.remove()
    logger.add(
        sys.stderr,
        level=config.level,
        format=config.format,
        colorize=True,
        backtrace=False,
        diagnose=False,
    )
