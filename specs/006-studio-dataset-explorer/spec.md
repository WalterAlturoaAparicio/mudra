# Feature Specification: Mudra Studio — Dataset Explorer

**Feature Branch**: `006-studio-dataset-explorer`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "We are starting a new desktop application inside the Mudra monorepo (apps/studio) — Mudra Studio, the desktop IDE built on top of Mudra Engine. This first milestone is dataset exploration and visual inspection only ('VS Code for Mudra datasets'): a left navigation rail with a working Dataset page (Capture, Recognition, Training, Calibration, Settings are placeholders), a pose tree → sample list → statistics layout on the left/center with a landmark visualization + metadata panel on the right, raw vs. normalized landmark rendering with zoom/pan/reset/fit, multi-sample overlay comparison, a per-pose statistics summary, and canvas architecture reserved for future outlier highlighting. Studio must consume Engine's dataset and domain-model logic rather than duplicating it, and must not implement training, export, editing, camera capture, recognition, or any change to Engine."

## Clarifications

### Session 2026-07-28

- Q: Should Mudra Studio let the user pick a different dataset directory at runtime, or always read from the repo's bundled datasets/poses folder for this milestone? → A: Fixed to the repo's bundled `datasets/poses` folder; no in-app folder picker this milestone.
- Q: How large a dataset (samples per pose) should this milestone be expected to handle smoothly without special performance work like virtualized lists? → A: Hundreds of samples per pose, with a plain list/tree and no virtualization work required.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect a single recorded sample (Priority: P1)

A developer browses the pose dataset, picks a pose category, picks one recorded sample, and immediately sees that sample's hand landmarks drawn on screen alongside every metadata field that was captured with it (handedness, confidence, timestamps, camera info, normalization strategy, schema/application versions).

**Why this priority**: This is the core "VS Code for datasets" loop — without it, nothing else in the milestone has a reason to exist. It alone answers "is this pose recorded correctly? is handedness right? is normalization producing sane output?"

**Independent Test**: Launch the application, select a pose category with at least one sample, select that sample, and confirm the landmark drawing and every metadata field render correctly with no other feature implemented.

**Acceptance Scenarios**:

1. **Given** the dataset contains at least one pose category with recorded samples, **When** the developer selects that pose in the pose tree, **Then** every sample belonging to that pose appears in the sample list.
2. **Given** a sample is selected from the sample list, **When** the visualization loads, **Then** all 21 hand landmarks and their connecting topology render for each hand present in the sample, and the metadata panel shows pose ID, display name, description, timestamp, sample UUID, sample number, handedness, confidence, normalization strategy, application version, camera metadata, capture metadata, and schema version.
3. **Given** a sample is displayed, **When** the developer switches between raw and normalized coordinate mode, **Then** the drawing updates to reflect the selected mode without any other step required.
4. **Given** a sample is displayed, **When** the developer zooms, pans, resets the view, or fits the drawing to the viewport, **Then** the visualization responds accordingly without distorting the landmark proportions.
5. **Given** a sample is displayed, **When** the developer toggles landmark index labels, **Then** each of the 21 points shows or hides its numeric index accordingly.

---

### User Story 2 - Compare multiple samples to spot noise and outliers (Priority: P2)

A developer selects several samples recorded for the same pose and views all of them overlaid in one visualization, using transparency to reveal how much the landmarks vary from sample to sample.

**Why this priority**: Single-sample inspection cannot answer "is this pose consistent across recordings?" — the question that most directly determines whether a pose is ready for training. This is the highest-value feature after basic single-sample inspection.

**Independent Test**: With User Story 1 already working, select multiple samples from the same pose's sample list and confirm all of them render simultaneously, semi-transparently, in the same visualization — independently verifiable without statistics or any other page.

**Acceptance Scenarios**:

1. **Given** a pose has multiple samples, **When** the developer selects more than one sample in the sample list, **Then** the landmarks of every selected sample render together in the same visualization, each at reduced opacity so overlapping regions remain distinguishable.
2. **Given** multiple samples are overlaid, **When** the developer switches between raw and normalized mode, **Then** all selected samples redraw consistently in the newly chosen mode.
3. **Given** samples are selected from one pose, **When** the developer selects a different pose in the pose tree, **Then** the previous multi-selection is cleared and the visualization reflects only the new pose's data.

---

### User Story 3 - Review per-pose statistics to judge dataset readiness (Priority: P3)

A developer selects a pose category and reads a summary of how many samples exist, how they split between left and right hands, what the average detection confidence was, and when the first and last samples were captured — enough to judge, at a glance, whether the pose has enough good-quality data to be considered ready.

