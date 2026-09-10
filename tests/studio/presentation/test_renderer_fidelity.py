"""The Qt layer must put the plan's differences on screen.

This is the regression suite for the defect itself. ``build_scene_plan`` was
always producing numerically distinct plans for distinct poses; the renderer then
drew every one of them as the same flat wash of colour, because
``point_radius``/``edge_width`` — documented in pixels — were being consumed as
*model-space* lengths. In raw space a hand spans about 0.25 units, so a radius of
4.0 was a dot roughly thirty times wider than the hand it marked. Once
``fitInView`` scaled the bounds to the viewport, the markers scaled with them:
one landmark became ~11,000px across in a 620x700 panel, and two completely
different poses rendered pixel-for-pixel identically.

So these tests assert on **rendered pixels**, not on scene-graph geometry.
``itemsBoundingRect()`` cannot be used here: for an ``ItemIgnoresTransformations``
item Qt maps its pixel-sized local rect through ``sceneTransform()`` and reports
the result as though those pixels were scene units, which is meaningless. What
lands in the framebuffer is the only honest measure.

Text is asserted structurally rather than visually: the ``offscreen`` platform
these tests run under has an empty font database, so glyphs rasterize to nothing
even when the items are present and correctly placed.
"""

from __future__ import annotations

import pytest
from engine.models.landmarks import Handedness
from PySide6.QtCore import QSize
from PySide6.QtGui import QColor, QImage, QPainter
from PySide6.QtWidgets import QGraphicsItem, QGraphicsSimpleTextItem
from studio.application.build_scene_plan import build_scene_plan
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey
from studio.presentation.canvas.landmark_view import LandmarkView

from tests.studio.conftest import (
    FIST_HAND,
    SPREAD_HAND,
    make_geometry_hand,
    make_pose_sample,
)

CONFIG = VisualizationConfig()

VIEWPORT = QSize(620, 700)
BACKGROUND = QColor("white")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _plan(landmarks, *, space=CoordinateSpace.RAW, handedness=Handedness.RIGHT, indices=False):
    sample = make_pose_sample(
        pose_id="fidelity",
        sample_number="sample_000001",
        hands=(make_geometry_hand(landmarks, handedness=handedness),),
    )
    state = DatasetViewState(
        selected_pose_id="fidelity",
        selected_samples=frozenset({SampleKey("fidelity", "sample_000001")}),
        coordinate_space=space,
        show_landmark_indices=indices,
    )
    return build_scene_plan([sample], state, CONFIG)


def _render(qtbot, plan) -> tuple[QImage, LandmarkView]:
    """Render ``plan`` fitted into a fixed viewport and return the framebuffer."""
    view = LandmarkView(CONFIG)
    qtbot.addWidget(view)
    view.resize(VIEWPORT)
    view.show()
    view.show_plan(plan, refit=True)

    image = QImage(VIEWPORT, QImage.Format.Format_ARGB32)
    image.fill(BACKGROUND)
    painter = QPainter(image)
    view.render(painter)
    painter.end()
    return image, view


def _ink(image: QImage) -> list[tuple[int, int]]:
    """Every pixel that is not background."""
    return [
        (x, y)
        for y in range(image.height())
        for x in range(image.width())
        if image.pixelColor(x, y) != BACKGROUND
    ]


def _coverage(image: QImage) -> float:
    """Fraction of the viewport covered by ink."""
    return len(_ink(image)) / (image.width() * image.height())


def _repaint(view: LandmarkView) -> QImage:
    """Grab the view's current framebuffer without rebuilding the scene."""
    image = QImage(VIEWPORT, QImage.Format.Format_ARGB32)
    image.fill(BACKGROUND)
    painter = QPainter(image)
    view.render(painter)
    painter.end()
    return image


def _marker_width_at(image: QImage, view: LandmarkView, point) -> int:
    """Width in device pixels of the contiguous ink run through ``point``.

    ``point`` is model-space, so it is mapped through the view's transform first
    — which is precisely the mapping under test: the marker's *position* follows
    the transform while its *size* must not.
    """
    centre = view.mapFromScene(point.x, point.y)
    cx, cy = centre.x(), centre.y()
    if not (0 <= cx < image.width() and 0 <= cy < image.height()):
        raise AssertionError(f"landmark mapped outside the viewport at ({cx}, {cy})")
    if image.pixelColor(cx, cy) == BACKGROUND:
        raise AssertionError(f"no marker drawn at ({cx}, {cy})")

    left = cx
    while left > 0 and image.pixelColor(left - 1, cy) != BACKGROUND:
        left -= 1
    right = cx
    while right < image.width() - 1 and image.pixelColor(right + 1, cy) != BACKGROUND:
        right += 1
    return right - left + 1


