"""Module entry point.

``python -m engine.main`` and the ``mudra`` console script both resolve to the same
Typer application object, so all entry points behave identically.
"""

from __future__ import annotations

from engine.ui.cli import app

__all__ = ["app"]


if __name__ == "__main__":
    app()
