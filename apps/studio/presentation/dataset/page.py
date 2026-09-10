"""The Dataset page — the one page that works in this milestone.

Owns ``DatasetViewState`` and applies the transitions in data-model §3. The two
that matter:

- Selecting a **different** pose clears the sample selection and the emphasis map
  and refits the view (FR-014).
- Selecting the pose **already current** is a no-op, so re-clicking a pose never
  discards a multi-selection the user has built up.

Also owns the three states a pose can be in — populated, empty, all-skipped —
which are rendered distinctly because their causes differ (FR-021, FR-022).
"""

from __future__ import annotations

from PySide6.QtCore import Qt, QThreadPool
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QSplitter,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from studio.application.build_scene_plan import build_scene_plan
from studio.application.load_pose import LoadPose
from studio.config.models import StudioConfig
from studio.domain.catalog import PoseCatalog
from studio.domain.loading import LoadedPose
from studio.domain.ports import PoseCatalogSource
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey
from studio.presentation.canvas.landmark_view import LandmarkView
from studio.presentation.dataset.loader_task import PoseCache, PoseLoaderTask
from studio.presentation.dataset.metadata_panel import MetadataPanel
from studio.presentation.dataset.pose_tree import PoseTree
from studio.presentation.dataset.sample_list import SampleList
from studio.presentation.dataset.statistics_panel import StatisticsPanel
from studio.presentation.dataset.view_controls import ViewControls
from studio.utils.logging import logger

__all__ = ["DatasetPage"]

_CANVAS_INDEX = 0
_MESSAGE_INDEX = 1


