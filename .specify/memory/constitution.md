<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0
Rationale: Architectural refinements adopted before Phase-1 implementation:
(a) dataset redesigned from one-JSON-per-pose to append-only sample collections
under per-identity directories; (b) poses gain a stable `pose_id` identity that
datasets/recognition/gameplay reference instead of display names; (c) CLI
formalized as a multi-command app with a `mudra run` == `python -m app.main`
callback. MINOR: materially expanded/redefined guidance + persisted-schema change,
no principle removed.

Modified in this amendment (1.1.0):
  - Principle III — pose identity now anchored on `pose_id` (display_name/aliases
    are mutable labels).
  - Technology & Code Quality Standards — persistence layout (collection-based,
    append-only samples), CLI command surface, and Phase-1 dependency footprint.

Baseline (1.0.0) principle mapping:
  - I. Architecture-First & Modular Boundaries
  - II. Coordinates, Never Images
  - III. Extensibility by Design (Recognition-Ready)
  - IV. Typed, Modeled, and Clean Code
  - V. Centralized Configuration & Structured Observability
  - VI. Scope Discipline (Milestone-Bounded YAGNI)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — no edit required (gate derived at plan time).
  - ✅ .specify/templates/spec-template.md — no mandatory-section conflict.
  - ✅ .specify/templates/tasks-template.md — no conflict.
  - ✅ .specify/templates/checklist-template.md — no conflict.

Deferred / follow-up TODOs: none. README.md and docs/ do not yet exist; they
MUST be authored to reflect these principles (tracked as project work, not a
constitution placeholder).
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

**Rationale**: Coordinate-only storage keeps datasets small, privacy-preserving, diffable,
portable across models, and independent of camera resolution or lighting — the properties a
reusable gesture library depends on.

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
- **Project layout** follows the agreed structure: `app/` with `core/`, `camera/`,
  `detection/`, `normalization/`, `recording/`, `recognition/`, `dataset/`, `models/`,
  `visualization/`, `ui/`, `utils/`, `config/`; plus `assets/`, `datasets/poses/`,
  `datasets/sequences/`, `recordings/`, `tests/`, `scripts/`, `docs/`. Deviations require an
  amendment.
- **CLI**: Mudra is a **multi-command** Typer application. The official command surface is
  `run`, `record-pose`, `record-sequence`, `dataset info`, `dataset validate`, `camera info`,
  and `doctor` (implemented incrementally; only `run` exists in Phase 1). A Typer callback
  makes `python -m app.main` (no subcommand) execute the exact same logic as `mudra run`, so
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

## Development Workflow & Scope Governance

- **Phase gating**: work proceeds through the four foundation phases in order. A phase is
  "done" only when it is runnable, tested where Principle IV requires, and documented.
- **Design review**: any change that introduces or alters a module boundary, an interface, or
  the persisted JSON schema MUST be reviewed against Principles I–III before merge, because
  these are the hardest things to change later.
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

**Version**: 1.1.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-24
