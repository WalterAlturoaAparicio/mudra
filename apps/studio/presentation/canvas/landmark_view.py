"""The landmark canvas — zoom, pan, reset, and fit (FR-011).

``QGraphicsView`` supplies all four as framework behaviour rather than as
geometry Studio hand-writes, which is the reason the toolkit was chosen
(research D1). In particular ``fitInView(..., Qt.KeepAspectRatio)`` is what
satisfies FR-011's "without distorting the landmark proportions" — a hand that
stretches when the panel is resized would misrepresent the very shape the tool
exists to inspect.

The view holds the transform; the transform is deliberately *not* part of
``DatasetViewState``. Zooming is not a change to the data being looked at
(data-model §3).

**Zoom is measured relative to the fitted view, not absolutely.** Model space is
unit-scale — a raw hand spans about 0.25 units — so fitting one to a 600px panel
produces a scale factor around 1400. Clamping the raw ``transform().m11()`` to an
absolute window such as ``[0.1, 50]`` therefore rejects the fitted transform
itself, and *both* zoom directions silently become no-ops: ``zoom_in`` because
``1421 * 1.25 > 50``, and ``zoom_out`` because ``1421 / 1.25`` is still ``> 50``.
The limits are ratios against :attr:`fit_scale` instead, where ``1.0`` is the
fitted view, and they mean the same thing in either coordinate space.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QPainter, QWheelEvent
from PySide6.QtWidgets import QGraphicsScene, QGraphicsView

from studio.config.models import VisualizationConfig
from studio.domain.scene import ScenePlan
from studio.presentation.canvas.scene_renderer import LandmarkSceneRenderer

__all__ = ["LandmarkView"]


class LandmarkView(QGraphicsView):
    """A pan/zoom canvas showing one :class:`ScenePlan` at a time."""

    def __init__(self, config: VisualizationConfig) -> None:
        """Build the view, its scene, and its renderer."""
        super().__init__()
        self._config = config
        self._renderer = LandmarkSceneRenderer(config)
        self._scene = QGraphicsScene(self)
        self.setScene(self._scene)
        # The scale at which the current content fills the viewport; the origin
        # every zoom limit is expressed against. Unknown until something is
        # fitted, hence None rather than 1.0.
        self._fit_scale: float | None = None

        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)

    # -- content -------------------------------------------------------------

    def show_plan(self, plan: ScenePlan, *, refit: bool = False) -> None:
        """Render ``plan``.

        Args:
            plan: What to draw.
            refit: Whether to fit the new content to the viewport. Toggling
                coordinate space or index labels leaves this ``False`` so the
                user's zoom survives a mode switch; changing pose sets it, since
                the old transform means nothing for new data.
        """
        self._renderer.render(self._scene, plan)
        # New content fits at a new scale even when the transform is kept, so the
        # zoom limits must be re-anchored either way — otherwise switching to a
        # differently-sized space would measure zoom against a stale origin.
        self._fit_scale = self._estimate_fit_scale()
        if refit:
            self.fit()

    def _estimate_fit_scale(self) -> float | None:
        """The scale at which the current scene rect would fill the viewport.

        Computed rather than applied, so ``show_plan`` can re-anchor the zoom
        limits without disturbing a transform the user is working in.
        """
        rect = self._scene.sceneRect()
        viewport = self.viewport().rect()
        if rect.isEmpty() or viewport.isEmpty():
            return self._fit_scale
        return min(viewport.width() / rect.width(), viewport.height() / rect.height())

    # -- FR-011 controls -----------------------------------------------------

    @property
    def zoom_level(self) -> float:
        """Current horizontal scale factor, in raw scene-to-device units.

        Of little use on its own — its magnitude depends on the coordinate space
        and the viewport size. :attr:`relative_zoom` is the meaningful figure.
        """
        return self.transform().m11()

    @property
    def fit_scale(self) -> float | None:
        """The scale at which the current content fits, or ``None`` before a fit."""
        return self._fit_scale

    @property
    def relative_zoom(self) -> float:
        """Current zoom as a multiple of the fitted view; ``1.0`` *is* fitted.

        Falls back to :attr:`zoom_level` when nothing has been fitted yet, so the
        limits still mean something on a view that has never been sized.
        """
        if self._fit_scale is None or self._fit_scale <= 0.0:
            return self.zoom_level
        return self.zoom_level / self._fit_scale

    def zoom_in(self) -> None:
        """Zoom in by one configured step, clamped to ``max_zoom`` × fitted."""
        self._apply_zoom(self._config.zoom_step)

    def zoom_out(self) -> None:
        """Zoom out by one configured step, clamped to ``min_zoom`` × fitted."""
        self._apply_zoom(1.0 / self._config.zoom_step)

    def reset_view(self) -> None:
        """Return to the fitted view.

        Not ``resetTransform()``: an identity transform means "one scene unit per
        device pixel", and one scene unit is four hands wide, so 1:1 rendered the
        entire selection as a handful of pixels. The fitted view is the only
        scale that is meaningful in model space, so it is what "reset" restores.
        """
        self.fit()

    def fit(self) -> None:
        """Fit the scene to the viewport, **preserving aspect ratio** (FR-011).

        Also records the resulting scale as the origin for the zoom limits.
        """
        rect = self._scene.sceneRect()
        if rect.isEmpty():
            return
        self.fitInView(rect, Qt.AspectRatioMode.KeepAspectRatio)
        self._fit_scale = self.zoom_level

    def _apply_zoom(self, factor: float) -> None:
        """Scale by ``factor``, refusing to leave the configured zoom range.

        The range is checked in *fit-relative* terms, so it is independent of the
        coordinate space and the viewport size.
        """
        target = self.relative_zoom * factor
        if target < self._config.min_zoom or target > self._config.max_zoom:
            return
        self.scale(factor, factor)

    def wheelEvent(self, event: QWheelEvent) -> None:  # noqa: N802 - Qt override
        """Zoom on wheel, which is what a developer expects from a canvas."""
        if event.angleDelta().y() > 0:
            self.zoom_in()
        else:
            self.zoom_out()
        event.accept()
