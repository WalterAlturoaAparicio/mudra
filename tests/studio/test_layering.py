"""The architectural invariants, checked mechanically rather than by review.

Two things this milestone depends on, both easy to erode by accident:

1. **Layering** — no Qt in ``domain/`` or ``application/``, no ``engine`` outside
   ``infrastructure/engine_dataset/``. This is what makes most of the suite
   runnable with no display, and what confines Engine to one adapter so the
   constitution's "declare the surface" rule stays true.
2. **FR-020** — all visualization embedded in Studio's own window. No OpenCV, no
   ``imshow``, no external preview window. Engine's OpenCV path is on the
   Engine-consumption contract's prohibited list precisely so this can be a
   check rather than a judgement call.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

STUDIO = Path(__file__).resolve().parents[2] / "apps" / "studio"

QT_FREE_PACKAGES = ("domain", "application", "config", "utils")
ENGINE_ALLOWED_PREFIXES = (
    "infrastructure/engine_dataset",
    # The composition root wires Engine's repository into the adapter; that is
    # the one place outside the adapter package where the name may appear.
    "main.py",
    # These consume Engine's *domain models* as values, which is the point of
    # the shared-library rule; they touch no dataset I/O.
    "domain/loading.py",
    "application/load_pose.py",
    "application/compute_statistics.py",
    "application/build_scene_plan.py",
    "config/models.py",
    "presentation/dataset/metadata_panel.py",
    "presentation/dataset/sample_list.py",
)


def _imports(path: Path) -> set[str]:
    """Every module name imported by ``path``."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _studio_files() -> list[Path]:
    return sorted(STUDIO.rglob("*.py"))


def _rel(path: Path) -> str:
    return path.relative_to(STUDIO).as_posix()


@pytest.mark.parametrize("path", _studio_files(), ids=_rel)
def test_no_qt_outside_the_presentation_layer(path: Path) -> None:
    """Research D8: the decisions live where a test can reach them."""
    if not _rel(path).startswith(QT_FREE_PACKAGES):
        return

    offending = {m for m in _imports(path) if m.split(".")[0] == "PySide6"}
    assert not offending, f"{_rel(path)} imports Qt: {offending}"


@pytest.mark.parametrize("path", _studio_files(), ids=_rel)
def test_engine_is_imported_only_where_authorized(path: Path) -> None:
    """The constitution v1.5.0 "declare the surface" rule, kept honest."""
    rel = _rel(path)
    if rel.startswith(ENGINE_ALLOWED_PREFIXES):
        return

    offending = {m for m in _imports(path) if m.split(".")[0] == "engine"}
    assert not offending, f"{rel} imports engine but is not on the allow-list: {offending}"


@pytest.mark.parametrize("path", _studio_files(), ids=_rel)
def test_no_opencv_or_external_window(path: Path) -> None:
    """FR-020: visualization stays inside Studio's own window."""
    imports = _imports(path)
    assert "cv2" not in {m.split(".")[0] for m in imports}, f"{_rel(path)} imports cv2"
    assert not any(
        m.startswith("engine.visualization") or m.startswith("engine.ui") for m in imports
    ), f"{_rel(path)} imports Engine's display layer"


@pytest.mark.parametrize("path", _studio_files(), ids=_rel)
def test_no_external_window_calls(path: Path) -> None:
    """No ``imshow``/``namedWindow``/``waitKey`` anywhere in Studio."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    forbidden = {"imshow", "namedWindow", "waitKey", "destroyAllWindows"}

    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert not (called & forbidden), f"{_rel(path)} opens an external window"


@pytest.mark.parametrize("path", _studio_files(), ids=_rel)
def test_studio_never_imports_capture(path: Path) -> None:
    """The Engine exemption names Engine and nothing else (constitution v1.5.0)."""
    offending = {m for m in _imports(path) if m.split(".")[0] in {"capture", "apps"}}
    assert not offending, f"{_rel(path)} reaches into another application: {offending}"


def test_the_forbidden_engine_modules_are_absent_everywhere() -> None:
    """FR-024, structurally: no capture, recognition, recording, or training."""
    banned = {
        "engine.camera",
        "engine.detection",
        "engine.recording",
        "engine.normalization",
        "engine.visualization",
        "engine.core",
        "engine.ui",
        "engine.main",
    }
    for path in _studio_files():
        offending = {m for m in _imports(path) if any(m.startswith(b) for b in banned)}
        assert not offending, f"{_rel(path)} imports out-of-scope Engine modules: {offending}"
