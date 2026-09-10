# Phase 1 Data Model: Mudra Studio — Dataset Explorer

**Feature**: `006-studio-dataset-explorer` | **Date**: 2026-08-18 | **Plan**: [plan.md](./plan.md)

Studio owns **no persisted data model**. Every dataset entity is Engine's, loaded through Engine's
own serializer (FR-019, research [D2](./research.md#d2--the-enginestudio-boundary-and-the-constitution-amendment-it-requires)); the
types below are the *view-side* and *derived* models Studio adds on top of them. Nothing here is
ever written to disk (FR-017).

All Studio types are **frozen, slotted dataclasses** with type hints on every field, matching
Engine's domain style (`apps/engine/models/pose.py`) and constitution Principle IV.

---

## 1. Reused from Engine — imported, never redefined

These are consumed as-is from `engine.models.*`. Studio does not wrap, copy, or re-declare them.

| Type | Module | Role in this feature |
|---|---|---|
| `PoseSample` | `engine.models.pose` | The atomic unit the sample list and metadata panel display. |
| `Pose` | `engine.models.pose` | `pose_id` (identity), `display_name`, `description` — FR-006. |
| `HandSample` | `engine.models.pose` | One hand: handedness, confidence, `raw` and `normalized` landmark sets. |
| `HandMeta` | `engine.models.pose` | Per-hand summary inside `PoseMetadata.hands`. |
| `PoseMetadata` | `engine.models.pose` | Timestamp, camera index/width/height, versions, `num_hands`, capture timing — FR-006. |
| `CaptureTiming` | `engine.models.pose` | Countdown start, capture time, countdown seconds. Optional (`None` on pre-countdown samples). |
| `NormalizationInfo` | `engine.models.pose` | `strategy`, `version` — FR-006, FR-015. |
| `HandLandmarks` | `engine.models.landmarks` | The 21-point invariant, enforced in `__post_init__`. |
| `Landmark` | `engine.models.landmarks` | `x`, `y`, `z`, optional `visibility`. |
| `Handedness` | `engine.models.landmarks` | `LEFT` / `RIGHT` / `UNKNOWN` — drives FR-008 colouring. |
| `HAND_CONNECTIONS`, `HAND_LANDMARK_COUNT`, `LandmarkIndex` | `engine.models.topology` | The skeleton edges and the 21-point model — FR-007. |
| `DatasetConfig` | `engine.config.models` | Composed into `StudioConfig` — research D12. |

> `Handedness.UNKNOWN` is a real, reachable value (Engine's `from_label` maps any unrecognised
> label to it). The visualization must give it a third colour rather than assuming a binary, and
> statistics must count it separately from left/right — see §4.

---

## 2. Studio domain types

### `CoordinateSpace` (enum)

```text
RAW         → HandSample.raw        — frame-relative, x,y ∈ [0,1], y-down
NORMALIZED  → HandSample.normalized — wrist-centred, scale-normalized, unbounded
```

The single input that FR-010's raw/normalized switch changes. Research
[D6](./research.md#d6--two-coordinate-spaces-one-projection-framework-supplied-fit) covers the
projection consequences.

### `SampleKey`

| Field | Type | Notes |
|---|---|---|
| `pose_id` | `str` | |
| `sample_number` | `str` | The zero-padded stem, e.g. `sample_000023`. Unique within a pose. |

The stable identity used for selection sets, emphasis mappings, and scene-item lookup. `sample_uuid`
is *displayed* (FR-006) but is not the key: `sample_number` is what the repository assigns and what
orders the list.

### `SkippedSample`

| Field | Type | Notes |
|---|---|---|
| `path` | `Path` | The file that could not be read. |
| `reason` | `str` | Human-readable cause from the caught exception. |

Produced per-file by the gateway (research D4). Its presence drives FR-022's visible indication.

### `PoseLoadResult`

| Field | Type | Notes |
|---|---|---|
| `pose_id` | `str` | |
| `samples` | `tuple[PoseSample, ...]` | Valid samples only, ordered by `sample_number`. |
| `skipped` | `tuple[SkippedSample, ...]` | Empty when everything parsed. |

The gateway's return type. **Invariant**: a failure to read one file never removes another file
from `samples` and never raises out of the load (FR-022).

### `LoadedPose`

| Field | Type | Notes |
|---|---|---|
| `pose` | `Pose` | Identity + labels, taken from the first valid sample (research D3). |
| `samples` | `tuple[PoseSample, ...]` | |
| `skipped` | `tuple[SkippedSample, ...]` | |
| `statistics` | `PoseStatistics` | Derived once at load; see §4. |

Derived properties: `sample_count`, `has_samples`, `skipped_count`.

**States** — the three the Dataset page must render distinctly:

| State | Condition | UI (FR-021, FR-022) |
|---|---|---|
| *Populated* | `samples` non-empty | Normal list, statistics, visualization. |
| *Empty* | `samples` empty, `skipped` empty | Empty state: "No samples recorded for this pose." Never a blank panel or an error. |
| *All-skipped* | `samples` empty, `skipped` non-empty | Empty state **plus** the skipped banner — distinct from *Empty*, because the cause is different. |

### `PoseCatalogEntry` / `PoseCatalog`

| Field | Type | Notes |
|---|---|---|
| `pose_id` | `str` | Directory name under `datasets/poses/`. |
| `display_name` | `str \| None` | `None` until the pose is loaded; the tree falls back to `pose_id`. |
| `sample_file_count` | `int` | Counted from filenames — **not** parsed. Cheap enough to show in the tree for every pose at startup. |

`PoseCatalog` is `tuple[PoseCatalogEntry, ...]`, ordered by `pose_id`. Feeds the pose tree (FR-003).

> `sample_file_count` is a *file* count and may exceed `LoadedPose.sample_count` when files are
> skipped. The tree shows the file count; the statistics panel shows the valid count. They are
> allowed to differ, and that difference is itself the FR-022 signal.

---

## 3. Selection and view state

### `DatasetViewState`

| Field | Type | Default | Requirement |
|---|---|---|---|
| `selected_pose_id` | `str \| None` | `None` | FR-004 |
| `selected_samples` | `frozenset[SampleKey]` | `frozenset()` | FR-012 |
| `coordinate_space` | `CoordinateSpace` | `RAW` | FR-010 |
| `show_landmark_indices` | `bool` | `False` | FR-009 |
| `emphasis` | `Mapping[SampleKey, EmphasisLevel]` | `{}` | FR-018 |

**Transitions** — the only rules that govern this state:

| Event | Effect |
|---|---|
| Select pose *P* (different from current) | `selected_pose_id = P`; **`selected_samples` cleared**; `emphasis` cleared; view reset to fit. `coordinate_space` and `show_landmark_indices` persist as user preferences. (FR-014) |
| Select pose *P* (already current) | No-op. Re-selecting must not clear a multi-selection. |
| Select sample(s) | `selected_samples` replaced with the new set. No I/O — samples are already loaded (research D5). |
| Toggle coordinate space | `coordinate_space` flipped; scene rebuilt; **selection preserved** (FR-010, and FR-013's "all selected samples redraw consistently"). |
| Toggle indices | `show_landmark_indices` flipped; scene rebuilt; selection preserved (FR-009). |
| Zoom / pan / reset / fit | Viewport transform only. **Never** touches this state — the view transform is not part of the data model (FR-011). |

**Invariant**: every `SampleKey` in `selected_samples` and in `emphasis` has
`pose_id == selected_pose_id`. FR-014's clear-on-pose-change is what maintains it.

---

## 4. `PoseStatistics` — derived, pure, never persisted

Computed by a pure function over a `LoadedPose`'s valid samples. Satisfies FR-015/FR-016.

| Field | Type | Derivation |
|---|---|---|
| `sample_count` | `int` | Number of **valid** samples. |
| `hand_observation_count` | `int` | `Σ len(sample.hands)` — ≥ `sample_count`, since a sample may hold two hands. |
| `left_hand_count` | `int` | Hand observations with `Handedness.LEFT`. |
| `right_hand_count` | `int` | Hand observations with `Handedness.RIGHT`. |
| `unknown_hand_count` | `int` | Hand observations with `Handedness.UNKNOWN`. |
| `average_confidence` | `float \| None` | Mean confidence over **hand observations**, not samples. `None` when there are none. |
| `first_capture` | `str \| None` | Minimum `sample.timestamp` (ISO-8601 UTC sorts lexicographically). |
| `last_capture` | `str \| None` | Maximum `sample.timestamp`. |
| `normalization_strategies` | `tuple[str, ...]` | Distinct `normalization.strategy` values, sorted. |

**Counting rule (the one that is easy to get wrong)**: left/right counts and average confidence are
computed over **hand observations**, not samples. A two-handed sample contributes one left *and*
one right, and two confidence values. `left + right + unknown == hand_observation_count`, which is
the invariant a test should assert.

**Normalization strategy display**: the spec (FR-015) assumes a single strategy per pose. Samples
recorded across an Engine change could disagree, so the field is a tuple: one element renders as
itself, more than one renders as `"mixed (n)"` with the values available on hover. Reporting a
single strategy when two exist would be a quiet lie about the data — precisely the thing this tool
exists to expose.

**Empty pose**: all counts `0`, all optionals `None`. Constructing statistics for a pose with no
samples must not raise — FR-021's empty state renders from a valid, empty `PoseStatistics`.

---

## 5. `ScenePlan` — what to draw, decided before Qt exists

Produced by the pure `build_scene_plan()` (research
[D8](./research.md#d8--split-the-scene-a-pure-sceneplan-then-a-thin-qt-renderer)); consumed by the
Qt renderer, which makes no further decisions.

### `EmphasisLevel` (enum)

`NORMAL` | `HIGHLIGHTED` | `MUTED` — FR-018's extension point. **No code in this milestone
produces anything but `NORMAL`.**

### `ScenePoint`

| Field | Type | Notes |
|---|---|---|
| `index` | `int` | 0–20; the label shown when FR-009's toggle is on. |
| `x`, `y` | `float` | Model-space, in the active `CoordinateSpace`. `z` is not projected (research D6). |

### `SceneHand`

| Field | Type | Notes |
|---|---|---|
| `sample_key` | `SampleKey` | Which sample this hand belongs to. |
| `hand_index` | `int` | Position within `sample.hands`; disambiguates two hands of one sample. |
| `handedness` | `Handedness` | Drives colour — FR-008. |
| `points` | `tuple[ScenePoint, ...]` | Exactly 21, or empty. |
| `edges` | `tuple[tuple[int, int], ...]` | `HAND_CONNECTIONS`, verbatim from Engine — FR-007. |
| `style` | `HandStyle` | Resolved colour, opacity, emphasis. |
| `unavailable_reason` | `str \| None` | Non-`None` ⇒ `points` empty; the renderer draws the "not available in this mode" state instead (research D7). **Reserved seam — currently unreachable.** See the note below. |

> **`unavailable_reason` is a reserved seam and is unreachable under `schema_version` 1.**
> Documented explicitly so nobody spends time hunting for the code path that sets it.
>
> The field exists for a hand whose coordinates are missing in the active `CoordinateSpace`. Under
> schema 1 that cannot happen: `PoseSerializer._hand_from_dict` reads `data["normalized"]`
> unconditionally, so a sample lacking a normalized block raises `PoseSchemaError` **during
> parsing** and is captured as a `SkippedSample` by the gateway (research D7) — it never becomes a
> `SceneHand`, and the renderer never sees it. Missing normalized coordinates are therefore a
> **load-time** concern (FR-022, surfaced by the skipped-sample banner), not a **render-time** one.
>
> It is kept rather than deleted because the branch costs one nullable field and one renderer
> message, and it is the natural landing point if a future schema makes the normalized block
> optional. Constructing it is a **future schema's** job: `build_scene_plan` never sets it today,
> and no test asserts it is reachable — only that the renderer handles it without raising if it
> ever is. Spec Assumptions records the same correction from the requirements side.

### `HandStyle`

| Field | Type | Notes |
|---|---|---|
| `color` | `str` | Hex, resolved from `VisualizationConfig` by handedness (FR-008). |
| `opacity` | `float` | `max(min_opacity, base_opacity / sqrt(n))` for `n` selected samples — FR-013, research D9. |
| `emphasis` | `EmphasisLevel` | FR-018. |

### `ScenePlan`

| Field | Type | Notes |
|---|---|---|
| `hands` | `tuple[SceneHand, ...]` | Every hand of every selected sample. Empty ⇒ renderer shows the no-selection state. |
| `bounds` | `SceneBounds` | Union bounding box in model space; what `fitInView` receives (FR-011). |
| `space` | `CoordinateSpace` | Which space `bounds` and every `ScenePoint` are expressed in. |
| `show_indices` | `bool` | FR-009. |

**Invariants** worth asserting in tests:

- `len(hand.points) in (0, 21)` — never a partial hand (Engine's `HandLandmarks` guarantees 21;
  `0` only accompanies a non-`None` `unavailable_reason`).
- Every `edge` index is `< 21`.
- `bounds` contains every `ScenePoint` of every hand, and is non-degenerate (a minimum span is
  applied) so `fitInView` on a single point cannot divide by zero.
- Single selection ⇒ every `opacity == 1.0`; opacity falls only as the selection grows.

---

## 6. Configuration

`StudioConfig` (Pydantic, validated at startup — Principle V), composing Engine's `DatasetConfig`:

| Section | Key fields |
|---|---|
| `dataset` | **Engine's `DatasetConfig`** — `root`, `poses_dirname`, `filename_prefix`, `filename_digits`. Reused, not redeclared (research D12). |
| `visualization` | `left_hand_color`, `right_hand_color`, `unknown_hand_color`, `highlight_color`, `muted_color`, `point_radius`, `edge_width`, `base_opacity`, `min_opacity`, `index_font_size`, `zoom_step`, `min_zoom`, `max_zoom`, `fit_margin` |
| `window` | `title`, `initial_width`, `initial_height`, `splitter_ratios` |
| `logging` | `level`, `format` — Loguru, mirroring Engine's `LoggingConfig` |

Every number the renderer uses appears in this table. No magic numbers in widget or renderer code
(Principle IV/V). There is **no** `dataset_picker` setting and no folder-picker widget — FR-003a is
enforced by absence (research D12).

---

## 7. Entity relationships

```text
PoseCatalog ──1..*──> PoseCatalogEntry
                            │ pose_id
                            ▼
                      PoseLoadResult ──> LoadedPose ──1──> PoseStatistics   (FR-015)
                                              │
                                  samples ────┴──── skipped                 (FR-022)
                                     │
                                     ▼
                              PoseSample (engine)
                                     │ hands
                                     ▼
                              HandSample (engine)
                                 │        │
                              raw│        │normalized                       (FR-010)
                                 ▼        ▼
                            HandLandmarks (engine) ──21──> Landmark (engine)

DatasetViewState ──┐
LoadedPose ────────┼──> build_scene_plan() ──> ScenePlan ──> LandmarkSceneRenderer ──> QGraphicsScene
StudioConfig ──────┘         (pure, D8)                          (thin, D8)
```

The dashed boundary that matters: everything left of `LandmarkSceneRenderer` is importable and
testable without Qt.
