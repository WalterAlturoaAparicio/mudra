# Feature Specification: Mudra Capture — Mobile Pose Dataset Collector

**Feature Branch**: `003-mobile-pose-capture`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Mudra Capture — a mobile application whose only responsibility is helping users build high-quality hand-pose datasets as fast and consistently as possible ('Duolingo for collecting computer vision datasets'). Primary success metric: how many high-quality samples a user can record in five minutes. Not the recognition engine, not a game. Two primary actions: Record and Sync. Predefined pose catalog with reference images and per-pose sample targets. Record starts a countdown over a live preview, then automatically captures ~1 second of hand landmarks, storing every valid frame as its own sample and reporting accepted vs discarded counts. Samples use the exact pose-sample JSON schema already defined by the Mudra engine. Sync exports the dataset as a ZIP preserving folder structure. No backend, no accounts, no recognition."

## Overview

Mudra Capture is a companion data-collection application for the Mudra engine. Its single job is
volume: turning a person with a phone and five minutes into hundreds of validated hand-pose
samples that the engine can consume with zero manual processing.

It deliberately does **not** recognize, classify, score, or interpret anything. It shows a pose to
imitate, counts down, records landmarks, tells the user how many samples survived validation, and
lets them export the result.

## Clarifications

### Session 2026-07-24

- Q: Should the catalog declare how many hands a pose requires, and should capture enforce it? → A: Declare and enforce — each pose carries a required hand count, and frames with fewer valid hands are discarded.
- Q: Which camera should Capture use by default, and with what mirroring? → A: Front-facing with a mirrored preview, matching the engine's selfie-view handedness convention.
- Q: No reference images exist yet for the 18 poses — what ships in this version? → A: Images are resolved per `pose_id` from bundled assets; missing images render a neutral placeholder so artwork can be dropped in later with no code change.
- Q: How should the exported archive reach the user on Android? → A: Via the system share sheet, so the user can send it anywhere without storage permissions.

### Session 2026-07-24 (post-analysis refinements)

Applied after the cross-artifact analysis report, closing its CRITICAL/HIGH findings and adding
traceability and integrity guarantees:

- Q: How is Principle V (structured observability) fully satisfied? → A: Explicit structured startup and shutdown records with a defined field set (FR-042/FR-043).
- Q: How is silent handedness corruption prevented? → A: The front camera is mandatory and explicit, the preview is mirrored, the selection is recorded in metadata, and unsupported configurations are rejected rather than silently accepted (FR-044).
- Q: How is the primary product metric verified? → A: A timed 5-minute benchmark counting accepted samples, with a ≥300 pass criterion, is part of the validation procedure (SC-001, now designated the primary KPI).
- Q: What links samples recorded together? → A: A `session_uuid` minted per capture session, carried by every sample it produced (FR-045/FR-046).
- Q: How does an importer discover what an archive contains? → A: A `manifest.json` at the archive root, which becomes the official entry point for importers (FR-047).
- Q: What prevents a corrupt dataset from being exported? → A: An integrity validation pass that aborts the export on critical failure (FR-048).
- Q: What prevents orientation changes from corrupting a capture? → A: Orientation is locked during a session, and an unexpected change aborts it without writing partial samples (FR-049/FR-050).

## Glossary

| Term | Meaning |
|---|---|
| **Sync** | The **user-facing** name of the second primary action. It is a label, not a mechanism — there is no server, account, or network involved. |
| **Dataset export** | The **internal/domain** name for what Sync performs: validate, package, and hand over the local dataset. All code, contracts, and tasks use this term (`ExportDataset`, `DatasetExporter`). |
| **Capture session** | One press of Record: countdown, capture window, validation, persistence. Identified by a `session_uuid`. |
| **Sample** | One validated frame of hand landmarks, stored as one JSON file. The atomic dataset unit. |
| **Pose collection** | All samples stored for one `pose_id`. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a burst of samples for a pose (Priority: P1)

