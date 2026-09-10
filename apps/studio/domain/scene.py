"""``ScenePlan`` — what to draw, decided before Qt exists.

Produced by the pure ``studio.application.build_scene_plan`` and consumed by the
Qt renderer, which makes **no further decisions**: coordinate space, per-hand
colour, opacity falloff, emphasis, and the 21-point topology are all resolved
here (research D8). That split is why the milestone's densest rules are asserted
by plain pytest with no display and no event loop.

Nothing in this module imports ``PySide6``.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from studio.domain.selection import CoordinateSpace, EmphasisLevel, SampleKey

__all__ = [
    "MarkerShape",
    "ScenePoint",
    "HandStyle",
    "SceneHand",
    "SceneBounds",
    "SceneReference",
    "ScenePlan",
]


class MarkerShape(StrEnum):
    """The dot shape used for one hand's landmarks.

    Handedness must survive being read by someone who cannot separate the two
    hues — colour-blindness, a projector, a greyscale screenshot in a bug report
    — so it is carried by shape *as well as* colour (FR-008).
    """

    CIRCLE = "circle"
    SQUARE = "square"
    DIAMOND = "diamond"


@dataclass(frozen=True, slots=True)
class ScenePoint:
    """One projected landmark in model space.

    ``z`` is deliberately not projected: MediaPipe's depth is relative to the
    wrist and in different units from x/y, so drawing it would imply a precision
    the data does not have (research D6).

    ``x``/``y`` are the source landmark's coordinates **verbatim** — this type
    is a lossless carrier, and a test asserts the equality holds exactly.
    ``radius`` is the one field in a different unit, and it is not geometry: it
    is how big to draw the marker *on screen*.

    Attributes:
        index: 0-20; the label shown when FR-009's toggle is on.
        x: Model-space horizontal coordinate in the active space.
        y: Model-space vertical coordinate in the active space.
        radius: Marker radius in **device pixels**, constant under zoom.
    """

    index: int
    x: float
    y: float
    radius: float = 3.5


@dataclass(frozen=True, slots=True)
class HandStyle:
    """Fully-resolved appearance of one hand.

    Every value here came from ``VisualizationConfig``; the renderer looks up
    nothing and computes nothing (Principle V — no magic numbers in widget code).

    Attributes:
        color: Hex colour resolved from handedness (FR-008).
        opacity: ``max(min_opacity, base_opacity / sqrt(n))`` for ``n`` selected
            samples (FR-013).
        emphasis: FR-018's level. ``NORMAL`` throughout this milestone.
        marker: Dot shape, the non-colour channel carrying handedness (FR-008).
        label: Short handedness caption drawn at the wrist, or ``""`` when the
            selection is too large for text to help.
    """

    color: str
    opacity: float = 1.0
    emphasis: EmphasisLevel = EmphasisLevel.NORMAL
    marker: MarkerShape = MarkerShape.CIRCLE
    label: str = ""


@dataclass(frozen=True, slots=True)
class SceneHand:
    """One hand of one sample, ready to draw.

    Attributes:
        sample_key: Which sample this hand belongs to.
        hand_index: Position within ``sample.hands``; disambiguates the two hands
            of a two-handed sample.
        handedness: The raw label, retained for tooltips and tests.
        points: Exactly 21 points, or empty.
        edges: ``HAND_CONNECTIONS``, verbatim from Engine (FR-007).
        style: Resolved colour, opacity, emphasis.
        unavailable_reason: **Reserved seam — unreachable under schema 1.** A
            hand whose coordinates are missing in the active space would land
            here, but Engine's serializer requires the ``normalized`` block, so
            such a sample raises during parsing and is captured as a
            ``SkippedSample`` instead: missing coordinates are a *load-time*
            concern (FR-022), not a render-time one. ``build_scene_plan`` never
            sets this field. It is kept because it costs one nullable and one
            message, and it is where a future optional-normalization schema would
            land (data-model §5, research D7).
    """

    sample_key: SampleKey
    hand_index: int
    handedness: str
    points: tuple[ScenePoint, ...]
    edges: tuple[tuple[int, int], ...]
    style: HandStyle
    unavailable_reason: str | None = None


@dataclass(frozen=True, slots=True)
class SceneBounds:
    """Model-space bounding box; what ``fitInView`` receives (FR-011).

    Guaranteed non-degenerate — a minimum span is applied by the builder — so
    fitting a single-point scene cannot divide by zero.
    """

    min_x: float = 0.0
    min_y: float = 0.0
    max_x: float = 1.0
    max_y: float = 1.0

    @property
    def width(self) -> float:
        """Horizontal span."""
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        """Vertical span."""
        return self.max_y - self.min_y

    def contains(self, x: float, y: float) -> bool:
        """Whether ``(x, y)`` lies inside the box, inclusive of its edges."""
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


@dataclass(frozen=True, slots=True)
class SceneReference:
    """Fixed geometry explaining what the active coordinate space *means*.

    Raw and normalized landmarks are both just numbers on a canvas; without a
    reference the difference between "the hand sat in the top-left of the frame"
    and "the hand is 1.7 wrist-lengths wide" is invisible, and a fitted view
    erases it entirely by scaling both to fill the viewport. So each space draws
    its own reference: the unit frame box for RAW, the origin crosshair for
    NORMALIZED, where the origin *is* the wrist.

    This is annotation, not data. It is deliberately **not** part of
    :attr:`ScenePlan.bounds`, so it can never influence what ``fitInView``
    fits — the user is inspecting the hand, not the frame around it.

    Attributes:
        lines: ``(x1, y1, x2, y2)`` segments in **model space**.
        labels: ``(x, y, text)`` captions anchored in **model space**.
        color: Hex colour for both.
        width: Line width in **device pixels**.
    """

    lines: tuple[tuple[float, float, float, float], ...] = ()
    labels: tuple[tuple[float, float, str], ...] = ()
    color: str = "#78909C"
    width: float = 1.0

    @property
    def is_empty(self) -> bool:
        """Whether there is no reference geometry to draw."""
        return not self.lines and not self.labels


@dataclass(frozen=True, slots=True)
class ScenePlan:
    """Everything the canvas needs, and nothing it must decide.

    Invariants worth asserting in tests (data-model §5):

    - ``len(hand.points) in (0, 21)`` — never a partial hand.
    - Every edge index is ``< 21``.
    - ``bounds`` contains every point and is non-degenerate.
    - A single selected sample ⇒ every ``opacity == 1.0``.

    Attributes:
        hands: Every hand of every selected sample. Empty ⇒ the renderer shows
            its no-selection state.
        bounds: Union bounding box in model space, over landmarks only. This is
            the *data* extent, and the invariant "bounds contains every point"
            belongs to it.
        view_bounds: What the view should fit — ``bounds`` unioned with the
            reference geometry. Separate from ``bounds`` so that framing is a
            presentation choice while ``bounds`` stays a fact about the
            landmarks. In RAW this is the camera frame, so every sample of every
            pose is framed identically and their *positions* become comparable;
            in NORMALIZED the crosshair is clamped to the data, so it equals
            ``bounds`` and the hand fills the panel.
        space: Which space ``bounds`` and every ``ScenePoint`` are expressed in.
        show_indices: FR-009, already reconciled with ``label_max_samples`` — the
            renderer does not second-guess it.
        reference: Space-explaining annotation, excluded from ``bounds``.
        index_font_size / index_label_offset: Device-pixel typography for FR-009's
            labels, resolved here so the renderer holds no literal.
        hand_label_font_size / hand_label_offset: Same, for the wrist captions.
    """

    hands: tuple[SceneHand, ...] = ()
    bounds: SceneBounds = SceneBounds()
    view_bounds: SceneBounds = SceneBounds()
    space: CoordinateSpace = CoordinateSpace.RAW
    show_indices: bool = False
    reference: SceneReference = SceneReference()
    index_font_size: int = 8
    index_label_offset: float = 5.0
    hand_label_font_size: int = 10
    hand_label_offset: float = 12.0

    @property
    def is_empty(self) -> bool:
        """Whether there is nothing to draw."""
        return not self.hands
