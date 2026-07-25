<!--
SYNC IMPACT REPORT
==================
Version change: 1.2.0 → 1.3.0
Rationale: the monorepo layout is now symmetrical. The Python engine moved from the
repository root (`app/`) to `apps/engine/`, alongside `apps/capture/`, and its
package is imported as `engine`. MINOR — a declared layout is redefined and the CLI
entry point changes; no principle is added, removed, or weakened.

Modified in this amendment (1.3.0):
  - Technology & Code Quality Standards, Engine section — project layout is now
    `apps/engine/` (was `app/`); `python -m engine.main` replaces `python -m app.main`.
  - Monorepo & Cross-Application Boundaries — every application, engine included,
    lives under `apps/`; shared repository-level concerns (tests, datasets, assets,
    scripts, specs, pyproject) stay at the root.

Templates requiring updates:
  - ✅ .specify/templates/* — no path assumptions; no edit required.

Deferred / follow-up TODOs:
  - specs/001-live-camera-detection and specs/002-pose-recorder retain `app/` paths as
    point-in-time records of what was built then; they are deliberately NOT rewritten.

--- previous report (1.1.0 → 1.2.0) -------------------------------------------
Version change: 1.1.0 → 1.2.0
Rationale: Mudra becomes a multi-application monorepo. The Python engine is no
longer the only application: `apps/capture` (Flutter/Android) collects pose
datasets on mobile. MINOR — a new mandatory section plus materially expanded
technology guidance; all six principles are retained unchanged in intent, with
Principle II clarified to bind every application in the repository.

Modified in this amendment (1.2.0):
  - Principle II — explicitly binds every application in the monorepo, including
    mobile capture; reference images are UI guidance assets, never dataset content.
  - Technology & Code Quality Standards — split into engine (Python) and capture
    (Dart/Flutter) standards; layout rules scoped per application.
  - NEW section: Monorepo & Cross-Application Boundaries — the versioned pose-sample
    JSON schema is the ONLY contract between applications; no shared code coupling.

Baseline principle mapping (unchanged since 1.0.0):
  - I. Architecture-First & Modular Boundaries
  - II. Coordinates, Never Images
  - III. Extensibility by Design (Recognition-Ready)
  - IV. Typed, Modeled, and Clean Code
  - V. Centralized Configuration & Structured Observability
  - VI. Scope Discipline (Milestone-Bounded YAGNI)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — no edit required (Language/Testing/Project
    Type are already language-agnostic placeholders; gate derived at plan time).
  - ✅ .specify/templates/spec-template.md — no mandatory-section conflict.
  - ✅ .specify/templates/tasks-template.md — no conflict.
  - ✅ .specify/templates/checklist-template.md — no conflict.

Deferred / follow-up TODOs:
  - ⚠ README.md — add the monorepo layout (engine at root, apps/capture) when the
    capture application lands; tracked as project work, not a constitution placeholder.
-->

# Mudra Constitution

Mudra is an AI-powered hand gesture recognition engine built with computer vision. Its
long-term purpose is to recognize sequences of hand signs, trigger events and effects, and
serve as a reusable engine for games, interactive experiences, AR filters, and social
content. This constitution governs how the project is built so that the foundation laid
today can support that future without rewrites.

## Core Principles

### I. Architecture-First & Modular Boundaries

The project's first and highest priority is a clean, extensible architecture — not features.
Every capability MUST live behind a clear module boundary with a single responsibility, and
any module (camera, detection, normalization, recording, dataset, recognition,
visualization, ui) MUST be replaceable independently without editing unrelated modules.
Modules communicate through explicit interfaces (Protocols / abstract base classes), not by
reaching into each other's internals. Dependencies flow toward abstractions: high-level
policy MUST NOT depend on low-level detail. Files stay small and single-purpose; monolithic
modules are prohibited. Global mutable state is prohibited; dependencies are passed
explicitly (dependency injection) rather than imported as singletons.

**Rationale**: The stated first milestone is the architecture itself. Loose coupling is the
only thing that lets MediaPipe, the storage format, or the future recognition engine be
swapped without cascading rewrites.

### II. Coordinates, Never Images

Mudra records hand landmarks, never pixels. The system MUST NOT save images, video frames,
or screenshots, and MUST NOT build any dataset from captured imagery. Persisted data
contains only normalized landmark coordinates (x, y, z per landmark, plus visibility when
MediaPipe provides it) together with metadata. All persisted artifacts (poses and sequences)
MUST be human-readable JSON — no binary or opaque formats. Every hand carries exactly 21
landmarks; handedness, confidence, and hand count are metadata, not pixel data.

This principle binds **every application in the monorepo**, desktop and mobile alike. A
capture application MAY display reference imagery to guide the user, but such images are UI
guidance assets shipped with the app; they MUST NOT be written into, referenced by, or
derived into any dataset artifact. Camera frames MUST leave memory as landmarks only.

**Rationale**: Coordinate-only storage keeps datasets small, privacy-preserving, diffable,
portable across models, and independent of camera resolution or lighting — the properties a
reusable gesture library depends on. A mobile app collecting data in the wild is exactly
where the temptation to "just save the frame" appears, so the rule is stated there explicitly.

### III. Extensibility by Design (Recognition-Ready)

The architecture MUST make future capabilities possible without implementing them now.
Recognition interfaces MUST be designed so that similarity matching, Dynamic Time Warping,
Hidden Markov Models, and neural approaches (LSTM, GRU, Transformer) can each be added as a
pluggable strategy behind a stable interface. Poses MUST be first-class reusable components
identified by a stable `pose_id`; `display_name`, `aliases`, and `description` are mutable
labels layered on that identity. Datasets, recognition, and future gameplay MUST reference
`pose_id`, never a human-readable name, so poses can be renamed, localized, and evolved
without breaking compatibility. Sequences MUST be able to reference pose identities rather
than only raw per-frame recordings. Datasets MUST be append-only: recording a new sample
never overwrites or mutates existing samples, so the library strengthens over time across
people, hand sizes, distances, rotations, and lighting.

**Rationale**: Every architectural decision optimizes for growth into a full recognition
engine. A stable `pose_id` decouples identity from presentation, making renaming/localization
and dataset evolution safe; append-only guarantees data is never lost as the corpus grows.

### IV. Typed, Modeled, and Clean Code

Type hints are mandatory on all functions, methods, and public attributes. Structured data
MUST be represented with Pydantic models (for validation/serialization boundaries such as
persisted JSON and configuration) or dataclasses (for internal value objects) rather than
raw dicts or tuples. Code MUST follow SOLID principles with small classes and small
functions, meaningful names, and docstrings on public modules, classes, and functions. Magic
numbers and duplicated logic are prohibited; named constants and shared helpers replace them.
Automated tests using pytest MUST accompany data models, normalization, and I/O
(serialization round-trips, append-only guarantees) — the logic whose correctness the whole
pipeline depends on.

**Rationale**: This is production-quality software, not a prototype. Types plus validated
models turn the JSON contract into something the compiler and tests enforce, catching
schema drift before it corrupts a growing dataset.

### V. Centralized Configuration & Structured Observability

All tunable values — camera settings, detection thresholds, recording settings, dataset
locations, logging levels, and reserved slots for future model settings — MUST be defined in
centralized configuration, not hardcoded at call sites. Configuration MUST be typed and
validated (Pydantic). Logging MUST use Loguru with structured output and appropriate levels,
including explicit startup and shutdown log lines. Long-running loops (live camera) MUST NOT
log per-frame at INFO or above; per-frame diagnostics belong at DEBUG/TRACE.

**Rationale**: Centralized, validated config makes the engine reconfigurable without code
changes, and structured logs make a real-time vision pipeline debuggable in the field.

### VI. Scope Discipline (Milestone-Bounded YAGNI)

The current objective is a robust data-collection foundation, delivered in order: (1) live
camera + detection, (2) pose recorder, (3) sequence recorder, (4) dataset builder. The
following MUST NOT be implemented until the foundation is complete and a later milestone
explicitly authorizes them: recognition algorithms, machine learning / model training,
gameplay, visual effects, and "attacks"/abilities. Interfaces and extension points for these
MAY (and per Principle III SHOULD) exist; their behavior MUST NOT. When a proposed change
adds feature surface beyond the current milestone, it is rejected or deferred by default.

**Rationale**: Discipline protects the foundation. Building recognition or gameplay on an
unproven data pipeline would bake in assumptions before the ground truth (the dataset format)
is stable.

## Technology & Code Quality Standards

Standards below are grouped by application. Principles I–VI apply to all of them; only the
concrete language, layout, and tooling differ.

### Engine (Python, repository root)

- **Language**: Python 3.14, using modern idioms (type parameter syntax, `match`, pathlib,
  `from __future__` not required at this version).
- **Dependency footprint**: the project keeps its runtime footprint as small as possible.
  Each dependency is introduced only in the phase where it is first required, and adding one
  MUST be justified against an existing capability first. Phase 1 (live camera) requires only:
  mediapipe, opencv-python, numpy, pydantic, rich, typer, loguru (plus pytest for tests).
  Analysis/visualization/training libraries (scipy, pandas, matplotlib) are introduced later,
  in the phase that first needs them (dataset analysis, plotting, or model training).
- **MediaPipe Hands** is the detection backend, accessed behind the detection interface so it
  can be replaced. It MUST surface both hands, handedness, per-hand confidence, and the 21
  landmarks. The live view MUST draw landmarks in real time and display FPS, handedness, and
  confidence.
- **Project layout** follows the agreed structure: `apps/engine/` with `core/`, `camera/`,
  `detection/`, `normalization/`, `recording/`, `recognition/`, `dataset/`, `models/`,
  `visualization/`, `ui/`, `utils/`, `config/`; plus the repository-level `assets/`,
  `datasets/poses/`, `datasets/sequences/`, `recordings/`, `tests/`, `scripts/`, `docs/`.
  Deviations require an amendment. The package is imported as `engine` (e.g.
  `from engine.core.live_app import LiveApp`).
- **CLI**: Mudra is a **multi-command** Typer application. The official command surface is
  `run`, `record-pose`, `record-sequence`, `dataset info`, `dataset validate`, `camera info`,
  and `doctor` (implemented incrementally; only `run` exists in Phase 1). A Typer callback
  makes `python -m engine.main` (no subcommand) execute the exact same logic as `mudra run`, so
  both entry points stay consistent. `mudra run` MUST launch the live application with clean,
  deterministic shutdown (camera released, resources closed).
- **Persistence layout**: datasets are organized as append-only **sample collections**, one
  directory per identity — `datasets/poses/<pose_id>/sample_NNNN.json` and
  `datasets/sequences/<sequence_id>/sample_NNNN.json`. There is NO single-file-per-pose. This
  supports collecting hundreds or thousands of examples per pose without redesign, and new
  samples are always appended, never overwritten. Each sample is human-readable JSON
  containing only normalized landmark coordinates plus metadata; a pose's identity metadata
  (`pose_id`, `display_name`, `aliases`, `description`) travels with the collection, and every
  sample references its `pose_id`. (No persistence occurs in Phase 1 — this governs Phase 2+.)
- **Documentation**: a professional README and `docs/` MUST cover vision, architecture,
  installation, running, folder structure, roadmap, contributing guidelines, and coding
  standards, and MUST stay consistent with this constitution.

### Capture applications (Dart / Flutter, `apps/capture/`)

- **Language & framework**: Dart with Flutter (latest stable channel). Android is the first
  target; the architecture MUST keep platform-specific code behind interfaces so iOS can be
  added without changing domain, application, or presentation layers.
- **Clean architecture layers** are mandatory and dependencies point inward only:
  `domain/` (entities, value objects, repository interfaces — no framework imports),
  `application/` (use cases and state orchestration — no widgets, no plugins),
  `infrastructure/` (camera, platform channels, filesystem, serialization — implements domain
  interfaces), `presentation/` (widgets and screens only). Business logic inside widgets is
  prohibited; a widget MAY read state and dispatch intent, nothing more. Feature-first
  grouping within a layer is preferred once a layer holds more than one feature.
- **Typed, immutable models**: every structured value is an immutable Dart class with typed
  fields and value equality — never a raw `Map`. Public classes, methods, and top-level
  functions carry doc comments. Magic numbers and duplicated logic are prohibited.
- **Configuration**, including the pose catalog, MUST be data (asset/config files) loaded and
  validated at runtime, never hardcoded into widgets — the Principle V rule, restated for
  Flutter.
- **Tests**: `flutter test` MUST cover the domain layer, the application/use-case layer, and
  JSON serialization round-trips against the shared schema. Platform-channel and camera code
  is isolated behind interfaces precisely so the rest stays testable without a device.
- **Static analysis**: `flutter analyze` MUST be clean; analyzer rules live in
  `analysis_options.yaml` and are part of the definition of done.

## Monorepo & Cross-Application Boundaries

Mudra is a monorepo containing multiple applications that share a data format, not a codebase.

- **Layout**: **every application lives under `apps/`** — `apps/engine/` (Python) and
  `apps/capture/` (Flutter) — each with its own toolchain, dependencies, and README. Concerns
  that belong to the repository rather than to one application (`tests/`, `datasets/`,
  `assets/`, `scripts/`, `specs/`, `pyproject.toml`) stay at the root. No application
  occupies the root.
- **The ONLY contract between applications is the versioned pose-sample JSON schema**
  (`schema_version`, currently 1), documented in the owning feature's `contracts/`. An
  application MUST NOT import, vendor, or reach into another application's source. Datasets
  produced by any application MUST be consumable by the engine with zero manual processing.
- **Schema changes are cross-application events**: altering the persisted schema is at minimum
  a MINOR constitution event, MUST bump `schema_version` when incompatible, MUST preserve the
  ability to read prior append-only samples, and MUST be reflected in every application that
  reads or writes it before merge.
- **No premature shared packages**: duplication of a small value object across applications is
  preferred over a shared library introduced speculatively. A shared package is justified only
  when the same logic has independently appeared in two applications and drifted.
- **Application independence**: no application may depend on another being installed, running,
  or reachable. Exchange happens through exported dataset artifacts on disk.

## Development Workflow & Scope Governance

- **Phase gating**: work proceeds through the four foundation phases in order. A phase is
  "done" only when it is runnable, tested where Principle IV requires, and documented.
- **Design review**: any change that introduces or alters a module boundary, an interface, or
  the persisted JSON schema MUST be reviewed against Principles I–III before merge, because
  these are the hardest things to change later. Adding a new application to `apps/` is such a
  change and requires the same review.
- **Data-format changes are versioned**: the JSON schema for poses and sequences carries a
  schema version field; changing it is at minimum a MINOR event and MUST preserve the
  ability to read prior append-only samples.
- **Definition of done** for any unit of work: type hints present, public API documented,
  no hardcoded config or magic numbers, no new global state, tests green, and no
  out-of-milestone feature surface introduced.

## Governance

This constitution supersedes ad-hoc practice. All contributions, reviews, and generated
plans/specs/tasks MUST verify compliance with the principles above; a change that violates a
principle is not merged until either the change is corrected or the constitution is amended
to permit it.

**Amendment procedure**: Amendments are proposed as a change to this file with a written
rationale, reviewed for downstream impact on `.specify/templates/*` and project docs, and
recorded in the Sync Impact Report at the top of this file.

**Versioning policy** (semantic versioning of governance):
- **MAJOR**: removal or backward-incompatible redefinition of a principle or governance rule.
- **MINOR**: a new principle/section, or materially expanded mandatory guidance (including
  persisted-schema version bumps).
- **PATCH**: clarifications, wording, and non-semantic refinements.

**Compliance review**: The Constitution Check gate in the planning workflow MUST be evaluated
against this document. Any justified deviation MUST be recorded in the plan's Complexity
Tracking with the simpler alternative that was rejected and why. Unjustified complexity is
grounds for rejection.

**Version**: 1.3.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-24
