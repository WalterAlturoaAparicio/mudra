"""Centralized, validated configuration for Mudra Studio.

Every tunable the renderer and widgets use lives here as a Pydantic model
(constitution Principle V), so nothing is hardcoded at a call site and invalid
values are rejected at startup rather than discovered at paint time.

Two boundary decisions worth stating explicitly:

- ``dataset`` **reuses Engine's** ``DatasetConfig`` rather than redeclaring where
  the dataset lives, so Studio and Engine cannot drift about it (research D12).
  It is the only Engine config symbol the feature's Engine-consumption contract
  authorizes.
- ``logging`` is **Studio-owned**, declared below rather than imported from
  ``engine.config.models``, so Studio's log level can differ from Engine's
  without either application reaching into the other.

There is **no** dataset-picker setting anywhere in this module. FR-003a is
enforced by absence: the milestone reads the repository's bundled
``datasets/poses`` and offers no way to point elsewhere from the UI.
"""

from __future__ import annotations

from engine.config.models import DatasetConfig
from pydantic import BaseModel, Field, model_validator

__all__ = [
    "VisualizationConfig",
    "WindowConfig",
    "LoggingConfig",
    "StudioConfig",
]


class VisualizationConfig(BaseModel):
    """Landmark canvas appearance and view limits.

    Every number the renderer uses appears here. A literal in
    ``scene_renderer.py`` or ``landmark_view.py`` is a bug against Principle V.

    **Units.** Two kinds of number live in this model and they must not be
    confused, because doing so is what produced the "every pose looks the same"
    defect: radii, widths, offsets and font sizes are **device pixels**, constant
    on screen at any zoom, while ``min_bounds_span`` and ``fit_margin`` are in
    **model space** — the landmark coordinate system, where a whole hand spans
    roughly 0.25 units in raw space. A marker sized in model units is ~30x the
    hand it marks; see ``scene_renderer`` for how the two spaces are kept apart.
    """

    left_hand_color: str = Field(default="#4FC3F7", description="Left-hand landmark colour.")
    right_hand_color: str = Field(default="#FF8A65", description="Right-hand landmark colour.")
    unknown_hand_color: str = Field(
        default="#BDBDBD", description="Colour when handedness is UNKNOWN."
    )
    highlight_color: str = Field(
        default="#FFD54F", description="Colour for HIGHLIGHTED emphasis (FR-018)."
    )
    muted_color: str = Field(default="#616161", description="Colour for MUTED emphasis (FR-018).")

    point_radius: float = Field(default=3.5, gt=0, description="Landmark dot radius, device px.")
    wrist_radius: float = Field(
        default=6.5,
        gt=0,
        description="Radius of landmark 0, device px. Larger than the rest so the hand's "
        "anchor — and therefore its orientation — is findable at a glance.",
    )
    fingertip_radius: float = Field(
        default=5.0,
        gt=0,
        description="Radius of landmarks 4/8/12/16/20, device px. Distinguishing the tips is "
        "what makes one pose readable as different from another.",
    )
    edge_width: float = Field(default=2.0, gt=0, description="Skeleton edge width, device px.")
    index_font_size: int = Field(default=8, gt=0, description="Landmark index label size, px.")
    index_label_offset: float = Field(
        default=5.0,
        ge=0,
        description="Gap between a landmark dot and its index label, device px.",
    )
    hand_label_font_size: int = Field(
        default=10, gt=0, description="Per-hand handedness label size, px."
    )
    hand_label_offset: float = Field(
        default=12.0,
        ge=0,
        description="Gap between the wrist and its handedness label, device px.",
    )
    label_max_samples: int = Field(
        default=4,
        gt=0,
        description="Above this many overlaid samples, per-point and per-hand text labels are "
        "suppressed: a thousand overlapping glyphs inform nobody and cost a great deal to lay "
        "out. The skeleton itself is always drawn.",
    )

    reference_color: str = Field(
        default="#78909C",
        description="Colour of the coordinate-space reference (frame box / origin crosshair).",
    )
    reference_width: float = Field(
        default=1.0, gt=0, description="Reference-geometry line width, device px."
    )
    reference_font_size: int = Field(
        default=9, gt=0, description="Reference annotation label size, px."
    )
    show_reference: bool = Field(
        default=True,
        description="Draw the per-space reference geometry (FR-010 legibility). The reference is "
        "never included in ``bounds``, so it cannot influence what the view fits.",
    )

    base_opacity: float = Field(
        default=1.0, gt=0, le=1.0, description="Opacity for a single selected sample."
    )
    min_opacity: float = Field(
        default=0.15,
        gt=0,
        le=1.0,
        description="Floor for the falloff, so a large overlay never fades to nothing.",
    )

    zoom_step: float = Field(default=1.25, gt=1.0, description="Multiplier per zoom action.")
    min_zoom: float = Field(
        default=0.1,
        gt=0,
        description="Smallest allowed view scale, **as a multiple of the fitted scale**. "
        "Deliberately not an absolute scene-to-device factor: model space is unit-scale, so the "
        "fitted transform is already on the order of 1000x and an absolute window would reject "
        "it — which silently disabled both zoom directions.",
    )
    max_zoom: float = Field(
        default=50.0,
        gt=0,
        description="Largest allowed view scale, as a multiple of the fitted scale.",
    )
    fit_margin: float = Field(
        default=0.05, ge=0, description="Fraction of the bounds added as padding when fitting."
    )
    min_bounds_span: float = Field(
        default=1e-3,
        gt=0,
        description="Minimum bounding-box span, so fitting a single point cannot divide by zero.",
    )

    @model_validator(mode="after")
    def _check_ranges(self) -> VisualizationConfig:
        """Reject configurations that are internally contradictory."""
        if self.min_opacity > self.base_opacity:
            raise ValueError("min_opacity must not exceed base_opacity.")
        if self.min_zoom >= self.max_zoom:
            raise ValueError("min_zoom must be less than max_zoom.")
        if not self.min_zoom <= 1.0 <= self.max_zoom:
            # The limits are multiples of the fitted scale, so 1.0 *is* the fitted
            # view. A range excluding it would make "Fit" unreachable by zooming.
            raise ValueError("The zoom range must contain 1.0, the fitted scale.")
        return self


