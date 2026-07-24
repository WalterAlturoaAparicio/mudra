# Implementation Plan: Live Camera Hand Detection

**Branch**: `001-live-camera-detection` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-live-camera-detection/spec.md`

## Summary

Deliver a runnable, display-only desktop application that opens the default webcam, detects up
to two hands in real time, overlays the 21-point hand skeleton, and shows FPS, per-hand
handedness, and per-hand confidence, with a clean shutdown. The technical approach establishes
the reusable, swappable module boundaries that all later Mudra phases (pose/sequence recording,
recognition) will build on: a `VideoSource` for capture, a `HandDetector` behind a Protocol
(backed by MediaPipe Hands), a backend-agnostic OpenCV `FrameRenderer`, centralized Pydantic
configuration, and a **multi-command** Typer CLI whose `run` command drives the live loop (a
callback makes bare `python -m app.main` equivalent to `mudra run`). MediaPipe runs with
`model_complexity=0` by default for maximum FPS, overridable via config. Nothing is persisted in
this phase (spec FR-013).

## Technical Context

**Language/Version**: Python 3.14

**Primary Dependencies**: mediapipe (Hands), opencv-python, numpy, pydantic v2, typer, loguru,
rich (console output). Dev/test: pytest. Per constitution 1.1.0, scipy/pandas/matplotlib are
NOT Phase-1 dependencies — they are introduced only in the later phase that first needs them.

**Storage**: None — display-only phase. No files written (constitution Principle II /
spec FR-013). The coordinate-only JSON storage model applies to later recording phases.

**Testing**: pytest — unit tests for the pure logic (FPS meter, coordinate/mirror transform,
data-model construction and the 21-landmark invariant, configuration loading/validation).
Camera and detector I/O are validated manually via `quickstart.md`.

**Target Platform**: Local desktop with an attached webcam and a display (Windows / macOS /
Linux). Headless operation is out of scope (spec Assumptions).

**Project Type**: Single project — a desktop CLI application (`app/` package, `python -m app.main`).

**Performance Goals**: Sustain ≥ 15 FPS end-to-end (capture → detect → render → display) on a
typical consumer laptop with an integrated webcam (spec SC-003). Landmark overlay aligned ≥ 95%
of visible time (SC-002).

**Constraints**: Real-time loop must not log per-frame at INFO+ (constitution Principle V);
clean shutdown must release the camera and destroy windows (spec FR-010, SC-005); no data
persistence; startup/shutdown log lines required (FR-011).

**Scale/Scope**: Single local user, single default camera, up to 2 hands per frame.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Architecture-First & Modular Boundaries | Camera, detection, visualization, config each isolated behind explicit interfaces (`VideoSource`, `HandDetector`, `FrameRenderer`); orchestrator wires them via dependency injection; no global mutable state; small single-purpose modules. | ✅ PASS |
| II. Coordinates, Never Images | Display-only; nothing captured, saved, or exported (FR-013). No persistence code introduced. Data model carries coordinates only. | ✅ PASS |
| III. Extensibility by Design | Detector/camera/renderer are Protocol-based and swappable (MediaPipe → Tasks API or other later). The `HandDetection`/`Landmark` data model is the same shape future normalization/recording/recognition will consume. No recognition/ML behavior implemented, only seams. | ✅ PASS |
| IV. Typed, Modeled, Clean Code | Full type hints; frozen dataclasses for transient value objects, Pydantic for config; SOLID small classes/functions; named constants (landmark topology, key codes) — no magic numbers; pytest on pure logic. | ✅ PASS |
| V. Centralized Config & Structured Observability | Single Pydantic `AppConfig` (camera, detection, visualization, logging); Loguru structured logs with explicit startup/shutdown lines; per-frame diagnostics at DEBUG/TRACE only. | ✅ PASS |
| VI. Scope Discipline (Milestone-Bounded YAGNI) | Only Phase-1 display behavior implemented. `recording/`, `recognition/`, `dataset/`, `normalization/` are NOT built here (seams reserved via the shared data model). No gameplay/effects. | ✅ PASS |

**Result**: All gates pass. No violations → Complexity Tracking table intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-live-camera-detection/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── cli.md           # Typer `run` command contract
│   └── interfaces.md    # VideoSource / HandDetector / FrameRenderer Protocols
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

Only the modules required for Phase 1 are created now. Sibling packages named by the
constitution (`normalization/`, `recording/`, `recognition/`, `dataset/`) are intentionally
deferred to their phases (Principle VI) and are NOT scaffolded here.

```text
app/
├── __init__.py
├── main.py                     # `python -m app.main` entry → invokes the Typer CLI
├── config/
│   ├── __init__.py
│   ├── models.py               # Pydantic: CameraConfig, DetectionConfig, VisualizationConfig,
│   │                           #           LoggingConfig, AppConfig
│   └── loader.py               # load_config() → AppConfig (defaults + optional file/env)
├── models/
│   ├── __init__.py
│   ├── landmarks.py            # Landmark, HandLandmarks (21), Handedness enum, HandDetection,
│   │                           #   FrameDetection (frozen dataclasses)
│   └── topology.py             # HAND_LANDMARK_COUNT=21, HAND_CONNECTIONS, landmark index names
├── camera/
│   ├── __init__.py
│   ├── source.py               # VideoSource Protocol + Frame type
│   └── opencv_source.py        # OpenCVCameraSource (cv2.VideoCapture), context manager
├── detection/
│   ├── __init__.py
│   ├── detector.py             # HandDetector Protocol + DetectionResult mapping contract
│   └── mediapipe_detector.py   # MediaPipeHandDetector → Tasks HandLandmarker → FrameDetection
├── visualization/
│   ├── __init__.py
│   ├── renderer.py             # FrameRenderer Protocol
│   └── opencv_overlay.py       # OpenCVOverlayRenderer: landmarks + skeleton + HUD text
├── core/
│   ├── __init__.py
│   ├── fps_meter.py            # FpsMeter (rolling-average FPS)
│   └── live_app.py            # LiveApp: orchestrates capture→detect→render→display + shutdown
├── ui/
│   ├── __init__.py
│   └── cli.py                  # Multi-command Typer app; callback makes bare `python -m app.main`
│                               #   run the same logic as `mudra run`. `run` implemented;
│                               #   record-pose/record-sequence/dataset/camera/doctor reserved.
└── utils/
    ├── __init__.py
    └── logging.py              # configure_logging(LoggingConfig) via Loguru

assets/                         # hand_landmarker.task (auto-downloaded on first run; git-ignored)

tests/
├── __init__.py
├── unit/
│   ├── test_fps_meter.py
│   ├── test_topology.py            # connection indices valid, 21-count invariant
│   ├── test_landmarks_model.py     # HandLandmarks enforces exactly 21; mirror transform
│   └── test_config.py              # defaults + validation errors
└── README.md                       # how to run tests; camera/detector are manual (quickstart)

pyproject.toml                  # project metadata, deps, tool config (created in Setup phase)
README.md                       # professional project README (constitution requirement)
```

**Structure Decision**: Single-project desktop CLI. The package root is `app/` (not `src/`) to
match the constitution's mandated layout and the `python -m app.main` entry point. Each concern
lives in its own small module behind a Protocol so backends (camera, detector, renderer) are
independently replaceable (Principle I/III). Later phases add sibling packages under `app/`
without modifying Phase-1 modules.

## Complexity Tracking

> No Constitution Check violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
