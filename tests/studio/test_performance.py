"""SC-007 — several hundred samples, with no perceptible freeze.

The criterion is about *responsiveness*, which is a property of the UI thread,
so the design meets it in two parts: the slow part (parsing) runs on a worker
thread, and everything after it is a pure re-render over objects already in
memory. This test measures both halves of that claim on 500 synthetic samples —
the scale the spec names — using the same generator that builds the ten-sample
fixture for SC-004.

The budgets are generous on purpose. They exist to catch an accidental
quadratic or a re-read per render, not to police milliseconds on a busy machine.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from engine.config.models import DatasetConfig
from engine.dataset.json_repository import JsonPoseRepository
from engine.dataset.serializer import PoseSerializer
from studio.application.build_scene_plan import build_scene_plan
from studio.application.load_pose import LoadPose
from studio.config.models import VisualizationConfig
from studio.domain.selection import CoordinateSpace, DatasetViewState, SampleKey
from studio.infrastructure.engine_dataset.gateway import EngineDatasetGateway

SAMPLE_COUNT = 500
LOAD_BUDGET_SECONDS = 20.0
RENDER_BUDGET_SECONDS = 2.0

VISUALIZATION = VisualizationConfig()


def _load_pose_for(dataset_root: Path) -> LoadPose:
    config = DatasetConfig(root=str(dataset_root))
    repository = JsonPoseRepository(config, PoseSerializer())
    return LoadPose(EngineDatasetGateway(config, repository))


def test_loading_five_hundred_samples_completes_within_budget(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    synthetic_pose(SAMPLE_COUNT, pose_id="big")

    start = time.perf_counter()
    loaded = _load_pose_for(dataset_root)("big")
    elapsed = time.perf_counter() - start

    assert loaded.sample_count == SAMPLE_COUNT
    assert not loaded.skipped
    assert elapsed < LOAD_BUDGET_SECONDS, f"load took {elapsed:.2f}s"


def test_rebuilding_the_scene_for_all_five_hundred_is_fast(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    """The interaction path: a mode toggle must not re-read anything."""
    synthetic_pose(SAMPLE_COUNT, pose_id="big")
    loaded = _load_pose_for(dataset_root)("big")
    keys = frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in loaded.samples)
    state = DatasetViewState(selected_pose_id="big", selected_samples=keys)

    start = time.perf_counter()
    plan = build_scene_plan(loaded.samples, state, VISUALIZATION)
    elapsed = time.perf_counter() - start

    assert len(plan.hands) == SAMPLE_COUNT
    assert elapsed < RENDER_BUDGET_SECONDS, f"scene build took {elapsed:.2f}s"


def test_switching_coordinate_space_performs_no_file_access(
    dataset_root: Path, synthetic_pose: Callable[..., Path], monkeypatch
) -> None:
    """SC-003's "no separate loading step", asserted rather than eyeballed."""
    synthetic_pose(50, pose_id="cached")
    loaded = _load_pose_for(dataset_root)("cached")
    keys = frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in loaded.samples)

    reads: list[str] = []
    original = Path.read_text

    def spy(self: Path, *args, **kwargs):
        reads.append(str(self))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", spy)

    for space in (CoordinateSpace.NORMALIZED, CoordinateSpace.RAW):
        build_scene_plan(
            loaded.samples,
            DatasetViewState(
                selected_pose_id="cached", selected_samples=keys, coordinate_space=space
            ),
            VISUALIZATION,
        )

    assert reads == [], "a mode switch must be a pure re-render"


def test_opacity_stays_above_the_floor_at_five_hundred(
    dataset_root: Path, synthetic_pose: Callable[..., Path]
) -> None:
    """A very large selection may reduce clarity but must still draw something."""
    synthetic_pose(SAMPLE_COUNT, pose_id="big")
    loaded = _load_pose_for(dataset_root)("big")
    keys = frozenset(SampleKey(s.pose.pose_id, s.sample_number) for s in loaded.samples)

    plan = build_scene_plan(
        loaded.samples,
        DatasetViewState(selected_pose_id="big", selected_samples=keys),
        VISUALIZATION,
    )

    assert all(h.style.opacity >= VISUALIZATION.min_opacity for h in plan.hands)
