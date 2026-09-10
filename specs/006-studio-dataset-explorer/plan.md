# Implementation Plan: Mudra Studio — Dataset Explorer

**Branch**: `006-studio-dataset-explorer` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-studio-dataset-explorer/spec.md`

## Summary

A new desktop application, `apps/studio/` — **Mudra Studio**, the IDE built on top of Mudra Engine.
This first milestone is dataset **exploration and visual inspection only**: a left navigation rail
whose Dataset page works and whose other five entries are honest placeholders; a pose tree → sample
list → statistics column; and a landmark canvas with a metadata panel that answers the question the
capture pipeline cannot answer about itself — *is what we recorded actually any good?*

Technically it is a **read-only consumer of Engine**. Studio parses no JSON: pose discovery walks
directories, and every byte of every sample is deserialized by Engine's own `PoseSerializer` through
`JsonPoseRepository.load_path` (FR-019). Engine is imported in exactly one package,
`studio/infrastructure/engine_dataset/`, behind two Studio-owned ports — which is what lets FR-019
("consume Engine") and FR-023 ("never modify Engine") hold at the same time. The UI is
**PySide6/Qt 6**, chosen because `QGraphicsView` supplies zoom, pan, reset, and
fit-without-distortion as framework behaviour rather than as geometry we hand-write (FR-011), plus
per-item opacity for multi-sample overlay (FR-013) and per-item styling for the future
outlier-highlight hook (FR-018).

The component with real logic in it — deciding *what* to draw — is a **pure function producing a
`ScenePlan`**, with no Qt import anywhere in it. The Qt layer turns a `ScenePlan` into graphics
items and makes no decisions. So the milestone's densest rules (coordinate space, per-hand colour,
opacity falloff, emphasis, the 21-point topology) are asserted by plain `pytest` with no display and
no event loop.

**This plan had a prerequisite it could not satisfy itself.** Constitution v1.4.0 blocked the
feature in two places; both were resolved — not waived — by a single amendment to **v1.5.0**,
ratified 2026-08-18, which authorizes the Studio Milestone 1 scope under Principle VI and
reclassifies Engine as the repository's shared platform library. Details in the Constitution Check
and Complexity Tracking below.

## Technical Context

**Language/Version**: Python 3.14 — the repository floor (`requires-python = ">=3.14"`), same
interpreter and same toolchain as Engine. No second language enters the monorepo.

**Primary Dependencies**: **PySide6** (Qt 6), one new dependency, declared as the *optional* extra
`studio` so Engine's CLI-only footprint is untouched. No other new runtime dependency: statistics
are arithmetic over already-loaded objects and need neither `pandas` nor `scipy`, whose introduction
the constitution's dependency-footprint rule defers to the phase that genuinely requires them.
Everything else — Pydantic for config, Loguru for logs — is already in the project.

**Storage**: none. Studio reads the repository's bundled `datasets/poses/<pose_id>/sample_NNNNNN.json`
through Engine and **writes nothing, ever** (FR-017). No cache file, no preferences file, no index.
The dataset on disk is byte-for-byte identical before and after a session (SC-006), enforced by an
automated hash-the-tree test rather than by care.

**Testing**: `pytest` at the repository root, in a new `tests/studio/` tree alongside the existing
`tests/unit/`. The catalog source, the dataset gateway, the statistics function, and `ScenePlan`
construction are Qt-free by design (research D8) and test as plain Python. The thin widget layer
gets a small `pytest-qt` suite runnable under `QT_QPA_PLATFORM=offscreen`. `ruff` (line-length 100,
Google docstrings) applies unchanged.

**Target Platform**: desktop — Windows, macOS, Linux. Development and validation target Windows 11,
matching the current environment. Qt is the portability layer; nothing platform-specific is written.

**Project Type**: desktop application. A **new application** under `apps/`, sibling to
`apps/engine/` and `apps/capture/` — the first addition to the monorepo since Capture, and by the
constitution's own rule ("Adding a new application to `apps/` is such a change and requires the same
review") a design-review event, which is what the Constitution Check below performs.

**Performance Goals**: no frame-rate target — this is not a real-time pipeline. The bar is SC-007:
a pose with **several hundred samples** stays responsive with no perceptible freeze, achieved by
loading a pose once on a worker thread and then serving every subsequent interaction from memory.
Once loaded, switching coordinate space, toggling indices, and changing the multi-selection are pure
re-renders with **zero I/O** (SC-003).

**Constraints**: strictly **read-only** with respect to the dataset (FR-017, SC-006); **zero
modification of `apps/engine/`** (FR-023) — not one line, including a convenience method that would
make Studio's job easier; **all visualization embedded in Studio's own window** (FR-020), which
rules out Engine's OpenCV `imshow` path entirely; **no dataset folder picker** (FR-003a), enforced
by not building the widget rather than by disabling it; and **no training, export, editing, capture,
or recognition** surface (FR-024).

**Scale/Scope**: 18 existing pose categories; hundreds of samples per pose as the design target, with
a plain tree/list and **no virtualization** (spec clarification). One new application, one working
page, five placeholder pages, four layers, and one new optional dependency.

## Constitution Check

*GATE: first evaluated against constitution **v1.4.0** before Phase 0, re-evaluated after Phase 1
design, and re-evaluated a third time against **v1.5.0** after the amendment landed.
This feature adds a new application to `apps/`, which the constitution's Development Workflow section
independently designates a design-review event — so every principle is checked explicitly rather
than assumed from the previous feature.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Architecture-First & Modular Boundaries** | Every capability behind an interface; dependencies flow toward abstractions; no global state | **PASS** — Studio's `application/` layer depends on two Studio-owned Protocols (`PoseCatalogSource`, `PoseSampleSource`), never on Engine. Engine appears in exactly one package, `infrastructure/engine_dataset/`, so a change in Engine's API moves one adapter. `build_scene_plan()` is a pure function; the Qt renderer holds no decision. Config and ports are injected at composition root (`studio/main.py`), never imported as singletons. |
| **II. Coordinates, Never Images** | No images saved; no dataset built from imagery | **PASS, trivially** — Studio has no camera, opens no frame, and writes nothing at all. It renders coordinates that already exist as coordinates. FR-020 pushes *further* in this principle's direction: no external OpenCV preview window, only embedded native UI. |
| **III. Extensibility by Design** | Extension points exist without being implemented; `pose_id` is identity | **PASS** — FR-018's highlight hook is `emphasis: Mapping[SampleKey, EmphasisLevel]`, a *parameter* of the pure scene builder. A future outlier detector becomes a new producer of that mapping and nothing else changes — no visualization rework, exactly as FR-018 requires. `SampleKey` is `(pose_id, sample_number)`; `display_name` is decoration the tree falls back away from. **No speculative `OutlierDetector` interface is invented** (research D10) — the mapping's type is the whole extension point. |
| **IV. Typed, Modeled, and Clean Code** | Type hints mandatory; dataclasses/Pydantic over raw dicts; tests on the load-bearing logic | **PASS** — Studio's view types are frozen slotted dataclasses matching `engine/models/pose.py`; `StudioConfig` is Pydantic. The Qt-free split (research D8) is what makes the load-bearing logic — fault-tolerant loading, statistics arithmetic, scene construction — testable without a display, which is what Principle IV's testing mandate is actually asking for. |
| **V. Centralized Configuration & Structured Observability** | No hardcoded tunables; Loguru with startup/shutdown lines | **PASS** — every colour, radius, opacity coefficient, zoom bound, and window dimension is `StudioConfig` data (data-model §6); the renderer contains no literal. `StudioConfig` **composes Engine's `DatasetConfig`** rather than redeclaring the dataset location, so the two cannot drift about where the dataset is. Startup logs the resolved root and pose count; shutdown logs its counterpart. |
| **VI. Scope Discipline** | No feature surface beyond the authorized milestone | **PASS (v1.5.0).** The amendment's "Mudra Studio — Milestone 1: Dataset Exploration" block authorizes exactly this feature's surface: pose/sample browsing, raw and normalized landmark visualization, multi-sample overlay, per-pose statistics, and a placeholder navigation shell. Everything the amendment withholds — training, export, sample editing, camera capture, recognition — this feature already excludes by FR-024, so authorized scope and requested scope are the same set. The one extension point FR-018 mandates is a type signature rather than an implementation, which is what Principle III permits and Principle VI requires. |
| **Monorepo & Cross-Application Boundaries** | Schema is the only contract between *independent* applications; Engine is the shared platform library | **PASS (v1.5.0).** The amendment's Engine-as-shared-platform-library rule authorizes FR-019 under four MUSTs, all satisfied here: **one direction only** — Engine gains no import, setting, or line of code from this feature; **consume, never touch** — zero modification of `apps/engine/` (FR-023), verified mechanically by T060; **declare the surface** — the exact symbol set is recorded in [contracts/engine-consumption.md](./contracts/engine-consumption.md), with a prohibited list beside it; **Engine only** — Studio imports no other application's source, and Capture↔Studio still exchange nothing but the schema. The rest of the section passes as before: `schema_version` stays `1` with no persisted field changed, so this is **not** a cross-application schema event and Capture needs no corresponding change; no premature shared package is extracted; and Studio depends on no other application running or being reachable. |

**Post-Phase-1 re-evaluation**: Principles I–V still **PASS** — the design added no persistence, no
network, no global state, and no tunable outside `StudioConfig`. Phase 1 additionally *tightened*
the Engine surface: research D4 established that `JsonPoseRepository.list_sample_refs()` is unusable
here (it aborts a whole pose on the first bad file and double-parses), so the consumed surface
narrowed to `load_path` alone — recorded in
[contracts/engine-consumption.md](./contracts/engine-consumption.md). That contract document is also
what discharges the v1.5.0 "declare the surface" MUST, so a decision made for engineering reasons
turned out to satisfy the governance rule exactly.

**Post-amendment re-evaluation (2026-08-18)**: with constitution **v1.5.0** ratified, the two
previously CONDITIONAL gates are **PASS**. Neither was resolved by changing the design — the design
never changed — and neither was waived. They were governance facts about the constitution's text,
and the constitution's text is what moved. FR-019 stands unmodified.

**Gate status**: **PASS.** All six principles and both cross-cutting sections clear against
constitution v1.5.0. Implementation is unblocked.

## Project Structure

### Documentation (this feature)

```text
specs/006-studio-dataset-explorer/
├── plan.md                       # This file
├── spec.md                       # Feature specification (clarified 2026-07-28)
├── research.md                   # Phase 0 output — D1..D12 + risks R1..R5
├── data-model.md                 # Phase 1 output — entities, state transitions, ScenePlan
├── quickstart.md                 # Phase 1 output — how to run and validate, scenario by scenario
├── contracts/
│   ├── studio-ports.md           # PoseCatalogSource, PoseSampleSource (Studio-owned)
│   └── engine-consumption.md     # The exhaustive Engine surface Studio may touch (FR-019/FR-023)
├── checklists/
│   └── requirements.md           # Spec quality checklist
└── tasks.md                      # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

