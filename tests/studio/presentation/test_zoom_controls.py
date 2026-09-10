"""FR-011's zoom controls, which used to be silently inert.

``LandmarkView`` clamped the raw ``QTransform.m11()`` — an absolute scene-to-device
factor — to ``[min_zoom, max_zoom]``, defaulting to ``[0.1, 50]``. But model space
is unit-scale: a raw hand spans about 0.25 units, so fitting one to a 620px panel
produces ``m11 ≈ 1421``, already far outside that window. The guard

    if target < min_zoom or target > max_zoom: return

then rejected **both** directions — ``zoom_in`` because ``1421 * 1.25 > 50``, and
``zoom_out`` because ``1421 / 1.25`` is *still* ``> 50``. Only "Reset" responded,
and it dropped to ``m11 = 1.0``, where an entire two-handed sample renders as a
single ten-pixel dot.

The limits are now multiples of the fitted scale, so ``1.0`` means "fitted" in
either coordinate space and at any viewport size.
"""

from __future__ import annotations

import pytest
from PySide6.QtCore import QSize
from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey
from studio.presentation.canvas.landmark_view import LandmarkView

from tests.studio.conftest import SPREAD_HAND, make_geometry_hand, make_pose_sample

CONFIG = VisualizationConfig()
VIEWPORT = QSize(620, 700)


@pytest.fixture
def view(qtbot) -> LandmarkView:
    """A shown, fitted view over one unit-scale hand."""
    widget = LandmarkView(CONFIG)
    qtbot.addWidget(widget)
    widget.resize(VIEWPORT)
    widget.show()
    sample = make_pose_sample(
        pose_id="zoom",
        sample_number="sample_000001",
        hands=(make_geometry_hand(SPREAD_HAND),),
    )
    state = DatasetViewState(
        selected_pose_id="zoom",
        selected_samples=frozenset({SampleKey("zoom", "sample_000001")}),
    )
    widget.show_plan(build_scene_plan([sample], state, CONFIG), refit=True)
    return widget


def test_the_fitted_view_is_relative_zoom_one(view: LandmarkView) -> None:
    """The anchor every limit is measured against."""
    assert view.relative_zoom == pytest.approx(1.0, abs=1e-6)
    # And the absolute scale really is the awkward magnitude that broke the old
    # clamp, so this test is exercising the real situation.
    assert view.zoom_level > CONFIG.max_zoom


def test_zoom_in_actually_zooms_in(view: LandmarkView) -> None:
    """The regression: this used to be a no-op at every fitted scale."""
    before = view.zoom_level

    view.zoom_in()

    assert view.zoom_level > before
    assert view.relative_zoom == pytest.approx(CONFIG.zoom_step, rel=1e-6)


def test_zoom_out_actually_zooms_out(view: LandmarkView) -> None:
    """So did this — the old guard rejected both directions at once."""
    before = view.zoom_level

    view.zoom_out()

    assert view.zoom_level < before
    assert view.relative_zoom == pytest.approx(1.0 / CONFIG.zoom_step, rel=1e-6)


def test_zoom_in_stops_at_the_configured_ceiling(view: LandmarkView) -> None:
    """Clamped, but only after the range has actually been used."""
    for _ in range(200):
        view.zoom_in()

    assert view.relative_zoom <= CONFIG.max_zoom
    assert view.relative_zoom > 1.0, "the ceiling must not block the first step"


def test_zoom_out_stops_at_the_configured_floor(view: LandmarkView) -> None:
    for _ in range(200):
        view.zoom_out()

    assert view.relative_zoom >= CONFIG.min_zoom
    assert view.relative_zoom < 1.0


def test_reset_restores_the_fitted_view_not_an_identity_transform(view: LandmarkView) -> None:
    """1:1 in model space is four hands per pixel — a meaningless "home"."""
    for _ in range(3):
        view.zoom_in()

    view.reset_view()

    assert view.relative_zoom == pytest.approx(1.0, abs=1e-6)
    assert view.zoom_level == pytest.approx(view.fit_scale, rel=1e-6)
    assert view.zoom_level != pytest.approx(1.0)


def test_the_limits_hold_in_normalized_space_too(qtbot) -> None:
    """The two spaces fit at scales that differ by roughly an order of magnitude.

    An absolute clamp cannot serve both; a fit-relative one needs no per-space
    tuning, which is the point of the change.
    """
    sample = make_pose_sample(
        pose_id="zoom",
        sample_number="sample_000001",
        hands=(make_geometry_hand(SPREAD_HAND),),
    )
    scales = {}
    for space in (CoordinateSpace.RAW, CoordinateSpace.NORMALIZED):
        widget = LandmarkView(CONFIG)
        qtbot.addWidget(widget)
        widget.resize(VIEWPORT)
        widget.show()
        state = DatasetViewState(
            selected_pose_id="zoom",
            selected_samples=frozenset({SampleKey("zoom", "sample_000001")}),
            coordinate_space=space,
        )
        widget.show_plan(build_scene_plan([sample], state, CONFIG), refit=True)
        before = widget.zoom_level
        widget.zoom_in()

        assert widget.zoom_level > before, f"zoom_in was a no-op in {space}"
        assert widget.relative_zoom == pytest.approx(CONFIG.zoom_step, rel=1e-6)
        scales[space] = before

    assert scales[CoordinateSpace.RAW] != pytest.approx(scales[CoordinateSpace.NORMALIZED])


def test_showing_a_new_plan_re_anchors_the_zoom_limits(view: LandmarkView) -> None:
    """New content fits at a new scale, so a stale anchor would mis-clamp."""
    sample = make_pose_sample(
        pose_id="zoom",
        sample_number="sample_000001",
        hands=(make_geometry_hand(SPREAD_HAND),),
    )
    state = DatasetViewState(
        selected_pose_id="zoom",
        selected_samples=frozenset({SampleKey("zoom", "sample_000001")}),
        coordinate_space=CoordinateSpace.NORMALIZED,
    )
    raw_fit = view.fit_scale

    # refit=False is the real path taken when the space toggle changes: the
    # user's zoom is preserved, but the fit anchor must still be updated.
    view.show_plan(build_scene_plan([sample], state, CONFIG), refit=False)

    assert view.fit_scale != pytest.approx(raw_fit)
    before = view.zoom_level
    view.zoom_in()
    assert view.zoom_level > before
