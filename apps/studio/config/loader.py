"""Configuration loading for Mudra Studio.

Mirrors ``engine.config.loader`` so both applications resolve configuration the
same way: built-in defaults, then an optional JSON file, then explicit keyword
overrides.

Note what is **not** here: no function reads a dataset path from the UI, from an
environment variable, or from a recent-folders list. FR-003a is enforced by
absence — the only way to point Studio at a different dataset is to edit a config
file, which is a developer action rather than an in-app one.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from studio.config.models import StudioConfig

__all__ = ["load_studio_config"]


def _deep_merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``overrides`` into ``base``, returning a new dict."""
    merged = dict(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_studio_config(path: Path | None = None, **overrides: Any) -> StudioConfig:
    """Resolve Studio's configuration.

    Precedence, lowest to highest: built-in defaults, the JSON file at ``path``
    if given, then ``overrides``. ``None`` overrides are ignored so an unset
    option never clobbers a default.

    Args:
        path: Optional path to a JSON config file.
        **overrides: Nested overrides, e.g. ``visualization={"point_radius": 6}``.

    Returns:
        A validated :class:`StudioConfig`.

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

    return StudioConfig.model_validate(data)
