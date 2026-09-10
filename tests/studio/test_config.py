"""Configuration validation, Engine composition, and the absence of a picker."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from engine.config.models import DatasetConfig
from pydantic import ValidationError
from studio.config.loader import load_studio_config
from studio.config.models import StudioConfig, VisualizationConfig, WindowConfig


def test_defaults_are_valid() -> None:
    config = StudioConfig()
    assert config.window.title == "Mudra Studio"
    assert config.visualization.base_opacity == 1.0
    assert config.logging.level == "INFO"


def test_dataset_section_is_engines_own_model() -> None:
    """FR-019 / research D12: the dataset location is reused, not redeclared."""
    config = StudioConfig()
    assert isinstance(config.dataset, DatasetConfig)
    assert config.dataset.root == "datasets"
    assert config.dataset.poses_dirname == "poses"
    assert config.poses_root == "datasets/poses"


def test_no_folder_picker_setting_exists() -> None:
    """FR-003a is enforced by absence, not by a disabled widget.

    If a future change adds a picker, it will need a setting, and this test is
    where that shows up.
    """
    fields = set(StudioConfig.model_fields)
    for section in (VisualizationConfig, WindowConfig):
        fields |= set(section.model_fields)
    forbidden = {"dataset_picker", "recent_datasets", "allow_dataset_selection", "dataset_paths"}
    assert not (fields & forbidden)


@pytest.mark.parametrize(
    "overrides",
    [
        {"point_radius": 0},
        {"min_zoom": 10.0, "max_zoom": 1.0},
        {"min_opacity": 0.9, "base_opacity": 0.5},
        {"base_opacity": 1.5},
        {"edge_width": -1},
    ],
)
def test_invalid_visualization_values_are_rejected(overrides: dict) -> None:
    with pytest.raises(ValidationError):
        VisualizationConfig(**overrides)


def test_invalid_window_values_are_rejected() -> None:
    with pytest.raises(ValidationError):
        WindowConfig(initial_width=0)
    with pytest.raises(ValidationError):
        WindowConfig(splitter_ratios=(1, 0, 2))


def test_loader_precedence_defaults_file_overrides(tmp_path: Path) -> None:
    config_file = tmp_path / "studio.json"
    config_file.write_text(
        json.dumps({"window": {"title": "From file"}, "visualization": {"point_radius": 6.0}}),
        encoding="utf-8",
    )

    config = load_studio_config(config_file, window={"title": "From override"})

    assert config.window.title == "From override"  # override beats file
    assert config.visualization.point_radius == 6.0  # file beats default
    assert config.visualization.edge_width == 2.0  # default survives


def test_loader_ignores_none_overrides() -> None:
    config = load_studio_config(None, window=None)
    assert config.window.title == "Mudra Studio"


def test_loader_raises_for_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_studio_config(tmp_path / "absent.json")
