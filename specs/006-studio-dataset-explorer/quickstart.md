# Quickstart: Mudra Studio — Dataset Explorer

**Feature**: `006-studio-dataset-explorer` | **Plan**: [plan.md](./plan.md)

How to run Mudra Studio and validate that this milestone actually works. Every scenario below maps
to a numbered requirement or success criterion, so "done" is checkable rather than felt.

---

## Prerequisites

| | |
|---|---|
| Python | ≥ 3.14 (repository floor, `pyproject.toml`) |
| Dataset | The repo's bundled `datasets/poses/` — currently 18 poses, 1–3 samples each |
| Display | A real desktop session. Qt widget tests run headless; the app does not. |
| Governance | Constitution **v1.5.0** — ratified 2026-08-18; the Constitution Check passes |

## Setup

```bash
# From the repository root, in the project's virtualenv
pip install -e ".[studio,dev]"
```

The `studio` extra installs PySide6 (research [D1](./research.md#d1--desktop-ui-toolkit-pyside6-qt-6)).
Engine's own runtime dependencies are unchanged — a CLI-only install never pulls in Qt.

> **Python 3.14 is confirmed supported** (research risk R2, closed 2026-08-18). PySide6 6.11.2 ships
> `cp310-abi3` stable-ABI wheels declaring `Requires-Python: >=3.10,<3.15` and classifying 3.14
> explicitly; `PySide6-Essentials`, `PySide6-Addons`, `shiboken6`, and `pytest-qt` all resolve for
> `cp314`/`win_amd64`. **Note the `<3.15` ceiling** — Python 3.15 is not supported by the current
> PySide6 release, so the `studio` extra pins `PySide6>=6.11,<7` and the interpreter stays on 3.14.

## Run

```bash
mudra-studio
# or, equivalently
python -m studio.main
```

Expected: one window, opening on the Dataset page with the pose tree populated. Startup logs a
structured Loguru line naming the resolved dataset root and the pose count; shutdown logs a
matching line (Principle V).

---

## Validation scenarios

### 1 · Inspect a single sample — User Story 1 (P1)

1. In the pose tree, select **`dog`** (3 samples, and its first sample has **two hands** — the
   two-handed case from the spec's edge cases).
2. Select `sample_000001`.

| Check | Requirement |
|---|---|
| The sample list shows every sample for the pose | FR-004 |
| Both hands render — 21 points and 21 skeleton edges each | FR-007 |
| Left and right hands are visually distinct | FR-008 |
| Metadata panel shows **all** of: pose id, display name (`perro`), description, timestamp, sample UUID, sample number, handedness, confidence, normalization strategy, application version, camera metadata, capture metadata, schema version | FR-006, SC-002 |
| Reaching this view took two selections (pose, then sample) | SC-001 |

### 2 · Coordinate modes and index labels

1. Toggle **Normalized**. 2. Toggle back to **Raw**. 3. Toggle landmark indices.

| Check | Requirement |
|---|---|
| The drawing updates with no loading step and no re-selection | FR-010, SC-003 |
| Raw mode places the hand where it sat in the camera frame; normalized mode centres it on the wrist | research D6 |
| Indices 0–20 appear and disappear on each of the 21 points | FR-009 |
| Selection survives every toggle | data-model §3 |

### 3 · Zoom, pan, reset, fit

| Check | Requirement |
|---|---|
| Zoom in/out, pan by dragging, reset, and fit-to-viewport all work | FR-011 |
| The hand never stretches — aspect ratio is preserved at every zoom level | FR-011 |
| Zoom clamps at the configured min/max instead of running away | data-model §6 |

### 4 · Multi-sample overlay — User Story 2 (P2)

1. On `dog`, select all 3 samples. 2. Switch to **Normalized**.

| Check | Requirement |
|---|---|
| All selected samples render at once, semi-transparently | FR-013 |
| Overlapping regions stay distinguishable | FR-013 |
| Every selected sample redraws in the new mode | FR-013 (scenario 2) |
| Variation between samples is visibly readable in normalized mode | SC-004 |

> With only 1–3 samples per pose today, SC-004's 10-sample benchmark cannot be met from the real
> dataset. Validate it against the synthetic fixture in scenario 8, or after recording more samples
> through Capture.

### 5 · Pose switching clears selection

1. With several `dog` samples selected, select **`ok`** in the tree.

| Check | Requirement |
|---|---|
| The previous multi-selection is cleared | FR-014 |
| The visualization shows only the new pose's data | FR-014 |
| Statistics update to `ok` | FR-016 |

### 6 · Statistics — User Story 3 (P3)

Select `dog` and read the statistics panel without opening any sample.

| Check | Requirement |
|---|---|
| Shows sample count, left-hand count, right-hand count, average confidence, first capture, last capture, normalization strategy | FR-015 |
| `left + right + unknown == total hand observations` — for `dog`, a two-handed sample contributes to both | data-model §4 |
| Panel updates on every pose change | FR-016 |

### 7 · Shell and placeholders — User Story 4 (P4)

| Check | Requirement |
|---|---|
| The rail lists Dataset, Capture, Recognition, Training, Calibration, Settings | FR-001 |
| Each non-Dataset entry says it is not yet implemented | FR-002 |
| No placeholder offers a control that looks interactive | FR-002 |
| No placeholder errors or appears functional | User Story 4 |

### 8 · Edge cases

Each of these has a scripted test; the manual pass confirms the *presentation*, not just the logic.

| Scenario | How to produce it | Expected | Requirement |
|---|---|---|---|
| Pose with zero samples | `mkdir datasets/poses/zzz_empty` (remove afterwards) | Clear empty state — not a blank panel, not an error | FR-021, SC-005 |
| Corrupt sample | Copy a pose to a temp root, truncate one sample's JSON, point `StudioConfig.dataset.root` at the copy | Remaining samples load; a visible banner reports one skipped | FR-022 |
| No poses at all | Point the config at an empty directory | "No poses recorded" empty state, no crash | spec edge case |
| Two-handed sample | `dog` / `sample_000001` | Both hands drawn, each coloured by handedness | FR-007, FR-008 |
| Several hundred samples | Generate 500 synthetic samples into a `tmp_path` root | Browsing, selecting, and overlaying stay responsive with no freeze | SC-007 |

> Never corrupt or delete a file inside the real `datasets/poses/`. Use a temporary copy — the
> dataset is the project's ground truth, and SC-006 is about keeping it that way.

### 9 · Read-only guarantee — SC-006

```bash
# Before the session
git status --porcelain datasets/    # expect: no output
# … run a full exploration session: browse every pose, open samples, overlay, toggle modes …
git status --porcelain datasets/    # expect: no output
```

The automated equivalent hashes the whole `datasets/poses` tree before and after a scripted session
and asserts byte-for-byte equality (contracts/studio-ports.md, "Read-only guarantee").

---

## Automated checks

```bash
pytest tests/studio                        # Studio's suite
pytest                                     # full repository suite — engine tests must stay green
ruff check apps/studio                     # lint (line-length 100, Google docstrings)
ruff format --check apps/studio
```

Headless Qt, for CI or a session without a display:

```bash
QT_QPA_PLATFORM=offscreen pytest tests/studio
```

Most of the suite does not need this: per research
[D8](./research.md#d8--split-the-scene-a-pure-sceneplan-then-a-thin-qt-renderer), the catalog,
gateway, statistics, and `ScenePlan` layers import no Qt at all and test as plain Python.

---

## Definition of done

| | |
|---|---|
| ☑ | Constitution **v1.5.0** ratified 2026-08-18 (Studio milestone + Engine-as-library) |
| ☐ | Scenarios 1–9 pass by hand |
| ☐ | `pytest` green across the whole repository, engine tests included |
| ☐ | `ruff check` / `ruff format --check` clean on `apps/studio` |
| ☐ | Type hints on every function, method, and public attribute; docstrings on public modules, classes, and functions |
| ☐ | No magic numbers in renderer or widget code — every tunable in `StudioConfig` |
| ☐ | **Zero changes under `apps/engine/`** (FR-023) — verify with `git diff --stat apps/engine` |
| ☐ | **Zero changes under `datasets/`** (FR-017, SC-006) — verify with `git status --porcelain datasets/` |
| ☐ | No training, export, editing, capture, or recognition surface introduced (FR-024) |
| ☐ | `apps/studio/README.md` written; root `README.md` lists Studio in the monorepo layout |
