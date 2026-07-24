# Phase 1 Data Model: Live Camera Hand Detection

**Feature**: 001-live-camera-detection | **Date**: 2026-07-24

All entities in this phase are **transient, in-memory value objects** — nothing is persisted
(spec FR-013). They are modeled as frozen, slotted `@dataclass`es (constitution Principle IV:
dataclasses for internal value objects, Pydantic reserved for the config/serialization boundary).
Crucially, this is the **same coordinate shape** that later phases (normalization, pose/sequence
recording) will reuse, so the seam is established now (Principle III).

Module: `app/models/landmarks.py` (unless noted). Constants: `app/models/topology.py`.

---

## Constants — `topology.py`

| Name | Value | Purpose |
|------|-------|---------|
| `HAND_LANDMARK_COUNT` | `21` | The fixed number of landmarks per hand. |
| `LandmarkIndex` | `IntEnum` (WRIST=0 … PINKY_TIP=20) | Named indices — removes magic numbers. |
| `HAND_CONNECTIONS` | `tuple[tuple[int, int], ...]` | Edges of the hand skeleton for drawing. Each pair references two valid landmark indices in `[0, 20]`. |

**Validation rules** (unit-tested, `test_topology.py`):
- Every index in `HAND_CONNECTIONS` is within `[0, HAND_LANDMARK_COUNT)`.
- No self-loops; the connection set matches the standard 21-point hand graph.

---

## `Handedness` (enum)

`str`-valued `Enum`: `LEFT = "left"`, `RIGHT = "right"`, `UNKNOWN = "unknown"`.

- Represents the **physical** hand (see research D3 — value is correct under selfie mirroring).
- `UNKNOWN` is a defensive fallback if a backend omits the label.

---

## `Landmark`

Frozen dataclass — a single tracked point.

| Field | Type | Notes |
|-------|------|-------|
| `x` | `float` | Normalized horizontal position, `[0.0, 1.0]`, in the (already mirrored) frame space. |
| `y` | `float` | Normalized vertical position, `[0.0, 1.0]`. |
| `z` | `float` | Relative depth (approx. wrist-relative); smaller = closer. Not displayed in Phase 1. |
| `visibility` | `float \| None` | Optional; `None` when the backend does not provide it (MediaPipe Hands does not). Reserved for future backends. |

**Behavior**:
- `to_pixel(width: int, height: int) -> tuple[int, int]` — maps normalized `(x, y)` to integer
  pixel coordinates for rendering. Pure; unit-tested.

**Validation**: coordinate range is not hard-clamped (MediaPipe may emit slightly <0 or >1 for
partially out-of-frame points); rendering clips to frame bounds instead. Documented so tests
assert graceful handling rather than rejection.

---

## `HandLandmarks`

Frozen dataclass wrapping the fixed-size set of points for one hand.

| Field | Type | Notes |
|-------|------|-------|
| `points` | `tuple[Landmark, ...]` | MUST contain exactly `HAND_LANDMARK_COUNT` (21) items. |

**Validation rules** (`__post_init__`, unit-tested in `test_landmarks_model.py`):
- `len(points) == 21` → else `ValueError`. This invariant is the contract every downstream phase
  relies on.

**Behavior**:
- `mirrored() -> HandLandmarks` — returns a copy with each `x` replaced by `1 - x`. Pure helper
  for backends that need manual mirroring (not needed by the default path, but tested).

---

## `HandDetection`

Frozen dataclass — one detected hand in a frame.

| Field | Type | Notes |
|-------|------|-------|
| `handedness` | `Handedness` | Left/Right/Unknown (physical hand). |
| `confidence` | `float` | MediaPipe's **handedness classification confidence** (the Left/Right label score), `[0.0, 1.0]` (spec FR-008). This is NOT a hand-"detection" score. |
| `landmarks` | `HandLandmarks` | The 21 points. |

**Behavior**:
- `confidence_label` property → `str` formatted as `f"{confidence:.2f}"` (e.g. `"0.98"`) so the
  renderer can show `Left 0.98` (spec FR-008).

---

## `FrameDetection`

Frozen dataclass — the full result of processing one frame. This is the object handed from the
detector to the renderer.

| Field | Type | Notes |
|-------|------|-------|
| `hands` | `tuple[HandDetection, ...]` | 0..2 detected hands (spec FR-004; empty is valid — no hands). |
| `frame_width` | `int` | Pixel width of the frame the detection refers to. |
| `frame_height` | `int` | Pixel height. |
| `timestamp` | `float` | Monotonic capture time (seconds), used by the FPS meter and future recording. |

**Behavior**:
- `hand_count` property → `len(hands)`.
- Empty `hands` is the normal "no hands in frame" case (spec Edge Cases) — never an error.

---

## HUD metrics (no dedicated type)

There is intentionally **no** `FrameMetrics` type. The renderer receives FPS as a plain `float`
(see the `FrameRenderer.render(frame, detection, fps)` contract) and reads per-hand handedness and
confidence directly off `FrameDetection.hands`. Only FPS needs its own accumulator (`FpsMeter`).
Keeping the model this small is deliberate (constitution Principle IV — no placeholder entities).

---

## Relationships

```text
FrameDetection 1 ── * HandDetection 1 ── 1 HandLandmarks 1 ── 21 Landmark
                                              (topology: HAND_CONNECTIONS over indices 0..20)
FpsMeter ──produces──> fps: float  (passed straight to FrameRenderer.render; no FrameMetrics type)
```

## Lifecycle

Created fresh each frame by `MediaPipeHandDetector.detect(frame)`, consumed the same frame by
`OpenCVOverlayRenderer.render(...)`, then discarded. **No instance outlives its frame; nothing is
serialized or written to disk in Phase 1.**

## Forward-compatibility note (Principle III)

`Landmark` / `HandLandmarks` / `HandDetection` are deliberately the persistence-ready shape the
constitution mandates for poses and sequences (x, y, z, optional visibility, per-hand handedness,
21 landmarks). When the recording phases arrive, they add a Pydantic serialization layer over
these same objects — they do not redefine them.

Per constitution 1.1.0, that future serialization layer writes **append-only sample collections**,
not one file per pose: `datasets/poses/<pose_id>/sample_NNNN.json` and
`datasets/sequences/<sequence_id>/sample_NNNN.json`. Each pose carries stable identity metadata
(`pose_id`, `display_name`, `aliases`, `description`), and samples/sequences reference `pose_id`
rather than a human-readable name. None of this is built in Phase 1 (display-only, FR-013); it is
recorded here so the Phase-1 value objects remain the seam those phases extend without rework.