class DatasetPage(QWidget):
    """Pose tree → sample list → canvas + metadata, with statistics."""

    def __init__(
        self,
        config: StudioConfig,
        catalog_source: PoseCatalogSource,
        load_pose: LoadPose,
        *,
        thread_pool: QThreadPool | None = None,
    ) -> None:
        """Assemble the page.

        Args:
            config: All tunables.
            catalog_source: Where the pose list comes from.
            load_pose: The use case that loads one pose.
            thread_pool: Pool for background loads. Defaults to the global pool;
                tests pass their own, or load synchronously.
        """
        super().__init__()
        self._config = config
        self._catalog_source = catalog_source
        self._load_pose = load_pose
        self._pool = thread_pool or QThreadPool.globalInstance()
        self._cache = PoseCache()

        self._state = DatasetViewState()
        self._loaded: LoadedPose | None = None

        self._build_widgets()
        self._connect()
        self._catalog = self.refresh_catalog()

    @property
    def pose_count(self) -> int:
        """How many poses the catalog holds — logged at startup (Principle V)."""
        return len(self._catalog)

    # -- construction --------------------------------------------------------

    def _build_widgets(self) -> None:
        window = self._config.window

        self.pose_tree = PoseTree(window)
        self.sample_list = SampleList()
        self.statistics_panel = StatisticsPanel()
        self.metadata_panel = MetadataPanel()
        self.view_controls = ViewControls()
        self.landmark_view = LandmarkView(self._config.visualization)

        self.skipped_banner = QLabel()
        self.skipped_banner.setWordWrap(True)
        self.skipped_banner.setObjectName("skippedBanner")
        self.skipped_banner.hide()

        self.message_label = QLabel(window.no_selection_message)
        self.message_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.message_label.setWordWrap(True)
        self.message_label.setObjectName("canvasMessage")

        self.canvas_stack = QStackedWidget()
        self.canvas_stack.addWidget(self.landmark_view)  # _CANVAS_INDEX
        self.canvas_stack.addWidget(self.message_label)  # _MESSAGE_INDEX
        self.canvas_stack.setCurrentIndex(_MESSAGE_INDEX)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.addWidget(self.pose_tree, 2)
        left_layout.addWidget(self.sample_list, 3)

        centre = QWidget()
        centre_layout = QVBoxLayout(centre)
        centre_layout.addWidget(self.view_controls)
        centre_layout.addWidget(self.skipped_banner)
        centre_layout.addWidget(self.canvas_stack, 1)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        right_layout.addWidget(self.statistics_panel)
        right_layout.addWidget(self.metadata_panel, 1)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.addWidget(left)
        self.splitter.addWidget(centre)
        self.splitter.addWidget(right)
        for index, ratio in enumerate(self._config.window.splitter_ratios):
            self.splitter.setStretchFactor(index, ratio)

        layout = QHBoxLayout(self)
        layout.addWidget(self.splitter)

    def _connect(self) -> None:
        self.pose_tree.pose_selected.connect(self.select_pose)
        self.sample_list.selection_changed.connect(self.select_samples)
        self.view_controls.space_changed.connect(self.set_coordinate_space)
        self.view_controls.indices_toggled.connect(self.set_show_indices)
        self.view_controls.zoom_in_requested.connect(self.landmark_view.zoom_in)
        self.view_controls.zoom_out_requested.connect(self.landmark_view.zoom_out)
        self.view_controls.reset_requested.connect(self.landmark_view.reset_view)
        self.view_controls.fit_requested.connect(self.landmark_view.fit)

    # -- catalog -------------------------------------------------------------

    def refresh_catalog(self) -> PoseCatalog:
        """Reload the pose list. Parses no sample (research D3)."""
        catalog = self._catalog_source.list_poses()
        self._catalog = catalog
        self.pose_tree.set_catalog(catalog)
        logger.info("Pose catalog loaded: {} pose(s)", len(catalog))
        return catalog

    # -- state transitions (data-model §3) -----------------------------------

    @property
    def view_state(self) -> DatasetViewState:
        """The current view state."""
        return self._state

    @property
    def loaded_pose(self) -> LoadedPose | None:
        """The pose currently in memory, if any."""
        return self._loaded

    def select_pose(self, pose_id: str, *, synchronous: bool = False) -> None:
        """Select ``pose_id``, clearing the sample selection if it changed.

        Re-selecting the current pose is a no-op — it must not discard a
        multi-selection (FR-014, data-model §3).

        Args:
            pose_id: The pose to open.
            synchronous: Load on the calling thread instead of the pool. Used by
                tests, which have no event loop to deliver the signal.
        """
        if pose_id == self._state.selected_pose_id:
            return

        self._state = self._state.select_pose(pose_id)
        self.sample_list.set_samples(())
        self.metadata_panel.clear()

        cached = self._cache.get(pose_id)
        if cached is not None:
            self._on_pose_loaded(pose_id, cached)
            return

        if synchronous:
            self._on_pose_loaded(pose_id, self._load_pose(pose_id))
            return

        task = PoseLoaderTask(self._load_pose, pose_id)
        task.signals.loaded.connect(self._on_pose_loaded)
        task.signals.failed.connect(self._on_pose_failed)
        self._pool.start(task)

    def select_samples(self, keys: frozenset[SampleKey]) -> None:
        """Replace the sample selection. No I/O — the pose is already loaded."""
        self._state = self._state.select_samples(keys)
        self._update_metadata()
        self._rebuild_scene(refit=False)

    def set_coordinate_space(self, space: CoordinateSpace) -> None:
        """Switch raw/normalized and re-render (FR-010, SC-003)."""
        self._state = self._state.with_coordinate_space(space)
        self._rebuild_scene(refit=True)

    def set_show_indices(self, shown: bool) -> None:
        """Toggle the 21 index labels and re-render (FR-009, SC-003)."""
        self._state = self._state.with_indices_shown(shown)
        self._rebuild_scene(refit=False)

    # -- load results --------------------------------------------------------

    def _on_pose_loaded(self, pose_id: str, loaded: LoadedPose) -> None:
        """Apply a completed load, ignoring one the user has navigated away from."""
        if pose_id != self._state.selected_pose_id:
            return

        self._cache.put(pose_id, loaded)
        self._loaded = loaded

        self.sample_list.set_samples(loaded.samples)
        self.statistics_panel.show_statistics(loaded.statistics)
        self._update_skipped_banner(loaded)
        self._apply_pose_state(loaded)

        logger.info(
            "Pose '{}' loaded: {} sample(s), {} skipped",
            pose_id,
            loaded.sample_count,
            loaded.skipped_count,
        )

    def _on_pose_failed(self, pose_id: str, reason: str) -> None:
        """Report a load that failed outright — not a bad sample, a bad directory."""
        logger.error("Pose '{}' could not be loaded: {}", pose_id, reason)
        if pose_id == self._state.selected_pose_id:
            self._show_message(f"Could not load '{pose_id}': {reason}")

    # -- the three pose states (FR-021, FR-022) ------------------------------

    def _apply_pose_state(self, loaded: LoadedPose) -> None:
        """Render the populated, empty, or all-skipped state.

        *Empty* and *All-skipped* look alike but mean different things — nothing
        recorded versus nothing readable — so they say different things.
        """
        window = self._config.window
        if loaded.is_empty:
            self._show_message(window.empty_pose_message)
        elif loaded.is_all_skipped:
            self._show_message(window.all_skipped_message)
        else:
            self._show_message(window.no_selection_message)

    @property
    def canvas_message(self) -> str:
        """The message currently shown in place of the canvas."""
        return self.message_label.text()

    @property
    def is_showing_canvas(self) -> bool:
        """Whether the landmark canvas, rather than a message, is visible."""
        return self.canvas_stack.currentIndex() == _CANVAS_INDEX

    def _show_message(self, text: str) -> None:
        self.message_label.setText(text)
        self.canvas_stack.setCurrentIndex(_MESSAGE_INDEX)

    def _update_skipped_banner(self, loaded: LoadedPose) -> None:
        """Non-modal, never a dialog: a skipped file is information, not an alarm."""
        if not loaded.skipped:
            self.skipped_banner.hide()
            self.skipped_banner.clear()
            return
        names = ", ".join(s.filename for s in loaded.skipped[:3])
        more = "" if loaded.skipped_count <= 3 else f" (+{loaded.skipped_count - 3} more)"
        self.skipped_banner.setText(
            f"{loaded.skipped_count} sample(s) skipped: {names}{more}"
        )
        self.skipped_banner.show()

    # -- rendering -----------------------------------------------------------

    def _update_metadata(self) -> None:
        """Show metadata for a single selection; clear it for none or many."""
        if self._loaded is None or len(self._state.selected_samples) != 1:
            self.metadata_panel.clear()
            return
        key = next(iter(self._state.selected_samples))
        for sample in self._loaded.samples:
            if sample.sample_number == key.sample_number:
                self.metadata_panel.show_sample(sample)
                return
        self.metadata_panel.clear()

    def _rebuild_scene(self, *, refit: bool) -> None:
        """Rebuild the plan and hand it to the canvas. Pure, no I/O (SC-003)."""
        if self._loaded is None or not self._state.selected_samples:
            if self._loaded is not None:
                self._apply_pose_state(self._loaded)
            return

        plan = build_scene_plan(
            self._loaded.samples, self._state, self._config.visualization
        )
        self.canvas_stack.setCurrentIndex(_CANVAS_INDEX)
        self.landmark_view.show_plan(plan, refit=refit)

    def current_scene_plan(self):
        """Build the plan for the current state — used by tests and diagnostics."""
        if self._loaded is None:
            return build_scene_plan((), self._state, self._config.visualization)
        return build_scene_plan(self._loaded.samples, self._state, self._config.visualization)