def _differing_pixels(a: QImage, b: QImage) -> int:
    return sum(
        1
        for y in range(a.height())
        for x in range(a.width())
        if a.pixelColor(x, y) != b.pixelColor(x, y)
    )


# --------------------------------------------------------------------------- #
# The headline regression
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "space", [CoordinateSpace.RAW, CoordinateSpace.NORMALIZED], ids=["raw", "normalized"]
)
def test_dissimilar_plans_render_to_dissimilar_images(qtbot, space) -> None:
    """The exact failure: two different poses used to be pixel-identical."""
    spread, _ = _render(qtbot, _plan(SPREAD_HAND, space=space))
    fist, _ = _render(qtbot, _plan(FIST_HAND, space=space))

    differing = _differing_pixels(spread, fist)
    total = spread.width() * spread.height()

    assert differing > 0, "two different hands rendered pixel-for-pixel identically"
    # A hairline difference would also be a failure: the shapes are wildly
    # dissimilar, so a faithful drawing differs over a substantial area of ink.
    assert differing > 0.2 * len(_ink(spread)), (
        f"only {differing} of {total} pixels differ; the drawing is dominated by "
        "something other than the landmark geometry"
    )


def test_a_rendered_hand_does_not_flood_the_viewport(qtbot) -> None:
    """Before the fix this was exactly 1.0 — a solid wash of one colour."""
    image, _ = _render(qtbot, _plan(SPREAD_HAND))

    coverage = _coverage(image)

    assert 0.0 < coverage < 0.5, (
        f"ink covers {coverage:.1%} of the viewport; a 21-point skeleton drawn at "
        "pixel scale covers a few percent, while markers sized in model units "
        "cover everything"
    )


def test_markers_are_small_relative_to_the_rendered_hand(qtbot) -> None:
    """The unit mismatch, measured on screen.

    The marker size is fixed in device pixels while the hand is scaled to the
    viewport, so the ratio between them is what the bug destroyed: it used to be
    ~18x, and anything above 1.0 means the marker is bigger than the whole hand.
    """
    plan = _plan(SPREAD_HAND)
    _, view = _render(qtbot, plan)

    hand_extent_px = plan.bounds.width * view.zoom_level
    largest_marker_px = 2 * max(p.radius for hand in plan.hands for p in hand.points)

    assert hand_extent_px > 0
    assert largest_marker_px < 0.25 * hand_extent_px, (
        f"largest marker is {largest_marker_px:.0f}px across against a {hand_extent_px:.0f}px hand"
    )


def test_rendered_ink_stays_within_the_viewport(qtbot) -> None:
    """Drawn extent must be commensurate with the data, not ~34x it.

    Fitting puts the data inside the viewport by construction; the question is
    whether the *chrome* drawn around it stays there too. Oversized markers used
    to overflow by orders of magnitude, which is why nothing was legible.
    """
    image, _ = _render(qtbot, _plan(SPREAD_HAND))
    ink = _ink(image)

    assert ink, "nothing was drawn"
    xs = [x for x, _ in ink]
    ys = [y for _, y in ink]
    # Ink touching all four edges means it is overflowing rather than fitting.
    assert not (min(xs) == 0 and max(xs) == image.width() - 1 and min(ys) == 0), (
        "ink spans the entire viewport in every direction"
    )


# --------------------------------------------------------------------------- #
# Pixel-space mechanics
# --------------------------------------------------------------------------- #


def test_zooming_in_grows_the_hand_but_not_the_markers(qtbot) -> None:
    """Constant-size chrome is what makes zoom a diagnostic tool.

    If markers scaled with the view, zooming would magnify blobs instead of
    separating landmarks — the behaviour that made the canvas useless. Measured
    on the wrist, the largest marker and the one with clear space around it.
    """
    plan = _plan(SPREAD_HAND)
    wrist = plan.hands[0].points[0]
    expected = 2 * wrist.radius

    _, view = _render(qtbot, plan)
    fitted_width = _marker_width_at(_repaint(view), view, wrist)

    for _ in range(4):
        view.zoom_in()
    view.centerOn(wrist.x, wrist.y)
    zoomed_width = _marker_width_at(_repaint(view), view, wrist)

    assert view.relative_zoom > 1.0
    assert fitted_width == pytest.approx(expected, abs=2.0)
    # The whole point: 2.4x more zoom, same dot.
    assert zoomed_width == pytest.approx(fitted_width, abs=2.0)


