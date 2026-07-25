# Feature Specification: Pose Recorder

**Feature Branch**: `002-pose-recorder`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Phase 2 — Pose Recorder. A production-quality tool to record individual, reusable hand poses into an append-only, per-pose-id dataset collection. Press R to freeze the current detection, validate it, enter a permanent pose_id (plus optional display name and description), and save one human-readable, versioned sample containing normalized landmark coordinates and reproducibility metadata. Never store images. Never overwrite. This is the dataset engine the whole project will build on."

## Clarifications

### Session 2026-07-24

- Q: What should the default normalization algorithm produce? → A: Translation + scale — re-origin
  each hand at the wrist and scale by a reference hand span, making the same pose comparable across
  position and distance while KEEPING orientation as a discriminative feature. Rotation is not
  removed. The algorithm is replaceable behind an interface.
- Q: Should raw detector landmarks also be persisted alongside the normalized ones? → A: Yes —
  store BOTH raw and normalized per hand, so a future/better normalization can be re-derived from
  raw on existing samples without re-recording. (Still never store images.)
- Q: How does the user enter pose_id / display_name / description? → A: Terminal prompt — the frozen
  frame stays on screen and the app prompts for text in the console.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a valid pose sample (Priority: P1)

A dataset contributor is running the live camera, holds a hand in a deliberate shape (for
example an open palm), and presses **R**. The application freezes on that moment, shows the
captured frame with a small "recording" indicator, and asks them to name the pose with a
permanent `pose_id`. They type `open_palm`, optionally add a friendly display name and a
description, confirm, and the application saves one sample and confirms success before
returning to the live view.

**Why this priority**: This is the core of the entire phase and the foundation of every future
capability (sequences, recognition, datasets, gameplay). A single, correctly captured and
saved pose sample is the minimum unit of value; nothing else in Mudra's data pipeline exists
without it.

**Independent Test**: With a hand clearly in view, press R, enter a valid `pose_id`, confirm,
and verify exactly one new human-readable sample file appears under that pose's collection
containing the hand's normalized landmarks and metadata — with no image data — after which the
live camera resumes.

**Acceptance Scenarios**:

1. **Given** the live camera is running with a hand detected, **When** the user presses R,
   **Then** the current frame freezes, a recording indicator is shown, and the user is prompted
   for a `pose_id`.
2. **Given** the recording prompt is shown, **When** the user enters a valid `pose_id` and
   confirms, **Then** exactly one new sample is saved under that pose's collection and a success
   message reports the pose and where it was saved.
3. **Given** a sample has been saved, **When** the save completes, **Then** the application
   resumes the live camera without being restarted.
4. **Given** a saved sample, **When** it is opened, **Then** it contains the `pose_id`, the
   per-hand normalized landmarks (left/right kept separate), and metadata — and contains no
   image, frame, or screenshot data.

---

### User Story 2 - Rejected captures give a clear reason (Priority: P2)

A contributor presses R at a bad moment — no hand is in view, or the detection is incomplete.
Instead of saving a useless or corrupt sample, the application refuses to save, tells them
exactly why (for example "No hands detected"), and returns them to the live camera so they can
try again.

**Why this priority**: Dataset quality is the whole point. Silently saving empty or malformed
samples would poison every downstream consumer. Validation with clear feedback is what makes
the tool trustworthy, but it only matters once the happy-path capture (US1) exists.

**Independent Test**: Press R with no hand in view and confirm that no file is written and a
specific, human-readable reason is displayed; repeat with a partially detected hand and confirm
the same protective behavior.

**Acceptance Scenarios**:

1. **Given** no hand is detected, **When** the user presses R, **Then** the application does not
   prompt for a save, displays "No hands detected" (or equivalent), writes no file, and resumes
   the live camera.
2. **Given** a detection with an invalid landmark count for a hand, **When** the user presses R,
   **Then** the application rejects the capture with a specific reason and writes no file.
3. **Given** a detection containing malformed landmark values (not finite numbers), **When**
   validation runs, **Then** the capture is rejected with a specific reason and no file is
   written.
4. **Given** the user is at the `pose_id` prompt, **When** they cancel, **Then** nothing is
   saved and the live camera resumes.

---

### User Story 3 - Grow a reusable, reproducible library (Priority: P3)

Over many sessions, one or more contributors record the same pose (say `open_palm`) dozens or
hundreds of times under different people, hand sizes, distances, and lighting. Every recording
adds a new sample beside the previous ones — nothing is ever replaced — and each sample carries
enough metadata that the conditions can be understood later.

