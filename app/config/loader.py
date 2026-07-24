"""Configuration loading.

Builds an :class:`AppConfig` from validated defaults, an optional JSON config
file, and explicit keyword overrides (e.g. CLI options). Keeping construction in
one function means every entry point resolves configuration the same way.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config.models import AppConfig

__all__ = ["load_config"]


def _deep_merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``overrides`` into ``base``, returning a new dict."""
    merged = dict(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None = None, **overrides: Any) -> AppConfig:
    """Resolve the application configuration.

    Precedence (lowest to highest): built-in defaults, then the JSON file at
    ``path`` (if given), then ``overrides``. ``overrides`` values that are
    ``None`` are ignored so unset CLI options do not clobber defaults.

    Args:
        path: Optional path to a JSON config file.
        **overrides: Nested overrides, e.g. ``camera={"index": 1}``.

    Returns:
        A validated :class:`AppConfig`.

    Raises:
        FileNotFoundError: If ``path`` is given but does not exist.
        pydantic.ValidationError: If the merged configuration is invalid.
    """
    data: dict[str, Any] = {}

    if path is not None:
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))

    clean_overrides = {key: value for key, value in overrides.items() if value is not None}
    data = _deep_merge(data, clean_overrides)

    return AppConfig.model_validate(data)
