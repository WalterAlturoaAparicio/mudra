---
description: "Task list for Live Camera Hand Detection (Phase 1)"
---

# Tasks: Live Camera Hand Detection

**Input**: Design documents from `/specs/001-live-camera-detection/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Unit tests are included ONLY for pure logic (FPS meter, data model, topology, config)
because constitution Principle IV mandates them for "data models, normalization, and I/O". Camera
and detector I/O are validated manually via `quickstart.md`, not automated tests.

**Organization**: Tasks are grouped by user story (US1 P1, US2 P2, US3 P3) so each is an
independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish have no story label)
- All paths are repo-relative from `D:\desarrollo\mudra\`

## Path Conventions

- Package root is `app/` (matches constitution layout + `python -m app.main`); tests in `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project skeleton and tooling so everything else can be built.

- [x] T001 Create the Phase-1 package tree with `__init__.py` files: `app/`, `app/config/`, `app/models/`, `app/camera/`, `app/detection/`, `app/visualization/`, `app/core/`, `app/ui/`, `app/utils/`, `tests/`, `tests/unit/`, plus empty `assets/` and `datasets/poses/`, `datasets/sequences/`, `recordings/` root placeholders (with `.gitkeep`). NOTE: leave `datasets/poses/` and `datasets/sequences/` as empty roots — the future append-only per-identity collection layout (`datasets/poses/<pose_id>/sample_NNNN.json`, constitution 1.1.0) is created by Phase 2+, not now; Phase 1 writes nothing (FR-013).
- [x] T002 Create `pyproject.toml` at repo root: project metadata (name `mudra`, Python 3.14), Phase-1 runtime deps ONLY — mediapipe, opencv-python, numpy, pydantic, rich, typer, loguru — and `[project.optional-dependencies].dev` (pytest); declare console script `mudra = "app.main:app"`. Do NOT add scipy/pandas/matplotlib in Phase 1 (constitution 1.1.0 — introduced only in the phase that first needs them).
- [x] T003 [P] Configure tooling in `pyproject.toml`: ruff (lint+format) and pytest (`[tool.pytest.ini_options]` with `testpaths=["tests"]`); add `.gitignore` covering `.venv/`, `__pycache__/`, `datasets/`, `recordings/`.

**Checkpoint**: Repo installs (`pip install -e ".[dev]"`) and `pytest` runs (0 tests) without error.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Neutral data model, config, logging, and the interface Protocols that ALL user
stories depend on. No feature behavior yet.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 [P] Implement Loguru setup in `app/utils/logging.py`: `configure_logging(config: LoggingConfig) -> None` with structured format and level; no per-frame INFO (Principle V).
- [x] T005 [P] Implement Pydantic v2 config models in `app/config/models.py`: `CameraConfig` (index, width, height, target_fps), `DetectionConfig` (max_num_hands=2, `model_complexity=0` as the Phase-1 default to maximize FPS, min_detection_confidence, min_tracking_confidence — all configurable), `VisualizationConfig` (mirror=True, colors, hud toggles), `LoggingConfig` (level, format), and composed `AppConfig` — all with sensible validated defaults (research D6, constitution 1.1.0).
- [x] T006 Implement `app/config/loader.py`: `load_config(path: Path | None = None, **overrides) -> AppConfig` building from defaults + optional file/env overrides (depends on T005).
- [x] T007 [P] Implement hand topology constants in `app/models/topology.py`: `HAND_LANDMARK_COUNT=21`, `LandmarkIndex(IntEnum)` (WRIST..PINKY_TIP), and `HAND_CONNECTIONS` tuple (data-model.md).
- [x] T008 [P] Implement the neutral data model in `app/models/landmarks.py`: frozen dataclasses `Landmark` (x,y,z,visibility, `to_pixel()`), `HandLandmarks` (21-count `__post_init__` invariant, `mirrored()`), `Handedness(str, Enum)`, `HandDetection` (handedness, confidence = handedness classification score, landmarks, `confidence_label` → `f"{confidence:.2f}"`), `FrameDetection` (hands, frame_width/height, timestamp, `hand_count`) per data-model.md.
- [x] T009 [P] Define `app/camera/source.py`: `Frame` type alias, `VideoSource` Protocol (open/read/release/width/height/context manager), and `CameraUnavailableError` (contracts/interfaces.md).
- [x] T010 [P] Define `app/detection/detector.py`: `HandDetector` Protocol (detect/close/context manager) per contracts/interfaces.md.
- [x] T011 [P] Define `app/visualization/renderer.py`: `FrameRenderer` Protocol (`render(frame, detection, fps) -> Frame`) per contracts/interfaces.md.
- [x] T012 [P] Unit test `tests/unit/test_topology.py`: all `HAND_CONNECTIONS` indices in `[0,21)`, no self-loops, count invariant (Principle IV).
- [x] T013 [P] Unit test `tests/unit/test_landmarks_model.py`: `HandLandmarks` rejects != 21 points, `to_pixel()` maps correctly, `mirrored()` computes `1 - x` (Principle IV).
- [x] T014 [P] Unit test `tests/unit/test_config.py`: `AppConfig` defaults load, invalid values raise, `load_config` overrides apply (Principle IV).

