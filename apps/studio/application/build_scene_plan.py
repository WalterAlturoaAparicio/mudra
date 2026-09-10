"""Decide what to draw. The Qt layer decides nothing.

This is the component with real logic in it, and it is a **pure function with no
``PySide6`` import** (research D8). Coordinate space, per-hand colour, opacity
falloff, emphasis, and the 21-point topology are all resolved here, so the
milestone's densest rules are asserted by plain pytest with no display and no
event loop.

If you find yourself adding a branch to the renderer, the branch belongs here.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence

from engine.models.landmarks import Handedness, HandLandmarks
from engine.models.pose import PoseSample
from engine.models.topology import HAND_CONNECTIONS, LandmarkIndex

from studio.config.models import VisualizationConfig
from studio.domain.scene import (
    HandStyle,
    MarkerShape,
    SceneBounds,
    SceneHand,
    ScenePlan,
    ScenePoint,
    SceneReference,
)
from studio.domain.selection import CoordinateSpace, DatasetViewState, EmphasisLevel, SampleKey

__all__ = ["build_scene_plan", "resolve_opacity"]

#: Landmarks drawn larger than their neighbours, because they are the ones that
#: tell you what the hand is *doing*. Sourced from Engine's named topology rather
#: than written as bare integers (Principle IV).
_FINGERTIPS: frozenset[int] = frozenset(
    {
        LandmarkIndex.THUMB_TIP,
        LandmarkIndex.INDEX_TIP,
        LandmarkIndex.MIDDLE_TIP,
        LandmarkIndex.RING_TIP,
        LandmarkIndex.PINKY_TIP,
    }
)

#: Handedness carried by a second, non-colour channel (FR-008).
_MARKERS: dict[Handedness, MarkerShape] = {
    Handedness.LEFT: MarkerShape.CIRCLE,
    Handedness.RIGHT: MarkerShape.SQUARE,
    Handedness.UNKNOWN: MarkerShape.DIAMOND,
}


def resolve_opacity(selection_size: int, config: VisualizationConfig) -> float:
    """Opacity for each hand when ``selection_size`` samples are overlaid.

    ``base_opacity / sqrt(n)``, floored at ``min_opacity`` (FR-013, research D9).
    The square root rather than ``1/n`` is deliberate: linear falloff makes a
    twenty-sample overlay invisible, while the square root keeps total ink roughly
    constant as the selection grows, which is what makes overlapping regions stay
    distinguishable instead of merging into a single wash.

    The floor matters at the other end: at 500 samples even ``1/sqrt(n)`` would
    round to nothing, and a plan that renders nothing is worse than a crowded one.

    Args:
        selection_size: Number of samples selected. Values below 1 are treated
            as 1, so an empty plan never divides by zero.
        config: Where ``base_opacity`` and ``min_opacity`` come from — no
            coefficient is literal in this function (Principle V).

    Returns:
        The per-hand opacity, in ``(0, 1]``.
    """
    n = max(1, selection_size)
    return max(config.min_opacity, config.base_opacity / math.sqrt(n))


def _color_for(handedness: Handedness, config: VisualizationConfig) -> str:
    """Resolve a hand's colour from its handedness (FR-008)."""
    if handedness is Handedness.LEFT:
        return config.left_hand_color
    if handedness is Handedness.RIGHT:
        return config.right_hand_color
    return config.unknown_hand_color


def _style_for(
    handedness: Handedness,
    emphasis: EmphasisLevel,
    opacity: float,
    config: VisualizationConfig,
    *,
    label: str = "",
) -> HandStyle:
    """Resolve colour, opacity, emphasis, marker and label into a :class:`HandStyle`.

    Emphasis overrides colour, because its whole purpose is to make one sample
    stand out from its neighbours — which it cannot do while wearing the same
    colour as them (FR-018). The *marker* is not overridden: it encodes which
    physical hand this is, which emphasis has no business changing.
    """
    if emphasis is EmphasisLevel.HIGHLIGHTED:
        color = config.highlight_color
    elif emphasis is EmphasisLevel.MUTED:
        color = config.muted_color
    else:
        color = _color_for(handedness, config)
    return HandStyle(
        color=color,
        opacity=opacity,
        emphasis=emphasis,
        marker=_MARKERS.get(handedness, MarkerShape.DIAMOND),
        label=label,
    )