**Why this priority**: Useful on its own, but it's a summary layer on top of the data already exposed by User Story 1; it doesn't unblock the noise/outlier questions the way User Story 2 does.

**Independent Test**: With a pose selected, confirm the statistics panel shows sample count, left/right hand counts, average confidence, first/last capture timestamps, and normalization strategy — verifiable without opening any single sample.

**Acceptance Scenarios**:

1. **Given** a pose category with recorded samples is selected, **When** the statistics panel loads, **Then** it shows total sample count, left-hand count, right-hand count, average confidence, first capture time, last capture time, and normalization strategy.
2. **Given** the developer selects a different pose, **When** the new pose loads, **Then** the statistics panel updates to reflect only that pose's samples.

---

### User Story 4 - Navigate a shell ready for future tools (Priority: P4)

A developer opens Mudra Studio and sees a left navigation rail listing Dataset, Capture, Recognition, Training, Calibration, and Settings. Dataset is fully usable; the others clearly indicate they are not yet available, so the shell communicates the product's future shape without pretending unfinished features work.

**Why this priority**: Structural scaffolding, not a data-inspection capability — lowest priority, but needed so the milestone doesn't paint the Dataset page in without a place for it to live.

**Independent Test**: Launch the application and click each non-Dataset navigation entry; confirm each shows a clear "not yet available" placeholder and never errors or appears functional.

**Acceptance Scenarios**:

1. **Given** the application is launched, **When** the developer views the navigation rail, **Then** Dataset, Capture, Recognition, Training, Calibration, and Settings are all listed.
2. **Given** the developer selects any placeholder entry, **When** the page loads, **Then** it clearly indicates the page is not yet implemented and offers no non-functional controls that appear interactive.

### Edge Cases

- What happens when the dataset directory contains no pose categories at all (fresh checkout, nothing recorded yet)?
- What happens when a pose category exists but has zero recorded samples?
- How does the system handle a sample file that is missing, corrupted, or fails schema validation — does it skip it, and does the developer see that it was skipped?
- How does the visualization handle a sample recorded with two hands present at once?
- How does raw/normalized switching behave for a sample whose normalized coordinates are absent (e.g., an older schema version)? *Resolved*: under the current schema the normalized block is mandatory, so such a sample never loads — it is skipped with a reason per FR-022 and the switch never encounters it. See Assumptions.
- What happens when a developer selects a very large number of samples at once in multi-sample mode (up to a few hundred, the expected scale for this milestone) — does the view degrade gracefully rather than becoming unusable or crashing?
- What happens to the current selection and visualization state when the developer switches poses mid-inspection?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST present a left navigation rail with entries for Dataset, Capture, Recognition, Training, Calibration, and Settings.
- **FR-002**: Only the Dataset entry MUST be functional in this milestone; all other entries MUST display a clear "not yet implemented" placeholder and take no other action.
- **FR-003**: The Dataset page MUST display a pose tree listing every pose category found in the dataset.
- **FR-003a**: The application MUST always read from the repository's bundled `datasets/poses` directory; this milestone MUST NOT provide a way to select or open a different dataset location.
- **FR-004**: Selecting a pose category MUST load and list every sample recorded for that pose.
- **FR-005**: Selecting a single sample MUST render that sample's landmarks and populate the metadata panel for it.
- **FR-006**: The metadata panel MUST display, for the selected sample: pose ID, display name, description, timestamp, sample UUID, sample number, handedness, confidence, normalization strategy, application version, camera metadata, capture metadata, and schema version.
- **FR-007**: The landmark visualization MUST render all 21 hand landmarks and their connecting topology for each hand present in the selected sample(s).
- **FR-008**: The landmark visualization MUST visually distinguish left-hand landmarks from right-hand landmarks.
- **FR-009**: The developer MUST be able to toggle numeric landmark index labels on and off.
- **FR-010**: The developer MUST be able to switch between raw-coordinate and normalized-coordinate visualization modes, with the drawing updating immediately on switch.
- **FR-011**: The developer MUST be able to zoom, pan, reset the view, and fit the drawing to the viewport.
- **FR-012**: The developer MUST be able to select multiple samples at once from the sample list.
- **FR-013**: When multiple samples are selected, the visualization MUST render all of their landmarks simultaneously, each at reduced opacity, so overlapping regions remain distinguishable.
- **FR-014**: Changing the selected pose MUST clear any prior multi-sample selection and reset the visualization to the new pose's data.
- **FR-015**: The statistics panel MUST display, for the selected pose: total sample count, left-hand count, right-hand count, average confidence, first capture timestamp, last capture timestamp, and normalization strategy.
- **FR-016**: The statistics panel MUST update automatically whenever the selected pose changes.
- **FR-017**: The application MUST only read recorded dataset files; it MUST NOT modify, delete, rename, or create any dataset or sample file.
- **FR-018**: The landmark visualization component MUST expose a way to flag or highlight individual samples for emphasis, without implementing any outlier-detection logic in this milestone — the mechanism must exist so future outlier detection can use it without visualization rework.
- **FR-019**: The application MUST consume Mudra Engine's existing dataset-reading and domain-model logic (pose, sample, landmark topology, normalization) for all dataset access, rather than re-implementing dataset parsing independently.
- **FR-020**: The application MUST render all visualizations as native desktop UI content embedded in the application's own window; it MUST NOT open a separate external video/preview window for any visualization.
- **FR-021**: When a selected pose category has zero recorded samples, the application MUST show a clear empty state rather than an error or a blank panel.
- **FR-022**: When a sample file cannot be read or fails validation, the application MUST skip that sample, continue loading the remaining valid samples in the pose, and visibly indicate that at least one sample was skipped.
- **FR-023**: The application MUST NOT modify, extend, or duplicate Mudra Engine's source code; all reuse MUST happen through consuming Engine's existing public interfaces.
- **FR-024**: This milestone MUST NOT implement model training, dataset export, sample editing, camera capture, or pose recognition.