**Checkpoint**: `pytest -q` green; data model + config + Protocols importable. User stories can begin.

---

## Phase 3: User Story 1 - See my hands detected live (Priority: P1) 🎯 MVP

**Goal**: `python -m app.main` opens the mirrored webcam feed and overlays the 21-point skeleton
on detected hands in real time.

**Independent Test**: Launch the app, place a hand in view, confirm the landmark overlay appears
and tracks motion (quickstart rows 1–3, 8).

### Implementation for User Story 1

- [x] T015 [US1] Implement `OpenCVCameraSource` in `app/camera/opencv_source.py`: `cv2.VideoCapture` wrapper honoring `CameraConfig`; `open()` raises `CameraUnavailableError` on failure; `read()` returns `Frame | None`; `release()` frees the device; context manager (depends on T009).
- [x] T016 [US1] Implement `MediaPipeHandDetector` in `app/detection/mediapipe_detector.py`: wrap the MediaPipe **Tasks** `HandLandmarker` (VIDEO mode) using `DetectionConfig` (the legacy `solutions` API is absent from current builds — research D1); resolve/auto-download the `hand_landmarker.task` model; map output to `FrameDetection` (21-landmark assert, `Handedness` from label, `confidence` from handedness score, timestamp, frame dims) per the mapping table in contracts/interfaces.md; context manager closes the model (depends on T008, T010).
- [x] T017 [US1] Implement landmark drawing in `app/visualization/opencv_overlay.py`: `OpenCVOverlayRenderer.render()` draws each hand's 21 points (`cv2.circle`) and skeleton edges from `HAND_CONNECTIONS` (`cv2.line`) using `Landmark.to_pixel()`; handles 0 hands gracefully; HUD text added in US2 (depends on T007, T008, T011).
- [x] T018 [US1] Implement `LiveApp` core loop in `app/core/live_app.py`: DI constructor (source, detector, renderer, config); `run()` loops read → `cv2.flip` if `config.visualization.mirror` → detect → render → `cv2.imshow` → `cv2.waitKey(1)` with a basic `q` quit; returns exit code (depends on T015, T016, T017).
- [x] T019 [US1] Implement `app/ui/cli.py` as a **multi-command** Typer app: a `run` subcommand plus a callback with `invoke_without_command=True` that dispatches to the same logic as `run` when no subcommand is given (so bare `python -m app.main` == `mudra run`); options `--camera/--config/--log-level/--no-mirror`. Wire `app/main.py` (`app = cli.app`; `if __name__ == "__main__": app()`). The shared run logic builds config, configures logging, constructs `OpenCVCameraSource`/`MediaPipeHandDetector`/`OpenCVOverlayRenderer`, injects into `LiveApp`, and executes it. Reserve (do NOT implement) `record-pose`, `record-sequence`, `dataset` (group: `info`/`validate`), `camera` (group: `info`), `doctor` (depends on T006, T018; contracts/cli.md, constitution 1.1.0).

**Checkpoint**: `python -m app.main` shows the mirrored feed with a live landmark overlay and quits on `q`. MVP is demonstrable.

---

## Phase 4: User Story 2 - Read live detection metrics (Priority: P2)

**Goal**: The running feed shows FPS, and per detected hand its handedness (left/right) and
confidence.

**Independent Test**: With the feed running and a hand in view, confirm an updating FPS readout,
a left/right label, and a confidence value that changes with detection quality (quickstart rows
4–7).

### Implementation for User Story 2

- [x] T020 [P] [US2] Implement `FpsMeter` in `app/core/fps_meter.py`: rolling-window average over a fixed-size `deque` of timestamps, `update(now: float)` and `fps` property; injectable clock (research D4).
- [x] T021 [P] [US2] Unit test `tests/unit/test_fps_meter.py`: feed synthetic timestamps, assert smoothed FPS and behavior on the first/underfilled window (Principle IV).
- [x] T022 [US2] Extend `OpenCVOverlayRenderer` in `app/visualization/opencv_overlay.py` to draw the HUD: FPS (top corner) and, per hand, its `Handedness` label + handedness-classification confidence rendered as `Left 0.98` / `Right 0.96` (via `HandDetection.confidence_label`) near the hand, using `VisualizationConfig` toggles/colors (FR-006/007/008) (depends on T017, T020).
- [x] T023 [US2] Integrate `FpsMeter` into `LiveApp` in `app/core/live_app.py`: inject the meter, `update()` each frame with the monotonic clock, pass smoothed `fps` into `renderer.render(...)` (depends on T018, T020).

**Checkpoint**: Feed displays FPS plus per-hand handedness and confidence for one or two hands.

---

## Phase 5: User Story 3 - Exit cleanly (Priority: P3)