def _radius_for(index: int, config: VisualizationConfig) -> float:
    """Device-pixel marker radius for landmark ``index``.

    Three tiers, because a hand read as 21 identical dots is a point cloud: the
    wrist anchors the pose's orientation, the five tips carry what the pose
    *is*, and the joints between them are context.
    """
    if index == LandmarkIndex.WRIST:
        return config.wrist_radius
    if index in _FINGERTIPS:
        return config.fingertip_radius
    return config.point_radius


def _reference_for(
    space: CoordinateSpace, bounds: SceneBounds, config: VisualizationConfig
) -> SceneReference:
    """Build the annotation that explains ``space``.

    RAW gets the camera frame's unit square: x/y are frame-relative in [0, 1], so
    the box shows *where in the frame* the hand was, which a fitted view would
    otherwise scale away. NORMALIZED gets a crosshair on the origin, because
    after wrist-centring the origin is the wrist — the single fact that makes the
    normalized numbers interpretable.

    Returns an empty reference when disabled, so the renderer needs no branch.
    """
    if not config.show_reference:
        return SceneReference()

    if space is CoordinateSpace.RAW:
        return SceneReference(
            lines=(
                (0.0, 0.0, 1.0, 0.0),
                (1.0, 0.0, 1.0, 1.0),
                (1.0, 1.0, 0.0, 1.0),
                (0.0, 1.0, 0.0, 0.0),
            ),
            labels=((0.0, 0.0, "frame (0,0)"), (1.0, 1.0, "(1,1)")),
            color=config.reference_color,
            width=config.reference_width,
        )

    # Crosshair clamped to the data's own extent. A fixed reach would either
    # vanish off-screen or force the view to zoom out past the hand; clamping
    # keeps the origin marked without costing the normalized view any detail.
    return SceneReference(
        lines=(
            (min(bounds.min_x, 0.0), 0.0, max(bounds.max_x, 0.0), 0.0),
            (0.0, min(bounds.min_y, 0.0), 0.0, max(bounds.max_y, 0.0)),
        ),
        labels=((0.0, 0.0, "wrist (0,0)"),),
        color=config.reference_color,
        width=config.reference_width,
    )


def _view_bounds_for(bounds: SceneBounds, reference: SceneReference) -> SceneBounds:
    """Union ``bounds`` with the reference geometry — what the view should fit.

    Kept out of :attr:`ScenePlan.bounds` so the data extent stays a fact about
    the landmarks, and computed here rather than in the renderer so the framing
    rule is assertable without a display.
    """
    if reference.is_empty:
        return bounds

    xs = [bounds.min_x, bounds.max_x]
    ys = [bounds.min_y, bounds.max_y]
    for x1, y1, x2, y2 in reference.lines:
        xs.extend((x1, x2))
        ys.extend((y1, y2))
    for x, y, _ in reference.labels:
        xs.append(x)
        ys.append(y)
    return SceneBounds(min_x=min(xs), min_y=min(ys), max_x=max(xs), max_y=max(ys))


def _landmarks_for(sample_hand, space: CoordinateSpace) -> HandLandmarks:
    """Pick the landmark set for the active coordinate space (FR-010)."""
    if space is CoordinateSpace.NORMALIZED:
        return sample_hand.normalized
    return sample_hand.raw


