# Phase 0 Research: Live Camera Hand Detection

**Feature**: 001-live-camera-detection | **Date**: 2026-07-24

This document resolves the open technical decisions for Phase 1 and records the rationale so the
design stays aligned with the Mudra constitution (modular boundaries, extensibility, scope
discipline).

---

## D1 — MediaPipe API: Tasks `HandLandmarker` (UPDATED at implementation)

**Decision**: Use the MediaPipe **Tasks** `HandLandmarker` (VIDEO mode) as the Phase-1 backend,
wrapped by `MediaPipeHandDetector` behind the `HandDetector` Protocol.

**Why this changed from the original plan**: the original decision was the legacy
`mediapipe.solutions.hands.Hands` API. During implementation on Python 3.14, the installed
MediaPipe build (0.10.35) exposes **only** the Tasks API — `mediapipe.solutions` is absent
(`import mediapipe as mp; dir(mp) == [Image, ImageFormat, tasks]`). The legacy API is therefore
not available and the Tasks API is the supported path. Because detection sits behind the
`HandDetector` Protocol, this was a localized single-module change with no ripple into capture,
rendering, or the domain model — exactly the extensibility the architecture was designed for
(constitution Principle III).

**Rationale**:
- `HandLandmarker` returns per hand: 21 normalized `hand_landmarks` (x, y, z), and
  `handedness` categories with `category_name` (Left/Right) + `score` — the handedness
  classification confidence surfaced by FR-007/FR-008.
- VIDEO mode (`detect_for_video(image, timestamp_ms)`) fits the real-time loop; the adapter
  guarantees a strictly increasing millisecond timestamp.
- MediaPipe's mirrored-input (selfie) assumption still applies (see D3): feeding the
  already-mirrored frame yields physically-correct handedness with no landmark remapping.

**Model asset**: the Tasks API needs `hand_landmarker.task` (~7.8 MB). `resolve_model_path`
looks for `assets/hand_landmarker.task` (relative to the repo root) and, if absent, downloads
it once from the official Google storage URL — so `python -m app.main` still runs with zero
manual setup (SC-001). The file is git-ignored (`assets/*.task`).

**Note on `model_complexity`**: the Tasks API has no `model_complexity` parameter (the `.task`
file fixes complexity). The field is retained in `DetectionConfig` as a backend-agnostic knob
(0 = fastest) for legacy/alternate backends but is not consumed by this backend.

**Alternatives considered**:
- **Legacy `mediapipe.solutions.hands`**: unavailable in the installed build — no longer an option.
- **Raw model inference (ONNX/TFLite directly)**: far more code, no benefit at this phase.

**Risk / follow-up — RESOLVED**: MediaPipe wheel availability on Python 3.14 was the open risk.
Verified during implementation: `opencv-python` 5.0.0 and `mediapipe` 0.10.35 both install and
import on Python 3.14.6; the detector loads the model and processes frames successfully.

---

## D2 — Backend-agnostic rendering

**Decision**: Draw the overlay ourselves in `visualization/opencv_overlay.py` using OpenCV
primitives (`cv2.circle`, `cv2.line`, `cv2.putText`) driven by **our own** `FrameDetection` data
model and our own `HAND_CONNECTIONS` topology constant — not `mp.solutions.drawing_utils`.

**Rationale**:
- Decouples visualization completely from MediaPipe (constitution Principle I). The renderer
  consumes the neutral data model, so it keeps working if the detector backend changes.
- The 21-point connection topology is a fixed, well-known graph; defining it once in
  `models/topology.py` removes a hidden dependency and a source of magic numbers (Principle IV).
- Gives us direct control over the HUD (FPS, per-hand handedness + confidence) in the same pass.

**Alternatives considered**:
- `mp.solutions.drawing_utils.draw_landmarks`: convenient but re-couples visualization to
  MediaPipe proto types and its styling; rejected for coupling.

---

## D3 — Mirroring (selfie view) and handedness correctness

**Decision**: Flip each captured frame horizontally **first** (`cv2.flip(frame, 1)`), then run
detection and draw on that already-mirrored frame. Report handedness exactly as MediaPipe
returns it.

**Rationale**:
- Spec FR-014 requires a selfie-mirrored preview so the user's motion matches the screen.
- MediaPipe Hands documents that it *assumes the input image is mirrored* (front/selfie camera).
  By feeding it the flipped frame, the returned `Left`/`Right` label already corresponds to the
  user's **physical** hand — satisfying FR-007/FR-014 with no landmark-coordinate remapping and
  no manual label swapping.
- Because landmarks are produced in the same (mirrored) coordinate space we display, the overlay
  aligns to the hand directly (SC-002) with no extra transform.