A contributor opens the app, sees the pose they are currently collecting (e.g. "Dragon") with a
reference image showing the hand shape, and the count of samples already collected. They hold the
phone, press the large **Record** button, and a countdown appears over the live camera preview
while they shape their hand to match the reference. At zero the app captures automatically for
about a second without any further input, then immediately reports how many samples were accepted
and how many were discarded. The collected count and progress bar update on the spot.

**Why this priority**: This is the product. Every other story exists to support this loop; if only
this story shipped, a contributor could still build a real dataset.

**Independent Test**: Select a pose, press Record once, hold a hand in view, and verify that a
single press produces many stored samples for that pose and an on-screen accepted/discarded
summary — no other feature required.

**Acceptance Scenarios**:

1. **Given** a pose is selected and a hand is visible, **When** the user presses Record and holds
   the pose through the countdown and capture window, **Then** multiple samples are stored for that
   pose and the screen reports the number accepted and the number discarded.
2. **Given** the countdown is running, **When** the user watches the screen, **Then** the live
   camera preview remains visible and animated for the whole countdown (it never freezes) so they
   can adjust both hands into position.
3. **Given** a capture session just finished, **When** the summary is shown, **Then** the pose's
   collected count and progress bar reflect the newly accepted samples without any manual refresh.
4. **Given** the user wants more samples of the same pose, **When** they press Record again,
   **Then** a new session runs and appends to the same pose collection without overwriting earlier
   samples.

---

### User Story 2 - Trust the quality of what was collected (Priority: P1)

During capture, frames where the hand is missing, partially tracked, or malformed are discarded
rather than stored. Immediately after the session the contributor sees a plain-language result such
as "28 valid samples · 2 discarded", so they instantly know whether that take was good or whether
they should redo it with better framing or lighting.

**Why this priority**: Volume without quality produces a dataset that poisons the engine. Feedback
in the same breath as the capture is what makes a non-technical contributor self-correct.

**Independent Test**: Run a capture with the hand deliberately out of frame for part of the window
and verify that those frames are discarded, are not stored, and are reported in the discarded
count.

**Acceptance Scenarios**:

1. **Given** a capture window in which no hand is ever visible, **When** the session ends, **Then**
   zero samples are stored, the summary reports zero accepted, and the collected count is unchanged.
2. **Given** a capture window in which the hand enters view halfway through, **When** the session
   ends, **Then** only the frames with a complete, valid hand are stored and the rest are counted
   as discarded.
3. **Given** any stored sample, **When** it is inspected, **Then** it contains exactly 21 landmarks
   per hand with finite coordinates.
4. **Given** a pose declared as two-handed, **When** the user records it showing only one hand,
   **Then** every such frame is discarded, zero samples are stored, and the discarded count makes
   the reason evident.

---

### User Story 3 - Work through the pose catalog (Priority: P2)

The contributor finishes a pose and moves to the next one. Each pose shows its own reference image,
description, collected count, and a progress bar toward its target (e.g. 127 of 500). Poses that
have reached their target are visibly complete, which pulls the contributor toward finishing the
catalog rather than over-collecting one pose.

**Why this priority**: The catalog and progress are what turn a recording tool into something a
non-technical person will actually work through to completion, but the app is still useful for a
single pose without it.

**Independent Test**: Switch between poses and verify each shows its own reference image, target,
collected count, and progress, and that recording affects only the selected pose.

**Acceptance Scenarios**:

1. **Given** the pose catalog, **When** the user selects a different pose, **Then** the reference
   image, description, collected count, and progress bar all switch to that pose.
2. **Given** a pose with 127 of 500 samples collected, **When** the user views it, **Then** the
   progress indicator communicates roughly a quarter complete without requiring the user to read
   numbers.
3. **Given** a pose that has reached its target, **When** the user views it, **Then** it is clearly
   marked complete while still allowing further recording.