def _bounds_for(hands: Sequence[SceneHand], config: VisualizationConfig) -> SceneBounds:
    """Union bounding box over every point, guaranteed non-degenerate.

    A single-point scene, or a scene whose points happen to be collinear, would
    otherwise give ``fitInView`` a zero-width or zero-height rectangle to scale
    into — a division by zero inside Qt. Expanding to ``min_bounds_span`` around
    the centre costs nothing visually and removes the failure mode entirely.
    """
    xs = [p.x for hand in hands for p in hand.points]
    ys = [p.y for hand in hands for p in hand.points]
    if not xs or not ys:
        return SceneBounds()

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span = config.min_bounds_span

    if max_x - min_x < span:
        centre = (max_x + min_x) / 2.0
        min_x, max_x = centre - span / 2.0, centre + span / 2.0
    if max_y - min_y < span:
        centre = (max_y + min_y) / 2.0
        min_y, max_y = centre - span / 2.0, centre + span / 2.0

    return SceneBounds(min_x=min_x, min_y=min_y, max_x=max_x, max_y=max_y)


def build_scene_plan(
    samples: Iterable[PoseSample],
    view_state: DatasetViewState,
    config: VisualizationConfig,
    *,
    emphasis: Mapping[SampleKey, EmphasisLevel] | None = None,
) -> ScenePlan:
    """Build the plan for the currently selected samples.

    Args:
        samples: The pose's valid samples. Only those whose ``SampleKey`` is in
            ``view_state.selected_samples`` are drawn.
        view_state: Selection, coordinate space, and index-label toggle.
        config: Every colour, radius, and opacity coefficient.
        emphasis: FR-018's extension point. Defaults to ``view_state.emphasis``.
            A key naming an unselected sample is **ignored rather than an error**
            — a future outlier detector will legitimately flag samples the user
            has not selected, and that must not break the render.

    Returns:
        A fully-resolved :class:`ScenePlan`. Empty selection yields an empty plan
        with default bounds, which the renderer shows as its no-selection state.
    """
    selected = view_state.selected_samples
    emphasis_map = dict(emphasis if emphasis is not None else view_state.emphasis)

    chosen = [
        sample
        for sample in samples
        if SampleKey(sample.pose.pose_id, sample.sample_number) in selected
    ]
    chosen.sort(key=lambda s: s.sample_number)

    opacity = resolve_opacity(len(chosen), config)
    space = view_state.coordinate_space

    # Text is useful for a handful of samples and actively harmful for hundreds:
    # 500 overlaid samples would mean 10,500 index glyphs stacked on the same
    # pixels. Decided once, here, so the renderer keeps its "no branches" rule.
    labels_fit = len(chosen) <= config.label_max_samples

    hands: list[SceneHand] = []
    for sample in chosen:
        key = SampleKey(sample.pose.pose_id, sample.sample_number)
        level = emphasis_map.get(key, EmphasisLevel.NORMAL)
        for hand_index, hand in enumerate(sample.hands):
            landmarks = _landmarks_for(hand, space)
            # x/y verbatim from the parsed landmark: this is the lossless step,
            # and the only added field is a device-pixel marker size.
            points = tuple(
                ScenePoint(index=i, x=point.x, y=point.y, radius=_radius_for(i, config))
                for i, point in enumerate(landmarks.points)
            )
            hands.append(
                SceneHand(
                    sample_key=key,
                    hand_index=hand_index,
                    handedness=str(hand.handedness),
                    points=points,
                    edges=HAND_CONNECTIONS,
                    style=_style_for(
                        hand.handedness,
                        level,
                        opacity,
                        config,
                        label=str(hand.handedness).upper() if labels_fit else "",
                    ),
                )
            )

    bounds = _bounds_for(hands, config)
    reference = _reference_for(space, bounds, config)
    return ScenePlan(
        hands=tuple(hands),
        bounds=bounds,
        view_bounds=_view_bounds_for(bounds, reference),
        space=space,
        show_indices=view_state.show_landmark_indices and labels_fit,
        reference=reference,
        index_font_size=config.index_font_size,
        index_label_offset=config.index_label_offset,
        hand_label_font_size=config.hand_label_font_size,
        hand_label_offset=config.hand_label_offset,
    )
