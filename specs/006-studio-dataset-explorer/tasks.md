---

description: "Task list for 006-studio-dataset-explorer"
---

# Tasks: Mudra Studio — Dataset Explorer

**Input**: Design documents from `/specs/006-studio-dataset-explorer/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks **are** included. This is not the template's optional case — constitution
Principle IV makes pytest coverage of data models and I/O mandatory, and the plan's definition of
done requires a green repository-wide suite.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1–US4)
- Every task names an exact file path

## Path Conventions

New application at `apps/studio/` (four layers: `domain/` → `application/` →
`infrastructure/` / `presentation/`); tests in the repository-root `tests/studio/` tree, matching
the existing `tests/unit/` convention. `pyproject.toml`'s `pythonpath = ["apps", "."]` already makes
`studio` importable, exactly as it makes `engine` importable — no test configuration changes.

> **Two rules bind every task below.** No task may edit any file under `apps/engine/` (FR-023), and
> no task may create, modify, or delete anything under `datasets/` (FR-017, SC-006). T060 and T061
> verify both mechanically.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: unblock the feature governance-wise and technically, and stand up the skeleton.

- [X] T001 ✅ **DONE 2026-08-18.** Amended `.specify/memory/constitution.md` from v1.4.0 to **v1.5.0** — Principle VI gains the "Mudra Studio — Milestone 1: Dataset Exploration" authorization (read-only exploration; training, export, editing, capture, and recognition explicitly withheld), and the Monorepo section reclassifies Engine as the repository's shared platform library under four MUSTs (one direction only / consume-never-touch / declare the surface / Engine only), with the JSON-schema-only contract preserved for independent application pairs. Sync Impact Report updated. **Plan Constitution Check now PASSES; the gate is unblocked.**
- [X] T002 ✅ **DONE 2026-08-18 — PySide6 is compatible with Python 3.14; no fallback needed.** Verified by explicit wheel resolution for `cp314`/`win_amd64`: PySide6 6.11.2, PySide6-Essentials, PySide6-Addons, and shiboken6 all ship `cp310-abi3` stable-ABI wheels declaring `Requires-Python: >=3.10,<3.15` with an explicit `Python :: 3.14` classifier; pytest-qt 4.5.0 is `py3-none-any`. Recorded in [research.md](./research.md) under "R2 resolution". **Decision recorded in place of the former ambiguous fallback**: the interpreter stays at **3.14** and the `studio` extra pins **`PySide6>=6.11,<7`**; the `<3.15` ceiling means a future move to Python 3.15 must re-verify this table before it proceeds. Environment prerequisite, since resolved: **CPython 3.14.7** is installed and the project is installed into `.venv` with `pip install -e ".[studio,dev]"`; PySide6 **6.11.2** imports and runs
- [X] T003 [P] Update `pyproject.toml`: add `[project.optional-dependencies] studio = ["PySide6>=6.11,<7"]` (the pin decided in T002), add `pytest-qt` to the `dev` extra, extend `[tool.hatch.build.targets.wheel] packages` with `"apps/studio"`, add `mudra-studio = "studio.main:main"` to `[project.scripts]`, and extend `[tool.ruff] src` with `"apps/studio"`
- [X] T004 Create the `apps/studio/` package skeleton — `domain/`, `application/`, `infrastructure/engine_dataset/`, `presentation/shell/`, `presentation/dataset/`, `presentation/canvas/`, `config/`, `utils/` — each with an `__init__.py` carrying a module docstring (ruff `D` rules are enabled repository-wide)
- [X] T005 [P] Create `tests/studio/__init__.py` and `tests/studio/conftest.py` with fixtures: a `tmp_path`-backed dataset root, a valid-sample factory reusing `tests/unit/factories.py` conventions, a corrupt-sample writer, and a parametrizable **`synthetic_pose(n)`** generator that writes `n` valid samples with controlled per-landmark variation — used at `n=10` by T044 (SC-004) and `n=500` by T057 (SC-007), one implementation serving both. **Fixtures write only under `tmp_path`, never under `datasets/`**
- [X] T006 Create `apps/studio/utils/logging.py` — Loguru configuration mirroring `apps/engine/utils/logging.py`, exposing `configure_logging(*, level: str, sink: ...) -> None` that takes **plain typed arguments, not a config object**. This keeps Phase 1 free of any dependency on Phase 2: `StudioConfig.logging` is created in T013 and is passed to this function at the composition root in T024. **`LoggingConfig` is Studio-owned** — declared in `apps/studio/config/models.py` (T013), *not* imported from `engine.config.models`, which [contracts/engine-consumption.md](./contracts/engine-consumption.md) authorizes only for `DatasetConfig` (Principle V)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the Qt-free core every user story reads from — domain types, config, the two Engine
adapters, the pure scene builder, and a minimal window to host a page.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

> **The invariant this phase establishes**: nothing in `domain/` or `application/` imports `PySide6`
> or `engine`. Engine is imported in `infrastructure/engine_dataset/` only; Qt in `presentation/`
> only. T063's lint pass is where that stops being a convention and starts being checked.

### Domain types (data-model.md §2, §3, §5)

- [X] T007 [P] Create `apps/studio/domain/selection.py` — `SampleKey`, `CoordinateSpace`, `EmphasisLevel`, `DatasetViewState` as frozen slotted dataclasses / enums (data-model §2, §3)
- [X] T008 [P] Create `apps/studio/domain/catalog.py` — `PoseCatalogEntry`, `PoseCatalog` (data-model §2)
- [X] T009 [P] Create `apps/studio/domain/loading.py` — `SkippedSample`, `PoseLoadResult`, `LoadedPose` with `sample_count` / `has_samples` / `skipped_count` derived properties (data-model §2)
- [X] T010 [P] Create `apps/studio/domain/statistics.py` — the `PoseStatistics` dataclass only; the computation lands in T045 (data-model §4)
- [X] T011 [P] Create `apps/studio/domain/scene.py` — `ScenePoint`, `HandStyle`, `SceneHand`, `SceneBounds`, `ScenePlan` (data-model §5)
- [X] T012 Create `apps/studio/domain/ports.py` — `PoseCatalogSource` and `PoseSampleSource` as `typing.Protocol`s per [contracts/studio-ports.md](./contracts/studio-ports.md) (depends on T008, T009)

### Configuration

- [X] T013 [P] Create `apps/studio/config/models.py` — `StudioConfig` composing Engine's `DatasetConfig` (the **only** Engine config symbol authorized by [contracts/engine-consumption.md](./contracts/engine-consumption.md)) plus **Studio's own** `VisualizationConfig`, `WindowConfig`, and `LoggingConfig` — the last declared here rather than imported from `engine.config.models`, so Studio's logging settings can diverge from Engine's without touching Engine. Every field from data-model §6, no field omitted (research D12)
- [X] T014 Create `apps/studio/config/loader.py` — `load_studio_config(path=None, **overrides)` following `apps/engine/config/loader.py`'s defaults → JSON file → overrides precedence (depends on T013)
- [X] T015 [P] Create `tests/studio/test_config.py` — validation rejects bad values, `DatasetConfig` composition resolves the bundled `datasets/poses` root, and **no folder-picker setting exists** (FR-003a). Depends on T014

### Infrastructure — the only place `engine` is imported

- [X] T016 Create `apps/studio/infrastructure/engine_dataset/catalog_source.py` — `FilesystemPoseCatalogSource` implementing `PoseCatalogSource`: enumerate pose directories, count files matching the configured prefix/pad width, **parse no JSON**; missing root returns an empty catalog rather than raising (research D3, contracts/studio-ports.md)
- [X] T017 Create `apps/studio/infrastructure/engine_dataset/gateway.py` — `EngineDatasetGateway` implementing `PoseSampleSource`: glob `sample_*.json`, call `JsonPoseRepository.load_path` **per file inside `try/except (PoseSchemaError, PoseRepositoryError, OSError)`**, collect `SkippedSample`s, return a `PoseLoadResult`. **Must not call `list_sample_refs()`, `save()`, or `next_sample_number()`** (research D4, contracts/engine-consumption.md)
- [X] T018 [P] Create `tests/studio/test_catalog_source.py` — ascending `pose_id` order, empty/missing root, zero-sample pose still listed, and an assertion that no sample file is opened during enumeration
- [X] T019 [P] Create `tests/studio/test_dataset_gateway.py` — **FR-022 core**: a corrupt sample among valid ones is skipped with a reason while every other sample survives; `len(samples) + len(skipped)` equals the file count; an unknown `pose_id` returns empty without raising; a sample missing its `normalized` block lands in `skipped` (research D7)

### Application — pure use cases

- [X] T020 Create `apps/studio/application/load_pose.py` — `LoadPose` use case turning a `PoseSampleSource` result into a `LoadedPose`, taking the `Pose` identity from the first valid sample and falling back to `pose_id` when none exists (research D3, D5). Depends on T012, T017
- [X] T021 Create `apps/studio/application/build_scene_plan.py` — the pure `build_scene_plan(loaded_pose, view_state, config) -> ScenePlan`: project the active `CoordinateSpace`, emit 21 points and `HAND_CONNECTIONS` edges per hand (FR-007), resolve colour by `Handedness` including `UNKNOWN` (FR-008), and compute non-degenerate `bounds`. **No `PySide6` import in this file** (research D6, D8). Depends on T011
- [X] T022 [P] Create `tests/studio/test_scene_plan.py` — core invariants from data-model §5: `len(points) in (0, 21)`, every edge index `< 21`, `bounds` contains every point and is non-degenerate for a single-point input, and the three handedness colours are distinct

### Minimal host window

> The full navigation shell is **US4** (P4, deliberately lowest priority). Foundational provides only
> a bare window that can host one page, so US1 is independently deliverable without US4 — T053 later
> upgrades this same window in place.

- [X] T023 Create `apps/studio/presentation/shell/main_window.py` — a `QMainWindow` hosting exactly one central widget, sized from `WindowConfig`. No navigation rail yet
- [X] T024 Create `apps/studio/main.py` — composition root: load config, **call T006's `configure_logging()` with the fields from `StudioConfig.logging`** (this is the single point where the Phase 1 logging module meets the Phase 2 config type), construct the two adapters, inject them into the window, run `QApplication`. Dependencies are **passed explicitly, never imported as singletons** (Principle I). Log the resolved dataset root and pose count at startup and a matching line at shutdown (Principle V). Depends on T006, T014, T016, T017, T023

**Checkpoint**: `mudra-studio` launches an empty window; every non-Qt layer is unit-tested. User story work can now begin.

---

## Phase 3: User Story 1 — Inspect a single recorded sample (Priority: P1) 🎯 MVP

**Goal**: pick a pose, pick a sample, and see its landmarks plus every recorded metadata field —
the loop the whole milestone exists for.

**Independent Test**: launch the app, select a pose with at least one sample, select that sample,
and confirm the landmark drawing and all 13 metadata fields render, with raw/normalized switching,
index labels, and zoom/pan/reset/fit working — with no other story implemented.

### Implementation for User Story 1

- [X] T025 [US1] Create `apps/studio/presentation/dataset/pose_tree.py` — `PoseTree` listing every catalog pose with its file count, falling back to `pose_id` when `display_name` is unknown (FR-003). **Empty-catalog state (FR-003, spec edge case 1)**: when the catalog holds zero poses — a fresh checkout with nothing recorded yet, or a missing dataset root — the tree renders an explicit **"No poses recorded"** message in place of the list. This is a *valid state*, never an error, never an empty box: it is distinct from T033's zero-*samples* state, which is about a pose that exists but has none. The message text is `StudioConfig` data, not a literal (Principle V)
- [X] T026 [US1] Create `apps/studio/presentation/dataset/sample_list.py` — `SampleList` in single-selection mode, ordered by `sample_number` (FR-004). Multi-selection is enabled in T038
- [X] T027 [P] [US1] Create `apps/studio/presentation/dataset/metadata_panel.py` — `MetadataPanel` rendering **all thirteen** FR-006 fields: pose id, display name, description, timestamp, sample UUID, sample number, handedness, confidence, normalization strategy, application version, camera metadata, capture metadata, schema version. `capture` is nullable and renders as "not recorded" rather than blank (FR-006, SC-002)
- [X] T028 [P] [US1] Create `apps/studio/presentation/canvas/scene_renderer.py` — `LandmarkSceneRenderer` turning a `ScenePlan` into `QGraphicsItem`s. **Contains no branch the ScenePlan did not already decide** (research D8); renders `unavailable_reason` as a plain message rather than raising. **That branch is a reserved seam and is unreachable under schema v1** — do not build a producer for it; `build_scene_plan` never sets it (data-model §5, research D7)
- [X] T029 [US1] Create `apps/studio/presentation/canvas/landmark_view.py` — `LandmarkView(QGraphicsView)` wiring `scale()` to zoom (clamped to the configured min/max), `ScrollHandDrag` to pan, `resetTransform()` to reset, and `fitInView(bounds, Qt.KeepAspectRatio)` to fit. **`KeepAspectRatio` is what satisfies "without distorting the landmark proportions"** (FR-011, research D6). Depends on T028
- [X] T030 [US1] Create `apps/studio/presentation/dataset/view_controls.py` — raw/normalized toggle (FR-010) and landmark-index toggle (FR-009), both mutating `DatasetViewState` and triggering a rebuild with **no I/O** (SC-003)
- [X] T031 [US1] Create `apps/studio/presentation/dataset/page.py` — `DatasetPage` assembling pose tree, sample list, metadata panel, and canvas in a `QSplitter`, owning `DatasetViewState` and applying the data-model §3 transitions. Depends on T025–T030
- [X] T032 [US1] Create `apps/studio/presentation/dataset/loader_task.py` — a `QRunnable` running `LoadPose` on `QThreadPool` so a several-hundred-sample pose never blocks the UI thread; the result is cached per `pose_id` for the session (research D5, SC-007). Wire it into `DatasetPage`
- [X] T033 [US1] Add the empty and skipped states to `DatasetPage` — a clear empty state for a pose with zero samples (FR-021, SC-005), a distinct all-skipped state, and a non-modal `SkippedBanner` reporting the skipped count whenever `skipped` is non-empty (FR-022). **Never a dialog, never a blank panel** (data-model §2)
- [X] T034 [P] [US1] Create `tests/studio/test_scene_plan_spaces.py` — raw model space stays within the unit square while normalized space is wrist-centred; both produce 21 points and the full edge set; `show_indices` is carried through to the plan (FR-007, FR-009, FR-010)
- [X] T035 [P] [US1] Create `tests/studio/presentation/test_metadata_panel.py` — every one of the thirteen FR-006 fields is present for a fixture sample, and a `capture: None` sample renders without error (SC-002)
- [X] T036 [P] [US1] Create `tests/studio/presentation/test_dataset_page_states.py` — **four** distinct states each render their own affordance and none raises: populated; **empty catalog** (zero poses — `PoseTree` shows "No poses recorded", the page does not error, and nothing is selected) (FR-003, spec edge case 1, quickstart §8 row 3); pose with zero samples (FR-021, SC-005); and all-skipped (FR-022). Assert the empty-catalog and zero-samples states are **distinguishable from each other**, so a missing dataset root is never mistaken for an empty pose
- [X] T037 [US1] Set `DatasetPage` as the host window's central widget in `main.py` and confirm the startup/shutdown log lines report the resolved root and pose count. Depends on T031, T024

**Checkpoint**: User Story 1 is fully functional and demoable on its own. This is the MVP — quickstart scenarios 1–3 pass.

---

## Phase 4: User Story 2 — Compare multiple samples (Priority: P2)

**Goal**: overlay several samples of one pose, semi-transparently, to see how much the landmarks
vary between recordings.

**Independent Test**: with US1 working, select multiple samples from one pose's list and confirm all
render together at reduced opacity in the same view — verifiable without statistics or any other page.

### Implementation for User Story 2

- [X] T038 [US2] Switch `SampleList` to `QAbstractItemView.ExtendedSelection` and propagate the full selection set into `DatasetViewState.selected_samples` in `apps/studio/presentation/dataset/sample_list.py` (FR-012)
- [X] T039 [US2] Add opacity falloff to `build_scene_plan` in `apps/studio/application/build_scene_plan.py` — `max(min_opacity, base_opacity / sqrt(n))` for `n` selected samples, every coefficient read from `VisualizationConfig`, **no literal in the function** (FR-013, research D9)
- [X] T040 [US2] Thread the `emphasis: Mapping[SampleKey, EmphasisLevel]` parameter through `build_scene_plan` and into `HandStyle`, and honour `HIGHLIGHTED` / `MUTED` in `scene_renderer.py`. `DatasetPage` passes `{}`. **Implement no outlier detection and define no detector interface** — the parameter is the entire extension point (FR-018, research D10)
- [X] T041 [US2] Implement the FR-014 transition in `apps/studio/presentation/dataset/page.py` — selecting a *different* pose clears `selected_samples` and `emphasis` and refits the view, while re-selecting the *current* pose is a no-op that preserves the multi-selection (data-model §3)
- [X] T042 [P] [US2] Create `tests/studio/test_scene_plan_overlay.py` — `n == 1` yields `opacity == 1.0`; opacity decreases monotonically as `n` grows; it never falls below `min_opacity` even at `n == 500` (FR-013, spec assumption on very large selections)
- [X] T043 [P] [US2] Create `tests/studio/test_emphasis.py` — an empty mapping renders every hand `NORMAL`; `HIGHLIGHTED` and `MUTED` resolve to distinct styles; an emphasis key for an unselected sample is ignored rather than raising (FR-018)
- [X] T044 [P] [US2] Create `tests/studio/presentation/test_multi_selection.py` — multi-select renders every selected sample; switching pose clears the selection; switching coordinate space preserves it (FR-013, FR-014). **Plus SC-004 as an executable assertion**: build a synthetic pose of **at least 10 samples** in `tmp_path` (reuse the generator written for T057 — extract it into `tests/studio/conftest.py` as a parametrizable `synthetic_pose(n)` fixture so T044 and T057 share one implementation), select all 10, and assert (a) all 10 samples appear in the resulting `ScenePlan` — `len(plan.hands) == 10 × hands_per_sample`, none silently dropped; (b) every hand's opacity is `>= min_opacity`, so all 10 stay visible rather than fading to nothing; (c) per-landmark spread across the 10 samples is computable from the plan alone, which is what makes "identify which landmarks vary the most" answerable inside the app. **This closes SC-004, which the real dataset cannot exercise** — it has only 1–3 samples per pose (research R4, quickstart §4)

**Checkpoint**: User Stories 1 and 2 both work independently. Quickstart scenarios 4–5 pass.

---

## Phase 5: User Story 3 — Per-pose statistics (Priority: P3)

**Goal**: judge at a glance whether a pose has enough good data, without opening a single sample.

**Independent Test**: select a pose and confirm the statistics panel shows sample count, left/right
counts, average confidence, first/last capture, and normalization strategy — verifiable without
opening any sample.

### Implementation for User Story 3

- [X] T045 [US3] Create `apps/studio/application/compute_statistics.py` — a pure function over a pose's valid samples. **Left/right/unknown counts and average confidence are computed over hand *observations*, not samples**, so a two-handed sample contributes to both; `normalization_strategies` is a sorted tuple of distinct values (FR-015, data-model §4)
- [X] T046 [US3] Attach the computed `PoseStatistics` to `LoadedPose` inside `apps/studio/application/load_pose.py`, so statistics are derived once per load rather than per render (FR-016). Depends on T045
- [X] T047 [US3] Create `apps/studio/presentation/dataset/statistics_panel.py` and mount it in `DatasetPage` — renders all seven FR-015 fields, shows `"mixed (n)"` when more than one normalization strategy is present, and renders a valid all-zero panel for an empty pose rather than raising (FR-015, FR-016, FR-021)
- [X] T048 [P] [US3] Create `tests/studio/test_statistics.py` — the `left + right + unknown == hand_observation_count` invariant; a two-handed sample counts once on each side; average confidence averages observations not samples; an empty pose yields zeros and `None`s without raising; mixed strategies produce a multi-element tuple (data-model §4)
- [X] T049 [P] [US3] Create `tests/studio/presentation/test_statistics_panel.py` — the panel updates when the selected pose changes (FR-016)

**Checkpoint**: all three data-inspection stories work independently. Quickstart scenario 6 passes.

---

## Phase 6: User Story 4 — Navigation shell (Priority: P4)

**Goal**: the six-entry rail that shows the product's future shape without pretending unfinished
features work.

**Independent Test**: launch the app and click every non-Dataset entry; each shows a clear "not yet
available" placeholder, never errors, and never appears functional.

### Implementation for User Story 4

- [X] T050 [US4] Create `apps/studio/presentation/shell/sections.py` — a `NavigationSection` enum (Dataset, Capture, Recognition, Training, Calibration, Settings) plus a section→factory registry (FR-001, research D11)
- [X] T051 [US4] Create `apps/studio/presentation/shell/placeholder_page.py` — one `PlaceholderPage` class holding a single label and **no controls whatsoever**, so FR-002's "offers no non-functional controls that appear interactive" is structural rather than a habit (FR-002)
- [X] T052 [US4] Create `apps/studio/presentation/shell/navigation_rail.py` — the rail widget rendering the registry's entries and emitting section changes
- [X] T053 [US4] Upgrade `apps/studio/presentation/shell/main_window.py` (from T023) to a `QStackedWidget` driven by the registry, with Dataset as the default section. Depends on T050–T052
- [X] T054 [P] [US4] Create `tests/studio/presentation/test_navigation.py` — all six sections are listed; selecting each one succeeds; only Dataset resolves to the real page (FR-001, FR-002)
- [X] T055 [P] [US4] Create `tests/studio/presentation/test_placeholder_page.py` — a placeholder exposes zero enabled interactive widgets (FR-002)

**Checkpoint**: every user story is complete and independently functional. Quickstart scenario 7 passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: the guarantees that span stories, and the mechanical checks that keep them true.

- [X] T056 [P] Create `tests/studio/test_read_only.py` — **SC-006 as an executable assertion**: hash every file under `datasets/poses` before and after a scripted exploration session (load every pose, build scene plans, compute statistics) and assert byte-for-byte equality (FR-017, contracts/studio-ports.md)
- [X] T057 [P] Create `tests/studio/test_performance.py` — using the shared `synthetic_pose(n)` fixture from `tests/studio/conftest.py` (the same generator T044 uses at `n=10`), generate **500** samples into a `tmp_path` root and assert the load-plus-scene-plan path completes within a documented budget. **Never writes to the real dataset** (SC-007, research R4)
- [X] T058 [P] Write `apps/studio/README.md` — what Studio is, how to run it, the four-layer structure, and an explicit "what this milestone deliberately is not" section (FR-024)
- [X] T059 [P] Update the root `README.md` monorepo layout to list `apps/studio/` alongside `apps/engine/` and `apps/capture/`
- [X] T060 Verify `git diff --stat apps/engine` is **empty** — zero Engine modifications (FR-023), and confirm every imported Engine symbol appears in [contracts/engine-consumption.md](./contracts/engine-consumption.md) with nothing from its prohibited list
- [X] T061 Verify `git status --porcelain datasets/` is **empty** after a full manual session (FR-017, SC-006)
- [X] T062 Run `ruff check apps/studio` and `ruff format --check apps/studio` clean, and confirm two invariants by grep across `apps/studio/`:
  - **Layering** — no `PySide6` import under `domain/` or `application/`, and no `engine` import outside `infrastructure/engine_dataset/`
  - **FR-020, embedded rendering** — **zero** matches for `cv2`, `engine.visualization`, `imshow`, `namedWindow`, or `waitKey` anywhere under `apps/studio/`, and no `QWidget` shown outside the main window's own widget hierarchy (no top-level `.show()` on a widget with no parent, other than the `QMainWindow` itself). All visualization stays embedded in Studio's Qt window; **no separate external preview window is ever opened**. Engine's OpenCV visualization path is on [contracts/engine-consumption.md](./contracts/engine-consumption.md)'s prohibited list precisely so this grep can be a one-line check rather than a judgement call
- [X] T063 Run the full repository suite — `pytest` — and confirm the existing `tests/unit/` engine tests are still green and unmodified
- [ ] T064 Walk [quickstart.md](./quickstart.md) scenarios 1–9 by hand on a real display and tick its definition-of-done checklist. **⚠️ THE ONLY TASK STILL OPEN — it requires a physical display and a human, and is deliberately not marked complete.** Scenarios 1–7 and 9 have been executed *headless* against the real 18-pose dataset (`QT_QPA_PLATFORM=offscreen`) and pass; scenario 8's edge cases are covered by `tests/studio/`. What remains genuinely unverified is the **visual** judgement those checks cannot make: that the drawing is legible, that left/right colours read as distinct to the eye, that pan feels right, and that overlaid samples stay distinguishable rather than merging into a wash
- [X] T065 Final scope review — confirm no training, export, sample-editing, camera-capture, or recognition surface was introduced (FR-024); no `datasets/poses` folder picker exists anywhere in `apps/studio/` (FR-003a); and **every visualization is embedded in Studio's own window with no external preview window reachable through any code path** (FR-020) — the human counterpart to T062's grep, checked by walking the running app rather than the source. Verify the delivered surface matches the constitution v1.5.0 Studio Milestone 1 authorization exactly: nothing withheld by that block was built (Principle VI)

---

## Dependencies & Execution Order

### Phase Dependencies

- **T001 (constitution amendment)** blocked everything. ✅ **Cleared 2026-08-18** — v1.5.0 ratified, plan Constitution Check PASS. Implementation is unblocked.
- **T002 (PySide6 on Python 3.14)** gated all Qt code. ✅ **Cleared 2026-08-18** — compatible, `PySide6>=6.11,<7` pinned in T003. The only remaining prerequisite is *environmental*: install a CPython 3.14 interpreter before `pip install -e ".[studio,dev]"`.
- **Setup (Phase 1)**: T003–T006 have no cross-phase dependency. T006 takes plain typed arguments so it does **not** depend on T013's `LoggingConfig`; the two meet only at T024.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phases 3–6)**: all depend on Foundational; then largely parallel (see below).
- **Polish (Phase 7)**: depends on all desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: after Foundational. No dependency on another story. **This is the MVP.**
- **US2 (P2)**: after Foundational, but T038/T041 modify `sample_list.py` and `page.py` from US1, so US2 is best sequenced after US1 rather than truly concurrent with it.
- **US3 (P3)**: after Foundational. T045/T046/T048 are genuinely independent of US1 and US2 — only T047's mounting touches `page.py`. **The most parallelizable story.**
- **US4 (P4)**: after Foundational. T050–T052 and T054–T055 are entirely new files touching no story's code; only T053 modifies the shared `main_window.py`.

### Within Each Story

Domain types → application logic → infrastructure → presentation → wiring. Tests for the pure layers
can be written alongside their subject; presentation tests come after the widget exists.

### Parallel Opportunities

- **Phase 2 domain types T007–T011** — five separate files, fully parallel; the widest parallel block in the plan.
- **Phase 2 tests T015, T018, T019, T022** — parallel with each other once their subjects exist.
- **US1: T027 and T028** — the metadata panel and the scene renderer share no file.
- **US1 tests T034, T035, T036** — fully parallel.
- **US2 tests T042, T043, T044** and **US3 tests T048, T049** and **US4 tests T054, T055** — parallel within each group.
- **Polish T056–T059** — four independent files.
- **Across stories**: with more than one developer, US3's logic (T045, T046, T048) and US4's shell (T050–T052, T054, T055) can proceed alongside US2 without file conflicts.

---

## Parallel Example: Phase 2 domain types

```bash
# Five independent files, no shared state — launch together:
Task: "Create apps/studio/domain/selection.py — SampleKey, CoordinateSpace, EmphasisLevel, DatasetViewState"
Task: "Create apps/studio/domain/catalog.py — PoseCatalogEntry, PoseCatalog"
Task: "Create apps/studio/domain/loading.py — SkippedSample, PoseLoadResult, LoadedPose"
Task: "Create apps/studio/domain/statistics.py — PoseStatistics"
Task: "Create apps/studio/domain/scene.py — ScenePoint, HandStyle, SceneHand, SceneBounds, ScenePlan"
```

## Parallel Example: User Story 1 tests

```bash
Task: "tests/studio/test_scene_plan_spaces.py — raw vs normalized model space, 21 points and edges"
Task: "tests/studio/presentation/test_metadata_panel.py — all thirteen FR-006 fields"
Task: "tests/studio/presentation/test_dataset_page_states.py — populated / empty / all-skipped"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. ~~**T001** — ratify constitution v1.5.0~~ ✅ done; ~~**T002** — PySide6/3.14 check~~ ✅ done. Both gates are clear.
2. Phase 1 Setup (T003–T006) — install CPython 3.14 first, then `pip install -e ".[studio,dev]"`.
3. Phase 2 Foundational (T007–T024) — the Qt-free core plus a bare window.
4. Phase 3 User Story 1 (T025–T037).
5. **STOP and VALIDATE**: quickstart scenarios 1–3. A developer can now open any recorded sample and read every field of it — the milestone's whole reason for existing, delivered.

