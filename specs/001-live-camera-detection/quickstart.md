# Quickstart & Validation: Live Camera Hand Detection

**Feature**: 001-live-camera-detection | **Date**: 2026-07-24

This guide proves Phase 1 works end to end. It maps each spec success criterion and user story to
a concrete check. Automated tests cover the pure logic; the camera/detector path is validated
manually here (it needs real hardware).

## Prerequisites

- Python 3.14 with a virtual environment.
- A connected, non-busy webcam and a desktop display.
- Dependencies installed from `pyproject.toml`:

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1   |   bash: source .venv/bin/activate
pip install -e ".[dev]"
```

## Run the automated tests (pure logic)

```bash
pytest -q
```

Expected: all pass. Covers `FpsMeter` (rolling average with a fake clock), the 21-landmark
invariant and `mirror_x` transform, the `HAND_CONNECTIONS` topology validity, and config
loading/validation. See `tests/unit/`.

## Launch the application

```bash
python -m app.main
```

Expected in under 10 seconds (SC-001): a window opens showing the **mirrored** live webcam feed,
with a startup log line printed (resolved config summary).

## Manual validation checklist

Each row ties a visible check to a spec requirement/criterion.

| # | Action | Expected result | Verifies |
|---|--------|-----------------|----------|
| 1 | Launch with no arguments | Live window appears in < 10 s, no config prompts | SC-001, FR-001/002, US1 |
| 2 | Raise one hand into view | 21 points + skeleton overlay appear on the hand and track motion | FR-003/005, SC-002, US1 |
| 3 | Move the hand around | Overlay stays aligned; motion on screen matches your motion (mirrored) | SC-002, FR-014 |
| 4 | Read the HUD | FPS value shown and updating; it reads ≥ 15 on a normal laptop | FR-006, SC-003, US2 |
| 5 | Check the hand's label | "Left"/"Right" shown = your **physical** hand (mirror-correct) | FR-007, FR-014, US2 |
| 6 | Check the confidence | The handedness classification confidence is shown per hand as `Left 0.98` and changes as you partially leave frame | FR-008, US2 |
| 7 | Show both hands | Each hand labelled + has its own confidence, independently | FR-004, SC-004, US2 |
| 8 | Remove hands from view | Feed continues smoothly, HUD stays, no overlay, no error | Edge case (no hands), US1.3 |
| 9 | Press `q` | Window closes, process exits cleanly, no traceback | FR-009/010, SC-005, US3 |
| 10 | Press `Esc` (relaunch first) | Same clean exit | FR-009, US3 |
| 11 | Click the window's X button | Same clean exit | FR-009, US3 |
| 12 | Relaunch immediately after exit | Camera opens again (was released) | SC-005, US3 |
| 13 | Unplug/disable the camera, launch | Clear message printed, clean non-zero exit, no traceback | FR-012, SC-006, edge case |

## Configuration spot-checks (optional)

```bash
python -m app.main --no-mirror         # feed no longer mirrored (raw orientation)
python -m app.main --camera 1          # open a second camera index
python -m app.main --log-level DEBUG   # verbose logs (per-frame diagnostics visible)
```

Expected: behavior changes accordingly, confirming values come from centralized config, not
hardcoded call sites (constitution Principle V).

## Done criteria for Phase 1

- Rows 1–13 pass on real hardware.
- `pytest -q` is green.
- No files created under `datasets/`, `recordings/`, or elsewhere during a run (spec FR-013).
- Startup and shutdown log lines are present (FR-011).
