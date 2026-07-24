# Mudra

**AI-powered hand gesture recognition engine, built with computer vision.**

Mudra recognizes hand signs and (in future phases) sequences of them — like magical
seals or martial-arts hand signs — to trigger events, powers, and visual effects. It is
designed to be a generic, reusable engine for games, interactive experiences, AR filters,
and social content. It is **not** tied to any single franchise or gesture set: you build
your own poses, sequences, and interactions.

> **Status — Phase 1 (Live Camera).** This milestone is a clean, extensible foundation, not
> gameplay. It ships a runnable, display-only application that opens the webcam, detects
> hands, draws the 21-point landmark overlay, and shows FPS, handedness, and per-hand
> confidence. Nothing is recorded or persisted yet.

---

## Project Vision

Build the engine bottom-up, so every layer rests on a proven one:

```
Camera → MediaPipe Hands → 21 Landmarks → Normalization → Pose Recording
       → Sequence Recording → Recognition Engine → Events → Gameplay (future)
```

The first objective is a **robust data-collection pipeline**. Everything else builds on it.
Development is governed by a project **[constitution](.specify/memory/constitution.md)**
(architecture-first, coordinates-never-images, recognition-ready interfaces, typed/modeled
clean code, centralized config, and strict scope discipline).

## Architecture

Each concern lives in its own small module behind an explicit interface (Protocol), so any
backend can be replaced independently.

| Layer | Package | Phase 1 role |
|-------|---------|--------------|
| Capture | `app/camera` | `VideoSource` Protocol + `OpenCVCameraSource` |
| Detection | `app/detection` | `HandDetector` Protocol + `MediaPipeHandDetector` (Tasks `HandLandmarker`) |
| Domain model | `app/models` | Neutral value objects (`Landmark`, `HandLandmarks`, `HandDetection`, `FrameDetection`) + hand topology |
| Rendering | `app/visualization` | `FrameRenderer` Protocol + `OpenCVOverlayRenderer` |
| Orchestration | `app/core` | `LiveApp` loop + `FpsMeter` |
| Config | `app/config` | Pydantic `AppConfig` + loader |
| CLI | `app/ui` | Multi-command Typer app |
| Utilities | `app/utils` | Loguru logging setup |

The detector is deliberately behind a Protocol: Phase 1 uses MediaPipe's Tasks
`HandLandmarker`, but any other backend can be dropped in without touching capture,
rendering, or the domain model. The domain value objects are already the
persistence-ready shape later recording phases will serialize.

## Installation

Requires **Python 3.14**.

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

pip install -e ".[dev]"
```

On first run, the MediaPipe hand model (`assets/hand_landmarker.task`, ~7.8 MB) is
downloaded automatically if it is not already present.

## Running

```bash
python -m app.main        # opens the webcam and shows live hand detection
# equivalent to:
mudra run
```

Options:

| Option | Purpose |
|--------|---------|
| `--camera N` | Camera device index (default `0`) |
| `--config PATH` | JSON config file overriding defaults |
| `--log-level LEVEL` | `TRACE`…`ERROR` (default `INFO`) |
| `--no-mirror` | Disable the selfie (mirrored) preview |

Exit any time with **`q`**, **`Esc`**, or by closing the window — the camera is released
cleanly.

## Folder Structure

```
mudra/
├── app/
│   ├── camera/         # VideoSource interface + OpenCV capture
│   ├── config/         # Pydantic configuration + loader
│   ├── core/           # LiveApp loop, FPS meter
│   ├── detection/      # HandDetector interface + MediaPipe backend
│   ├── models/         # Neutral value objects + hand topology
│   ├── ui/             # Typer CLI
│   ├── utils/          # Logging
│   ├── visualization/  # FrameRenderer interface + OpenCV overlay
│   └── main.py         # `python -m app.main` entry point
├── assets/             # ML model assets (auto-downloaded; git-ignored)
├── datasets/
│   ├── poses/          # (Phase 2+) append-only per-pose sample collections
│   └── sequences/      # (Phase 3+) append-only per-sequence sample collections
├── recordings/         # (future) raw recordings
├── tests/              # pytest unit tests
├── specs/              # Spec-Kit specifications, plans, tasks
└── pyproject.toml
```

## Future Roadmap

- **Phase 2 — Pose Recorder**: freeze a detection, name it, append a JSON sample to
  `datasets/poses/<pose_id>/`. Poses carry a stable `pose_id` (plus `display_name`,
  `aliases`, `description`).
- **Phase 3 — Sequence Recorder**: capture ordered frames into
  `datasets/sequences/<sequence_id>/`; sequences reference pose identities.
- **Phase 4 — Dataset Builder**: append-only collections that grow across people, hand
  sizes, distances, rotations, and lighting.
- **Recognition Engine (later)**: similarity matching, Dynamic Time Warping, HMMs, and
  neural approaches (LSTM/GRU/Transformer) behind a pluggable interface.
- **Gameplay, effects, and interactions (later)**: built on top of the recognition engine.

Datasets store **only** normalized landmark coordinates and metadata — never images.

## Contributing

- Read the **[constitution](.specify/memory/constitution.md)** first; it is non-negotiable.
- Keep modules small and single-purpose behind their interfaces; inject dependencies.
- No out-of-scope feature surface: Phase 1 is display-only.
- Every change: type hints, docstrings, no hardcoded config or magic numbers, tests green.
- Run `ruff check`, `ruff format`, and `pytest` before opening a PR.

## Coding Standards

- **Python 3.14**, full type hints, modern idioms.
- **Pydantic** models at validation/serialization boundaries; frozen `dataclasses` for
  internal value objects.
- **SOLID**, small classes and functions, meaningful names, Google-style docstrings.
- **Centralized configuration** (no hardcoded values) and **structured Loguru logging**.
- Tooling: `ruff` (lint + format), `pytest` (tests).

## License

MIT.
