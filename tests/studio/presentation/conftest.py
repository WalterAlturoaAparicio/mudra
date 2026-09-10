"""Fixtures for the Qt widget tests.

These are the only tests that need a Qt platform plugin. Everything else in the
Studio suite — catalog, gateway, statistics, scene plans, config — is Qt-free by
design (research D8) and runs as plain Python.

``QT_QPA_PLATFORM`` is forced to ``offscreen`` before Qt is imported, so the
suite is green on a machine or a CI runner with no display, and nobody has to
remember to set it.
"""

from __future__ import annotations

import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from collections.abc import Callable  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from engine.config.models import DatasetConfig  # noqa: E402
from engine.dataset.json_repository import JsonPoseRepository  # noqa: E402
from engine.dataset.serializer import PoseSerializer  # noqa: E402
from studio.application.load_pose import LoadPose  # noqa: E402
from studio.config.models import StudioConfig  # noqa: E402
from studio.infrastructure.engine_dataset.catalog_source import (  # noqa: E402
    FilesystemPoseCatalogSource,
)
from studio.infrastructure.engine_dataset.gateway import EngineDatasetGateway  # noqa: E402
from studio.presentation.dataset.page import DatasetPage  # noqa: E402


@pytest.fixture
def studio_config(dataset_root: Path) -> StudioConfig:
    """A config pointing at the throwaway ``tmp_path`` dataset."""
    return StudioConfig(dataset=DatasetConfig(root=str(dataset_root)))


@pytest.fixture
def make_page(studio_config: StudioConfig) -> Callable[[], DatasetPage]:
    """Return a factory building a fully-wired :class:`DatasetPage`.

    The page is built over the temporary dataset, never the real one.
    """

    def _make() -> DatasetPage:
        config = studio_config
        repository = JsonPoseRepository(config.dataset, PoseSerializer())
        return DatasetPage(
            config,
            FilesystemPoseCatalogSource(config.dataset),
            LoadPose(EngineDatasetGateway(config.dataset, repository)),
        )

    return _make
