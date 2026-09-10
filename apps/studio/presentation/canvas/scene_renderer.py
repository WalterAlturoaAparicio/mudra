"""Turn a ``ScenePlan`` into ``QGraphicsItem``s. Decide nothing.

This module is deliberately dull. Coordinate space, colour, opacity, emphasis,
topology, marker sizes and label visibility were all resolved by
``build_scene_plan``; everything here is a loop over already-decided values. **If
a branch appears here that the plan did not already make, it belongs in the
plan** (research D8) — that is what keeps the interesting rules testable without
a display.

Two coordinate systems, and keeping them apart is the whole point
----------------------------------------------------------------

A ``ScenePlan`` carries landmark coordinates in **model space**: the numbers
Engine parsed, untouched. In raw space a whole hand spans about 0.25 units; in
normalized space, about 1.5. Those numbers are the *data*, and they are the only
thing placed in scene coordinates, so ``fitInView`` scales exactly the geometry
the user is inspecting and nothing else.

Everything drawn *about* a landmark — its dot, its index label, the skeleton
stroke width, the reference annotation — is **device-pixel chrome**. Sizing
chrome in model units is what previously made every pose look identical: a
``point_radius`` of 4.0 taken as model units is a dot ~30x wider than the hand it
marks, and once ``fitInView`` normalised the bounds away, every sample rendered
as the same flat wash of colour.

So chrome is drawn transform-independently, by exactly two mechanisms:

- **Cosmetic pens** (``QPen.setCosmetic(True)``) for strokes. A cosmetic pen is
  always the given number of device pixels wide, whatever the view transform.
- **``ItemIgnoresTransformations``** for dots and text. Such an item is anchored
  at its scene ``pos()`` but draws in unscaled device pixels, so its *local*
  geometry — the ``(-r, -r, 2r, 2r)`` rect below — is in pixels. This is also why
  zooming in reveals more structure instead of merely magnifying blobs.

Labels are **children of the marker they annotate**, and their offset is a child
``setPos`` in the parent's local (therefore pixel) space. This is not a stylistic
choice: an offset applied as the text item's *own* transform leaves
``sceneBoundingRect`` reporting pixel numbers as though they were scene units, so
Qt's visibility culling computes a rectangle far outside the exposed scene area
and drops the label entirely. Parenting to the marker keeps the anchor — and
therefore the culling — in model space where it belongs.

The renderer still transforms nothing and corrects nothing: model-space values
go into ``setPos``/``addLine`` verbatim.

All rendering is embedded in Studio's own window. No OpenCV, no ``imshow``, no
external preview window (FR-020).
"""

from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QFont, QPen, QPolygonF
from PySide6.QtWidgets import QGraphicsItem, QGraphicsScene, QGraphicsSimpleTextItem

from studio.config.models import VisualizationConfig
from studio.domain.scene import HandStyle, MarkerShape, ScenePlan, ScenePoint

__all__ = ["LandmarkSceneRenderer"]

# Painter order. Reference sits behind the data it explains; dots sit on their
# edges; text sits on everything, since a label hidden under a dot is worse than
# no label. Not configuration — it is the drawing's structure.
_Z_REFERENCE = -10.0
_Z_EDGE = 0.0
_Z_POINT = 10.0
_Z_LABEL = 20.0