**Goal**: `q`/`Esc`/window-close all end the session cleanly, releasing the camera; camera
failures produce a clear message and clean exit.

**Independent Test**: Trigger each exit path and confirm the window closes, the process ends with
no traceback, and the camera is immediately reusable; launch with no camera and confirm a clean
error (quickstart rows 9–13).

### Implementation for User Story 3

- [x] T024 [US3] Harden shutdown in `app/core/live_app.py`: define named key constants (`q`=113, `Esc`=27) and a window name; exit on those keys or when `cv2.getWindowProperty(..., WND_PROP_VISIBLE) < 1`; wrap the loop in `try/finally` that releases the source, closes the detector, and calls `cv2.destroyAllWindows()`; emit explicit startup and shutdown log lines (FR-009/010/011, SC-005; research D5) (depends on T018).
- [x] T025 [US3] Handle camera-unavailable path in `app/ui/cli.py` (and/or `LiveApp.run`): catch `CameraUnavailableError`, log a clear human-readable message via Loguru/rich, return a non-zero exit code with no traceback (FR-012, SC-006) (depends on T019, T024).

**Checkpoint**: All three exit routes are clean; missing-camera launch is graceful. All user stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, project-wide quality, and validation.

- [x] T026 [P] Write a professional `README.md`: project vision, architecture, installation, running (`python -m app.main`), folder structure, future roadmap, contributing guidelines, and coding standards (constitution Documentation requirement).
- [x] T027 [P] Add `tests/README.md` explaining unit vs. manual (quickstart) validation, and ensure `pytest -q` is green.
- [x] T028 Verify MediaPipe wheel availability on Python 3.14; if unavailable, pin the supported interpreter/version in `pyproject.toml` and note it in README (research D1 risk) — no change to any module other than `pyproject.toml`.
- [x] T029 [P] Docstring + type-hint + lint pass across `app/` (ruff clean, public modules/classes/functions documented) per constitution Principle IV.
- [ ] T030 Execute the `quickstart.md` manual validation matrix (rows 1–13) on real hardware; confirm ≥15 FPS (SC-003) and that no files are written during a run (FR-013). PARTIAL: automated-verifiable rows done in a headless env — row 13 (no-camera → clear message, exit 1, no traceback: FR-012/SC-006) ✅; detector loads model + processes frames on Python 3.14 ✅; renderer draws overlay + HUD ✅. REMAINING (needs a webcam + display): rows 1–12 (live overlay tracking, FPS≥15, handedness/confidence HUD, the three clean-exit routes).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–5)**: all depend on Foundational. US1 is the MVP; US2 and US3 both
  extend the same `LiveApp`/renderer produced by US1, so they run after US1 (US2 and US3 are
  largely independent of each other and touch mostly different code paths).
- **Polish (Phase 6)**: after the desired user stories are complete.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. Delivers the runnable MVP.
- **US2 (P2)**: builds on US1's `LiveApp` and renderer (adds FPS meter + HUD).
- **US3 (P3)**: builds on US1's `LiveApp` (adds robust exit + error handling).

### Within Each Story

- Concrete `VideoSource`/`HandDetector`/`FrameRenderer` implementations before `LiveApp` wiring.
- `LiveApp` before the CLI that injects into it.
- Pure-logic tests can be written alongside their module and MUST pass at the checkpoint.

### Parallel Opportunities

- Setup: T003 is `[P]`.
- Foundational: T004, T005, T007, T008, T009, T010, T011 and the tests T012–T014 are `[P]`
  (different files); T006 waits on T005.
- US2: T020 and T021 are `[P]`.
- Polish: T026, T027, T029 are `[P]`.

---

## Parallel Example: Foundational Phase

```bash
# After Setup, launch these together (different files, no interdependencies):
Task: "T004 Loguru setup in app/utils/logging.py"
Task: "T005 Pydantic config models in app/config/models.py"
Task: "T007 Topology constants in app/models/topology.py"
Task: "T008 Neutral data model in app/models/landmarks.py"
Task: "T009 VideoSource Protocol in app/camera/source.py"
Task: "T010 HandDetector Protocol in app/detection/detector.py"
Task: "T011 FrameRenderer Protocol in app/visualization/renderer.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup.
2. Phase 2: Foundational (blocks everything).
3. Phase 3: US1 → `python -m app.main` shows the mirrored feed + landmark overlay.
4. **STOP and VALIDATE** with quickstart rows 1–3, 8. This is a demonstrable MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → landmark overlay (MVP).
3. US2 → add FPS + handedness + confidence HUD.
4. US3 → add clean shutdown + camera-error handling.
5. Polish → README, lint/docstrings, quickstart validation.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` label maps each task to its user story for traceability.
- Nothing is persisted in this phase (FR-013); no `datasets/`/`recordings/` writes at runtime.
- Keep the real-time loop free of INFO-level per-frame logging (constitution Principle V).
- Commit after each task or logical group; stop at any checkpoint to validate a story.