class WindowConfig(BaseModel):
    """Main-window geometry and titling."""

    title: str = Field(default="Mudra Studio", description="Window title.")
    initial_width: int = Field(default=1440, gt=0, description="Initial window width, px.")
    initial_height: int = Field(default=900, gt=0, description="Initial window height, px.")
    splitter_ratios: tuple[int, int, int] = Field(
        default=(2, 3, 3),
        description="Relative widths of the pose/sample column, canvas, and metadata column.",
    )
    empty_catalog_message: str = Field(
        default="No poses recorded",
        description="Shown in the pose tree when the dataset holds no poses (spec edge case 1).",
    )
    empty_pose_message: str = Field(
        default="No samples recorded for this pose",
        description="Shown when a pose exists but has no samples (FR-021, SC-005).",
    )
    all_skipped_message: str = Field(
        default="No readable samples for this pose",
        description="Distinct from the empty state: files exist but none could be read (FR-022).",
    )
    no_selection_message: str = Field(
        default="Select a sample to view its landmarks",
        description="Shown on the canvas before anything is selected.",
    )

    @model_validator(mode="after")
    def _check_ratios(self) -> WindowConfig:
        """Reject non-positive splitter ratios, which Qt would silently collapse."""
        if any(r <= 0 for r in self.splitter_ratios):
            raise ValueError("splitter_ratios entries must all be positive.")
        return self


class LoggingConfig(BaseModel):
    """Structured logging settings (Loguru).

    Studio-owned, mirroring Engine's model rather than importing it, so the two
    applications can log differently without coupling.
    """

    level: str = Field(default="INFO", description="Minimum log level.")
    format: str = Field(
        default=(
            "<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | "
            "<cyan>{name}</cyan> - <level>{message}</level>"
        ),
        description="Loguru message format.",
    )


class StudioConfig(BaseModel):
    """Root configuration object for Mudra Studio."""

    dataset: DatasetConfig = Field(
        default_factory=DatasetConfig,
        description="Engine's dataset location settings, reused rather than redeclared (D12).",
    )
    visualization: VisualizationConfig = Field(default_factory=VisualizationConfig)
    window: WindowConfig = Field(default_factory=WindowConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    @property
    def poses_root(self) -> str:
        """The resolved ``<root>/<poses_dirname>`` path, as configured."""
        return f"{self.dataset.root}/{self.dataset.poses_dirname}"