4. **Given** the app is reopened later, **When** the user views any pose, **Then** the collected
   counts reflect everything previously recorded on that device.

---

### User Story 4 - Hand the dataset to the engine (Priority: P2)

When the contributor has collected enough, they press **Sync**. The app packages everything
collected on the device into a single archive that preserves the dataset folder structure, and
offers it for sharing or saving. Someone on the engine side unpacks it directly into the engine's
dataset directory and it just works — no renaming, no conversion, no cleanup.

**Why this priority**: Data that cannot leave the phone has no value, but collection must exist
before export can be exercised.

**Independent Test**: Record samples for two poses, press Sync, and verify the produced archive
contains both pose folders with their sample files in engine-compatible form.

**Acceptance Scenarios**:

1. **Given** samples collected for several poses, **When** the user presses Sync, **Then** a single
   archive is produced containing one folder per pose with that pose's sample files inside.
2. **Given** the archive, **When** it is unpacked into the engine's dataset location, **Then** the
   engine reads every sample without errors or manual edits.
3. **Given** no samples have been collected yet, **When** the user presses Sync, **Then** they are
   told there is nothing to export rather than receiving an empty or broken archive.
4. **Given** an export has completed, **When** the user looks at the app, **Then** they are told
   where the archive is or are offered a way to share it.

---

### Edge Cases

- **Camera permission denied or revoked**: the app explains why the camera is needed and offers a
  way to grant permission; Record is unavailable rather than failing silently mid-session.
- **No hand visible for the entire capture window**: zero samples stored, summary states zero
  accepted, nothing is written to disk, and the user can immediately retry.
- **Hand leaves the frame mid-session**: partial results are kept — valid frames stored, invalid
  frames discarded and counted.
- **Fewer hands than the pose requires**: frames are discarded and counted, so a two-handed pose
  never stores one-handed samples; the user sees the high discard count and retries.
