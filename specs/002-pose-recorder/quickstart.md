# Quickstart & Validation: Pose Recorder

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

Proves Phase 2 end to end and maps each check to spec requirements/criteria. Automated tests
cover the pure logic (normalization, validation, serialization, repository); the
capture→prompt→save GUI/terminal flow is validated manually here.

## Prerequisites

- Phase 1 working (`python -m app.main` shows the live overlay).
- Dependencies installed: `pip install -e ".[dev]"` (no new packages vs Phase 1).

## Run the automated tests

```bash
pytest -q
```

Expected: all pass, including the four new suites:
- `tests/unit/test_normalization.py` — wrist→origin, scale by hand span, translation/scale
  invariance, degenerate (zero-span) fallback.
- `tests/unit/test_pose_validation.py` — rejects 0 hands, ≠21 landmarks, non-finite values;
  accepts valid captures; `pose_id` allow-list + length + path-safety.
- `tests/unit/test_pose_serializer.py` — round-trip equality, stable field order, `schema_version`
  stamped, `sample_uuid`/`sample_number`/`normalization` present, rejects bad/incompatible documents.
- `tests/unit/test_json_repository.py` — first save creates the collection; sequential numbering;
  never overwrites (exclusive create); numbering continues past gaps and across sessions; `count`/
  `list`/`load`.
- `tests/unit/test_recorder.py` — valid detection → saved sample with injected `sample_uuid`,
  `normalization` block, and raw+normalized hands; invalid detection never saves.
- `tests/unit/test_metadata.py` — field-by-field FR-015 reproducibility metadata.
- `tests/unit/test_countdown.py` — the non-blocking countdown timer (fake clock, fires once).
- `tests/unit/test_recording_state.py` — recording lifecycle transitions and illegal-move guards.
- `tests/unit/test_countdown_overlay.py` — the countdown overlay renderer.
- `tests/unit/test_recording_controller.py` — R → countdown → capture at zero, cancellation,
  rejection, and the recorded capture timestamps.
- `tests/unit/test_live_app_recording.py` — live-loop wiring: R arms the countdown without
  blocking, q/Esc cancels instead of exiting.

## Manual validation (record a pose)

```bash
python -m app.main
```

| # | Action | Expected result | Verifies |
|---|--------|-----------------|----------|
| 1 | With a hand in view, press **R** | A "Recording pose in 3 / 2 / 1" overlay counts down over a **still-live** preview; at zero the frame freezes with a "RECORDING" overlay and the terminal asks for `pose_id` | FR-001/002, US1 |
| 2 | Type `open_palm`, Enter; skip display_name/description | Success message with `pose_id`, `sample_number`, and saved path; a structured INFO log line records pose_id/sample_number/sample_uuid/location/elapsed_duration_ms/hand count/normalization strategy; live camera resumes | FR-005/008/016/017, US1 |
| 3 | Open `datasets/poses/open_palm/sample_000001.json` | Human-readable, indented; has `schema_version`, `pose_id`, `sample_uuid`, `sample_number`, `timestamp`, `normalization` (strategy+version), `metadata`, `hands`; each hand has `raw` + `normalized` 21-point arrays; **no image data** | FR-011/012/013/014/020/021, SC-003/006/007 |
| 4 | Record `open_palm` again | New `sample_000002.json`; `sample_000001.json` unchanged | FR-009/010, SC-002, US3 |
| 5 | Inspect the metadata block | Contains timestamp, camera resolution + index, app + mediapipe versions, num_hands, per-hand handedness + confidence | FR-015, SC-003, US3 |
| 6 | Press **R** with no hand in view | "No hands detected"; no file written; live camera resumes | FR-003/004, US2 |
| 7 | Press **R**, then cancel at the `pose_id` prompt | Nothing saved; live camera resumes | FR-007, US2 |
| 8 | Press **R**, enter an invalid id like `Open Palm!` | Rejected with a reason; re-prompt or cancel; no unsafe folder created | FR-006, US2 |
| 9 | Record a second pose `closed_fist` | New collection `datasets/poses/closed_fist/` with `sample_000001.json` | FR-010, US3 |
| 10 | Press **R**, then put **both** hands in view before zero | Sample `hands` array has two entries, left and right stored separately — recordable solo, because the keyboard is only needed to start the countdown | FR-012, US1 |
| 11 | Press **R**, then `q` or `Esc` during the countdown | Countdown disappears, live camera continues, app does **not** exit, no file written | Countdown cancellation |
| 12 | Run with `--config cfg.json` setting `recording.recording_countdown_seconds` to `5` (and `0`) | Countdown lasts 5 s; `0` captures on the next frame | Configurable countdown |
| 13 | Inspect `metadata.capture` in a saved sample | `countdown_start_time`, `capture_time`, and `countdown_seconds` are recorded | Capture timing |

## Done criteria for Phase 2

- `pytest -q` green (four new suites included).
- Rows 1–10 pass on real hardware.
- Only JSON landmark+metadata files exist under `datasets/poses/**`; **zero** image files
  (FR-011/SC-006).
- No sample is ever overwritten (SC-002); numbering is sequential and collision-free (SC-005).
- Every successful recording emits a structured INFO log with `pose_id`, `sample_number`,
  `sample_uuid`, location, `elapsed_duration_ms`, hand count, and normalization strategy (FR-016).
