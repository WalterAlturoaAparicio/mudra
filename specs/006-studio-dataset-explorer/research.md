# Phase 0 Research: Mudra Studio — Dataset Explorer

**Feature**: `006-studio-dataset-explorer` | **Date**: 2026-08-18 | **Plan**: [plan.md](./plan.md)

This document resolves every `NEEDS CLARIFICATION` raised in the plan's Technical Context and
records the design decisions (**D1–D12**) the Phase 1 artifacts are built on. Each decision states
what was chosen, why, and what was rejected — per the constitution's Governance section, an
alternative that was considered and rejected is recorded rather than silently dropped.

Two decisions (**D1**, **D2**) were escalated to the project owner rather than decided here,
because both are architectural locks for the whole Mudra Studio milestone rather than choices
internal to this feature. Both were confirmed on 2026-08-18 and are recorded below as decided.

---

## D1 — Desktop UI toolkit: PySide6 (Qt 6)

**Decision**: build Mudra Studio on **PySide6**, declared as an *optional* dependency group
(`studio`) in `pyproject.toml` so the engine's own runtime footprint is unchanged for users who
only want the CLI.

**Rationale**:

- The constitution's dependency-footprint rule ("adding one MUST be justified against an existing
  capability first") is satisfied: there is no existing capability in the repository for building a
  desktop window. Engine's only visual surface is OpenCV's `imshow`, which FR-020 explicitly
  forbids here — an OpenCV window is a *separate external window*, not embedded native UI.
- `QGraphicsView` / `QGraphicsScene` supplies, as framework behaviour rather than as code we write,
  precisely the four viewport operations FR-011 requires — `scale()` for zoom,
  `ScrollHandDrag` for pan, `resetTransform()` for reset, and `fitInView(..., KeepAspectRatio)`
  for fit-without-distortion — plus per-item opacity (FR-013) and per-item styling (FR-018).
- `QTreeWidget`, `QListWidget` (`ExtendedSelection`, FR-012), `QSplitter`, and `QStackedWidget`
  give the IDE shell (FR-001/FR-002) natively, so the milestone spends its effort on dataset
  semantics rather than on re-inventing widgets.
- PySide6 is **LGPL**, compatible with this project's MIT license.

**Alternatives rejected**:

| Option | Rejected because |
|---|---|
| **Tkinter** (stdlib, zero new dependencies) | The strictest reading of the footprint rule, and genuinely tempting. But `tk.Canvas` has no view transform: zoom, pan, and fit-to-viewport all become hand-written matrix math, and `Canvas` has no true alpha (stipple patterns only), so FR-013's "reduced opacity so overlapping regions remain distinguishable" cannot be honestly implemented. Cheapest for this feature, most expensive across the Studio milestone. |
| **Dear PyGui** | Strong GPU-accelerated drawing, but a weak tree/list/docking story for an IDE shell, and its immediate-mode model (redraw everything every frame from a global context) fits poorly with the layered, dependency-injected architecture Principle I mandates. |
| **PyQt6** | Functionally equivalent to PySide6, but GPL-or-commercial licensing conflicts with this project's MIT license. |
| **Flet / Kivy / web view** | Each renders through an embedded browser or a custom GL stack, reintroducing exactly the "not native desktop UI in our own window" character FR-020 pushes against, and adding a far larger dependency surface than Qt for a strictly worse fit. |

---

## D2 — The Engine↔Studio boundary, and the constitution amendment it requires

**Decision**: Studio **imports Engine's `engine.models.*` and `engine.dataset.*` modules directly,
read-only**, and touches no other Engine module. This requires a constitution amendment to
**v1.5.0**, which is a prerequisite of this feature rather than part of it.

