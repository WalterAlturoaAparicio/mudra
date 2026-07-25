---
description: "Task list for Pose Recorder (Phase 2)"
---

# Tasks: Pose Recorder

**Input**: Design documents from `/specs/002-pose-recorder/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Unit tests are REQUIRED for normalization, validation, serialization, and repository
(constitution Principle IV + explicit brief request). The capture→prompt→save GUI/terminal flow is
validated manually via `quickstart.md`.

**Organization**: Tasks are grouped by user story (US1 P1, US2 P2, US3 P3). Shared building blocks
(domain, config, normalizer, serializer, repository, services) are Foundational because all three
stories depend on them; the story phases add the interactive/reproducibility behavior.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish have no story label)
- All paths are repo-relative from `D:\desarrollo\mudra\`

## Path Conventions

- Package root `app/`; new packages `app/normalization/`, `app/dataset/`, `app/recording/`; tests
  in `tests/unit/`.

---

## Phase 1: Setup

**Purpose**: New package skeletons for Phase 2.

- [x] T001 Create new packages with `__init__.py` module docstrings: `app/normalization/`, `app/dataset/`, `app/recording/`; no third-party additions to `pyproject.toml` (Phase 2 reuses the Phase-1 dependency set — constitution 1.1.0).

**Checkpoint**: New packages importable; `pytest -q` still green (Phase-1 tests unaffected).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Domain model, configuration, and the pure, replaceable building blocks (normalizer,
serializer, repository, validation, recorder) that ALL user stories depend on. No interactive
behavior yet.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Extend `app/config/models.py`: add `NormalizationConfig` (algorithm="translation_scale", origin_index=0, scale_index=9), `DatasetConfig` (root="datasets", poses_dirname="poses", json_indent=2, filename_prefix="sample_", filename_digits=6), `RecordingConfig` (record_key="r", pose_id_pattern="^[a-z0-9_]+$", pose_id_max_length=64); add them to `AppConfig` with validated defaults (research D8).
- [x] T003 [P] Create `app/models/pose.py`: frozen dataclasses `Pose`, `HandMeta`, `HandSample` (handedness, confidence, raw, normalized), `PoseMetadata`, `NormalizationInfo` (strategy, version), `PoseSample` (schema_version, pose, `sample_uuid`, `sample_number`, timestamp, normalization, metadata, hands — NO `sample_id`), `SampleRef` (pose_id, `sample_uuid`, `sample_number`, location), and `VersionInfo` — reusing `Landmark`/`HandLandmarks`/`Handedness` from `app/models/landmarks.py`; no I/O (data-model.md).
- [x] T004 [P] Define `app/normalization/normalizer.py`: `Normalizer` Protocol with `strategy` and `version` read-only properties plus `normalize(hand: HandLandmarks) -> HandLandmarks` (contracts/interfaces.md).
- [x] T005 Implement `app/normalization/translation_scale.py`: `TranslationScaleNormalizer(config)` with `strategy="translation_scale"`, `version="1.0"` — wrist-origin translation + uniform scale by distance(origin_index → scale_index), applied to x/y/z; zero-span → scale 1.0 with a logged warning (research D1) (depends on T002, T004).
- [x] T006 [P] Unit test `tests/unit/test_normalization.py`: wrist maps to origin; translation invariance (shifted hand → same normalized); scale invariance (uniformly scaled hand → same normalized); orientation preserved; zero-span fallback does not raise (depends on T005).
- [x] T007 Implement `app/dataset/serializer.py`: `SCHEMA_VERSION=1`, `PoseSerializer` (`to_dict`/`to_json`/`from_dict`/`from_json`) emitting the full field set (`schema_version`, `pose_id`, `display_name`, `description`, `sample_uuid`, `sample_number`, `timestamp`, `normalization`, `metadata`, `hands`) in stable order + indentation per contracts/json-schema.md, and `PoseSchemaError`; validates `schema_version` and shape on load (depends on T003).
- [x] T008 [P] Unit test `tests/unit/test_pose_serializer.py`: round-trip `from_dict(to_dict(s)) == s`; field order/indent stable; `schema_version` stamped; `sample_uuid` + `sample_number` + `normalization` present; raw+normalized each have 21 points; corrupt/incompatible document raises `PoseSchemaError` (depends on T007).
- [x] T009 [P] Define `app/dataset/repository.py`: `PoseRepository` Protocol (save/next_sample_number/count/list_sample_refs/load) and `PoseRepositoryError` (imports `SampleRef` from `app/models/pose.py`) (contracts/interfaces.md).
- [x] T010 Implement `app/dataset/json_repository.py`: `JsonPoseRepository(config, serializer)` — resolves `datasets/poses/<pose_id>/`, creates it on first save, computes next number = max-existing+1 (tolerates gaps), assigns the zero-padded `sample_number` (e.g. `sample_000023`), writes `<sample_number>.json` with exclusive create (`open(path,"x")`, retry-on-collision), never overwrites; returns a `SampleRef` (carrying the sample's `sample_uuid` and assigned `sample_number`); implements load/list/count (research D4) (depends on T007, T009, T002).
- [x] T011 [P] Unit test `tests/unit/test_json_repository.py` (uses `tmp_path`): first save creates collection + `sample_000001.json`; second save → `sample_000002.json` with the first unchanged; numbering continues past a manually created gap; exclusive-create never overwrites; `count`/`list_sample_refs`/`load` round-trip (depends on T010).
- [x] T012 Implement `app/recording/validation.py`: a **single** `PoseValidationService(config)` — the only validation entry point (no parallel module-level function; research D12) — with `validate_capture(detection)` (≥1 hand, exactly 21 landmarks/hand, finite coords → raise `CaptureValidationError(reason)`) and `validate_pose_id(value)` (`^[a-z0-9_]+$`, ≤max length, path-safe) (data-model rules, research D7) (depends on T002, T003).
- [x] T013 [P] Unit test `tests/unit/test_pose_validation.py`: via the `PoseValidationService`, rejects 0 hands, ≠21 landmarks, NaN/Inf coords with specific reasons; accepts valid captures; `pose_id` accepts snake_case, rejects blanks/spaces/uppercase/`..`/slashes and over-length (depends on T012).
- [x] T014 Implement `app/recording/recorder.py`: `PoseRecorderService(validator, normalizer, repository, versions, camera_config, clock, uuid_factory=lambda: str(uuid.uuid4()))` — `record(detection, pose)` validates → normalizes each hand → mints `sample_uuid` via `uuid_factory` → stamps `NormalizationInfo` from `normalizer.strategy`/`normalizer.version` → builds `PoseMetadata` (camera res/index, versions, num_hands, per-hand handedness+confidence, ISO-8601 UTC timestamp) → builds `PoseSample` → `repository.save`; returns `SampleRef`; no GUI/terminal I/O (contracts/interfaces.md, research D6/D10/D11) (depends on T005, T009, T012, T003).
- [x] T015 [P] Unit test `tests/unit/test_recorder.py`: with fake validator/normalizer/repository/clock and a deterministic `uuid_factory`, a valid detection produces a saved `PoseSample` carrying the injected `sample_uuid`, a `normalization` block matching the normalizer's strategy/version, and hands with both raw and normalized 21-point sets; an invalid detection raises without calling `repository.save` (depends on T014).
- [x] T016 [P] Define `app/core/recording_port.py`: `RecordingController` Protocol (`record(frame, detection) -> None`) — the port `LiveApp` will depend on (contracts/interfaces.md) (depends on T003).

**Checkpoint**: All four+ mandated unit suites green; services importable; no interactive code yet.

---

## Phase 3: User Story 1 - Record a valid pose sample (Priority: P1) 🎯 MVP

**Goal**: Pressing **R** on a valid detection freezes the frame, prompts for a `pose_id`, and
appends one valid JSON sample, then resumes the live camera.

**Independent Test**: quickstart rows 1–5, 10 — press R, enter `open_palm`, confirm a new
`sample_000001.json` with raw+normalized landmarks and metadata, no image data, camera resumes.

### Implementation for User Story 1

- [x] T017 [US1] Implement `app/recording/controller.py`: `PoseRecordingController(recorder, config, console)` implementing the `RecordingController` port — start a monotonic timer on `record()` entry, draw a "RECORDING" overlay on the frozen frame (`cv2`), prompt in the terminal (Typer/Rich) for `pose_id` (required), `display_name`/`description` (optional, Enter to skip), call `PoseRecorderService.record`, print success, and emit a structured **INFO Loguru log** with `pose_id`, `sample_number`, `sample_uuid`, save location, `elapsed_duration_ms` (measured from entry until the sample is written), number of hands, and normalization strategy (fully satisfies FR-016) (contracts/cli.md) (depends on T014, T016, T002).
- [x] T018 [US1] Modify `app/core/live_app.py`: add optional `recording_controller: RecordingController | None = None` to the constructor; in the loop, map the **R** key (`ord("r")`) to `recording_controller.record(frame, detection)` for the current frame/detection; behavior is exactly Phase-1 when the controller is `None`; `q`/`Esc`/window-close unchanged (depends on T016).
- [x] T019 [US1] Modify `app/ui/cli.py` run path: build `VersionInfo` (`app.__version__`, `getattr(mediapipe,"__version__",None)`), `TranslationScaleNormalizer`, `PoseSerializer`, `JsonPoseRepository`, `PoseValidationService`, `PoseRecorderService`, and `PoseRecordingController`; inject the controller into `LiveApp` (depends on T017, T018, T010, T014).

**Checkpoint**: `python -m app.main` → press R → a valid pose sample is saved end-to-end; MVP done.

---

## Phase 4: User Story 2 - Rejected captures give a clear reason (Priority: P2)

**Goal**: Invalid captures and cancellations never write a file and always explain why, then
resume the live camera.

**Independent Test**: quickstart rows 6–8 — R with no hand → "No hands detected", no file; cancel
at prompt → no file; invalid `pose_id` → rejected with reason.

### Implementation for User Story 2

- [x] T020 [US2] Extend `app/recording/controller.py`: catch `CaptureValidationError` from `validate_capture` (show the specific reason, write nothing, resume); support cancel at any prompt (blank/cancel token → abort, no save); re-prompt on invalid `pose_id` with the reason; log warnings for each rejection/cancel (FR-004/006/007/016) (depends on T017, T012).
- [x] T021 [US2] Unit test `tests/unit/test_recording_rejections.py`: with fakes (no GUI), assert an empty detection and a malformed detection cause no `repository.save`, and an invalid `pose_id` is rejected — driving the recorder/validation paths the controller relies on (depends on T020, T014).

**Checkpoint**: All rejection and cancel paths are safe and explained; no stray files written.

---

## Phase 5: User Story 3 - Grow a reusable, reproducible library (Priority: P3)

**Goal**: The same `pose_id` accumulates many append-only, sequentially numbered samples across
sessions, each with complete reproducibility metadata; multiple poses coexist.

**Independent Test**: quickstart rows 4, 5, 9 — record `open_palm` twice (no overwrite), inspect
full metadata, and create a second `closed_fist` collection.

### Implementation for User Story 3

- [x] T022 [US3] Add cross-session numbering test to `tests/unit/test_json_repository.py`: a fresh `JsonPoseRepository` instance over an existing populated pose directory (simulating a new session) continues numbering without overwrite, and distinct `pose_id`s get separate collections (SC-002/SC-005) (depends on T010).
- [x] T023 [US3] Add a dedicated, field-by-field FR-015 metadata assertion in `tests/unit/test_metadata.py` (distinct from T015's broad check): assert each metadata field individually — `timestamp` (ISO-8601 UTC), `camera.index`/`width`/`height`, `versions.application`/`versions.mediapipe`, `num_hands`, and each `hands[i].handedness`/`hands[i].confidence` — matches the source detection/config (FR-015, SC-003) (depends on T014).

**Checkpoint**: Append-only accumulation across sessions and multi-pose collections are proven; all user stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality, and validation.

- [x] T024 [P] Update `README.md`: add a "Recording a pose" section (press R flow), the dataset layout (`datasets/poses/<pose_id>/sample_NNNNNN.json`), a JSON schema summary (link to contracts/json-schema.md), and folder organization; note recording is a mode of `run`.
- [x] T025 [P] Run `ruff check` + `ruff format` and ensure Google-style docstrings across all new modules (`normalization/`, `dataset/`, `recording/`, `models/pose.py`, `core/recording_port.py`); confirm `pytest -q` green (constitution Principle IV).
- [ ] T026 Execute the `quickstart.md` manual validation matrix (rows 1–10) on real hardware; confirm no image/screenshot files are ever written under `datasets/**` (FR-011/SC-006) and every successful recording emits the structured INFO log (FR-016). PARTIAL: headless-verifiable parts done — the recorder→repository stack writes a schema-correct JSON sample (all top-level keys ordered, `sample_uuid`, `sample_number`, `normalization`, raw+normalized 21 each, normalized wrist at origin, full metadata), only `.json` is written (no images), and 85 unit tests pass. REMAINING (needs a webcam + display): rows 1–10 interactive flow (press R → freeze/overlay → terminal prompts → save → resume; rejection/cancel/invalid-id UX).
- [x] T027 [P] Update the `run` command help/README to mention **R = record a pose**; reserved CLI command set is unchanged from Phase 1.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **US1 (Phase 3)**: depends on Foundational (needs recorder + port + config). The MVP vertical
  slice (controller + LiveApp + CLI wiring).
- **US2 (Phase 4)**: depends on US1's controller (adds rejection/cancel UX) + the foundational
  validator.
- **US3 (Phase 5)**: depends on the foundational repository + recorder (adds cross-session /
  multi-pose / metadata verification). Independent of US2.
- **Polish (Phase 6)**: after the desired stories are complete.

### Within Foundational

- Interfaces/domain/config (T002–T004, T009, T016) before their implementations (T005, T007, T010,
  T012, T014).
- Each implementation before its unit test.
- `PoseRecorderService` (T014) depends on normalizer (T005), repository Protocol (T009), and
  validator (T012).

### Parallel Opportunities

- Setup: T001.
- Foundational: T002, T003, T004, T009, T016 are `[P]` (distinct files); tests T006/T008/T011/
  T013/T015 are `[P]` once their targets exist. T005/T007/T010/T012/T014 are sequential w.r.t.
  their own deps but touch separate files.
- Polish: T024, T025, T027 are `[P]`.

---

## Parallel Example: Foundational interfaces & domain

```bash
# After Setup, launch these together (different files, no interdependencies):
Task: "T002 Config sections in app/config/models.py"
Task: "T003 Pose domain model in app/models/pose.py"
Task: "T004 Normalizer Protocol in app/normalization/normalizer.py"
Task: "T009 PoseRepository Protocol in app/dataset/repository.py"
Task: "T016 RecordingController port in app/core/recording_port.py"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Setup (Phase 1) → Foundational (Phase 2, blocks everything).
2. US1 (Phase 3): controller + LiveApp R-key + CLI wiring → **record a valid pose end-to-end**.
3. **STOP and VALIDATE** with quickstart rows 1–5, 10. Demonstrable dataset-creation MVP.

### Incremental Delivery

1. Foundational → all pure services proven by unit tests.
2. US1 → happy-path recording (MVP).
3. US2 → safe rejection/cancel feedback.
4. US3 → append-only-across-sessions + reproducible metadata + multi-pose.
5. Polish → README/schema docs, lint/docstrings, manual validation.

---

## Notes

- Only individual pose recording (Principle VI). No sequence recording, recognition, or gameplay.
- Never persist images/frames (FR-011, Principle II); the frozen frame is shown, never saved.
- Never overwrite a sample (FR-009); numbering is append-only via exclusive create.
- `pose_id` is the only identifier and the filesystem-safety boundary (FR-006, research D7).
- Keep domain independent of JSON (serializer) and of storage (repository) — swap-ready.
- Commit after each task or logical group; stop at any checkpoint to validate a story.