class LandmarkSceneRenderer:
    """Renders a :class:`ScenePlan` into a ``QGraphicsScene``."""

    def __init__(self, config: VisualizationConfig) -> None:
        """Store the visual configuration.

        Args:
            config: Radii, widths, and font size. Nothing in this class is a
                literal (Principle V).
        """
        self._config = config

    # -- entry point ---------------------------------------------------------

    def render(self, scene: QGraphicsScene, plan: ScenePlan) -> None:
        """Clear ``scene`` and draw ``plan`` into it.

        Args:
            scene: The target scene. Fully cleared first — the plan is the whole
                truth about what should be visible.
            plan: What to draw.
        """
        scene.clear()
        if plan.is_empty:
            scene.setSceneRect(self._rect_of(plan))
            return

        self._draw_reference(scene, plan)

        for hand in plan.hands:
            if hand.unavailable_reason is not None:
                # Reserved seam: unreachable under schema 1, because a sample
                # missing coordinates is skipped at load time (research D7).
                # Handled rather than raised, so a future schema cannot crash us.
                self._draw_message(scene, plan, hand.unavailable_reason)
                continue

            color = QColor(hand.style.color)
            color.setAlphaF(hand.style.opacity)

            self._draw_edges(scene, hand.points, hand.edges, color)
            markers = self._draw_points(scene, plan, hand.points, hand.style, color)
            self._draw_hand_label(plan, markers, hand.style, color)

        scene.setSceneRect(self._rect_of(plan))

    # -- data: model space ---------------------------------------------------

    def _draw_edges(
        self,
        scene: QGraphicsScene,
        points: tuple[ScenePoint, ...],
        edges: tuple[tuple[int, int], ...],
        color: QColor,
    ) -> None:
        """Draw the 21-edge skeleton (FR-007).

        Endpoints are model-space and go in verbatim; only the *width* is
        pixel-space, which is what the cosmetic pen buys.
        """
        pen = QPen(color, self._config.edge_width)
        pen.setCosmetic(True)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)

        for a, b in edges:
            line = scene.addLine(points[a].x, points[a].y, points[b].x, points[b].y, pen)
            line.setZValue(_Z_EDGE)

    # -- chrome: device-pixel space -----------------------------------------

    def _draw_points(
        self,
        scene: QGraphicsScene,
        plan: ScenePlan,
        points: tuple[ScenePoint, ...],
        style: HandStyle,
        color: QColor,
    ) -> list[QGraphicsItem]:
        """Draw all 21 landmark markers, and their index labels when enabled.

        Returns the marker items in landmark order, so callers can anchor further
        pixel-space annotation to a specific landmark.
        """
        brush = QBrush(color)
        pen = QPen(color)
        pen.setCosmetic(True)
        markers: list[QGraphicsItem] = []

        for point in points:
            item = self._marker_item(scene, style.marker, point.radius, pen, brush)
            # The single line that separates the two spaces: model-space
            # position, pixel-space geometry.
            item.setPos(point.x, point.y)
            item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations, True)
            item.setZValue(_Z_POINT)

            if plan.show_indices:
                self._attach_pixel_label(
                    parent=item,
                    text=str(point.index),
                    offset=(point.radius + plan.index_label_offset, -point.radius),
                    size=plan.index_font_size,
                    color=color,
                    bold=False,
                )
            markers.append(item)

        return markers

    def _marker_item(
        self,
        scene: QGraphicsScene,
        marker: MarkerShape,
        radius: float,
        pen: QPen,
        brush: QBrush,
    ) -> QGraphicsItem:
        """One landmark marker, centred on its own origin, sized in device pixels.

        The shape is the second, colour-independent channel for handedness
        (FR-008); the radius is the plan's per-landmark tier, so wrist, fingertip
        and joint are separable at a glance.
        """
        rect = QRectF(-radius, -radius, radius * 2, radius * 2)
        if marker is MarkerShape.SQUARE:
            return scene.addRect(rect, pen, brush)
        if marker is MarkerShape.DIAMOND:
            diamond = QPolygonF(
                [
                    QPointF(0.0, -radius),
                    QPointF(radius, 0.0),
                    QPointF(0.0, radius),
                    QPointF(-radius, 0.0),
                ]
            )
            return scene.addPolygon(diamond, pen, brush)
        return scene.addEllipse(rect, pen, brush)

    def _draw_hand_label(
        self,
        plan: ScenePlan,
        markers: list[QGraphicsItem],
        style: HandStyle,
        color: QColor,
    ) -> None:
        """Caption the wrist with the handedness, when the plan asked for it.

        Anchored to landmark 0 rather than to the bounding box, so in normalized
        space — where both wrists sit on the origin — the caption still names the
        hand it belongs to.
        """
        if not style.label or not markers:
            return
        wrist = markers[0]
        self._attach_pixel_label(
            parent=wrist,
            text=style.label,
            offset=(plan.hand_label_offset, plan.hand_label_offset),
            size=plan.hand_label_font_size,
            color=color,
            bold=True,
        )

    def _draw_reference(self, scene: QGraphicsScene, plan: ScenePlan) -> None:
        """Draw the space-explaining annotation behind everything else."""
        reference = plan.reference
        if reference.is_empty:
            return

        color = QColor(reference.color)
        pen = QPen(color, reference.width)
        pen.setCosmetic(True)
        pen.setStyle(Qt.PenStyle.DashLine)

        for x1, y1, x2, y2 in reference.lines:
            line = scene.addLine(x1, y1, x2, y2, pen)
            line.setZValue(_Z_REFERENCE)

        for x, y, text in reference.labels:
            anchor = self._pixel_anchor(scene, x, y)
            anchor.setZValue(_Z_REFERENCE)
            self._attach_pixel_label(
                parent=anchor,
                text=text,
                offset=(self._config.reference_width, self._config.reference_width),
                size=self._config.reference_font_size,
                color=color,
                bold=False,
            )

    def _pixel_anchor(self, scene: QGraphicsScene, x: float, y: float) -> QGraphicsItem:
        """An invisible marker-sized item at a model-space point.

        Reference captions have no dot to hang from, but they still need a parent
        whose position lives in model space — see the culling note in this
        module's docstring. The item is given a real (if tiny) extent rather than
        an empty one, because an empty bounding rect is itself a candidate for
        being culled away along with its children.
        """
        radius = self._config.reference_width
        item = scene.addRect(
            QRectF(-radius, -radius, radius * 2, radius * 2),
            QPen(Qt.PenStyle.NoPen),
            QBrush(Qt.BrushStyle.NoBrush),
        )
        item.setPos(x, y)
        item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations, True)
        return item

    def _attach_pixel_label(
        self,
        *,
        parent: QGraphicsItem,
        text: str,
        offset: tuple[float, float],
        size: int,
        color: QColor,
        bold: bool,
    ) -> QGraphicsItem:
        """Hang ``text`` off ``parent``, offset and sized in device pixels.

        ``parent`` must already ignore view transformations, which makes its local
        coordinate system unscaled pixels — so ``offset`` means "pixels", not "a
        multiple of the whole hand". That was the mistake that previously flung
        every index label thousands of pixels away from the point it named.
        """
        font = QFont()
        font.setPixelSize(size)
        font.setBold(bold)

        item = QGraphicsSimpleTextItem(text, parent)
        item.setFont(font)
        item.setBrush(QBrush(color))
        item.setPos(offset[0], offset[1])
        item.setZValue(_Z_LABEL)
        return item

    # -- framing -------------------------------------------------------------

    def _rect_of(self, plan: ScenePlan) -> QRectF:
        """The scene rectangle, padded by the configured fit margin.

        Built from ``plan.bounds`` — the landmarks — and never from the drawn
        items: chrome has no model-space extent to speak of, and the reference is
        annotation the user did not ask to have framed.
        """
        bounds = plan.bounds
        pad_x = bounds.width * self._config.fit_margin
        pad_y = bounds.height * self._config.fit_margin
        return QRectF(
            bounds.min_x - pad_x,
            bounds.min_y - pad_y,
            bounds.width + 2 * pad_x,
            bounds.height + 2 * pad_y,
        )

    @staticmethod
    def _draw_message(scene: QGraphicsScene, plan: ScenePlan, text: str) -> None:
        """Draw a plain message where a hand would have been."""
        item = scene.addText(text)
        item.setPos(plan.bounds.min_x, plan.bounds.min_y)
        item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations, True)
        item.setZValue(_Z_LABEL)
