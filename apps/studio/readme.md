# Mudra Studio

The desktop IDE built on top of Mudra Engine. Milestone 1 is **read-only dataset exploration and
visual inspection** — "VS Code for Mudra datasets".

It answers the question the capture pipeline cannot answer about itself: *is what we recorded
actually any good?* Pick a pose, pick a sample, see the 21 landmarks drawn in raw or normalized
space alongside every field that was recorded with them; overlay several samples to see how much
they vary; read a per-pose summary to judge whether a pose has enough good data.

---

## Running

```bash
# From the repository root, in a Python 3.14 environment
pip install -e ".[studio,dev]"

mudra-studio
# or
python -m studio.main
```

**Python 3.14 is required** (the repository floor) and **PySide6 < 7** is pinned. PySide6 6.11
declares `Requires-Python: >=3.10,<3.15`, so a move to Python 3.15 needs that pin re-verified
first. Qt is an *optional* extra: a CLI-only install of the engine never pulls it in.

## What this milestone deliberately is **not**

Studio's scope is bounded by the project constitution (v1.5.0, Principle VI), which authorizes
exactly the exploration surface above and withholds the rest. This milestone therefore implements:

- **No model training** and no ML of any kind.
- **No dataset export.**
- **No sample editing** — Studio never writes to the dataset. Not a rename, not a reordering, not
  a "fix". The dataset on disk is byte-for-byte identical before and after a session, and
  `tests/studio/test_read_only.py` hashes the whole tree to prove it rather than trusting care.
- **No camera capture.** Recording happens in Mudra Capture on a phone.
- **No pose recognition.**
- **No dataset folder picker.** The dataset root is the repository's bundled `datasets/poses`.
  This is enforced by *absence* — there is no such widget and no such setting — rather than by a
  disabled button.

Each of those needs its own constitutional authorization before any behavior for it is written.
Extension points may exist as type signatures; behavior may not.

The one extension point that does exist is FR-018's: `build_scene_plan` takes an
`emphasis: Mapping[SampleKey, EmphasisLevel]`. A future outlier detector becomes a new *producer*
of that mapping and nothing else changes. There is deliberately **no** `OutlierDetector` protocol —
the mapping's type is the whole extension point.

## Structure

Four layers, dependencies pointing inward only:

```
presentation/  ─┐
                ├─> application/ ──> domain/
infrastructure/─┘
```

| Package | Contents | Imports |
|---|---|---|
| `domain/` | Value objects, view state, `ScenePlan`, the two ports | Neither Qt nor `engine` I/O |
| `application/` | `LoadPose`, `build_scene_plan`, `compute_statistics` | No Qt |
| `infrastructure/engine_dataset/` | `FilesystemPoseCatalogSource`, `EngineDatasetGateway` | **The only package that imports `engine`** |
| `presentation/` | `shell/`, `dataset/`, `canvas/` | **The only place Qt appears** |
| `config/` | Pydantic `StudioConfig` | Composes Engine's `DatasetConfig` |

Two invariants make this more than a diagram, and `tests/studio/test_layering.py` checks both by
parsing the source:

1. **The scene is decided before Qt exists.** `build_scene_plan()` is a pure function producing a
   `ScenePlan`; the renderer turns that into graphics items and makes no decisions. So coordinate
   space, per-hand colour, opacity falloff, emphasis, and the 21-point topology are all asserted by
   plain pytest with no display and no event loop. If you find yourself adding a branch to the
   renderer, it belongs in the plan.
2. **Engine is consumed, never touched.** Studio imports Engine's documented public interfaces
   through two Studio-owned `Protocol`s, so consuming Engine (FR-019) and never modifying it
   (FR-023) hold at the same time. The exact authorized symbol set — and the prohibited one, which
   includes `save()`, `next_sample_number()`, and `list_sample_refs()` — is recorded in
   [`contracts/engine-consumption.md`](../../specs/006-studio-dataset-explorer/contracts/engine-consumption.md).

`list_sample_refs()` is prohibited for a concrete reason worth knowing: it calls `load_path` for
every sample to build its refs, so the first malformed file aborts the whole pose and every
surviving sample gets parsed twice. Studio globs the directory and calls `load_path` per file
inside a `try`/`except`, so one bad file costs exactly one sample and the rest still load.

## Testing

```bash
pytest tests/studio            # Studio's suite
pytest                         # the whole repository
ruff check apps/studio
ruff format --check apps/studio
```

Most of the suite needs no display: the catalog source, gateway, statistics, config, and every
`ScenePlan` rule are Qt-free by design. The thin widget tests force
`QT_QPA_PLATFORM=offscreen` themselves, so a headless machine or CI runner needs no extra setup.

## Documents

The specification, plan, research decisions, data model, contracts, and quickstart live in
[`specs/006-studio-dataset-explorer/`](../../specs/006-studio-dataset-explorer/).