**The conflict**: constitution v1.4.0's *Monorepo & Cross-Application Boundaries* section states
that the versioned pose-sample JSON schema is "the ONLY contract between applications" and that
"an application MUST NOT import, vendor, or reach into another application's source." Read
literally, that forbids exactly what FR-019 mandates ("MUST consume Mudra Engine's existing
dataset-reading and domain-model logic … rather than re-implementing dataset parsing
independently"). Separately, Principle VI lists Mudra Studio as a later milestone that "must
explicitly authorize" its own scope, which v1.4.0 has not yet done.

**Why the amendment is the right resolution rather than a workaround**: the boundary rule exists to
stop two *peer* applications from coupling to each other's internals — Capture (Flutter/Android)
and Studio (Python/desktop) are such a pair, and the JSON-schema-only rule must keep holding
between them. Engine is not a peer: the spec's own framing is "Mudra Studio, the desktop IDE built
on top of Mudra Engine," and the constitution already describes Engine as "a reusable engine for
games, interactive experiences, AR filters, and social content." Reuse *is* Engine's purpose. The
amendment should therefore reclassify Engine as the repository's shared platform library that
same-language applications MAY import, while leaving the schema-only rule intact for
application↔application pairs.

**What the amendment must cover** (both, or this feature does not pass its gate):

1. Authorize the **Mudra Studio milestone** at this feature's bounds — read-only dataset
   exploration and visualization; explicitly *not* training, export, editing, capture, or
   recognition (FR-024).
2. Reclassify **Engine as the shared platform library**, importable by same-language applications
   in `apps/`, with the JSON-schema-only contract preserved for app↔app pairs.

**Containment, so the import stays cheap to change**: Studio does not scatter `engine.*` imports
through its layers. It defines its own ports in `studio/domain/ports.py` and Engine appears in
exactly one package — `studio/infrastructure/engine_dataset/`. If Engine's API moves, one adapter
moves. This is Principle I's "dependencies flow toward abstractions" applied to a cross-package
dependency, and it is what keeps FR-019 (consume Engine) and FR-023 (never modify Engine)
satisfiable at the same time.

**Alternatives rejected**:

| Option | Rejected because |
|---|---|
| Studio parses sample JSON itself | Directly violates FR-019, and guarantees schema drift between the reader and `PoseSerializer` — the exact failure the versioned-schema rule exists to prevent. |
| Extract a shared `packages/mudra-core` now | The constitution forbids it: "A shared package is justified only when the same logic has independently appeared in two applications and drifted." It has not. Engine *is* the shared code; moving it would be churn for no behavioural gain. |
| Reinterpret "application" to exclude Engine, no amendment | Leaves the governance text contradicting the code, and still does not authorize the Studio milestone under Principle VI. Considered and declined by the project owner in favour of the amendment. |

---

## D3 — Pose discovery: Studio enumerates directories, Engine still does every parse

**Decision**: `EngineDatasetGateway` enumerates pose directories under
`<dataset.root>/<dataset.poses_dirname>/` with `Path.iterdir()`, and delegates **every byte of
parsing** to Engine's `JsonPoseRepository.load_path()` / `PoseSerializer`.

**Rationale**: Engine's `PoseRepository` protocol has no "list all pose ids" operation — it is
keyed by a `pose_id` the caller already knows, because the recorder always does. Studio's entire
premise is *not* knowing the pose ids up front (FR-003). Adding `list_pose_ids()` to Engine would
be the natural fix, but FR-023 forbids modifying Engine in this milestone. Directory enumeration is
filesystem traversal, not dataset parsing; FR-019's requirement is that dataset *reading and domain
modelling* not be re-implemented, and it is not — no JSON is decoded outside Engine.

**Follow-up recorded, not actioned**: this is a genuine gap in Engine's public interface. Studio's
`PoseCatalogSource` port is shaped so that a future, separately-authorized Engine change adding
`list_pose_ids()` is an adapter-only substitution, invisible above `infrastructure/`.

**Also discovered**: pose identity metadata (`display_name`, `description`) is stored per-sample,
not in a collection-level manifest, so a pose's display name is read from its first valid sample.
A pose directory with zero valid samples has no display name available, and falls back to its
`pose_id` — consistent with Principle III's rule that `pose_id` is the identity and the labels are
mutable decoration.

---

## D4 — Fault-tolerant loading: Studio must not use `list_sample_refs()`

**Decision**: `EngineDatasetGateway` globs `sample_*.json` paths itself and calls
`repository.load_path(path)` **per file inside a `try/except (PoseRepositoryError,
PoseSchemaError, OSError)`**, accumulating a `SkippedSample(path, reason)` for each failure
alongside the successfully loaded samples.

**Rationale**: Engine's `JsonPoseRepository.list_sample_refs()` looks like the right entry point
but is unusable here for two independent reasons, both verified against
`apps/engine/dataset/json_repository.py:100-115`:

1. **It is not fault-tolerant.** It loads and deserializes every sample to build the ref list, and
   the first malformed file raises out of the whole call. FR-022 requires the opposite: skip the
   bad sample, keep the rest, and say so. One corrupt file must never hide a pose's other 200.
2. **It parses everything twice.** It fully deserializes each sample only to discard the result and
   keep a `SampleRef`; Studio would then re-load each sample to display it. At several hundred
   samples per pose (SC-007) that is double the I/O for no benefit.

Loading per-path with Engine's own `load_path` keeps FR-019 intact — the parse is still Engine's —
while giving FR-022 the per-file error boundary it needs. The skipped count surfaces in the sample
list as a visible, non-fatal banner, never as a dialog or a silent omission.

---

## D5 — Load the whole pose once, on a worker thread; no virtualization

**Decision**: selecting a pose loads **all** of its samples eagerly, once, on a `QThreadPool`
worker, into an immutable `LoadedPose` cached by `pose_id` for the session. The sample list, the
metadata panel, the statistics panel, and the visualization all read from that in-memory object.

**Rationale**:

- The statistics panel (FR-015) needs every sample anyway, and multi-sample overlay (FR-013) needs
  every *selected* sample's landmarks. Lazy per-sample loading would buy nothing and would make
  selection latency depend on disk.
- With everything already in memory, switching raw↔normalized (FR-010), toggling landmark indices
  (FR-009), and changing the multi-selection (FR-012) are **pure re-renders with no I/O** — which
  is exactly what SC-003 ("visibly instantaneous, no separate loading step") demands.
- The load runs off the UI thread so a several-hundred-sample pose never freezes the window
  (SC-007). The UI shows a loading state on the affected panels only.
- Caching is sound precisely because the application is read-only (FR-017): the dataset cannot
  change underneath the cache as a result of using Studio.
- **No virtualization**, per the spec's clarification. A plain `QListWidget` holds several hundred
  rows without complaint; adding virtualization now would be out-of-milestone complexity that
  Principle VI rejects by default.

**Rejected**: lazy/paged sample loading (solves a problem this milestone does not have, and breaks
SC-003's no-loading-step guarantee); a filesystem watcher to invalidate the cache (out of scope —
nothing in this milestone writes, and Capture writes on a different device).

---

## D6 — Two coordinate spaces, one projection, framework-supplied fit

**Decision**: the visualization builds its scene in a **mode-specific model space** and lets
`QGraphicsView.fitInView(scene_rect, Qt.KeepAspectRatio)` map that space to the viewport. Nothing
rescales the landmark data itself.

**Rationale**: the two modes have deliberately different numeric ranges, and conflating them would
be a bug:

| Mode | Range | What it shows |
|---|---|---|
| **Raw** | `x, y ∈ [0, 1]`, frame-relative, y-down | *Where in the camera frame* the hand was — position and apparent size are meaningful. |
| **Normalized** | centred near the wrist (origin index 0), scaled by the wrist→middle-MCP distance (index 9), unbounded | *The hand's shape*, with translation and scale removed. |

Because `fitInView` with `KeepAspectRatio` applies a single uniform scale factor to both axes, the
FR-011 requirement "without distorting the landmark proportions" is a property of the framework
call, not something the renderer has to defend. Raw mode fits to the unit square so a hand in the
corner of the frame *appears* in the corner; normalized mode fits to the union bounding box of
whatever is currently drawn.

Normalized mode is the one that answers SC-004 ("identify which landmarks vary the most"): with
translation and scale removed, residual spread across overlaid samples is real pose variation
rather than the hand having been held further from the camera.

**`z` is not projected to a position.** The view is a 2D orthographic projection of `x, y`;
`z` is shown as a metadata value only. Depth-as-radius or depth-as-colour is a plausible future
addition and is deliberately not built now (Principle VI).

---

## D7 — Missing normalized coordinates are a *load* concern, not a *render* concern

**Finding**: Engine's `PoseSerializer._hand_from_dict` reads `data["normalized"]` unconditionally,
so a `schema_version: 1` document lacking a normalized block raises `PoseSchemaError` at parse
time. It can therefore never reach the visualization.

**Decision**: such a sample is handled by **D4** — it lands in `skipped` with its reason shown,
which is a strictly better outcome than the spec's assumed "shown as unavailable in normalized
mode," because the sample is not silently half-usable.

Studio nonetheless models the *question* explicitly: `SampleView.landmarks_for(space)` returns
`HandLandmarks | None`, and the visualization renders a plain "not available in this mode" state
for `None` rather than raising. Today that branch is unreachable for schema 1; it exists so that a
future schema which legitimately omits a coordinate set is a data change, not a rendering rewrite
(Principle III).

---

## D8 — Split the scene: a pure `ScenePlan`, then a thin Qt renderer

**Decision**: computing *what to draw* is a pure function in `studio/application/`
(`build_scene_plan(...) -> ScenePlan`); turning a `ScenePlan` into `QGraphicsItem`s is a thin,
logic-free adapter in `studio/presentation/`.

```text
LoadedPose + selection + CoordinateSpace + emphasis
        │
        ▼  build_scene_plan()          ← pure, no Qt import, fully unit-testable
ScenePlan(points, edges, styles, bounds)
        │
        ▼  LandmarkSceneRenderer       ← QGraphicsScene items only, no decisions
QGraphicsScene
```

**Rationale**: this is Principle I's module boundary and Principle IV's testability mandate applied
to the one component with real logic in it. Every interesting rule — which samples are visible,
which coordinate space, per-hand colour (FR-008), opacity as a function of selection size (FR-013),
emphasis (FR-018), the 21 points and 21 edges from `engine.models.topology.HAND_CONNECTIONS`
(FR-007) — is decided in a `ScenePlan` that a `pytest` test can assert on field by field, with **no
display, no Qt event loop, and no `QApplication`**. The Qt layer holds no branch that a test would
want to check.

**Rejected**: building `QGraphicsItem`s directly from domain objects. It is fewer lines, and it
makes the milestone's most rule-dense component testable only through a GUI harness.

---

## D9 — Opacity that survives 200 overlaid samples

**Decision**: per-sample opacity is `max(min_opacity, base_opacity / sqrt(n))` for `n` selected
samples, with `base_opacity`, `min_opacity`, and the falloff clamp all in `StudioConfig` — never
literals in the renderer (Principle V).

**Rationale**: FR-013 requires overlapping regions to stay distinguishable, which is a statement
about *accumulated* alpha, so opacity has to fall as the selection grows. Linear `1/n` falloff goes
invisible around 20 samples; `1/sqrt(n)` keeps accumulated density roughly comparable across
selection sizes, and the `min_opacity` floor guarantees the spec's "very large selection … may
reduce visual clarity but must not cause the application to crash" degrades to *cluttered*, never
to *blank* and never to *unresponsive*. SC-004's benchmark of 10+ overlaid samples sits comfortably
inside the useful range.

---

## D10 — FR-018's highlight hook: emphasis is an input, not a computation

**Decision**: `build_scene_plan` takes an `emphasis: Mapping[SampleKey, EmphasisLevel]` argument,
where `EmphasisLevel` is `NORMAL | HIGHLIGHTED | MUTED`. The Dataset page passes an **empty
mapping** in this milestone, which renders every sample `NORMAL`.

**Rationale**: FR-018 asks for the mechanism without the policy, which is Principle III stated for
the canvas. Making emphasis a *parameter* rather than something the scene computes means a future
outlier detector is a new producer of that mapping and nothing else changes — no visualization
rework, exactly as FR-018 requires. Nothing in this milestone computes an outlier score, and no
detector interface is invented speculatively; the mapping's type is the whole extension point.

---

## D11 — The shell: a data-driven section registry

**Decision**: navigation is a `NavigationSection` enum plus a registry mapping each section to a
factory; the shell drives a `QStackedWidget` from that registry. Every non-Dataset section resolves
to the same `PlaceholderPage`, constructed with the section's title.

**Rationale**: FR-002 requires placeholders that "offer no non-functional controls that appear
interactive," which is easiest to *guarantee* when there is exactly one placeholder widget class
containing exactly one label and no controls at all — rather than five hand-written near-duplicate
pages that could each drift. Promoting a section later replaces one registry entry and touches no
navigation code (Principle I).

---

## D12 — Configuration: compose Engine's `DatasetConfig`, add Studio's own

**Decision**: `StudioConfig` (Pydantic, `apps/studio/config/models.py`) **composes Engine's existing
`DatasetConfig`** for dataset location and filename conventions, and adds Studio-only
`VisualizationConfig`, `WindowConfig`, and `LoggingConfig` sections. Loading mirrors Engine's
`load_config` precedence (defaults → optional JSON file → explicit overrides).

**Rationale**: the dataset's location, `poses` sub-directory name, filename prefix, and zero-pad
width are already validated configuration in Engine (`engine.config.models.DatasetConfig`).
Re-declaring them in Studio would be the duplicated logic Principle IV prohibits and would let the
two drift into disagreeing about where the dataset is. Reusing the model is the same
consume-don't-reimplement rule FR-019 states for dataset reading.

**FR-003a is enforced structurally, not by validation**: the dataset root resolves to the
repository's bundled `datasets/poses` and **no folder-picker widget exists in the codebase**. There
is no "Open Folder…" action to disable, because none is built. A config file can still point a
developer's checkout elsewhere; what the milestone forbids is an in-app way to change it, and an
absent widget cannot regress.

---

## Risks and open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | The constitution amendment (D2) is not ratified, leaving the feature's Constitution Check unresolved. | ✅ **CLOSED 2026-08-18** — constitution **v1.5.0** ratified: Principle VI authorizes the Studio Milestone 1 scope, and the Monorepo section reclassifies Engine as the shared platform library under four MUSTs. Both plan gates moved CONDITIONAL → PASS. Neither was waived; FR-019 was not changed. |
| R2 | PySide6 wheels are unavailable or lag for Python 3.14 (`requires-python = ">=3.14"`). | ✅ **CLOSED 2026-08-18 — no fallback needed.** See "R2 resolution" below. |
| R3 | Qt widget tests need a display in CI. | Pure logic (catalog, gateway, statistics, `ScenePlan`) is deliberately Qt-free per D8 and needs no display; the thin widget tests run under `QT_QPA_PLATFORM=offscreen`. |
| R4 | The current dataset is tiny (1–3 samples per pose), so SC-007's "several hundred" is untested by real data. | The performance test generates a synthetic pose directory of 500 samples in a `tmp_path` fixture; the real dataset is never written to (FR-017/SC-006). |
| R5 | The read-only guarantee (SC-006) erodes silently as Studio grows. | An automated test hashes the entire `datasets/poses` tree before and after a scripted exploration session and asserts byte-for-byte equality — SC-006 as an executable assertion rather than a review habit. |

### R2 resolution — PySide6 on Python 3.14 (verified 2026-08-18)

**Outcome: compatible. No interpreter fallback is required, and D1 stands unchanged.**

Verified by resolving wheels for the target platform explicitly
(`pip download --only-binary=:all: --python-version 3.14 --implementation cp --platform win_amd64`):

| Package | Resolved wheel | Verdict |
|---|---|---|
| `PySide6` 6.11.2 | `pyside6-6.11.2-cp310-abi3-win_amd64.whl` | ✅ |
| `PySide6-Essentials` 6.11.2 | `cp310-abi3-win_amd64` | ✅ |
| `PySide6-Addons` 6.11.2 | `cp310-abi3-win_amd64` | ✅ |
| `shiboken6` 6.11.2 | `cp310-abi3-win_amd64` | ✅ |
| `pytest-qt` 4.5.0 | `py3-none-any` | ✅ |

Two facts make this conclusive rather than incidental:

1. The wheels are **`abi3`** (CPython stable ABI, floor `cp310`), so a single binary is valid on
   every CPython ≥ 3.10 — 3.14 included. PySide6 does not need a per-version rebuild.
2. The package metadata declares `Requires-Python: >=3.10,<3.15` and carries an explicit
   `Programming Language :: Python :: 3.14` classifier. Support is stated, not inferred.

**The one constraint this introduces**: the `<3.15` ceiling. Python 3.15 is *not* supported by the
current PySide6 release, which puts a **ceiling** on the interpreter where the repository previously
had only a floor (`requires-python = ">=3.14"`). Recorded as a decision rather than left implicit:
the `studio` extra pins **`PySide6>=6.11,<7`**, and moving the repository to 3.15 requires
re-verifying this table first. This inverts the original risk — the exposure is a future interpreter
upgrade, not the current one.

> **Environment note, separate from the risk**: the machine this was verified on has only
> CPython 3.10 installed (`py -0p` lists `-3.10-64` alone) while `pyproject.toml` requires `>=3.14`.
> The wheel resolution above was performed for `cp314` explicitly and is therefore valid, but a
> Python 3.14 interpreter must be installed before `pip install -e ".[studio,dev]"` will run at all.
> That is an environment setup step, not a compatibility question.
