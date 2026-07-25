# Implementation Plan: Pose Recorder

**Branch**: `002-pose-recorder` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-pose-recorder/spec.md`

## Summary

Add a production-quality Pose Recorder to the existing live camera app. Pressing **R** freezes
the current detection, validates it, prompts (in the terminal) for a permanent `pose_id` plus
optional `display_name`/`description`, normalizes each hand (translation + scale), and appends a
single human-readable, versioned JSON sample under `datasets/poses/<pose_id>/sample_NNNNNN.json`
— storing **both raw and normalized** landmarks, a `normalization` record (strategy + version),
reproducibility metadata, an immutable `sample_uuid`, and a sequential `sample_number`, never
images, and never overwriting. Every successful save emits a structured INFO log (pose_id,
sample_number, sample_uuid, location, elapsed_duration_ms, hand count, normalization strategy). The design is built around replaceable seams the whole project will reuse: a
`Normalizer` interface, a `PoseRepository` abstraction (`JsonPoseRepository` now), a
`PoseSerializer` that isolates the JSON schema from the domain, and `PoseValidationService` /
`PoseRecorderService` that hold the business logic independent of storage and I/O. Recording is
integrated into `run` via a `RecordingController` port so `LiveApp` depends only on an interface.

## Technical Context

**Language/Version**: Python 3.14

**Primary Dependencies**: pydantic v2 (config + schema validation on load), numpy (normalization
math), opencv-python (freeze overlay), loguru, typer/rich (terminal prompts + feedback),
mediapipe (already present — used only to read its version string for metadata). **No new
runtime dependencies** — scipy/pandas/matplotlib remain excluded (constitution 1.1.0).

**Storage**: Human-readable, indented, `schema_version`-stamped JSON files, one per sample, under
`datasets/poses/<pose_id>/`. Append-only; exclusive-create so an existing sample is never
overwritten. Access is behind the `PoseRepository` abstraction (FR-019).

**Testing**: pytest — normalization (translation/scale invariance, degenerate handling),
validation (empty/wrong-count/non-finite, `pose_id` safety), serialization (round-trip + stable
field order + schema version), and repository (sequential numbering, append-only/no-overwrite,
directory creation) using `tmp_path`. The camera/terminal/GUI flow is validated via
`quickstart.md`.

**Target Platform**: Local desktop with webcam + display (same as Phase 1).

**Project Type**: Single project — desktop CLI application (`app/` package).

**Performance Goals**: Saving one sample completes in well under 1 second (SC-001 allows 20s
including typing). Sequential numbering stays correct and collision-free to ≥1,000 samples per
pose (SC-005).

**Constraints**: Never store images/frames (FR-011, constitution Principle II); never overwrite
(FR-009); `pose_id` is the only identifier (FR-006); recording pauses the live loop and resumes
after any outcome (FR-017); every attempt is logged (FR-016).

**Scale/Scope**: Thousands of samples per `pose_id`, accumulated across sessions and contributors
via a shared `datasets/` folder.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Architecture-First & Modular Boundaries | `Normalizer`, `PoseRepository`, `PoseSerializer`, and the `RecordingController` port are interfaces; services depend on abstractions and are injected; domain value objects hold no I/O; small single-purpose modules. | ✅ PASS |
| II. Coordinates, Never Images | Samples store only raw + normalized landmark coordinates and metadata. No image/frame/screenshot is ever written (FR-011); the frozen frame is shown but never persisted. | ✅ PASS |
| III. Extensibility by Design | Poses keyed by stable `pose_id`; append-only per-identity collections; `schema_version` on every sample; repository and normalizer are swappable; **raw** landmarks persisted so normalization can change later without re-recording. | ✅ PASS |
| IV. Typed, Modeled, Clean Code | Full type hints; frozen dataclasses for domain value objects; Pydantic for config and schema-load validation; named constants (schema version, landmark indices, filename pattern); pytest across all pure logic. | ✅ PASS |
| V. Centralized Config & Structured Observability | New `NormalizationConfig`, `DatasetConfig`, `RecordingConfig` under `AppConfig`; no hardcoded paths/keys; Loguru INFO log on every successful recording (pose_id, sample_number, sample_uuid, location, elapsed_duration_ms, hand count, normalization strategy) + warnings on rejection, per FR-016. | ✅ PASS |
| VI. Scope Discipline (Milestone-Bounded YAGNI) | Implements ONLY individual pose recording (constitution's Phase 2). No sequence recording, recognition, ML, or gameplay. `sequences/` stays untouched; `recognition/` not created. | ✅ PASS |
| Persistence layout & schema (1.1.0) | Matches `datasets/poses/<pose_id>/sample_NNNNNN.json`; schema is documented and versioned (design-review gate satisfied by `contracts/json-schema.md`). | ✅ PASS |

**Result**: All gates pass. Complexity Tracking intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-pose-recorder/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── interfaces.md     # Normalizer / PoseRepository / PoseSerializer / services / port
│   ├── json-schema.md    # Versioned pose-sample JSON schema (v1)
│   └── cli.md            # Recording UX within `run` (no new command in Phase 2)
└── tasks.md             # Phase 2 output (/speckit-tasks — via after_plan hook)
```

