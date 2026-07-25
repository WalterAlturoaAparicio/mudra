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

Keys while running:

| Key | Action |
|-----|--------|
| **`R`** | Start the countdown, then record the pose (Phase 2 — see below) |
| **`q`** / **`Esc`** | Cancel a running countdown; otherwise exit |
| close window | Exit; the camera is released cleanly |

## Recording poses (Phase 2)

The Pose Recorder builds a reusable, append-only dataset of hand poses. While the live camera is
running, press **`R`**:

1. A **countdown starts** (3 seconds by default) and a large `Recording pose in 3 / 2 / 1` overlay
   appears. The preview keeps running — it is never frozen — so you can watch yourself and place
   **both** hands, which is impossible when one hand is stuck on the keyboard. Press `q` or `Esc`
   during the countdown to cancel; nothing is written.
2. At zero the frame is captured automatically and freezes with a **RECORDING** indicator.
3. The capture is validated (at least one hand, exactly 21 landmarks each, finite values). Invalid
   captures are rejected with a clear reason and nothing is written.
4. You are prompted in the terminal for a **`pose_id`** (the permanent identifier — lowercase
   letters, digits, and underscores, e.g. `open_palm`) and, optionally, a `display_name` and
   `description`. Press Enter on a blank `pose_id` to cancel.
5. One sample is appended to that pose's collection and the live camera resumes. Existing samples
   are never overwritten.

### Countdown settings

The countdown length is configuration, not code. Set `recording.recording_countdown_seconds` in a
JSON config file and pass it with `--config`:

```json
{ "recording": { "recording_countdown_seconds": 5 } }
```

`0` captures on the very next frame (the old press-and-capture behaviour); the maximum is `60`.
The overlay's color, caption, hint, digit size, and backdrop dimming are configurable under
`visualization` (`countdown_color`, `countdown_prompt`, `countdown_hint`, `countdown_digit_scale`,
`countdown_dim`).

The countdown itself (`app/core/countdown.py`) is a generic, non-blocking timer polled once per
frame — no `sleep()` anywhere — paired with a generic state machine (`app/core/state_machine.py`)
and a workflow-agnostic overlay, so sequence recording, calibration, and benchmark workflows can
reuse all three unchanged.

### Dataset layout

```
datasets/poses/
├── open_palm/
│   ├── sample_000001.json
│   ├── sample_000002.json
│   └── ...
└── closed_fist/
    └── sample_000001.json
```

Each `pose_id` accumulates its own append-only, sequentially numbered samples across sessions and
contributors. Only landmark coordinates and metadata are ever stored — **never images**.

### Sample JSON (schema v1)

Each sample is human-readable, indented JSON:

```json
{
  "schema_version": 1,
  "pose_id": "open_palm",
  "display_name": "Open Palm",
  "description": "Right hand fully open.",
  "sample_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "sample_number": "sample_000001",
  "timestamp": "2026-07-24T13:20:00.123456+00:00",
  "normalization": { "strategy": "translation_scale", "version": "1.0" },
  "metadata": {
    "timestamp": "...",
    "camera": { "index": 0, "width": 1280, "height": 720 },
    "versions": { "application": "0.1.0", "mediapipe": "0.10.35" },
    "num_hands": 1,
    "hands": [ { "handedness": "right", "confidence": 0.98 } ],
    "capture": {
      "countdown_start_time": "2026-07-24T13:19:57.100000+00:00",
      "capture_time": "2026-07-24T13:20:00.123456+00:00",
      "countdown_seconds": 3.0
    }
  },
  "hands": [
    { "handedness": "right", "confidence": 0.98, "raw": [ ... 21 ... ], "normalized": [ ... 21 ... ] }
  ]
}
```

- **`sample_uuid`** is the immutable, globally-unique internal id (used by future
  databases/sync); **`sample_number`** is the sequential, filesystem-friendly stem.
- Each hand stores **both** `raw` detector landmarks and `normalized` landmarks (translation +
  scale: wrist at origin, scaled by hand span). Persisting raw lets the normalization strategy
  change later without re-recording.
- **`metadata.capture`** records when the countdown was armed and when the shutter actually fired
  (debugging and future analytics); it is `null` for samples captured without a countdown.
- Full field-by-field reference: [`specs/002-pose-recorder/contracts/json-schema.md`](specs/002-pose-recorder/contracts/json-schema.md).

## Folder Structure

```
mudra/
├── app/
│   ├── camera/         # VideoSource interface + OpenCV capture
│   ├── config/         # Pydantic configuration + loader
│   ├── core/           # LiveApp loop, FPS meter, countdown timer, state machine, recording port
│   ├── dataset/        # PoseRepository interface + JSON repository + serializer
│   ├── detection/      # HandDetector interface + MediaPipe backend
│   ├── models/         # Neutral value objects, hand topology, pose domain
│   ├── normalization/  # Normalizer interface + translation-scale implementation
│   ├── recording/      # Validation, recorder service, state machine, interactive controller
│   ├── ui/             # Typer CLI
│   ├── utils/          # Logging
│   ├── visualization/  # Renderer interfaces + OpenCV landmark and countdown overlays
│   └── main.py         # `python -m app.main` entry point
├── assets/             # ML model assets (auto-downloaded; git-ignored)
├── datasets/
│   ├── poses/          # append-only per-pose sample collections (Phase 2)
│   └── sequences/      # (Phase 3+) append-only per-sequence sample collections
├── recordings/         # (future) raw recordings
├── tests/              # pytest unit tests
├── specs/              # Spec-Kit specifications, plans, tasks
└── pyproject.toml
```

## Future Roadmap

- **Phase 1 — Live Camera** ✅: real-time detection, landmark overlay, FPS/handedness/confidence.
- **Phase 2 — Pose Recorder** ✅: press **R** to count down, capture, validate, name (`pose_id`),
  and append a human-readable JSON sample to `datasets/poses/<pose_id>/`; raw + normalized
  landmarks, immutable `sample_uuid`, append-only, never images.
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
