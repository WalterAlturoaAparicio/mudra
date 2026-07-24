# Tests

## Running

```bash
pytest            # or: pytest -q
```

## What is covered here (automated)

The unit tests in `tests/unit/` cover the **pure logic** the constitution requires to be
tested (Principle IV) — the code whose correctness the whole pipeline depends on, and which
runs without hardware:

- `test_topology.py` — the 21-landmark count and `HAND_CONNECTIONS` validity (in-range
  indices, no self-loops, full coverage).
- `test_landmarks_model.py` — the neutral value objects: the exactly-21 invariant,
  normalized→pixel mapping with clipping, the mirror transform, handedness label parsing,
  and the two-decimal confidence label.
- `test_config.py` — configuration defaults, validation errors, and the loader
  (file + kwargs precedence, `None`-override skipping).
- `test_fps_meter.py` — the rolling-average FPS meter with a fake clock.

These tests do **not** require a camera, a display, or MediaPipe.

## What is validated manually (not here)

The camera capture and MediaPipe detection paths involve real hardware and a GUI window, so
they are validated with the step-by-step matrix in
[`specs/001-live-camera-detection/quickstart.md`](../specs/001-live-camera-detection/quickstart.md)
(launch, overlay tracking, FPS/handedness/confidence HUD, the three clean-exit routes, and
the no-camera error path).
