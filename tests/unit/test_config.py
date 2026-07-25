"""Tests for configuration models and the loader."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from engine.config.loader import load_config
from engine.config.models import AppConfig, DetectionConfig, RecordingConfig
from pydantic import ValidationError


def test_defaults_are_valid() -> None:
    config = AppConfig()
    assert config.camera.index == 0
    assert config.detection.max_num_hands == 2
    assert config.detection.model_complexity == 0  # Phase-1 fastest default
    assert config.visualization.mirror is True
    assert config.logging.level == "INFO"


def test_invalid_values_raise() -> None:
    with pytest.raises(ValidationError):
        DetectionConfig(model_complexity=5)  # le=1
    with pytest.raises(ValidationError):
        DetectionConfig(min_detection_confidence=1.5)  # le=1.0
    with pytest.raises(ValidationError):
        DetectionConfig(max_num_hands=0)  # ge=1


def test_load_config_defaults() -> None:
    config = load_config()
    assert isinstance(config, AppConfig)
    assert config.detection.model_complexity == 0


def test_load_config_overrides_ignore_none() -> None:
    config = load_config(camera={"index": 2}, logging=None)
    assert config.camera.index == 2
    assert config.logging.level == "INFO"  # None override ignored


def test_load_config_from_file(tmp_path: Path) -> None:
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps({"visualization": {"mirror": False}}), encoding="utf-8")
    config = load_config(path)
    assert config.visualization.mirror is False


def test_load_config_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_config(tmp_path / "does_not_exist.json")


def test_recording_countdown_defaults_to_three_seconds() -> None:
    assert AppConfig().recording.recording_countdown_seconds == 3.0


def test_recording_countdown_is_configurable(tmp_path: Path) -> None:
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps({"recording": {"recording_countdown_seconds": 5}}), encoding="utf-8")
    assert load_config(path).recording.recording_countdown_seconds == 5.0


def test_invalid_recording_countdown_rejected() -> None:
    with pytest.raises(ValidationError):
        RecordingConfig(recording_countdown_seconds=-1)  # ge=0.0
    with pytest.raises(ValidationError):
        RecordingConfig(recording_countdown_seconds=120)  # le=60.0


def test_file_overridden_by_kwargs(tmp_path: Path) -> None:
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps({"camera": {"index": 1}}), encoding="utf-8")
    config = load_config(path, camera={"index": 3})
    assert config.camera.index == 3
