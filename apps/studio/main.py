"""Composition root for Mudra Studio.

Everything is wired here and **passed explicitly** — no module reaches for a
singleton, no widget constructs its own dependencies (Principle I). That is what
makes the layers below testable in isolation and what keeps ``engine`` confined
to the one adapter package that imports it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.serializer import PoseSerializer
from PySide6.QtWidgets import QApplication

from studio.application.load_pose import LoadPose
from studio.config.loader import load_studio_config
from studio.config.models import StudioConfig
from studio.infrastructure.engine_dataset.catalog_source import FilesystemPoseCatalogSource
from studio.infrastructure.engine_dataset.gateway import EngineDatasetGateway
from studio.presentation.dataset.page import DatasetPage
from studio.presentation.shell.main_window import MainWindow
from studio.presentation.shell.sections import NavigationSection
from studio.utils.logging import configure_logging, logger

__all__ = ["main", "build_window", "repository_root"]


def repository_root() -> Path:
    """The repository root, derived from this file's location.

    ``apps/studio/main.py`` → three parents up. Anchoring the dataset to the
    repository rather than to the working directory means ``mudra-studio`` finds
    the bundled dataset whatever directory it is launched from (FR-003a).
    """
    return Path(__file__).resolve().parents[2]


def build_window(config: StudioConfig, *, base_dir: Path | None = None) -> MainWindow:
    """Construct the fully-wired main window.

    Separated from :func:`main` so a test can build the whole application graph
    without starting an event loop.

    Args:
        config: The resolved configuration.
        base_dir: Directory a relative dataset root resolves against. Defaults
            to the repository root.

    Returns:
        The main window, with the Dataset page mounted and the catalog loaded.
    """
    base = base_dir or repository_root()

    serializer = PoseSerializer()
    repository = JsonPoseRepository(config.dataset, serializer)

    catalog_source = FilesystemPoseCatalogSource(config.dataset, base_dir=base)
    gateway = EngineDatasetGateway(config.dataset, repository, base_dir=base)
    load_pose = LoadPose(gateway)

    page = DatasetPage(config, catalog_source, load_pose)
    return MainWindow(config.window, page)


def main(argv: list[str] | None = None) -> int:
    """Launch Mudra Studio.

    Args:
        argv: Command-line arguments. Defaults to ``sys.argv``.

    Returns:
        The Qt exit code.
    """
    config = load_studio_config()
    configure_logging(level=config.logging.level, format=config.logging.format)

    base = repository_root()
    app = QApplication(argv if argv is not None else sys.argv)

    window = build_window(config, base_dir=base)
    dataset_page = window.page_for(NavigationSection.DATASET)

    logger.info(
        "Mudra Studio starting — dataset root '{}', {} pose(s)",
        base / config.dataset.root / config.dataset.poses_dirname,
        dataset_page.pose_count,
    )

    window.show()
    code = app.exec()
    logger.info("Mudra Studio shutting down (exit code {})", code)
    return code


if __name__ == "__main__":  # pragma: no cover - entry point
    raise SystemExit(main())