def test_marker_size_follows_the_configured_pixel_radius(qtbot) -> None:
    """Doubling the configured radius must double the drawn dot.

    Proves the number is honoured as pixels rather than being incidental — the
    property that was silently false while radii were read as model units.
    """
    plan = _plan(SPREAD_HAND)
    wrist = plan.hands[0].points[0]

    _, view = _render(qtbot, plan)
    default_width = _marker_width_at(_repaint(view), view, wrist)

    big = VisualizationConfig(wrist_radius=CONFIG.wrist_radius * 2)
    big_view = LandmarkView(big)
    qtbot.addWidget(big_view)
    big_view.resize(VIEWPORT)
    big_view.show()
    big_plan = build_scene_plan(
        [
            make_pose_sample(
                pose_id="fidelity",
                sample_number="sample_000001",
                hands=(make_geometry_hand(SPREAD_HAND),),
            )
        ],
        DatasetViewState(
            selected_pose_id="fidelity",
            selected_samples=frozenset({SampleKey("fidelity", "sample_000001")}),
        ),
        big,
    )
    big_view.show_plan(big_plan, refit=True)
    big_width = _marker_width_at(_repaint(big_view), big_view, big_plan.hands[0].points[0])

    assert big_width == pytest.approx(2 * default_width, abs=3.0)


def test_skeleton_edges_use_a_cosmetic_pen(qtbot) -> None:
    """A non-cosmetic pen is measured in model units — the original defect."""
    _, view = _render(qtbot, _plan(SPREAD_HAND))

    lines = [item for item in view.scene().items() if hasattr(item, "line")]

    assert lines, "no skeleton edges were drawn"
    assert all(item.pen().isCosmetic() for item in lines)


def test_landmark_markers_ignore_the_view_transform(qtbot) -> None:
    """Every dot must be pixel-sized; one that is not would swamp the drawing."""
    _, view = _render(qtbot, _plan(SPREAD_HAND))
    flag = QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations

    markers = [
        item
        for item in view.scene().items()
        if hasattr(item, "rect") and not isinstance(item, QGraphicsSimpleTextItem)
    ]

    assert len(markers) >= 21
    assert all(item.flags() & flag for item in markers)


def test_index_labels_are_parented_to_their_marker(qtbot) -> None:
    """FR-009, and the culling trap.

    Offsetting a label by its own transform leaves ``sceneBoundingRect`` reporting
    pixel numbers as scene units, so Qt culls the label out of existence. Hanging
    it off the marker keeps the anchor in model space. Asserted structurally
    because the offscreen platform has no fonts to rasterize.
    """
    _, view = _render(qtbot, _plan(SPREAD_HAND, indices=True))

    labels = [i for i in view.scene().items() if isinstance(i, QGraphicsSimpleTextItem)]
    index_labels = [i for i in labels if i.text().isdigit()]

    assert len(index_labels) == 21
    assert {i.text() for i in index_labels} == {str(n) for n in range(21)}
    for label in index_labels:
        assert label.parentItem() is not None, "an unparented label will be culled away"
        assert label.pos().x() != 0.0 or label.pos().y() != 0.0


def test_no_labels_are_drawn_when_the_plan_disables_them(qtbot) -> None:
    """The renderer obeys the plan and makes no visibility decision of its own."""
    _, view = _render(qtbot, _plan(SPREAD_HAND, indices=False))

    labels = [i for i in view.scene().items() if isinstance(i, QGraphicsSimpleTextItem)]

    assert not [i for i in labels if i.text().isdigit()]


def test_left_and_right_hands_render_differently_in_greyscale(qtbot) -> None:
    """Handedness must survive the loss of colour (FR-008)."""
    left, _ = _render(qtbot, _plan(SPREAD_HAND, handedness=Handedness.LEFT))
    right, _ = _render(qtbot, _plan(SPREAD_HAND, handedness=Handedness.RIGHT))

    grey_left = left.convertToFormat(QImage.Format.Format_Grayscale8)
    grey_right = right.convertToFormat(QImage.Format.Format_Grayscale8)

    assert _differing_pixels(grey_left, grey_right) > 0, (
        "left and right are distinguishable only by hue"
    )


def test_the_reference_is_drawn_and_is_not_part_of_the_hand(qtbot) -> None:
    """The frame box explains raw space without touching a coordinate."""
    plan = _plan(SPREAD_HAND, space=CoordinateSpace.RAW)
    image, _ = _render(qtbot, plan)

    reference = QColor(CONFIG.reference_color)
    reference_pixels = sum(
        1
        for y in range(image.height())
        for x in range(image.width())
        if image.pixelColor(x, y) == reference
    )

    assert reference_pixels > 0, "the raw frame reference was not drawn"
    for point in plan.hands[0].points:
        assert plan.bounds.contains(point.x, point.y)