A **new application** alongside the two that exist. New paths are marked `+`; `~` marks an existing
file that gains a line.

```text
apps/
├── engine/                       # UNTOUCHED — zero changes (FR-023), verified by `git diff apps/engine`
├── capture/                      # UNTOUCHED — different application, different device
└── studio/                     + # NEW: Mudra Studio (Python 3.14 + PySide6)
    ├── domain/                 + # No Qt, no engine imports, no I/O
    │   ├── catalog.py          + #   PoseCatalogEntry, PoseCatalog
    │   ├── selection.py        + #   SampleKey, CoordinateSpace, DatasetViewState, EmphasisLevel
    │   ├── loading.py          + #   SkippedSample, PoseLoadResult, LoadedPose
    │   ├── statistics.py       + #   PoseStatistics (the type; the computation lives in application/)
    │   ├── scene.py            + #   ScenePoint, SceneHand, HandStyle, SceneBounds, ScenePlan
    │   └── ports.py            + #   PoseCatalogSource, PoseSampleSource  (contracts/studio-ports.md)
    ├── application/            + # Use cases — pure, no Qt
    │   ├── load_pose.py        + #   Port → LoadedPose, statistics attached
    │   ├── compute_statistics.py + # Pure function over valid samples (data-model §4)
    │   └── build_scene_plan.py + #   (LoadedPose, view state, config) → ScenePlan   ← research D8
    ├── infrastructure/         + # The ONLY place `engine.*` is imported
    │   └── engine_dataset/     + #   FilesystemPoseCatalogSource (dir walk, no parsing — D3)
    │                           + #   EngineDatasetGateway (per-file load_path + try/except — D4)
    ├── presentation/           + # Qt only; holds no decision the ScenePlan didn't already make
    │   ├── shell/              + #   MainWindow, NavigationRail, section registry, PlaceholderPage
    │   ├── dataset/            + #   DatasetPage, PoseTree, SampleList, MetadataPanel,
    │   │                       + #     StatisticsPanel, SkippedBanner, ViewControls
    │   └── canvas/             + #   LandmarkView (QGraphicsView), LandmarkSceneRenderer
    ├── config/                 + #   StudioConfig (composes engine DatasetConfig), loader
    ├── utils/                  + #   Loguru setup, mirroring engine/utils/logging.py
    ├── main.py                 + #   Composition root: config → ports → window → exec
    └── README.md               + #   What Studio is, how to run it, what it deliberately isn't

tests/
├── unit/                         # UNTOUCHED — engine's existing suite stays green
└── studio/                     + #
    ├── test_catalog_source.py  + #   Ordering, empty root, zero-sample pose, no-parse guarantee
    ├── test_dataset_gateway.py + #   FR-022: corrupt file skipped, others survive, counts reconcile
    ├── test_statistics.py      + #   Hand-observation counting, two-handed samples, empty pose
    ├── test_scene_plan.py      + #   Both spaces, 21 points/edges, colours, opacity falloff, emphasis
    ├── test_config.py          + #   Validation, DatasetConfig composition, no picker setting
    ├── test_read_only.py       + #   SC-006: hash datasets/poses before and after a session
    ├── test_performance.py     + #   SC-007: 500 synthetic samples in tmp_path
    └── presentation/           + #   Thin pytest-qt suite (QT_QPA_PLATFORM=offscreen)

pyproject.toml                   ~ # + optional-dependencies.studio = ["PySide6"]
                                 ~ # + hatch packages += "apps/studio"
                                 ~ # + scripts: mudra-studio = "studio.main:main"
                                 ~ # + ruff src += "apps/studio"   (pythonpath already covers `apps`)
README.md                        ~ # + Studio in the monorepo layout
.specify/memory/constitution.md  ~ # PREREQUISITE: v1.4.0 → v1.5.0 (task T001)
```