### Incremental Delivery

| Increment | Adds | Validates |
|---|---|---|
| Setup + Foundational | Qt-free core, both Engine adapters, bare window | `pytest tests/studio` green with no display |
| **+ US1** | Pose tree, sample list, metadata, canvas | Quickstart 1–3 — **MVP** |
| **+ US2** | Multi-select overlay, opacity, emphasis hook | Quickstart 4–5 |
| **+ US3** | Statistics panel | Quickstart 6 |
| **+ US4** | Navigation rail and placeholders | Quickstart 7 |
| **+ Polish** | Read-only and performance guarantees, docs | Quickstart 8–9, full suite |

### Parallel Team Strategy

After Foundational completes: Developer A takes US1 then US2 (they share `page.py` and
`sample_list.py`); Developer B takes US3's pure logic (T045, T046, T048) and US4's shell
(T050–T052, T054, T055) — neither touches US1's files until the two small mounting tasks (T047,
T053), which are sequenced last.

---

## Notes

- **T001 and T002 are complete** (2026-08-18). Constitution **v1.5.0** is ratified — both formerly CONDITIONAL gates are PASS, resolved by the amendment rather than waived, and FR-019 was not changed. PySide6 is confirmed on Python 3.14 with `<3.15` as a newly-recorded ceiling.
- The layering invariant (no Qt in `domain/`/`application/`, no `engine` outside `infrastructure/engine_dataset/`) is what makes most of this suite runnable without a display. T062 checks it mechanically.
- Presentation tests need `QT_QPA_PLATFORM=offscreen` in CI; the rest need nothing.
- Never corrupt or delete a file inside the real `datasets/poses/` — use `tmp_path` copies. The dataset is the project's ground truth, and SC-006 exists to keep it that way.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