- A `VisualizationConfig.mirror` flag (default `True`) keeps this configurable (Principle V) and
  testable; a pure `mirror_x(normalized_x) -> 1 - x` helper is unit-tested for the case where a
  future backend needs manual mirroring.

**Alternatives considered**:
- Detect on the raw frame, then flip frame + landmark x for display and swap the handedness
  label manually: more moving parts and an easy off-by-one in label logic; rejected.

---

## D4 — FPS measurement

**Decision**: `core/fps_meter.py` computes FPS from a rolling window of recent frame timestamps
(a fixed-size `collections.deque`), reporting the smoothed rate = (window size − 1) / elapsed.

**Rationale**: A rolling average avoids the jitter of instantaneous 1/Δt while staying responsive
(spec US2: "updates as performance changes"). Pure function of injected timestamps → fully unit
testable with a fake clock (Principle IV), no wall-clock flakiness. Window size is a named config
value, not a magic number.

**Alternatives considered**: Exponential moving average (fine, but window average is simpler to
reason about and assert in tests); instantaneous 1/Δt (too jittery for a readable HUD).

---

## D5 — Capture loop, window, and clean shutdown

**Decision**: `core/live_app.py` runs a single-threaded loop: read frame → mirror → detect →
render → `cv2.imshow` → `cv2.waitKey(1)`. Exit when the key is `q` (113) or `Esc` (27), or when
`cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1` (window closed via X). Shutdown always
runs in a `finally` block: release the `VideoSource` and `cv2.destroyAllWindows()`, then log a
shutdown line.

**Rationale**: Single-threaded is sufficient for ≥15 FPS at this scope and is the simplest
correct design (Principle VI / YAGNI). The `finally` guarantees the camera is released even on
error (spec FR-010, SC-005, FR-012). Key codes and the window name are named constants
(Principle IV). Startup/shutdown lines satisfy FR-011; per-frame logging stays at TRACE/DEBUG
(Principle V).

**Alternatives considered**: A capture thread + processing thread pipeline — unnecessary
complexity for Phase 1, deferred until a phase actually needs it.

---

## D6 — Configuration & logging

**Decision**: Centralize all tunables in a Pydantic v2 `AppConfig` composed of `CameraConfig`
(index, width, height, target FPS), `DetectionConfig` (max_num_hands=2, `model_complexity=0` as the
default to maximize FPS for the real-time requirement, min_detection_confidence,
min_tracking_confidence — all configurable), `VisualizationConfig` (mirror, colors, HUD toggles),
and `LoggingConfig` (level, format). `config/loader.py` builds it from defaults, with optional
overrides (env / file) reserved. Logging is configured once via Loguru in `utils/logging.py`.

**Rationale**: No hardcoded thresholds or camera settings at call sites (Principle V); validated,
typed config catches bad values early (Principle IV). Reserving detection-confidence and future
model settings in config aligns with the constitution's "future model settings" slot.

**Alternatives considered**: `argparse`/plain dict config (no validation, drifts) — rejected in
favor of Pydantic per constitution.

---

## D7 — CLI shape (multi-command with default callback)

**Decision**: A **multi-command** Typer app in `ui/cli.py`. It registers `run` as a subcommand
(options `--camera`, `--config`, `--log-level`, `--no-mirror`, all config-backed) AND defines a
callback with `invoke_without_command=True` that dispatches to the same run logic when no
subcommand is given. `app/main.py` exposes the same Typer object (`app = cli.app`) and the
console script `mudra = "app.main:app"` points at it, so `python -m app.main`, `python -m app.main
run`, and `mudra run` are all identical. Future commands are reserved but NOT implemented
(Principle VI): `record-pose`, `record-sequence`, a `dataset` group (`info`, `validate`), a
`camera` group (`info`), and `doctor`.

**Rationale**: This is the official command architecture (constitution 1.1.0). The callback is the
concrete mechanism that keeps the bare entry point equal to `mudra run` as the command surface
grows. Typer gives typed options and help for free (Principle IV).

---

## Summary of resolved unknowns

| # | Unknown | Resolution |
|---|---------|------------|
| D1 | Which MediaPipe API | Legacy Solutions Hands behind `HandDetector` Protocol; Tasks API = future swap |
| D2 | How to draw overlay | Own OpenCV renderer over neutral data model + own topology constant |
| D3 | Mirroring + handedness | Flip frame first, detect on flipped frame, report handedness as-is |
| D4 | FPS calculation | Rolling-window average with injected clock, unit-tested |
| D5 | Loop / shutdown | Single-thread loop; `finally` releases camera; q/Esc/window-close exit |
| D6 | Config & logging | Pydantic `AppConfig` + Loguru, no hardcoded values |
| D7 | CLI | Typer `run` implemented; other commands reserved names only |

No remaining NEEDS CLARIFICATION items.
