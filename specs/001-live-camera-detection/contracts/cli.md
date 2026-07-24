# CLI Contract: Live Camera Hand Detection

**Feature**: 001-live-camera-detection | **Date**: 2026-07-24

Mudra is a **multi-command** Typer application in `app/ui/cli.py`. `app/main.py` exposes the same
Typer object (`app = cli.app`) and runs it under `__main__`, and the console script
`mudra = "app.main:app"` (pyproject) points at the same object — so `python -m app.main` and
`mudra` are the identical CLI.

### Default-command architecture (official, going forward)

The app registers `run` as a normal subcommand AND defines a Typer callback with
`invoke_without_command=True`. When no subcommand is given, the callback dispatches to the exact
same logic as `run` (it forwards the shared options / calls the `run` implementation). Result:

```bash
python -m app.main            # no subcommand → callback runs the SAME logic as `mudra run`
python -m app.main run        # explicit subcommand → identical behavior
mudra run                     # console-script form → identical behavior
```

This callback pattern is the official mechanism that keeps the bare entry point and `mudra run`
consistent as more subcommands are added.

## Implemented command: `run`

Launches the live camera hand-detection loop (the entire Phase-1 feature).

### Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `--camera INTEGER` | int | from config (`0`) | Camera device index to open. |
| `--config PATH` | path | none | Optional config file overriding defaults. |
| `--log-level TEXT` | str | from config (`INFO`) | Loguru level (`TRACE`…`ERROR`). |
| `--no-mirror` | flag | off (mirror on) | Disable selfie mirroring (spec FR-014 default = mirrored). |
| `--help` | flag | — | Typer-generated help. |

### Behavior contract

- With no options, MUST open the default camera and show the live overlay with zero further input
  (spec FR-001/SC-001).
- Emits a startup log line (resolved config summary at INFO) and a shutdown log line (FR-011).
- Exit keys `q` / `Esc` or window-close end the session cleanly, releasing the camera (FR-009/010,
  SC-005). Process exit code `0`.
- If the camera cannot be opened, prints a clear human-readable message (via Loguru/rich) and
  exits with a non-zero code and NO traceback (FR-012, SC-006).

### Outputs

- No files are written (spec FR-013). Only the live window + console/log lines.

## Reserved (NOT implemented in Phase 1)

These names are reserved in structure and documentation only, to match the constitution's CLI
expansion plan (constitution 1.1.0). Invoking them MUST NOT exist yet as working behavior
(Principle VI). They are introduced in their respective future phases. Note `dataset` is a
**command group** with `info` and `validate` subcommands (`mudra dataset info`), and `camera`
is a group with `info` (`mudra camera info`):

| Command | Future phase |
|---------|--------------|
| `record-pose` | Phase 2 — Pose Recorder |
| `record-sequence` | Phase 3 — Sequence Recorder |
| `dataset info` | Phase 4 — Dataset Builder |
| `dataset validate` | Phase 4 — Dataset Builder |
| `camera info` | utility (later) |
| `doctor` | utility (later) — environment/diagnostics self-check |

Documenting them here prevents name churn and signals the intended surface without implementing
out-of-scope behavior.