- **More hands than the pose requires**: every detected hand is recorded as detected; the app never
  judges pose correctness (that is the engine's job).
- **Degenerate hand geometry** (all landmarks nearly coincident, so scale cannot be derived):
  handled without producing infinite or NaN coordinates; the sample is either normalized safely or
  discarded, never stored corrupt.
- **Storage full or unwritable**: the user is told the samples could not be saved; counts do not
  claim samples that were not persisted.
- **App backgrounded or phone locked mid-countdown/mid-capture**: the session aborts cleanly, no
  partial or corrupt sample is written, and the app returns to a ready state.
- **Interrupting phone call or camera taken by another app**: same as above — clean abort with a
  clear message.
- **Reference image missing for a pose**: the pose remains usable and shows a neutral placeholder
  with its description instead of breaking the screen.
- **Export while a capture session is running**: the export is refused or queued rather than
  archiving a half-written sample.
- **Very large dataset (thousands of samples)**: the home screen and export remain responsive and
  do not stall the interface.
- **Device rotated during capture**: orientation is locked while a session runs (FR-049); an
  unexpected change aborts the session, writes nothing, and explains why (FR-050). Mislabeled or
  mis-oriented data is never stored silently.
- **Session hits the configured sample limit**: capture stops accepting frames, the session finalizes
  normally with everything already accepted, and the user is told the limit was reached (FR-051).
- **Unsupported camera configuration** (no front camera, or mirroring unavailable): the application
  refuses to record and says why, rather than capturing data whose handedness cannot be trusted
  (FR-044).
- **Dataset fails integrity validation at export**: the export aborts with a clear explanation and no
  archive is produced (FR-048).

## Requirements *(mandatory)*

### Functional Requirements

**Pose catalog**

- **FR-001**: The application MUST load its pose catalog from local configuration data, not from
  code embedded in the interface, so poses can be added, renamed, or retargeted without changing
  the application's screens.
- **FR-002**: Each catalog entry MUST provide a stable `pose_id`, a human-readable display name, a
  description, a reference image reference, a target sample count, and the number of hands the pose
  requires (one or two).
- **FR-003**: The initial catalog MUST contain exactly these 18 poses: bird, dog,
  domain_expansion, dragon, hare, hi, horse, militar_hi, monkey, ok, ox, peace, ram, rat, snake,
  tiger, tp, wild_boar.
- **FR-004**: Every stored sample MUST reference its pose by `pose_id`; display names MUST never be
  used as identifiers.
- **FR-005**: Reference images MUST be resolved from bundled assets by `pose_id`, and the
  application MUST remain fully usable when a pose's image is absent, showing a neutral placeholder
  carrying the pose name and description instead of failing. Adding artwork later MUST require no
  change to the application's screens.

**Home screen**

- **FR-006**: The home screen MUST display, for the currently selected pose: its name, its
  reference image, the number of samples collected, and a progress indicator toward its target.
- **FR-007**: The home screen MUST offer exactly two primary actions — Record (prominent) and Sync
  (secondary) — and MUST NOT present recognition, prediction, statistics, review, or account
  features.
- **FR-008**: Users MUST be able to change the selected pose and see all pose-specific information
  update accordingly.
- **FR-009**: Collected counts and progress MUST reflect what is actually stored on the device,
  including after the app is closed and reopened.

**Recording**

- **FR-010**: Pressing Record MUST start a visible countdown before any capture begins.
- **FR-011**: The live camera preview MUST remain visible and updating throughout the countdown;
  it MUST NOT freeze, so the user can position one or both hands while watching themselves.
- **FR-012**: The pose's reference image MUST remain **visible on screen during the countdown**, as a
  thumbnail alongside the live preview and the countdown, so the user can compare their hands against
  the target shape at the moment it matters. The preview, the countdown, and the reference are shown
  together — never one instead of another.
- **FR-013**: When the countdown reaches zero, capture MUST begin automatically without further
  user input.
- **FR-014**: A capture session MUST record hand landmarks continuously for a configured window of
  approximately one second, producing many samples from a single press.
- **FR-015**: Every accepted frame in the session MUST be stored as its own independent sample.
- **FR-016**: Users MUST be able to cancel a countdown or an in-progress session, with no samples
  stored from a cancelled session.
- **FR-017**: The application MUST NOT require the user to press Record once per sample.
- **FR-018**: Consecutive sessions for the same pose MUST append to that pose's collection and MUST
  NOT overwrite or modify previously stored samples.
- **FR-051**: When a session reaches the configured maximum sample count, the application MUST stop
  accepting new frames, finalize the session normally (persisting everything already accepted), and
  tell the user in plain language that the configured limit was reached — never truncate silently and
  never discard already-accepted work.

**Quality**

- **FR-019**: Each captured frame MUST be validated before storage; frames without at least one
  detected hand, without exactly 21 landmarks per hand, or with non-finite coordinates MUST be
  discarded.
- **FR-019a**: A frame MUST additionally be discarded when it contains fewer hands than the selected
  pose requires (FR-002), so a two-handed pose never accumulates one-handed samples.
- **FR-019b**: The selected pose's required hand count MUST be visible to the user before and during
  a session, so a discarded-heavy result is self-explanatory.
- **FR-020**: Discarded frames MUST NOT be written to storage in any form.
- **FR-021**: Immediately after each session the application MUST display the number of samples
  accepted and the number discarded, in plain language.
- **FR-022**: The application MUST NOT evaluate whether the user performed the *correct* pose — it
  validates landmark integrity only, never pose identity.

**Progress**

- **FR-023**: Each pose MUST have a target sample count and a progress indicator showing collected
  versus target.
- **FR-024**: Reaching a pose's target MUST be visually distinct, while still allowing additional
  samples to be recorded.

**Storage & schema compatibility**

- **FR-025**: Samples MUST be persisted locally using the exact pose-sample JSON schema already
  defined by the Mudra engine (`schema_version` 1), with no added, renamed, removed, or reordered
  fields.
- **FR-026**: Samples MUST be organized as append-only per-pose collections mirroring the engine's
  layout: one directory per `pose_id`, containing sequentially numbered sample files.
- **FR-027**: Each sample MUST contain both the raw detector landmarks and the normalized
  landmarks, with normalization producing values identical to the engine's `translation_scale`
  strategy version 1.0 for the same input.
- **FR-028**: Each sample MUST record the reproducibility metadata the schema requires, including
  capture timestamp, camera dimensions, application and detector versions, hand count, and per-hand
  handedness and confidence.
- **FR-029**: Sample numbering MUST be sequential and MUST never reuse or overwrite an existing
  sample number for a pose.
- **FR-030**: The application MUST NOT persist images, video frames, or any pixel data — only
  landmark coordinates and metadata.
- **FR-031**: Reference images MUST be treated as user-guidance assets only and MUST NOT be copied
  into, referenced by, or derived into any dataset artifact.

**Session identity & traceability**

- **FR-045**: Every capture session MUST mint a `session_uuid`, and every sample it produces MUST
  carry that identifier, so the samples recorded together are recoverable as a group.
- **FR-046**: The application MUST record, per session: `session_uuid`, start time, finish time,
  accepted sample count, and discarded frame count. Future analytics and synchronization reference
  the session by `session_uuid`, never by time or file order.
- **FR-052**: Session identity and all other new metadata MUST be **additive and backwards
  compatible**: the engine's pose-sample schema is not redefined, `schema_version` stays `1`, no
  existing field changes meaning, and a reader that ignores the new fields still reads every sample
  correctly.

**Dataset integrity & manifest**

- **FR-047**: Every exported archive MUST contain a `manifest.json` at its root describing the
  archive's contents: schema version, capture application version, export timestamp, device and
  platform information, total sample count, per-pose sample counts, normalization strategy and
  version, and per-collection checksums where computable. The manifest is the **official entry point
  for importers** — an importer must be able to understand an archive by reading it alone.
- **FR-048**: Before packaging, the application MUST run a dataset integrity validation covering:
  parseable JSON, schema compliance, expected folder structure, duplicate detection, and valid
  `pose_id` values. Critical failures MUST abort the export with a clear explanation rather than
  producing a suspect archive; non-critical findings MUST be reported and recorded in the manifest.

**Export (Sync)**

- **FR-032**: Sync MUST package the locally collected dataset into a single archive file that
  preserves the per-pose folder structure.
- **FR-033**: The archive MUST be directly importable into the engine's dataset directory with no
  renaming, conversion, or manual cleanup.
- **FR-034**: Sync MUST operate entirely on-device: no network access, no account, no
  authentication, and no cloud service.
- **FR-035**: After a successful export the application MUST offer the archive through the system
  share mechanism, so the user can send or save it anywhere without granting storage permissions.
- **FR-036**: Exporting with no collected samples MUST produce a clear message rather than an empty
  or invalid archive.

**Platform & permissions**

- **FR-037**: The application MUST request camera permission before recording and MUST explain why
  it is needed if permission is denied.
- **FR-037a**: The application MUST use the front-facing camera with a mirrored preview, so the user
  can watch and correct their own hands while posing, and MUST record handedness with the same
  physical-hand meaning the engine's selfie-view convention assumes.
- **FR-044**: The front-facing camera MUST be selected **explicitly**, never left to a platform
  default. The application MUST record the selected camera in each sample's metadata, MUST verify
  that handedness remains correct under mirroring, and MUST **reject an unsupported camera
  configuration** with a clear error instead of recording against it. *This requirement exists to
  prevent silent dataset corruption: a rear-facing or unmirrored capture produces handedness labels
  that are wrong in a way neither the app nor the engine can detect afterwards.*

**Orientation safety**

- **FR-049**: Screen orientation MUST be locked for the duration of a capture session (countdown and
  capture window), so frame geometry cannot change mid-session.
- **FR-050**: If orientation changes unexpectedly during a session, the application MUST abort the
  capture safely, write **no** samples from that session, explain what happened, and return to idle;
  recording may resume only from the idle state.

**Observability**

- **FR-042**: The application MUST emit a structured **startup** record containing: application
  version, configuration profile, dataset root, catalog size, camera configuration, and platform
  information.
- **FR-043**: The application MUST emit a structured **shutdown** record containing: session
  duration, total recorded samples, total discarded samples, export count, and explicit confirmation
  of a graceful shutdown.
- **FR-038**: The application MUST function fully offline.
- **FR-039**: The application MUST NOT transmit collected data anywhere off the device.

**Out of scope (explicitly not built)**

- **FR-040**: The application MUST NOT include recognition, classification, prediction, or any
  model inference over the collected data.
- **FR-041**: The application MUST NOT include gameplay, cloud sync, accounts, online datasets,
  leaderboards, gamified rewards, AI assistance, statistics dashboards, or dataset review/editing
  tools.

### Key Entities

- **Pose (catalog entry)**: A pose the user is asked to perform. Identified by a stable `pose_id`;
  carries a display name, a description, a reference image, a target sample count, and the number of
  hands it requires. Configuration data, not user data.
- **Capture session**: One press of Record. Identified by a `session_uuid` and described by its start
  time, finish time, accepted count, and discarded count. Every sample it produces carries its
  identifier, making a take recoverable as a group long after the fact.
- **Dataset manifest**: The descriptive record placed at the root of every export — schema version,
  capture version, export timestamp, device and platform, totals, per-pose counts, normalization
  identity, and checksums. The official entry point for any importer.
- **Integrity report**: The outcome of validating a dataset before export — what was checked, what
  passed, and any critical failure that blocked the export.
- **Sample**: One validated frame of hand landmarks for one pose, stored as an independent,
  human-readable record containing raw and normalized landmarks plus reproducibility metadata. The
  atomic unit of the dataset and the unit of compatibility with the engine.
- **Pose collection**: All samples stored for one `pose_id`, append-only and sequentially numbered.
- **Dataset export**: A single archive containing all pose collections, structured exactly as the
  engine expects to consume them.
- **Progress**: The relationship between a pose's collected sample count and its target, surfaced
  to motivate completion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** ⭐ **PRIMARY PRODUCT KPI**: A contributor collects at least **300 validated samples in
  five minutes** of continuous use, measured from opening the app. Verified by an explicit timed
  benchmark (see `quickstart.md`): run a 5-minute recording session, count accepted samples on disk,
  pass at ≥300. Every other criterion exists to serve this one.
- **SC-002**: A single Record press yields **at least 20 stored samples** under normal conditions
  (hand visible, adequate lighting), so no user needs to press Record once per sample.
- **SC-003**: A complete cycle — press Record, countdown, capture, see the result — completes in
  **under 6 seconds**, and the user can start the next cycle immediately.
- **SC-004**: **100% of stored samples** pass the engine's own validation rules (at least one hand,
  exactly 21 landmarks per hand, finite coordinates).