**Structure Decision**: a **new application under `apps/`**, per the constitution's rule that every
application lives there and none occupies the root. Internally Studio uses the four-layer clean
architecture the constitution mandates for Capture (`domain/` → `application/` →
`infrastructure/` / `presentation/`, dependencies pointing inward only) rather than Engine's flatter
capability-directory layout — because the problem shape here is Capture's, not Engine's: a UI
application whose value is in keeping framework and I/O out of its decisions. The rule that makes
this layout worth the ceremony is that **`domain/` and `application/` import neither Qt nor
`engine`**, which is what makes the milestone's real logic testable without a display.

Test placement follows the repository's existing convention — the root `tests/` tree, with
`pyproject.toml`'s `pythonpath = ["apps", "."]` already making `studio` importable exactly as it
makes `engine` importable. No test configuration changes.

## Design decisions

Full rationale and rejected alternatives are in [research.md](./research.md) as **D1–D12**; this
section states what is being built and why it is shaped that way.

### 1 · Engine is consumed, never touched (D2, D3, D4)

```text
presentation/  ──┐
application/   ──┼──> domain/ports.py  (Protocol)
                 │            ▲
                 │            │ implements
                 └────────────┴── infrastructure/engine_dataset/  ← the ONLY `import engine`
                                            │
                                            ▼
                                  engine.dataset.JsonPoseRepository.load_path
                                  engine.dataset.PoseSerializer
                                  engine.models.{pose,landmarks,topology}
```

