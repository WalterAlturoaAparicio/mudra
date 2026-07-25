# CLI / UX Contract: Pose Recorder

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

Phase 2 adds **no new CLI command**. Recording is a mode of the existing `run` command, triggered
by the **R** key (matching the brief's "press R" flow). The `record-pose` command name stays
reserved for a future non-interactive/batch path (constitution CLI surface); it is not
implemented here.

## Trigger and flow (within `mudra run` / `python -m app.main`)

```
[live camera running]
        │  user presses  R
        ▼
start countdown (recording.recording_countdown_seconds, default 3)
        │
        │   camera feed KEEPS RUNNING (no sleep, no freeze) with a large
        │   "Recording pose in 3 / 2 / 1" overlay — both hands stay free
        │
        ├─ user presses q / Esc ─► cancel ─► no sample ─► resume live camera
        │
        ▼  countdown reaches zero
capture the current frame automatically  ──►  freeze it + "RECORDING" overlay
        ▼
validate capture (≥1 hand, 21 landmarks each, finite values)
        │
        ├─ invalid ─► print reason (e.g. "No hands detected") ─► resume live camera
        │
        └─ valid ─► terminal prompt: pose_id (required)
                          │  (cancel at any prompt ─► no save ─► resume)
                          ▼
                    terminal prompt: display_name (optional, Enter to skip)
                          ▼
                    terminal prompt: description (optional, Enter to skip)
                          ▼
                    normalize + build sample + repository.save (append-only)
                          ▼
                    print success: pose_id, sample_number, saved location
                          ▼
                    resume live camera
```

## Keys (in `run`)

| Key | Action |
|-----|--------|
| `R` / `r` | Start the pre-capture countdown (ignored while one is already running) |
| `q` / `Esc` | Cancel a running countdown (no sample written); otherwise exit the application |
| window-close | Exit the application (unchanged from Phase 1) |

## Terminal prompts

- **pose_id** — required; re-prompts on invalid input (`^[a-z0-9_]+$`, ≤64 chars) with the reason;
  blank/`Ctrl-C`/cancel token aborts the recording without saving.
- **display_name** — optional; Enter to skip (stored as `null`).
- **description** — optional; Enter to skip (stored as `null`).

## Output / feedback

- **Success**: a clear message naming the `pose_id`, the assigned `sample_number`, and the file
  location; also emitted as a structured INFO log with `pose_id`, `sample_number`, `sample_uuid`,
  location, `elapsed_duration_ms`, hand count, and normalization strategy (FR-016).
- **Rejection**: a specific human-readable reason; no file written; logged as a warning.
- **No image/screenshot** is ever written (FR-011).

## Config surface (defaults; overridable via `--config`)

The recording behavior is governed by `RecordingConfig`, `NormalizationConfig`, and
`DatasetConfig` (see [interfaces.md](./interfaces.md) / research D8) — e.g. dataset root, filename
pattern/width, record key, and the `pose_id` pattern — so nothing is hardcoded.

## Reserved (still NOT implemented)

`record-pose`, `record-sequence`, `dataset info`, `dataset validate`, `camera info`, `doctor` —
unchanged from Phase 1's reserved set. `dataset info`/`validate` will later read the collections
this phase writes.