- **SC-005**: **100% of exported datasets** are imported by the engine with **zero manual
  processing** — no renaming, conversion, or repair steps.
- **SC-006**: A non-technical user, with no instruction beyond the app itself, completes their
  first successful capture session within **60 seconds** of first opening the app.
- **SC-007**: The user can state, immediately after any session, how many samples were kept and how
  many were rejected — the information is on screen without navigation.
- **SC-008**: **Zero image, video, or pixel data** exists anywhere in the stored dataset or the
  exported archive.
- **SC-009**: No previously stored sample is ever modified or overwritten across an arbitrary
  number of sessions.
- **SC-010**: The countdown keeps the camera preview live — a user positioning both hands during
  the countdown can see themselves for **100% of the countdown duration**.
- **SC-011**: The app remains responsive (no frozen interface) with at least **5,000 samples**
  stored on the device.
- **SC-012**: **100% of stored samples for a two-handed pose contain two hands** — no one-handed
  sample is ever filed under a pose declared as two-handed.
- **SC-013**: **100% of stored samples carry a `session_uuid`** that resolves to a recorded session,
  so any sample can be traced back to the take that produced it.
- **SC-014**: **100% of exported archives contain a valid manifest** listing every pose collection
  and a total sample count that matches the archive's actual contents exactly.