Two findings shaped the adapter, and both are load-bearing:

- **Engine cannot enumerate poses.** `PoseRepository`'s every method takes a `pose_id` the caller
  already knows, because Engine's recorder always does — Studio's premise is the opposite (FR-003).
  The adapter walks pose directories itself; **no JSON is decoded outside Engine**, so FR-019 holds,
  and no Engine file is touched, so FR-023 holds. The gap is recorded as a future Engine improvement
  the port is already shaped to absorb (D3).
- **`list_sample_refs()` is unusable here.** It deserializes every sample to build refs and lets the
  first `PoseSchemaError` abort the whole call — the exact opposite of FR-022 — and then Studio would
  parse everything a second time to display it. The adapter globs paths and calls `load_path` per
  file inside `try/except`, collecting `SkippedSample`s (D4). **One corrupt file never hides a
  pose's other two hundred.**

### 2 · One eager load, then zero I/O (D5)

Selecting a pose loads all of its samples once, on a `QThreadPool` worker, into an immutable
`LoadedPose` cached for the session. Statistics need every sample anyway; overlay needs every
selected sample's landmarks. With everything resident, **raw↔normalized (FR-010), index labels
(FR-009), and multi-selection changes (FR-012) are pure re-renders that touch no disk** — which is
what SC-003's "no separate loading step" actually requires, not merely a fast one. Caching is safe
precisely because the application is read-only: nothing can change underneath it (FR-017). No
virtualization, per the spec's clarification — several hundred rows is not a problem a plain list
has.