### Source Code (repository root)

New Phase-2 packages are added as siblings under `app/`. Phase-1 modules are reused unchanged
except `core/live_app.py` (gains an optional recording hook) and `config/models.py` (gains
config sections). `recognition/` and sequence recording are NOT created (Principle VI).

```text
app/
├── models/
│   ├── landmarks.py            # (reused) Landmark, HandLandmarks, Handedness, HandDetection, FrameDetection
│   └── pose.py                 # NEW: Pose, HandSample, PoseMetadata, NormalizationInfo,
│                               #      PoseSample (sample_uuid + sample_number), SampleRef,
│                               #      VersionInfo (frozen dataclasses)
├── normalization/              # NEW package
│   ├── __init__.py
│   ├── normalizer.py           # Normalizer Protocol
│   └── translation_scale.py    # TranslationScaleNormalizer (wrist origin + hand-span scale)
├── dataset/                    # NEW package
│   ├── __init__.py
│   ├── repository.py           # PoseRepository Protocol, PoseRepositoryError (SampleRef lives in models/pose.py)
│   ├── json_repository.py      # JsonPoseRepository (numbering, append-only exclusive create)
│   └── serializer.py           # PoseSerializer (domain <-> dict/JSON), SCHEMA_VERSION
├── recording/                  # NEW package
│   ├── __init__.py
│   ├── validation.py           # PoseValidationService, CaptureValidationError, pose_id validation
│   ├── recorder.py             # PoseRecorderService (orchestrates validate→normalize→build→save)
│   └── controller.py           # PoseRecordingController: freeze overlay + terminal prompts (impl of port)
├── core/
│   ├── live_app.py             # MODIFIED: 'R' key → recording_controller.record(frame, detection)
│   └── recording_port.py       # NEW: RecordingController Protocol (the port LiveApp depends on)
├── config/
│   └── models.py               # MODIFIED: + NormalizationConfig, DatasetConfig, RecordingConfig
├── ui/
│   └── cli.py                  # MODIFIED: build controller + services, inject into LiveApp
└── ... (camera/, detection/, visualization/, utils/ reused unchanged)

tests/unit/
├── test_normalization.py       # NEW
├── test_pose_validation.py      # NEW
├── test_pose_serializer.py      # NEW
└── test_json_repository.py      # NEW
```

**Structure Decision**: Single-project desktop CLI, extended with three new packages
(`normalization`, `dataset`, `recording`) plus a `core/recording_port.py` port. Dependency
direction points inward: `recording` → `dataset`/`normalization`/`models` (abstractions); `core`
depends only on the port, never on `recording` concretes; `ui` wires everything via DI. This
keeps domain and business logic independent of JSON and of storage, so the repository can be
replaced (SQLite/Postgres/Cloud) without touching the recorder, validator, or normalizer.

## Complexity Tracking

> No Constitution Check violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