- **SC-015**: **Zero datasets failing critical integrity validation are ever exported** — a corrupt
  or duplicated dataset produces an aborted export with an explanation, never an archive.
- **SC-016**: **Zero partial samples exist after any interruption** — orientation change,
  backgrounding, or camera loss during a session leaves either a complete session or nothing at all.
- **SC-017**: Every application run produces exactly one structured startup record and, on a graceful
  exit, exactly one structured shutdown record carrying the session and sample totals.

## Assumptions

- **Capture window**: "approximately one second" is taken as a configurable window defaulting to
  1.0 second. At typical mobile detection rates this yields roughly 20–30 samples per press, which
  satisfies SC-002.
- **Countdown length**: defaults to 3 seconds, configurable — long enough to place both hands,
  short enough to keep the 5-minute throughput metric.
- **Every valid frame is kept**: no de-duplication or similarity filtering is applied. Near-identical
  consecutive frames are considered legitimate dataset variety, per the explicit instruction to
  store every captured frame.
- **Default target**: poses default to 500 samples each unless the catalog specifies otherwise.
- **Hands per sample**: the catalog declares each pose's required hand count and validation enforces
  it (FR-002/FR-019a); poses default to one hand unless declared two-handed. Two-handed poses (e.g.
  domain_expansion, tp) are precisely why countdown-then-auto-capture matters — neither hand is
  needed to press a button.