### 3 · Two coordinate spaces, one framework-supplied fit (D6)

| Mode | Model space | What it tells you |
|---|---|---|
| **Raw** | `x, y ∈ [0,1]`, frame-relative | *Where in the frame* the hand was |
| **Normalized** | wrist-centred, scale-removed | *The hand's shape*, comparable across recordings |

The scene is built in the active mode's own model space and mapped to the viewport by
`fitInView(bounds, Qt.KeepAspectRatio)`. Because that applies one uniform scale to both axes,
FR-011's "without distorting the landmark proportions" is a property of the framework call rather
than something the renderer must defend. `z` is displayed as metadata but is **not** projected to a
position — depth-as-radius is a plausible future addition, deliberately not built (Principle VI).

Normalized mode is what answers SC-004: with translation and scale removed, the residual spread
across overlaid samples is *real pose variation* rather than the hand having been held closer to the
camera.

### 4 · The scene is decided before Qt exists (D8)

```text
LoadedPose + DatasetViewState + StudioConfig
        │
        ▼  build_scene_plan()        ← pure; no Qt import; unit-tested with plain pytest
   ScenePlan(hands, bounds, space, show_indices)
        │
        ▼  LandmarkSceneRenderer     ← QGraphicsItems only; no branches worth testing
   QGraphicsScene
```

Every rule with judgement in it — which samples are visible, which coordinate space, per-hand colour
(FR-008), opacity as a function of selection size (FR-013), emphasis (FR-018), and the 21 points and
21 edges taken verbatim from `engine.models.topology.HAND_CONNECTIONS` (FR-007) — is decided in a
`ScenePlan` that a test asserts on field by field, **with no display, no `QApplication`, and no
event loop**. Building `QGraphicsItem`s straight from domain objects would be fewer lines and would
make the milestone's most rule-dense component reachable only through a GUI harness.

### 5 · Opacity that survives two hundred samples (D9)

`opacity = max(min_opacity, base_opacity / sqrt(n))` for `n` selected samples, every coefficient in
`StudioConfig`. FR-013 is a claim about *accumulated* alpha, so opacity must fall as the selection
grows; linear `1/n` goes invisible around twenty samples, while `1/sqrt(n)` holds accumulated density
roughly steady. The `min_opacity` floor is what makes the spec's "very large selections … must not
crash" degrade to **cluttered**, never to blank and never to frozen. A single selection renders at
full opacity — a property worth asserting.

### 6 · FR-018's hook is a parameter, not a subsystem (D10)

`build_scene_plan(..., emphasis: Mapping[SampleKey, EmphasisLevel])`, where `EmphasisLevel` is
`NORMAL | HIGHLIGHTED | MUTED`. This milestone always passes `{}`. Making emphasis an *input* rather
than something the scene computes is what satisfies FR-018's actual requirement — that a future
outlier detector need no visualization rework — while inventing no detector interface today. The
type signature is the entire extension point.

### 7 · The shell is a registry, not five near-duplicate pages (D11)