### Key Entities

- **Pose Category**: A named gesture in the dataset (pose ID, display name, description) that groups together every sample recorded for it.
- **Dataset Sample**: One recorded observation of a pose — identified by sample UUID and sample number, with a capture timestamp, schema version, one or more hand observations, capture metadata, camera metadata, application/library version info, and the normalization strategy applied to it.
- **Hand Observation**: One hand's data within a sample — handedness, detection confidence, its raw (camera-space) landmark set, and its normalized landmark set.
- **Landmark**: A single 3D point (x, y, z) at one of 21 fixed positions on a hand, connected to specific other landmarks by a fixed topology shared across all hands.
- **Pose Statistics Summary**: Aggregated metrics derived from a pose category's current samples — sample count, left/right hand split, average confidence, first/last capture time, and normalization strategy in use.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from launching the application to viewing a specific recorded sample's landmarks and full metadata in three selections or fewer (pose, then sample).
- **SC-002**: Every metadata field recorded with a sample is visible inside the application, with no need to open the underlying dataset file directly.
- **SC-003**: Switching visualization mode (raw/normalized) or toggling landmark indices produces a visibly instantaneous update, with no separate loading step or page reload.
- **SC-004**: A developer can overlay 10 or more samples from the same pose at once and visually identify which landmarks vary the most across recordings, without using any tool outside the application.
- **SC-005**: Selecting a pose with zero recorded samples communicates that clearly within the same view, never as a blank panel or an unhandled error.
- **SC-006**: Across a full exploration session, no dataset file's contents change as a result of using the application — the dataset on disk before and after a session is byte-for-byte identical.
- **SC-007**: The application remains responsive (browsing, selecting, and visualizing samples with no perceptible freeze) for a pose category with up to several hundred recorded samples, using only a plain list/tree with no specialized performance work.

## Assumptions

- The dataset root is fixed to the monorepo's existing `datasets/poses` directory for this milestone (confirmed via clarification; see FR-003a).
- Mudra Studio consumes Mudra Engine's existing dataset repository, serializer, and domain models (pose, sample, landmark, normalization) rather than parsing sample files independently, per the project's architecture boundary between Engine and its consuming applications.
- A sample may contain more than one hand observation; the visualization renders every hand present in the sample it is showing.
- A sample that lacks normalized coordinates is **skipped at load time with a stated reason** and surfaced through the same skipped-sample indicator as any other unreadable sample (FR-022) — it is never silently dropped, and it never causes an error. *Corrected 2026-08-18 during design review*: this assumption originally read "shown as unavailable in normalized mode". Reading the schema showed that under `schema_version` 1 the normalized block is **mandatory**, so such a sample fails validation during parsing and can never reach the visualization at all. The behavior is therefore FR-022's, not a per-mode display state. The visualization retains an "unavailable" presentation path as a reserved seam for a hypothetical future schema in which normalized coordinates become optional; it is unreachable today.
- The non-Dataset navigation entries (Capture, Recognition, Training, Calibration, Settings) are placeholders only in this milestone; no functional behavior is expected behind them.
- Outlier detection logic itself is out of scope for this milestone; only the visualization's ability to later highlight flagged samples needs to exist.
- Multi-sample selection has no fixed maximum in this milestone; the application is expected to stay responsive up to a few hundred samples per pose (see SC-007), and very large selections beyond that may reduce visual clarity but must not cause the application to crash.
- The 21-point hand landmark topology already defined for dataset capture is reused as-is; this milestone does not introduce a new landmark model.