**Why this priority**: The long-term value is a large, diverse, reproducible corpus per pose.
This behavior (append-only accumulation with rich metadata) is what turns individual captures
into a dataset, but it builds directly on US1's single-sample capture.

**Independent Test**: Record the same `pose_id` several times across separate sessions and
verify each produces a new, sequentially numbered sample with no overwrites, and that each
sample includes the reproducibility metadata (timestamp, camera details, versions, hand count,
handedness, confidence).

**Acceptance Scenarios**:

1. **Given** a pose already has samples, **When** a new sample of the same `pose_id` is
   recorded, **Then** a new sequentially numbered file is added and every existing sample is
   left unchanged.
2. **Given** a brand-new `pose_id`, **When** its first sample is recorded, **Then** the pose's
   collection is created and the first sample is numbered as the first entry.
3. **Given** any saved sample, **When** it is inspected, **Then** it contains reproducibility
   metadata: timestamp, camera resolution, camera index, hand-detection library version (if
   available), application version, number of hands, and per-hand handedness and confidence.
4. **Given** the same pose is recorded many times, **When** the collection is examined, **Then**
   it can hold a large number of samples (hundreds or thousands) with correct, collision-free
   numbering.

---

### Edge Cases

- **No hands when R is pressed**: rejected with a clear reason; nothing saved (US2).
- **Empty or unsafe `pose_id`** (blank, whitespace, or characters unsafe for a folder name):
  rejected; the user is asked again or can cancel.
- **Cancel mid-prompt**: nothing is saved; the live camera resumes.
- **First sample for a new pose**: the pose collection is created automatically.
- **Existing collection with gaps or manually added files**: new sample numbering continues past
  the highest existing number so nothing is overwritten.
- **One hand vs two hands**: both are supported; each hand is stored separately and labeled.
- **Malformed/partial landmark data** (missing points or non-finite values): rejected.
- **Same pose recorded in rapid succession**: each press produces a distinct new sample.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While the live camera is running, pressing **R** MUST enter pose-recording mode
  using the detection from the current frame.
- **FR-002**: On entering recording mode, the system MUST freeze and display the captured frame
  with a small recording indicator so the user sees exactly what is being recorded.
- **FR-003**: Before allowing a save, the system MUST validate the frozen capture: at least one
  hand is present, each detected hand has exactly 21 landmarks, and all landmark coordinates are
  finite, well-formed numbers.
- **FR-004**: If validation fails, the system MUST NOT write any file, MUST display a specific
  human-readable reason, and MUST return to the live camera.
- **FR-005**: On successful validation, the system MUST prompt for a required `pose_id` and an
  optional `display_name` and `description`.
- **FR-006**: `pose_id` MUST be the permanent internal identifier and MUST be a stable,
  folder-safe value; the system MUST reject an empty or unsafe `pose_id` and let the user retry
  or cancel. `display_name` and `description` MUST NEVER be used as identifiers.
- **FR-007**: The user MUST be able to cancel recording at any prompt, resulting in no file
  being written.
- **FR-008**: On confirmation, the system MUST save exactly one pose sample as a human-readable,
  indented, versioned record within the pose's own collection.
- **FR-009**: Samples MUST be numbered sequentially (e.g. `sample_000001`, `sample_000002`, …)
  and the system MUST NEVER overwrite or modify an existing sample; each recording appends a new
  one, numbered after the highest existing sample.
- **FR-010**: If the pose's collection does not yet exist, the system MUST create it; if it
  exists, new samples MUST be appended alongside the existing ones.
- **FR-011**: Stored samples MUST contain ONLY landmark coordinates (x, y, z per landmark) and
  metadata — never images, video frames, or screenshots.
- **FR-012**: Left and right hands MUST be stored separately and each clearly labeled by
  handedness.
- **FR-013**: For each hand, the system MUST store both the **raw** detector landmarks and the
  **normalized** landmarks. Normalization MUST make the hand invariant to its position and scale
  within the frame (translation to the wrist as origin, uniform scale by a reference hand span)
  while preserving orientation, and MUST be produced by a dedicated, replaceable normalization
  step. Persisting raw landmarks ensures a different normalization can be re-derived later on
  existing samples without re-recording.
- **FR-014**: Each sample MUST be versioned with a schema version and MUST include the fields:
  `schema_version`, `pose_id`, `display_name`, `description`, `sample_uuid`, `sample_number`,
  `timestamp`, `normalization`, `metadata`, and `hands`.