A `NavigationSection` enum plus a section→factory registry driving a `QStackedWidget`. Every
non-Dataset section resolves to the **same** `PlaceholderPage` class, which contains one label and
no controls at all — which is how FR-002's "offers no non-functional controls that appear
interactive" becomes a structural guarantee rather than five hand-written pages that could each
drift. Promoting a section later replaces one registry entry.

### 8 · Config composed, not copied; FR-003a enforced by absence (D12)

`StudioConfig` **composes Engine's `DatasetConfig`** for the dataset root, `poses` sub-directory,
filename prefix, and pad width. Redeclaring them would be the duplicated logic Principle IV
prohibits, and would let Studio and Engine drift about where the dataset is — the same
consume-don't-reimplement rule FR-019 states for parsing. Studio adds only its own
`visualization`, `window`, and `logging` sections.

FR-003a is enforced **structurally**: there is no "Open Folder…" action to disable, because no
folder-picker widget is built. A config file can still point a developer's checkout elsewhere; what
the milestone forbids is an *in-app* way to change it, and an absent widget cannot regress.

## Complexity Tracking

> **Status: both entries RESOLVED.** Two constitutional gates were CONDITIONAL under v1.4.0. Both
> were resolved by a **single amendment to v1.5.0**, ratified 2026-08-18 (task T001) — neither was
> waived, and neither was reinterpreted away. They are retained below as the record of what was
> decided and which simpler alternatives were rejected, which is what the constitution's compliance
> review asks Complexity Tracking to preserve.

| Violation (resolved) | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **1. Principle VI** — v1.4.0 named Mudra Studio as a later milestone that "must explicitly authorize" itself, and had not. ✅ **Resolved in v1.5.0** by the "Mudra Studio — Milestone 1: Dataset Exploration" authorization block. | The Studio milestone is the project's next step, and this feature is deliberately its narrowest possible first slice: read-only inspection, with training, export, editing, capture, and recognition all explicitly excluded (FR-024). | *Defer Studio until the foundation phases finish* — rejected because the foundation's remaining question is whether the collected dataset is any good, and that is precisely what this tool answers; deferring it means continuing to collect data no one can inspect. *Build the explorer inside Engine's CLI instead* — rejected because FR-020 requires embedded native UI in the application's own window, which Engine's OpenCV-based visualization cannot provide, and because it would grow Engine's scope rather than avoid growing scope. |
| **2. Monorepo & Cross-Application Boundaries** — v1.4.0 said the pose-sample schema was "the ONLY contract between applications" and no application may "import, vendor, or reach into another application's source," contradicting FR-019. ✅ **Resolved in v1.5.0** by the Engine-as-shared-platform-library rule, which authorizes the import under four MUSTs while leaving the schema-only rule intact for independent application pairs. | The boundary rule exists to stop two *peer* applications coupling to each other's internals. Capture↔Studio is such a pair and must keep the schema-only rule. Engine is not a peer: the spec's framing is "the desktop IDE built **on top of** Mudra Engine," and the constitution already calls Engine "a reusable engine" — reuse is its stated purpose. The amendment should reclassify Engine as the repository's shared platform library that same-language applications may import, leaving the schema-only rule intact for app↔app pairs. | *Studio parses sample JSON itself* — rejected: violates FR-019 outright and guarantees drift between Studio's reader and `PoseSerializer`, the exact failure the versioned schema exists to prevent. *Extract a shared `packages/mudra-core`* — rejected by the constitution's own words: "A shared package is justified only when the same logic has independently appeared in two applications and drifted." It has not. Engine **is** the shared code; relocating it would be churn for no behavioural gain. *Reinterpret "application" to exclude Engine without amending* — rejected by the project owner: it leaves the governance text contradicting the code and still fails to authorize the milestone under Principle VI. |

**Not recorded as a violation**: PySide6, the one new dependency. The constitution's
dependency-footprint rule requires that a new dependency be "justified against an existing
capability first" — and there is no existing capability in this repository for building a desktop
window. Engine's only visual surface is OpenCV's `imshow`, which FR-020 explicitly forbids here.
The rule is satisfied on its own terms, so no exception is needed; the full comparison against
Tkinter, Dear PyGui, PyQt6, and web-view options is research
[D1](./research.md#d1--desktop-ui-toolkit-pyside6-qt-6).