- **Camera**: front-facing and mirrored, selected explicitly (FR-037a/FR-044). Switching to the rear
  camera is not offered in this version; the minimal two-action screen is deliberate.
- **Additive metadata only**: `session_uuid` and the manifest are additions that leave the engine's
  sample schema intact (FR-052). `session_uuid` travels inside the existing `metadata.capture` block
  — the same additive pattern the engine itself used when that block was introduced — so an engine
  that ignores it still reads every sample. **Known consequence**: an engine load-then-resave cycle
  currently drops the field, since the engine's serializer only preserves the keys it knows. Making
  the engine round-trip `session_uuid` is a follow-up on the engine side, not a change to this
  feature's contract.
- **Manifest is not a schema change**: `manifest.json` lives at the archive root, beside the dataset
  tree, so it is invisible to anything reading individual samples.
- **Single contributor per device**: no accounts, no per-user separation; the dataset on a device is
  one pool. Attribution, if ever needed, happens outside the app.
- **Export is a full snapshot**: each Sync exports everything currently on the device, not a delta.
  Re-exporting is safe and repeatable.
- **Reference images ship with the application** as static assets keyed by `pose_id`. No artwork
  exists yet, so this version ships with placeholders (FR-005) for every pose; real images can be
  dropped into the asset folder at any time without touching code, and catalog growth is never
  blocked on artwork.
- **Landmark detection**: the same hand-landmark detection technology as the engine is used on
  device, so coordinate conventions and handedness semantics match without translation.
- **Storage location**: samples are written to application-private storage; the export step is what
  makes them reachable by the user.
- **Android first**: the first release targets Android phones; nothing in this specification is
  Android-specific, so a later iOS release requires no behavioral change.

## Dependencies

- The Mudra engine's pose-sample JSON schema (`schema_version` 1) and its `translation_scale`
  normalization strategy (v1.0) are the fixed contract this application writes against. Any change
  to that schema is a cross-application event affecting this feature.
- On-device hand-landmark detection providing 21 landmarks per hand, handedness, and per-hand
  confidence.
- Device camera and camera permission.