- **FR-015**: Sample metadata MUST include, for reproducibility: timestamp, camera resolution,
  camera index, hand-detection library version (when available), application version, number of
  hands, and per-hand handedness and confidence.
- **FR-016**: On every **successful** recording, the system MUST emit a structured INFO log that
  includes at minimum: `pose_id`, `sample_number`, `sample_uuid`, save location,
  `elapsed_duration_ms`, number of hands, and the normalization strategy. `elapsed_duration_ms`
  MUST measure the entire recording workflow — from entering recording mode (R pressed) until the
  sample is successfully written. Rejected or cancelled recordings MUST be logged as warnings with
  a descriptive reason (unchanged).
- **FR-017**: After any outcome (success, validation failure, or cancel), the system MUST resume
  the live camera without restarting the application.
- **FR-018**: The dataset MUST support a single `pose_id` accumulating a large number of samples
  (hundreds or thousands) contributed across many sessions without any structural change.
- **FR-019**: The recorder MUST depend on an abstract storage boundary so the storage medium can
  be replaced later without changing the recording or validation behavior.
- **FR-020**: Each sample MUST carry an immutable, globally-unique `sample_uuid` (the internal
  identifier) in addition to the sequential, filesystem-friendly `sample_number`. Future
  repositories, databases, and synchronization MUST be able to reference a sample by its
  `sample_uuid` rather than by filename.
- **FR-021**: Each sample MUST record how it was normalized as a `normalization` block containing
  a `strategy` name and a `version`, independent of the normalization implementation, so different
  normalization strategies are distinguishable without ambiguity.

### Key Entities *(include if data involved)*

- **Pose**: A named, reusable hand shape identified permanently by its `pose_id`, with optional
  human-facing `display_name` and `description`. A pose owns a growing collection of samples.
- **Pose Sample**: One recorded instance of a pose at a moment in time — the atomic dataset
  unit. Holds its immutable `sample_uuid`, its sequential `sample_number`, schema version,
  timestamp, the normalization record (strategy + version), the hands captured, and metadata.
- **Hand Sample**: The data for one detected hand within a sample — its handedness plus both its
  raw and its normalized landmark sets. Left and right hands are distinct hand samples.
- **Landmark**: A single point on a hand, expressed as x, y, z (present in both the raw and the
  normalized sets).
- **Pose Metadata**: The reproducibility context for a sample — timestamp, camera resolution,
  camera index, hand-detection library version, application version, number of hands, and
  per-hand handedness and confidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From pressing R on a valid detection to a saved sample, a user can complete the
  flow (including typing a `pose_id`) in under 20 seconds.
- **SC-002**: 100% of saves create a new sample file; no recording ever overwrites or alters an
  existing sample.
- **SC-003**: 100% of saved samples contain all required fields and reproducibility metadata.
- **SC-004**: 100% of invalid captures (no hands, wrong landmark count, or malformed values)
  result in no file written and a specific reason shown to the user.
- **SC-005**: A single `pose_id` can accumulate at least 1,000 samples across multiple sessions
  with correct, collision-free sequential numbering.
- **SC-006**: Zero image, frame, or screenshot artifacts are ever written by the recorder.
- **SC-007**: A person can open any saved sample and identify the `pose_id`, which hand(s) it
  contains, and the landmark values without special tooling.

## Assumptions

- The capture is the detection from the frame at the instant R is pressed (the frozen frame);
  the recorder reuses the existing live detection rather than performing a separate capture.
- `pose_id` convention is lowercase letters, digits, and underscores (snake_case), which is
  folder-safe; the system validates input against this and rejects unsafe values.
- Prompts (`pose_id`, `display_name`, `description`) are entered through the application's text
  console (terminal) while the frozen frame is displayed (resolved in Clarifications).
- "Normalized" means translation- and scale-invariant per hand (wrist origin, scaled by a
  reference hand span), preserving orientation; the algorithm is replaceable behind an interface.
  Both raw and normalized landmark sets are persisted so the normalization can be changed later
  without re-recording (resolved in Clarifications). Phase 1 drew raw detector coordinates; Phase
  2 introduces the normalization step for stored data.
- Multi-user contribution happens by sharing the dataset folder (e.g., via version control or
  shared storage); no networked/real-time multi-user coordination is in scope for this phase.
- Recording runs as a single local process at a time; concurrent writers to the same pose from
  separate processes are out of scope for guarantees.
- The stored record format is human-readable, indented JSON, versioned via `schema_version`
  (as mandated by the project constitution), starting at schema version 1.
- Only individual poses are in scope. Sequence recording, recognition, and gameplay are
  explicitly out of scope for Phase 2.
