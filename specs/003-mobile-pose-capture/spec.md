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
- Q: Which camera should Capture use by default, and with what mirroring? → A: Front-facing with a mirrored preview, matching the engine's selfie-view handedness convention. *(Partially superseded by Revision R1 — the front camera is now the Self Capture default rather than the only permitted configuration; the mirrored convention it established is retained as the canonical one.)*
- Q: No reference images exist yet for the 18 poses — what ships in this version? → A: Images are resolved per `pose_id` from bundled assets; missing images render a neutral placeholder so artwork can be dropped in later with no code change.
- Q: How should the exported archive reach the user on Android? → A: Via the system share sheet, so the user can send it anywhere without storage permissions.

### Session 2026-07-24 (post-analysis refinements)

Applied after the cross-artifact analysis report, closing its CRITICAL/HIGH findings and adding
traceability and integrity guarantees:

- Q: How is Principle V (structured observability) fully satisfied? → A: Explicit structured startup and shutdown records with a defined field set (FR-042/FR-043).
- Q: How is silent handedness corruption prevented? → A: The front camera is mandatory and explicit, the preview is mirrored, the selection is recorded in metadata, and unsupported configurations are rejected rather than silently accepted (FR-044). *(Superseded by Revision R1 — the guarantee is preserved, but through capture-time conversion into the canonical convention rather than by forbidding the rear lens.)*
- Q: How is the primary product metric verified? → A: A timed 5-minute benchmark counting accepted samples, with a ≥300 pass criterion, is part of the validation procedure (SC-001, now designated the primary KPI).
- Q: What links samples recorded together? → A: A `session_uuid` minted per capture session, carried by every sample it produced (FR-045/FR-046).
- Q: How does an importer discover what an archive contains? → A: A `manifest.json` at the archive root, which becomes the official entry point for importers (FR-047).
- Q: What prevents a corrupt dataset from being exported? → A: An integrity validation pass that aborts the export on critical failure (FR-048).
- Q: What prevents orientation changes from corrupting a capture? → A: Orientation is locked during a session, and an unexpected change aborts it without writing partial samples (FR-049/FR-050). *(Scope widened by revision R1.1 — the lock now spans the whole capture screen, not only an in-flight take.)*

### Session 2026-07-25 (Revision R1 — camera lifecycle, capture modes, preview fidelity)

Recorded during the revision that folded the former specification 004 into this one. See
[Revision History](#revision-history).

- Q: The countdown default is described both per-mode and per-lens — which wins when the lens is switched within a mode? → A: The mode wins. The capture mode establishes the countdown once at session initialization; thereafter it is a user-controlled session setting, and switching lenses never changes it automatically. *(R1.1 pinned down which "session": the **capture session** — see the Glossary — and stated that re-entering the screen without a mode change does not re-initialize.)*
- Q: Once the rear lens is allowed, how should rear-camera samples relate to the fixed mirroring convention every existing sample assumes? → A: Normalize at capture. Rear-camera captures are converted into the canonical convention before storage, so all samples stay directly comparable and no consumer needs to correct for lens.
- Q: A sample stores two landmark sets — the earliest-stored form and the normalized form. Which does the conversion apply to? → A: Both. The dataset is the canonical source of truth, not a byte-for-byte recording of the detector. Any deterministic transformation needed to make samples device-, lens-, and platform-independent is applied before persistence, and the earliest-stored landmark set is therefore the **canonical raw** form — suitable for regenerating future normalization strategies.
- Q: Is the "canonical raw" rename conceptual, or does the persisted field name change too? → A: Conceptual only. The specification, domain model, and documentation adopt the term and the field's redefined meaning; persisted field names and sample structure are unchanged, so `schema_version` stays `1` and the engine needs no change.
- Q: After a take completes, does the capture screen stay put or return to the pose list? → A: Stay, and show a per-take summary the user dismisses before the next take — so a bad take is noticed immediately — with a session option to turn that confirmation off.

### Session 2026-07-27 (Revision R2 — developer debug overlay)

- Q: This overlay attaches to the shared `PreviewStage`/camera-landmark pipeline used by both the capture screen and the recognition preview screen (specification 005). Which specification should own it? → A: This one. 003 already owns "the whole Mudra Capture mobile app, including the camera subsystem" (see Revision History); the overlay is camera/landmark debug tooling, not a recognition-specific capability, and 005's mandate stays untouched.
- Q: Should the overlay be available on the capture screen, the recognition preview screen, or both? → A: Both. They already share the same camera session and the same `PreviewStage` widget, so supporting both costs nothing extra and a developer debugging either flow benefits equally.

### Session 2026-07-28 (Revision R3 — persistent per-device camera calibration)

- Q: A working preview/overlay transform was found by hand on the reference device using the D25 calibration screen — should the next step be another automatic fix attempt, or something else? → A: Something else. Stop trying to derive one universal transform for every Android device; instead make the found values this device's **default** calibration, persist them per device, and keep the calibration screen permanently available so any future device can find and keep its own.
- Q: Should the calibration screen stay a standalone, disconnected instrument (as D25 deliberately built it) now that its values are the real production input? → A: No — it now renders through the same `PreviewStage`/landmark-overlay widgets the capture and recognition screens use, so a value found on the calibration screen is guaranteed to produce the identical result there. Two separate rendering pipelines is exactly the drift that caused the original bug.
- Q: Does anything about `CameraXController.kt` or the native camera pipeline need to change to ship this? → A: No. There is no evidence the native side is wrong; the remaining device-specific differences are absorbed entirely by calibration. A native change stays a separate, future specification if evidence ever points there.

## Glossary

| Term | Meaning |
|---|---|
| **Sync** | The **user-facing** name of the second primary action. It is a label, not a mechanism — there is no server, account, or network involved. |
| **Dataset export** | The **internal/domain** name for what Sync performs: validate, package, and hand over the local dataset. All code, contracts, and tasks use this term (`ExportDataset`, `DatasetExporter`). |
| **Sample** | One validated frame of hand landmarks, stored as one JSON file. The atomic dataset unit. |
| **Pose collection** | All samples stored for one `pose_id`. |
| **Self Capture** | The capture mode for recording yourself: front lens, mirrored preview, countdown on. |
| **Operator Capture** | The capture mode for recording someone else: rear lens, unmirrored preview, countdown off. |
| **Canonical convention** | The single mirroring convention every stored sample uses — the mirrored front-camera view. Captures from a lens that does not match it are converted before storage. |
| **Canonical raw landmarks** | The earliest landmark set persisted with a sample, already expressed in the canonical convention. The earliest *canonical* observation, not a verbatim detector recording. |
| **Hand Landmark Debug Overlay** | A developer-only visual layer, added in R2, that draws the live frame's detected landmarks and skeleton over the preview on the capture and recognition screens. Presentation-only: it reads the same frame stream recording and recognition already consume and never affects either. |
| **Camera calibration** | A per-lens, per-device set of display transforms (preview rotation/mirror/fit; overlay rotation/mirror/swap-XY/scale/X-Y offset), added in R3, that governs how the live preview and the debug overlay are actually rendered. Persisted locally, defaulting to shipped values until a device saves its own. Display-only — it is never read by recording, dataset storage, or recognition. |
| **Calibration screen** | The developer tool (originally D25's throwaway instrument, made permanent in R3) that lets a developer view and edit the active lens's camera calibration live, reset it to defaults, and export/import it as JSON. |

### The three sessions

The word *session* names three different things in this document. They are **never**
interchangeable, and every requirement below uses the specific term.

| Term | What it is | Begins / ends | Scope |
|---|---|---|---|
| **Recording session** | One press of Record: optional countdown, capture window, validation, persistence. Also called a **take**. Identified by `session_uuid`. | Record pressed → summary, cancellation, or failure | Seconds. Many per capture session. |
| **Capture session** | One visit to the capture screen. Owns the user's mode, lens, countdown, and take-confirmation settings, and holds the camera across many takes. | Entering the capture screen, or changing capture mode → leaving the capture screen | Minutes. Survives lens switches, backgrounding, screen lock, and screen recreation. |
| **Camera session** | One live acquisition of the camera device. | `open` → `close` | At most **one** exists at any instant. Shorter than a capture session (released on backgrounding, replaced on a lens switch), longer than a recording session. |

*Terminology clarified after the R1 analysis pass.* Before it, "capture session" meant a take and
there was no name for the screen-level scope, which made FR-071's "session initialization" ambiguous.
**The persisted field `session_uuid` is unchanged** and still identifies the **recording session** —
this is a naming correction, not a schema change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a burst of samples for a pose (Priority: P1)

A contributor opens the app, sees the pose they are currently collecting (e.g. "Dragon") with a
reference image showing the hand shape, and the count of samples already collected. They hold the
phone and press the large **Record** button. In Self Capture a countdown appears over the live
camera preview while they shape their hand to match the reference; in Operator Capture capture
begins at once. The app then captures automatically for about a second without any further input
and reports how many samples were accepted and how many were discarded. The collected count and
progress bar update on the spot, and the screen stays ready for the next take.

*(Revised in R1: the countdown is initialized by the capture mode rather than always present, and
the screen now persists across takes instead of returning to the pose list after each one.)*

**Why this priority**: This is the product. Every other story exists to support this loop; if only
this story shipped, a contributor could still build a real dataset.

**Independent Test**: Select a pose, press Record once, hold a hand in view, and verify that a
single press produces many stored samples for that pose and an on-screen accepted/discarded
summary — no other feature required.

**Acceptance Scenarios**:

1. **Given** a pose is selected and a hand is visible, **When** the user presses Record and holds
   the pose through the countdown (when enabled) and the capture window, **Then** multiple samples
   are stored for that pose and the screen reports the number accepted and the number discarded.
2. **Given** the countdown is running, **When** the user watches the screen, **Then** the live
   camera preview remains visible and animated for the whole countdown (it never freezes) so they
   can adjust both hands into position.
3. **Given** a recording session just finished, **When** the summary is shown, **Then** the pose's
   collected count and progress bar reflect the newly accepted samples without any manual refresh.
4. **Given** the user wants more samples of the same pose, **When** they press Record again,
   **Then** a new recording session runs and appends to the same pose collection without overwriting
   earlier samples.
5. **Given** the countdown is disabled for the capture session, **When** the user presses Record,
   **Then** capture begins immediately with no countdown phase and the preview stays live throughout.
6. **Given** a take has completed and its summary is shown, **When** the user dismisses it, **Then**
   the screen is immediately ready for the next take without the camera being released and
   reacquired.

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

### User Story 5 - Enter and leave capture repeatedly without the camera locking up (Priority: P1) *(added in R1)*

A contributor records a pose, returns to the pose list, picks another pose, records again, and
repeats this dozens of times in one sitting. Every time the capture screen opens, the camera starts
within a moment and the preview appears. Every time they leave, the camera light goes out. The
device never reports the camera as unavailable, and another application can open the camera
immediately after Mudra Capture leaves the capture screen.

**Why this priority**: Without it the application is unusable beyond the first recording, which puts
SC-001 — the primary product KPI — out of reach. It is the only item in R1 that can disrupt a
collection session already in progress.

**Independent Test**: Open and leave the capture screen 20 consecutive times, then background the
app, lock the screen, unlock, and force the screen to be recreated. The preview must return every
time, and the camera-in-use indicator must be off whenever the capture screen is not displayed.

**Acceptance Scenarios**:

1. **Given** the capture screen is open with a live preview, **When** the user navigates back to the
   pose list, **Then** the camera is released within one second and the device's camera-in-use
   indicator turns off.
2. **Given** the user has just left the capture screen, **When** they immediately re-enter it for the
   same or a different pose, **Then** the preview starts successfully with no "camera already in use"
   error.
3. **Given** the capture screen is open, **When** the application is backgrounded or the screen locks,
   **Then** the camera is released; **When** it returns to the foreground, **Then** the preview is
   reacquired automatically without user action.
4. **Given** the capture screen is open, **When** the operating system recreates it, **Then** exactly
   one camera session exists afterwards and no orphaned session remains.
5. **Given** a take is counting down or capturing, **When** the user leaves or the app is
   backgrounded, **Then** the take is abandoned, nothing is saved for it, and the camera is still
   released cleanly.
6. **Given** the user opens and leaves the capture screen 20 times in a row, **When** the 20th session
   starts, **Then** it starts as quickly as the first and no resource-exhaustion error occurs.

---

### User Story 6 - See an undistorted preview (Priority: P2) *(added in R1)*

A contributor looks at the preview to judge whether their hand is in frame and correctly shaped. The
preview must show the camera's image in its true proportions, centered, with empty space (letterbox
or pillarbox) wherever the available area does not match the camera's shape.

**Why this priority**: Sample quality depends on the contributor being able to judge their own hand
position. A distorted preview does not corrupt the stored landmarks, but it systematically biases how
people position themselves, which does degrade the dataset.

**Independent Test**: Display the preview on screens and window shapes of differing aspect ratios and
confirm a square card held in frame appears square in every case, with visible background bands
rather than distortion.

**Acceptance Scenarios**:

1. **Given** the preview area is wider than the camera's aspect ratio, **When** the preview is shown,
   **Then** the image is pillarboxed and horizontally centered, with no horizontal stretching.
2. **Given** the preview area is taller than the camera's aspect ratio, **When** the preview is shown,
   **Then** the image is letterboxed and vertically centered, with no vertical stretching.
3. **Given** the camera reports different dimensions than expected, **When** the preview renders,
   **Then** it uses the camera's actually-reported dimensions and remains undistorted.
4. **Given** an overlay is drawn over the preview (countdown, capture indicator, reference thumbnail),
   **When** it is displayed, **Then** it aligns with the visible image area, not the padded bands.

---

### User Story 7 - Record someone else with Operator Capture (Priority: P2) *(added in R1)*

A second person holds the device and records the subject's hands. They point the rear camera at the
subject, see an unmirrored preview, and press Record — the take starts immediately, with no
countdown, because the operator controls the timing directly. They may still turn a countdown on if
the subject needs a moment to settle.

**Why this priority**: This unlocks the fastest way to grow the dataset — one person poses while
another operates — and enables collecting from people who cannot operate the device themselves. It
directly serves SC-001.

**Independent Test**: Choose Operator Capture, confirm the rear camera starts with a non-mirrored
preview and the countdown off, record a take, then enable the countdown and record another; both
takes must be stored with metadata that distinguishes them.

**Acceptance Scenarios**:

1. **Given** the user selects Operator Capture, **When** the capture screen starts, **Then** the rear
   camera is used, the preview is not mirrored, and the countdown is off.
2. **Given** the user selects Self Capture, **When** the capture screen starts, **Then** the front
   camera is used, the preview is mirrored, and a 3-second countdown is on.
3. **Given** Operator Capture with the countdown off, **When** the user presses Record, **Then**
   capture begins immediately.
4. **Given** Operator Capture, **When** the user turns the countdown on, **Then** that take and every
   subsequent take in the same capture session runs with a countdown.
5. **Given** a mode is active, **When** the user returns to the capture screen later in the same run
   of the application, **Then** the most recently used mode is preselected **and the countdown and
   confirmation settings they chose are still in effect** (FR-071).

---

### User Story 8 - Switch between front and rear cameras in place (Priority: P3) *(added in R1)*

Mid-session the person holding the device wants the other lens — the subject moved, or the operator
handed the device back. They tap a switch control and the preview changes lens without leaving the
screen and without restarting the application.

**Why this priority**: A convenience on top of the mode defaults, which already cover both lenses at
session start.

**Independent Test**: With the capture screen open, switch lenses back and forth ten times and confirm
the preview reappears each time, mirroring follows the lens, and no camera error occurs.

**Acceptance Scenarios**:

1. **Given** a live preview on one lens, **When** the user switches lenses, **Then** the previous
   camera session is fully released before the new one starts and the new preview appears.
2. **Given** the user switches to the front lens, **When** the preview appears, **Then** it is
   mirrored; **Given** they switch to the rear lens, **Then** it is not mirrored.
3. **Given** a countdown or capture is in progress, **When** the user switches lenses, **Then** the
   take is abandoned without saving and the user is told nothing was saved.
4. **Given** the device has only one usable lens, **When** the capture screen is shown, **Then** the
   switch control is unavailable and the reason is stated rather than failing on tap.
5. **Given** the user switches lenses repeatedly, **When** they leave the screen, **Then** no camera
   session remains open.
6. **Given** any countdown setting is active, **When** the user switches lenses, **Then** the countdown
   setting is unchanged.

---

### User Story 9 - Trust what a sample was recorded with (Priority: P3) *(added in R1)*

Someone analysing the dataset months later needs to know which lens produced a sample, whether the
contributor saw a mirrored image, and whether a countdown gave them time to settle — all three change
how a hand is presented and are exactly the confounders a model would otherwise learn.

**Why this priority**: Traceability protects the value of everything collected. Recording it is cheap
now and impossible retroactively.

**Independent Test**: Record takes in each mode and with the countdown both on and off, then read the
stored samples and confirm each states its camera position, mirroring, countdown state, and platform
lens identifier consistently with how it was recorded.

**Acceptance Scenarios**:

1. **Given** a sample recorded in Self Capture, **When** it is read back, **Then** it reports a front
   camera position, mirrored preview true, and countdown enabled true.
2. **Given** a sample recorded in Operator Capture with no countdown, **When** it is read back, **Then**
   it reports a rear camera position, mirrored preview false, and countdown enabled false.
3. **Given** the user switched lenses mid-session, **When** samples from before and after are read,
   **Then** each reports the lens that was actually active when it was taken.
4. **Given** samples recorded before R1, **When** they are read by the engine, **Then** they still load
   successfully, with the new fields absent rather than wrong.
5. **Given** the same physical hand in the same pose is recorded once in Self Capture and once in
   Operator Capture, **When** the two samples are compared, **Then** they report the same handedness
   and closely matching landmark geometry, while each still reports its own lens and mirroring.

---

### User Story 10 - Work from a layout built for capturing (Priority: P3) *(added in R1)*

The contributor needs to compare their hand against the reference pose, see how many samples they have
collected, watch the preview, and reach the Record and Sync controls — all without hunting. The preview
is the visual centre of the screen, but the reference image and progress stay visible above it and the
controls stay within reach below it.

**Why this priority**: Usability improvement over an already-functional flow.

**Independent Test**: On the smallest supported screen, confirm the reference image, progress, preview,
Record, and Sync are all visible and reachable at once without scrolling, and that no element is
clipped.

**Acceptance Scenarios**:

1. **Given** the capture screen is open, **When** it is displayed, **Then** the reference pose image,
   capture progress, camera preview, Record control, and Sync control are all visible simultaneously.
2. **Given** a small device, **When** space is constrained, **Then** the preview shrinks to make room
   and the reference image, progress, and controls remain visible and legible.
3. **Given** a countdown or capture is running, **When** the overlay is shown, **Then** the reference
   image and progress remain visible.
4. **Given** the user is mid-session, **When** they look for the mode, lens, countdown, or
   take-confirmation controls, **Then** all of them are reachable from the capture screen without
   leaving it.

---

### User Story 11 - See detected landmarks while developing (Priority: P3) *(added in R2)*

A developer diagnosing a tracking problem — samples discarded for no obvious reason, handedness that
looks wrong, jittery detection — turns on a debug overlay from either the capture screen or the
recognition preview screen. The live preview now shows every detected hand's 21 landmarks and skeleton
directly on top of the camera image, colored so the left and right hands are easy to tell apart, with
each hand's handedness and confidence and the total hand count shown on screen. Turning the overlay off
removes it immediately, with no restart and no effect on what is being recorded or recognized.

**Why this priority**: Pure development tooling — it improves nobody's dataset and answers no product
question, but it materially speeds up diagnosing detector and normalization problems while everything
else in this specification is being built or debugged. It must never be reachable in a build an end user
runs.

**Independent Test**: With the overlay off, confirm recording and recognition behave exactly as before.
Turn the overlay on, hold one and then two hands in frame, and confirm 21 landmarks and the correct
skeleton are drawn per hand, colored by handedness, with handedness, confidence, and hand count shown
on screen and updating every frame. Turn it off and confirm the drawing disappears at once.

**Acceptance Scenarios**:

1. **Given** the capture screen or the recognition preview screen with a live camera, **When** the
   developer enables the debug overlay, **Then** every currently detected hand is drawn with all 21
   landmarks and the standard MediaPipe hand-connection skeleton, aligned with the visible preview image.
2. **Given** two hands are in frame, **When** the overlay is enabled, **Then** both hands are drawn
   simultaneously, each in a color that identifies it as left or right.
3. **Given** the overlay is enabled, **When** a new frame is processed, **Then** the on-screen landmarks,
   handedness, confidence, and hand count update to match it, with no perceptible lag.
4. **Given** the overlay is enabled, **When** the developer disables it, **Then** the drawing disappears
   immediately, without leaving the screen or restarting the application.
5. **Given** the overlay is enabled on the capture screen, **When** a take is recorded, **Then** the
   recorded samples and the accepted/discarded counts are identical to what the same take would have
   produced with the overlay off.
6. **Given** the overlay is enabled on the recognition preview screen, **When** a pose is recognized and
   confirmed, **Then** the recognition result and confirmation behave exactly as they would with the
   overlay off.
7. **Given** a release build of the application, **When** a user looks for a way to enable the overlay,
   **Then** no such control exists anywhere in the interface.

---

### User Story 12 - Keep a working display calibration without re-finding it every time (Priority: P3) *(added in R3)*

A developer finds, once, the exact combination of preview and overlay transforms that makes the live
preview and the debug overlay actually line up on their device — using the calibration screen introduced
alongside the debug overlay. That combination is not lost: the application remembers it per lens, applies
it automatically every time the app runs on that device, and the same calibration screen stays reachable
afterward to fine-tune it further, reset it, or compare it against a value exported from another device.

**Why this priority**: Like User Story 11, this is development tooling — it produces no dataset artifact
and answers no product question. It exists because the preview/overlay rendering that Users Stories 1–11
depend on had no reliable way to be correct on every Android device from formula alone; a per-device,
persisted calibration is the practical replacement for that formula.

**Independent Test**: With no calibration ever saved, confirm the capture and recognition screens render
using this lens's shipped default. Change a calibration value, confirm the live preview or overlay
updates immediately, then fully restart the application and confirm the changed value is still in effect.
Export the calibration, corrupt the exported text, attempt to import it, and confirm the calibration is
unchanged and an error is shown.

**Acceptance Scenarios**:

1. **Given** a device with no previously saved calibration, **When** the capture or recognition screen
   opens, **Then** the preview and overlay render using that lens's shipped default calibration, with no
   manual adjustment required.
2. **Given** the calibration screen is open with a live camera, **When** the developer changes any
   control, **Then** the live preview or overlay updates immediately, with no restart, and the new value
   is saved without a separate save action.
3. **Given** a calibration value was changed and the application is fully restarted, **When** the capture
   or recognition screen opens again, **Then** it renders using the previously changed value, not the
   shipped default.
4. **Given** the front lens has been calibrated, **When** the calibration screen is later opened against
   the rear lens, **Then** the rear lens's own calibration is shown and edited, independent of the front
   lens's values.
5. **Given** a lens's calibration has been changed from its default, **When** the developer resets that
   lens, **Then** only that lens returns to its shipped default; the other lens is unaffected.
6. **Given** a calibration has been exported as JSON, **When** that exact document is imported — on the
   same device or a different one — **Then** the resulting calibration matches what was exported exactly.
7. **Given** the import dialog is open, **When** the developer submits text that is not valid JSON,
   **Then** an error is shown, the dialog stays open, and the calibration active before the attempt is
   unchanged.

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
- **Device rotated on the capture screen**: orientation is locked for the whole capture session, so
  rotation has no effect at all — during a take *or* between takes (FR-049, revised). If it changes
  anyway, any in-flight recording session aborts, writes nothing, and explains why (FR-050).
  Mislabeled or mis-oriented data is never stored silently, and the preview's aspect ratio cannot
  change underneath a live camera session.
- **Recording session hits the configured sample limit**: capture stops accepting frames, that
  session finalizes normally with everything already accepted, and the user is told the limit was
  reached (FR-051).
- **Unsupported camera configuration**: a mode whose default lens the device does not have is
  unavailable and says why, while the other mode remains fully usable; a device with no usable lens at
  all refuses to record and explains, rather than capturing data whose handedness cannot be trusted
  (FR-044, revised in R1).
- **Dataset fails integrity validation at export**: the export aborts with a clear explanation and no
  archive is produced (FR-048).

*Added in Revision R1:*

- **Camera busy on entry**: another application (or a stale session of this one) holds the camera when
  the capture screen opens. The user sees a clear, non-technical explanation and a retry action; the
  screen never sits on an indefinite spinner.
- **Permission revoked while backgrounded**: on return the screen shows the permission explanation and
  a way to grant, rather than a camera failure.
- **Permission denied permanently**: the screen explains that permission must be granted from system
  settings and offers a route there.
- **Lens disappears mid-session**: the in-flight take is abandoned without saving and the user is told
  what happened.
- **Rapid navigation**: leaving while the camera is still starting tears the half-started session down
  completely; no camera session survives, and no error surfaces from the abandoned start.
- **Rapid lens switching**: only one camera session may exist at any moment, and the final preview
  matches the last requested lens.
- **Mode changed mid-session**: the lens, mirroring, and countdown default change; any in-flight take is
  abandoned without saving, and already-saved samples are untouched.
- **Very wide or very tall preview area**: the preview remains undistorted and centered however extreme
  the mismatch; the bands are visually neutral and not mistakable for part of the image.
- **Handedness across lenses**: mirroring changes which side of the image a hand appears on and can flip
  the detected left/right label. Rear-camera captures are converted into the canonical convention before
  storage (FR-053), so a sample never depends on the reader knowing which lens took it.
- **Two hands in frame across lenses**: conversion keeps each hand's identity attached to the correct
  physical hand — it never simply swaps the two entries.
- **Leaving while a take summary is shown**: the sample is already saved, so leaving discards only the
  summary; progress reflects the saved sample when the pose is next opened.
- **Backgrounded while a take summary is shown**: the camera is released as usual; on return the screen
  reacquires it and the user is ready for the next take without the completed take being repeated or
  lost.

*Added in Revision R2:*

- **Debug overlay enabled with no hand in view**: the overlay draws nothing and reports zero hands
  rather than holding onto the last frame that had one.
- **Debug overlay enabled before the camera is live**: nothing is drawn until the first frame arrives;
  no error, no placeholder skeleton.
- **Overlay toggled off mid-stream**: any frame subscription it opened is cancelled immediately, and no
  further paint work happens for it.
- **Overlay enabled during an active take or a recognition confirmation**: the take or confirmation
  proceeds exactly as it would with the overlay off; the overlay only adds a visual layer.
- **Overlay left enabled across a lens switch or mode change**: it keeps drawing the new session's
  frames with no manual re-enable needed.

*Added in Revision R3:*

- **Calibration never saved on this device**: the shipped per-lens default is used; nothing about
  startup is blocked or delayed waiting for a value that does not exist.
- **A saved calibration file is missing or unreadable** (corrupted, hand-edited into invalid JSON):
  treated exactly like no calibration ever saved — the shipped default is used, silently, rather than
  crashing startup.
- **A calibration value is changed while no camera is live**: the value is still saved; it takes effect
  the next time a camera session for that lens becomes live, with no separate step required.
- **Resetting a lens while the other lens has unsaved-from-default changes**: only the reset lens returns
  to its default; the other lens's values are untouched.
- **Importing a document that only contains one lens**: the missing lens falls back to its shipped
  default rather than being left undefined or crashing the import.
- **Importing malformed or non-JSON text**: the calibration active before the attempt is completely
  unchanged, and the developer sees a clear error without leaving the screen.

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

- **FR-010** *(revised in R1)*: Pressing Record MUST start a take. When the countdown is enabled for
  the session, it MUST be visible and MUST complete before any capture begins; when it is disabled,
  capture MUST begin immediately with no countdown phase. The countdown is no longer unconditional —
  see FR-071 for how it is established and FR-072 for how the user changes it.
- **FR-011**: The live camera preview MUST remain visible and updating throughout the countdown;
  it MUST NOT freeze, so the user can position one or both hands while watching themselves.
- **FR-012**: The pose's reference image MUST remain **visible on screen during the countdown**, as a
  thumbnail alongside the live preview and the countdown, so the user can compare their hands against
  the target shape at the moment it matters. The preview, the countdown, and the reference are shown
  together — never one instead of another.
- **FR-013**: When the countdown reaches zero, capture MUST begin automatically without further
  user input.
- **FR-014**: A recording session MUST record hand landmarks continuously for a configured window of
  approximately one second, producing many samples from a single press.
- **FR-015**: Every accepted frame in the recording session MUST be stored as its own independent
  sample.
- **FR-016**: Users MUST be able to cancel a countdown or an in-progress recording session, with no
  samples stored from a cancelled one.
- **FR-017**: The application MUST NOT require the user to press Record once per sample.
- **FR-018**: Consecutive recording sessions for the same pose MUST append to that pose's collection
  and MUST NOT overwrite or modify previously stored samples.
- **FR-051**: When a recording session reaches the configured maximum sample count, the application
  MUST stop accepting new frames, finalize that session normally (persisting everything already
  accepted), and tell the user in plain language that the configured limit was reached — never
  truncate silently and never discard already-accepted work.

**Quality**

- **FR-019**: Each captured frame MUST be validated before storage; frames without at least one
  detected hand, without exactly 21 landmarks per hand, or with non-finite coordinates MUST be
  discarded.
- **FR-019a**: A frame MUST additionally be discarded when it contains fewer hands than the selected
  pose requires (FR-002), so a two-handed pose never accumulates one-handed samples.
- **FR-019b**: The selected pose's required hand count MUST be visible to the user before and during
  a recording session, so a discarded-heavy result is self-explanatory.
- **FR-020**: Discarded frames MUST NOT be written to storage in any form.
- **FR-021**: Immediately after each recording session the application MUST display the number of
  samples accepted and the number discarded, in plain language.
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
- **FR-027** *(revised in R1)*: Each sample MUST contain both the **canonical raw** landmarks (see
  FR-056) and the normalized landmarks, with normalization producing values identical to the engine's
  `translation_scale` strategy version 1.0 for the same input.
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

- **FR-045**: Every **recording session** MUST mint a `session_uuid`, and every sample it produces
  MUST carry that identifier, so the samples recorded together are recoverable as a group. *(The
  persisted field name is unchanged; only the term describing it was clarified.)*
- **FR-046**: The application MUST record, per recording session: `session_uuid`, start time, finish
  time, accepted sample count, and discarded frame count. Future analytics and synchronization
  reference the recording session by `session_uuid`, never by time or file order.
- **FR-052** *(scope extended in R1)*: Session identity, the camera metadata introduced in R1
  (FR-081–FR-085), and all other new metadata MUST be **additive and backwards compatible**: the
  engine's pose-sample schema is not redefined, `schema_version` stays `1`, no persisted field is
  added, renamed, removed, or reordered outside the additive metadata blocks, and a reader that
  ignores the new fields still reads every sample correctly. Samples recorded before R1 MUST remain
  readable and comparable with no manual processing, with the new fields simply absent.

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
- **FR-037a** *(revised in R1)*: Self Capture MUST use the front-facing camera with a mirrored
  preview, so the user can watch and correct their own hands while posing. Every stored sample —
  whichever lens produced it — MUST record handedness with the same physical-hand meaning the
  engine's selfie-view convention assumes (FR-053/FR-054).
- **FR-044** *(revised in R1)*: The lens MUST be selected **explicitly**, never left to a platform
  default, and MUST be recorded in each sample's metadata (FR-081/FR-084). The application MUST
  guarantee that handedness is correct under whichever mirroring is in effect, and MUST **reject a
  camera configuration it cannot record correctly** with a clear error instead of recording against
  it. *This requirement exists to prevent silent dataset corruption: an uncorrected rear-facing or
  unmirrored capture produces handedness labels that are wrong in a way neither the app nor the
  engine can detect afterwards. R1 permits the rear lens but preserves the guarantee by converting
  such captures into the canonical convention before storage — it does not weaken it.*

**Orientation safety**

- **FR-049** *(revised after the R1 analysis pass)*: Screen orientation MUST be locked for the
  duration of the **capture session** — from entering the capture screen until leaving it — not only
  while a recording session runs. The previous orientation setting MUST be restored on leaving, on
  every exit path including failures. *Rationale: R1 makes the capture screen persist across takes,
  so locking only during a take would let the device rotate between them and silently change both the
  preview's aspect ratio (FR-099) and the frame geometry a sample's coordinates depend on. Locking the
  whole screen is simpler than recomputing either, and leaves nothing to get wrong.*
- **FR-050**: If orientation changes unexpectedly despite the lock, the application MUST abort any
  in-flight recording session safely, write **no** samples from it, explain what happened, and return
  to idle; recording may resume only from the idle state. The camera is **not** released by this
  (FR-076) — the capture screen stays ready for the next take.

**Observability**

- **FR-042**: The application MUST emit a structured **startup** record containing: application
  version, configuration profile, dataset root, catalog size, camera configuration, and platform
  information.
- **FR-043**: The application MUST emit a structured **shutdown** record containing: session
  duration, total recorded samples, total discarded samples, export count, and explicit confirmation
  of a graceful shutdown.
- **FR-038**: The application MUST function fully offline.
- **FR-039**: The application MUST NOT transmit collected data anywhere off the device.

**Canonical viewing convention** *(added in R1)*

- **FR-053**: Every sample MUST be stored in a single canonical viewing convention — the mirrored,
  front-camera convention every sample collected before R1 already uses — regardless of which lens
  produced it. Captures from a lens whose image does not match that convention MUST be converted at
  capture time, before the sample is stored.
- **FR-054**: The conversion MUST cover both things mirroring affects: the recorded handedness label
  (which physical hand it is) and the landmark geometry (which side of the frame the hand occupies).
  A sample of the same physical hand in the same physical pose MUST be directly comparable whether it
  was recorded in Self Capture or Operator Capture, and conversion MUST preserve each hand's identity
  when two hands are present rather than swapping the entries.
- **FR-055**: The conversion MUST apply to **every persisted landmark set in the sample**, including
  the earliest-stored set — not only the normalized set. The dataset is the canonical source of
  truth, not a byte-for-byte recording of detector output: any deterministic transformation required
  to make a sample device-, lens-, and platform-independent MUST be applied before persistence.
- **FR-056**: The earliest-stored landmark set is therefore defined as the **canonical raw** form —
  the earliest canonical observation of the hand, suitable for regenerating future normalization
  strategies across the entire dataset without consulting which lens produced each sample. This
  specification, the data model, and the documentation MUST use this term rather than describing the
  set as unmodified detector output.
- **FR-057**: The "canonical raw" rename is a change of terminology and documented meaning only. The
  persisted field names and the sample's structure MUST NOT change, so `schema_version` stays `1`,
  the engine requires no change, and every sample already on disk stays valid and readable.
- **FR-058**: Conversion MUST NOT rewrite the camera metadata: a sample stored in the canonical
  convention still reports the lens, mirroring, and countdown that were actually in effect
  (FR-081–FR-085). What was used and what was stored are recorded separately, so the conversion is
  auditable rather than invisible.

**Capture modes** *(added in R1)*

- **FR-059**: The application MUST offer exactly two capture modes: **Self Capture** and **Operator
  Capture**.
- **FR-060**: Self Capture MUST default to the front camera, a mirrored preview, and a countdown
  enabled at 3 seconds.
- **FR-061**: Operator Capture MUST default to the rear camera, a non-mirrored preview, and the
  countdown disabled.
- **FR-062**: Users MUST be able to choose the mode from the capture screen without leaving it, and
  the chosen mode MUST take effect for the next take.
- **FR-063**: The application MUST remember the most recently used mode for the duration of the
  application run and preselect it when the capture screen is next opened.
- **FR-064**: When a mode is unavailable because the device lacks its default lens, the application
  MUST state why rather than failing at the moment of use, and MUST leave the other mode fully usable.

**Lens selection & switching** *(added in R1)*

- **FR-065**: Users MUST be able to switch between the front and rear cameras from the capture screen
  without restarting the application.
- **FR-066**: A lens switch MUST fully release the previous camera session before acquiring the new one.
- **FR-067**: Preview mirroring MUST follow the active lens — mirrored on the front lens, not mirrored
  on the rear lens — regardless of which mode selected that lens.
- **FR-068**: A lens switch during an in-flight countdown or capture MUST abandon that take without
  saving and MUST tell the user that nothing was saved.
- **FR-069**: When the device exposes only one usable lens, the switch control MUST be unavailable with
  a stated reason rather than failing when used.
- **FR-070**: Repeated or rapid lens switches MUST converge on the last requested lens with exactly one
  live camera session.

**Countdown behaviour** *(added in R1; see also revised FR-010)*

- **FR-071** *(terminology clarified after the R1 analysis pass)*: The selected capture mode MUST
  establish the countdown setting **once, at capture-session initialization** — enabled at 3 seconds
  for Self Capture, disabled for Operator Capture. A capture session initializes when the capture
  screen is entered **or** when the mode is changed; **re-entering the capture screen without changing
  the mode does NOT re-initialize it**, so a user's choice survives leaving and returning within one
  application run. After initialization the countdown is a user-controlled capture-session setting;
  the application MUST NOT change it automatically for any reason.
- **FR-072**: Users MUST be able to change the countdown setting from the capture screen for the
  current capture session, in both directions (on when initialized off, off when initialized on).
- **FR-073**: A user-set countdown MUST persist for every subsequent recording session within the same
  capture session and MUST NOT be reset by unrelated events — including backgrounding, screen lock,
  screen recreation, and a completed take.
- **FR-074**: Switching lenses MUST NOT change the countdown setting, in either direction. The
  front/rear pairing exists only as the lens each mode starts with, never as a live rule that
  re-applies on a lens change.
- **FR-075**: Persisting capture preferences across **application runs** (a settings screen) is
  explicitly OUT OF SCOPE. Every setting introduced in R1 — mode, countdown, and take confirmation —
  lives for the current application run only and is never written to disk.

**Capture session loop** *(added in R1)*

- **FR-076**: After a take completes, the capture screen MUST remain open and ready for the next take,
  with the camera still acquired. Leaving the screen MUST be an explicit user action, never a
  consequence of finishing a take.
- **FR-077**: By default, each completed recording session MUST present its accepted/discarded summary
  (FR-021) as a result the user dismisses before the next take can begin, so a bad take is noticed
  immediately rather than discovered later in the dataset.
- **FR-078**: Users MUST be able to turn the per-take confirmation off from the capture screen. With it
  off, the screen MUST return to ready immediately after a take, and the take's result MUST still be
  conveyed without blocking.
- **FR-079**: The confirmation setting MUST behave exactly like the countdown setting: initialized to
  enabled, changed only by the user, scoped to the current capture session, and never altered
  automatically.
- **FR-080**: Capture progress for the pose MUST update immediately after every saved recording
  session, whether or not the confirmation is shown.

**Camera metadata** *(added in R1)*

- **FR-081**: Every stored sample MUST record the camera position it was captured with, expressed as
  `front` or `rear`.
- **FR-082**: Every stored sample MUST record whether the preview shown to the person posing was
  mirrored.
- **FR-083**: Every stored sample MUST record whether a countdown was enabled for that take.
- **FR-084**: Every stored sample MUST record the platform lens identifier for the active lens,
  preserving the value the platform reports.
- **FR-085**: Camera metadata MUST reflect the configuration active at the instant of capture, so
  samples taken before and after a lens or mode change each report their own configuration. This
  metadata is descriptive only and introduces no pixel data of any kind (FR-030).

**Camera lifecycle & resource ownership** *(added in R1)*

- **FR-086**: The application MUST release every camera resource it acquired — camera session, preview
  surface, frame-analysis stream, detector, and any background worker — when the capture screen is
  left, within one second of the screen being dismissed.
- **FR-087**: No camera resource may remain open once the capture screen is no longer displayed,
  verifiable by the operating system's camera-in-use indicator being off and by another application
  being able to acquire the camera immediately.
- **FR-088**: The application MUST reacquire the camera cleanly whenever the capture screen is shown
  again, with no dependence on state left behind by a previous session.
- **FR-089**: Repeated enter/leave cycles of the capture screen within a single application run MUST be
  unlimited, with no degradation, resource exhaustion, or failure to start.
- **FR-090**: The application MUST release the camera when it moves to the background or the device
  screen locks, and MUST reacquire it automatically when the capture screen returns to the foreground,
  without requiring user action.
- **FR-091**: The application MUST tolerate the operating system recreating the capture screen, leaving
  exactly one live camera session afterwards and no orphaned session.
- **FR-092**: At most one camera session may exist at any moment, including during lens switches, mode
  changes, and rapid navigation.
- **FR-093**: A camera session still starting when the screen is left MUST be torn down fully, without
  surfacing an error for the abandoned start.
- **FR-094**: Any in-flight countdown or capture MUST be abandoned when the camera is released for any
  reason, with no partial take persisted and already-saved samples untouched (consistent with FR-016
  and FR-050).
- **FR-095**: Teardown MUST be idempotent and MUST complete even when the preceding start failed
  partway through.
- **FR-096**: Camera acquisition and release MUST be recorded as structured lifecycle events including
  the reason for release, at a level suitable for diagnosing leaks in the field, without recording
  per-frame events above debug level.

**Preview fidelity** *(added in R1)*

- **FR-097**: The preview MUST be rendered at the camera's true aspect ratio and MUST NOT be distorted
  under any layout condition.
- **FR-098**: The application MUST letterbox or pillarbox with neutral background bands whenever the
  preview area's shape differs from the camera's, and MUST center the image within its area.
- **FR-099**: The preview's aspect ratio MUST be derived from the dimensions the camera actually
  reports for the active session, not from a fixed assumption.
- **FR-100**: The preview MUST NOT be required to fill the display; the layout MUST prioritise
  simultaneous visibility of the reference pose, progress, and controls over preview size.
- **FR-101** *(revised in R3)*: Chrome overlays the user can see (countdown, capture indicator, take
  summary, prediction HUD, effect playback) MUST remain visually centered on the visible image area, not
  the padded bands. The developer landmark overlay is the one exception: its alignment is governed
  entirely by this device's persisted camera calibration (FR-127–FR-130), which may legitimately extend
  across the whole preview pane rather than being confined to the image sub-rect — the calibration values
  a developer finds are only reproducible in production if the geometry they were found against is the
  geometry production actually renders with.

**Capture screen layout** *(added in R1)*

- **FR-102**: The capture screen MUST present, simultaneously and without scrolling: the reference pose
  image, capture progress for the pose, the camera preview, the Record control, and the Sync control.
- **FR-103**: The preview MUST be the visual focal point of the screen while remaining subordinate to
  simultaneous visibility of the other elements; a fullscreen preview MUST NOT be used.
- **FR-104**: FR-012's guarantee that the reference image stays visible during the countdown MUST
  extend to the capture window and the take summary, alongside the progress indicator.
- **FR-105**: The mode, lens, countdown, and take-confirmation controls MUST all be reachable from the
  capture screen without leaving it.
- **FR-106**: On the smallest supported screen size, all required elements MUST remain visible and
  legible, with the preview yielding space first.

**Camera stability & error handling** *(added in R1)*

- **FR-107**: The camera start sequence MUST be a single, ordered, resumable path — check permission,
  acquire the camera, start frame analysis, publish the preview — with each step's failure surfacing a
  distinct, plain-language explanation and a retry action.
- **FR-108**: The application MUST handle the camera being unavailable because another application holds
  it by explaining the situation and offering retry, never by waiting indefinitely.
- **FR-109**: The application MUST handle permission being revoked while backgrounded by returning to the
  permission explanation on resume rather than reporting a camera failure.
- **FR-110**: The application MUST distinguish "permission denied" from "permission permanently denied"
  and route the latter to system settings.
- **FR-111**: No camera failure path may leave the application in a state where the capture screen cannot
  be entered again after the cause is resolved.

**Camera abstraction** *(added in R1)*

- **FR-112**: Camera acquisition, preview production, lens selection, and release MUST sit behind a
  single platform-neutral capability boundary, expressed in terms of lens position, preview dimensions,
  mirroring, and lifecycle — never in terms of a specific platform's camera API.
- **FR-113**: The recording workflow (arming, countdown, capture, validation, normalization,
  persistence) MUST depend only on that boundary and MUST require no change when a different camera
  implementation is supplied.
- **FR-114**: Adding an alternative camera implementation (for example another mobile platform or a
  desktop webcam) MUST be possible by supplying a new implementation of the boundary alone, with no
  edits to recording, dataset, or presentation logic.
- **FR-115**: Camera management MUST NOT read from or write to dataset storage, and dataset recording
  MUST NOT reach into camera internals; the only coupling is the descriptive metadata the camera reports
  for a sample. This separation MUST be **enforced automatically**, not merely observed by convention,
  so it cannot drift as the application grows.
- **FR-116**: The recording workflow MUST remain exercisable without a physical camera, by substituting
  an alternative implementation of the camera boundary. The substitute MUST support the **complete**
  pipeline end to end — camera initialization, capture flow, validation, storage, and export — so the
  whole workflow is verifiable in automated testing with no hardware present.

**Developer debug overlay** *(added in R2)*

- **FR-117**: The application MUST provide a developer-only overlay that renders the current camera
  session's detected hand landmarks directly on top of the live preview, on both the capture screen and
  the recognition preview screen.
- **FR-118**: When visible, the overlay MUST draw all 21 landmarks and the standard MediaPipe
  hand-connection skeleton for every hand detected in the most recently processed frame.
- **FR-119**: The overlay MUST support up to two simultaneously detected hands and MUST visually
  distinguish the left hand from the right hand.
- **FR-120**: The overlay MUST display, for the current frame: each detected hand's handedness, its
  detection confidence, and the total number of hands detected.
- **FR-121**: The overlay MUST update on every frame the live camera session emits, with no
  user-perceptible lag beyond the frame's own arrival.
- **FR-122**: The overlay MUST be a passive visual layer only: it MUST NOT alter, delay, block, or
  duplicate the landmark data recording (FR-014) or recognition consumes, and MUST NOT intercept touch
  input meant for the preview or its controls.
- **FR-123**: A visible, user-operable control MUST let the user turn the overlay on or off at runtime,
  on every screen it is available on, without restarting the application or leaving the screen.
- **FR-124**: The overlay MUST be implemented as a self-contained, reusable rendering component that
  depends on the existing landmark frame stream and nothing else — it MUST NOT depend on, and MUST NOT
  be depended on by, any recording or recognition business logic.
- **FR-125**: The overlay's toggle control MUST NOT be reachable in a release build, so it is never
  visible to an end user; this MUST require no runtime configuration or settings screen.
- **FR-126**: Disabling the overlay MUST release any frame subscription it opened; the overlay MUST NOT
  retain state or continue consuming frames while hidden.

**Persistent per-device camera calibration** *(added in R3)*

- **FR-127**: The application MUST maintain, per lens (front and rear independently), a display
  calibration — preview rotation, preview mirror, preview fit, overlay rotation, overlay mirror, overlay
  swap-X/Y, overlay scale, and overlay X/Y offset — that governs how the live preview and the debug
  overlay actually render on the capture screen and the recognition preview screen.
- **FR-128**: A lens's calibration MUST default to that lens's shipped values whenever this device has
  never saved a calibration of its own.
- **FR-129**: A device's calibration MUST be persisted locally and MUST survive an application restart.
  It MUST be stored isolated from dataset storage: no calibration value may ever be written into, or read
  from, the dataset tree, and it MUST have no effect on recording or recognition.
- **FR-130**: Changing any calibration control MUST update the live preview and/or the live overlay
  immediately, with no restart, and MUST persist the new value as part of the same action — no separate
  save step MUST be required.
- **FR-131**: The calibration screen MUST remain reachable as a developer tool for as long as the
  application exists, on the same terms as every other debug control (FR-125): unreachable in a release
  build, requiring no runtime configuration.
- **FR-132**: The calibration screen MUST let a developer reset the calibration of the lens currently
  active on it to that lens's shipped default, without affecting the other lens's calibration.
- **FR-133**: The calibration screen MUST let a developer export the full two-lens calibration as a
  human-readable JSON document, and import a previously exported document to replace the full
  calibration — so values found on one device can be compared against another.
- **FR-134**: Importing a malformed or unparseable document MUST leave the calibration active before the
  attempt completely unchanged and MUST show the developer a clear error; it MUST NOT crash the screen or
  corrupt what is persisted.

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
- **Recording session** *(named "capture session" before the R1 analysis pass)*: One press of Record.
  Identified by a `session_uuid` and described by its start time, finish time, accepted count, and
  discarded count. Every sample it produces carries its identifier, making a take recoverable as a
  group long after the fact.
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

*Added in Revision R1:*

- **Capture mode** (capture profile): A named preset of capture defaults — Self Capture or Operator
  Capture. Carries a default lens position, a default mirroring behaviour, and a default countdown
  setting. It establishes those values once, at session initialization; from then on they are session
  state the user controls, not a rule that keeps re-applying.
- **Camera session**: One live acquisition of a camera, with an explicit start and an explicit
  release. Reports the lens in use, its preview dimensions, whether the preview is mirrored, and the
  dimensions landmark analysis is computed against. At most one exists at a time. It **outlives** a
  recording session and is **outlived by** the capture session — see *The three sessions*.
- **Capture session**: One visit to the capture screen. Owns the mode, lens, countdown, and
  take-confirmation settings and the locked orientation, and holds the camera across many recording
  sessions. Initialized on entering the capture screen or changing mode; ends on leaving.
- **Lens position**: Which physical camera is in use — front or rear — together with the platform's own
  identifier for it, preserved verbatim for traceability.
- **Camera metadata**: The descriptive record attached to every stored sample: camera position,
  mirrored preview, countdown enabled, and platform lens identifier. Additive to the existing sample
  format and never contains pixel data.
- **Countdown setting**: Whether a take is preceded by a countdown and for how long. Initialized once
  from the capture mode, then owned by the session and changed only by the user.
- **Take confirmation setting**: Whether each completed take pauses for the user to review and dismiss
  its summary. Enabled by default, session-scoped, changed only by the user.
- **Canonical viewing convention**: The single mirroring convention every stored sample uses. Captures
  from a lens that does not match it are converted at capture time so all samples, before and after
  R1, are directly comparable.
- **Canonical raw landmarks**: The earliest landmark set persisted with a sample, already expressed in
  the canonical convention — the earliest *canonical* observation rather than a verbatim detector
  recording, and what a future normalization strategy is re-derived from.

*Added in Revision R2:*

- **Hand Landmark Debug Overlay**: A developer-only rendering layer drawn over the live preview,
  showing every detected hand's 21 landmarks, skeleton, handedness, and confidence for the current
  frame. Ephemeral presentation state — nothing it displays is stored, and it produces no dataset
  artifact of any kind.

*Added in Revision R3:*

- **Camera calibration**: A per-lens set of display transforms (preview rotation/mirror/fit; overlay
  rotation/mirror/swap-XY/scale/X-Y offset) that governs how the live preview and the debug overlay
  render. Persisted locally per device, defaulting to shipped values until a device saves its own.
  Display-only: it is never read by recording, dataset storage, or recognition, and is never included in
  a dataset export.

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

*Added in Revision R1:*

- **SC-018**: A contributor enters and leaves the capture screen **20 consecutive times** with a 100%
  success rate on camera start, and the 20th start is no slower than the first.
- **SC-019**: The camera-in-use indicator is off **within 1 second** of leaving the capture screen, in
  100% of trials, across navigation, backgrounding, and screen lock.
- **SC-020**: Another application can acquire the camera immediately after Mudra Capture leaves the
  capture screen, in 100% of trials.
- **SC-021**: **Zero** "camera already in use" or equivalent unavailability errors attributable to the
  application's own retained resources, across a 30-minute continuous collection session.
- **SC-022**: A square reference object held in frame measures square **within 2%** on every supported
  screen shape and in both lens positions.
- **SC-023**: A contributor records their first take in Operator Capture within **30 seconds** of
  opening the application, with no instruction beyond the on-screen controls.
- **SC-024**: Switching lenses returns a live preview **within 1.5 seconds**, in 100% of 10 consecutive
  switches, with no error.
- **SC-025**: **100% of samples recorded after R1** carry all four camera metadata values, each matching
  the configuration actually active for that take.
- **SC-026**: **100% of samples recorded before R1** remain readable by the engine with no manual
  processing.
- **SC-027**: On the smallest supported screen, all five required layout elements are visible and
  reachable without scrolling, in the orientation the capture screen locks to (FR-049).
- **SC-028**: Operator-mode collection with no countdown and the per-take confirmation disabled yields
  **at least twice** the samples per minute of the countdown-mandatory flow that preceded R1.
- **SC-029**: Every camera error path presents a plain-language explanation and a working retry or
  resolution route; **zero** paths end in an indefinite loading state.
- **SC-030**: The full recording workflow can be exercised end to end with **no physical camera present**.
- **SC-031**: For the same physical hand in the same pose, samples recorded in Self Capture and in
  Operator Capture agree on handedness in **100%** of trials, and their landmark geometry matches within
  the tolerance already accepted between two consecutive samples of the same take.
- **SC-032**: The countdown setting changes only when the user changes it: across a session involving
  mode initialization, lens switches, backgrounding, and screen lock, **zero** unrequested changes occur.

*Added in Revision R2:*

- **SC-033**: With the debug overlay enabled, every hand present in the current frame shows all 21
  landmarks and the correct skeleton connections, in **100%** of sampled frames during manual
  verification.
- **SC-034**: Toggling the overlay on or off takes effect within one rendered frame and requires no
  screen restart, in **100%** of trials.
- **SC-035**: With the overlay disabled, every existing recording and recognition test passes unchanged
  — **zero** behavioural differences from before this revision.
- **SC-036**: The overlay's toggle control is absent from a release build in **100%** of inspected
  release builds.

*Added in Revision R3:*

- **SC-037**: On a device with no previously saved calibration, the capture and recognition screens
  render using the shipped per-lens default calibration, with **zero** manual adjustment required.
- **SC-038**: A calibration value changed on the calibration screen is reflected in the live preview or
  overlay within one rendered frame in **100%** of trials, and remains in effect after a full application
  restart in **100%** of trials.
- **SC-039**: Exporting a calibration and immediately importing that exact document reproduces the
  exported calibration exactly, in **100%** of trials.
- **SC-040**: A deliberately malformed import leaves the previously active calibration completely
  unchanged, in **100%** of trials, and never crashes the calibration screen.

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
- **Camera** *(revised in R1)*: both lenses are offered, selected explicitly, through two capture modes
  (FR-059–FR-061). Self Capture is front-facing and mirrored, as before; Operator Capture is rear-facing
  and unmirrored, for recording someone else. The mirrored front-camera view remains the **canonical
  convention** every sample is stored in, so widening the lens choice does not fragment the dataset
  (FR-053). *The pre-R1 assumption that the rear camera would never be offered — justified then by the
  minimal two-action screen — is superseded.*
- **Countdown is no longer unconditional** *(R1)*: it is initialized by the capture mode and owned by
  the session thereafter (FR-071). SC-003's ≤6-second cycle is now an upper bound set by the
  countdown-enabled path; the countdown-disabled path is faster.
- **Conversion happens before persistence** *(R1)*: rear-lens captures are converted into the canonical
  convention on the way to disk, so the landmark *content* of such samples differs from the detector's
  immediate output. The fields, their meaning, and the sample structure are unchanged, which is what
  keeps `schema_version` at `1` (FR-055/FR-057).
- **The capture screen is a repeating loop** *(R1)*: it stays open across takes with the camera acquired
  (FR-076), rather than running one take per visit. This is what the R1 layout requires and what keeps
  the camera from being torn down and reacquired once per sample.
- **Orientation is fixed for the whole capture screen** *(R1, post-analysis)*: FR-049 locks on entry and
  restores on exit, so neither the preview's aspect ratio nor a sample's frame geometry can change while
  the screen is open. The alternative — recomputing the preview aspect on rotation and re-deriving
  geometry mid-capture-session — was rejected as more machinery for a case the product does not need.
- **Android remains the only implemented platform** *(R1)*: the camera abstraction (FR-112–FR-116)
  exists so other platforms *can* be added later; no second implementation is built.
- **Smallest supported screen** is taken to mean a compact phone in portrait; FR-106 is validated against
  that, not against tablets or foldables.
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
- **The debug overlay is development tooling, not a product feature** *(R2)*: it exists to speed up
  diagnosing detector and normalization problems while this application is built and maintained. It is
  compiled out of reach in release builds (FR-125) precisely because it is not part of what a
  contributor is meant to see or use.
- **Camera calibration is development tooling, not a product feature** *(R3)*: like the debug overlay it
  attaches to, it exists so a contributor can make the preview and overlay actually correct on whatever
  device they are using, and is compiled out of reach in release builds for the same reason (FR-131). A
  contributor never sees or interacts with it.

## Dependencies

- The Mudra engine's pose-sample JSON schema (`schema_version` 1) and its `translation_scale`
  normalization strategy (v1.0) are the fixed contract this application writes against. Any change
  to that schema is a cross-application event affecting this feature.
- On-device hand-landmark detection providing 21 landmarks per hand, handedness, and per-hand
  confidence.
- Device camera and camera permission.

## Revision History

Specification numbers denote **product capabilities, not development iterations**. Mudra Capture's
camera subsystem lives here; changes to its intended behaviour are recorded as revisions of this
specification rather than as new numbered specifications.

### R1 — Camera lifecycle, capture modes & preview fidelity (2026-07-25)

**Status**: integrated. **Supersedes**: the former specification `004-camera-lifecycle-modes`, which
was created in error as a standalone feature and is now marked superseded by this document. All of
its requirements were migrated here; none remain duplicated there.

**Why this is a revision, not a new feature**: every item changes the intended behaviour of
capabilities this specification already defines — the camera, the countdown, the preview, and the
capture screen. No new user-visible capability, subsystem, or architectural layer is introduced.

**What changed**

| Area | Change | Requirements |
|---|---|---|
| Camera lifecycle | Full release on leaving the capture screen, clean reacquisition, correct behaviour across navigation, background, screen lock, and screen recreation; at most one camera session at a time | FR-086 – FR-096 (new) |
| Preview fidelity | Never distort; letterbox/pillarbox and center instead; aspect ratio derived from the camera's reported dimensions; fullscreen preview dropped | FR-097 – FR-101 (new) |
| Capture modes | Self Capture (front, mirrored, countdown on at 3s) and Operator Capture (rear, unmirrored, countdown off) | FR-059 – FR-064 (new) |
| Camera switching | Front/rear switching in place, without an application restart | FR-065 – FR-070 (new) |
| Countdown | No longer mandatory. Initialized once by the capture mode, then a user-controlled session setting a lens switch never alters | **FR-010 revised**; FR-071 – FR-075 (new) |
| Session loop | The capture screen stays open across takes; each take's summary is dismissed by default, with a session opt-out | FR-076 – FR-080 (new) |
| Camera metadata | Camera position, mirrored preview, countdown enabled, and platform lens identifier stored with every sample | FR-081 – FR-085 (new); **FR-052 extended** |
| Canonical convention | Rear-lens captures converted into the mirrored front-camera convention before storage, covering handedness and geometry, across every persisted landmark set | FR-053 – FR-058 (new); **FR-027, FR-037a, FR-044 revised** |
| Layout | Reference image, progress, preview, Record, and Sync visible together; preview central but not fullscreen | FR-102 – FR-106 (new) |
| Stability | Ordered, resumable camera start; distinct errors with retry; permission-revocation and permanently-denied handling | FR-107 – FR-111 (new) |
| Extensibility | Camera behind a platform-neutral boundary, independent of dataset recording | FR-112 – FR-116 (new) |

**Requirements revised rather than added**: FR-010 (countdown conditional), FR-027 (canonical raw),
FR-037a (front camera becomes the Self Capture default), FR-044 (explicit lens selection with the
anti-corruption guarantee preserved through conversion), FR-052 (extended to cover camera metadata).

**Acceptance criteria**: User Stories 5–10 added; User Story 1 revised for the conditional countdown
and the persistent session loop. Success criteria SC-018 – SC-032 added. Thirteen edge cases added and
the "unsupported camera configuration" case revised.

**Decisions taken during this revision** (full Q&A in *Clarifications → Session 2026-07-25*):

1. The capture mode, not the lens, owns the countdown after initialization.
2. Rear-lens captures are normalized at capture time rather than corrected downstream — this preserves
   the anti-corruption guarantee FR-044 was written for while permitting the rear lens.
3. Conversion applies to every persisted landmark set, redefining the earliest set as *canonical raw*.
4. That rename is conceptual only; no persisted field name changes, so `schema_version` stays `1`.
5. The capture screen persists across takes, with a dismissable per-take summary and an opt-out.

**Known consequence**: FR-056 redefines the documented meaning of an existing persisted field without
renaming it. Nothing breaks mechanically and no schema version is spent, but the engine's own
documentation of that field is now stale — a cross-application documentation follow-up, tracked outside
this specification.

**Downstream artifacts**: `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and
`tasks.md` were all regenerated for R1 on 2026-07-26. T037/T037a, which enforced front-camera-only
capture, are marked superseded and replaced by T098/T099.

### R1.1 — Post-analysis refinements (2026-07-26)

Six findings from the cross-artifact analysis pass, all accepted. **No functional behaviour changes
except where stated**; no new features; no schema change.

| Finding | Change | Requirements |
|---|---|---|
| **A1** Ambiguous "session" | Three terms defined and applied throughout: **recording session** (a take), **capture session** (one visit to the capture screen), **camera session** (one device acquisition). FR-071 now states explicitly that re-entering the capture screen without a mode change does **not** re-initialize settings. | Glossary → *The three sessions*; FR-014–FR-021, FR-045/FR-046, FR-051, FR-071–FR-080 reworded |
| **F1** Orientation between takes | **Behaviour change**: orientation is now locked for the whole capture session — entering the capture screen locks it, leaving restores it — instead of only while a take runs. R1 made the screen persist across takes, which would otherwise have let rotation change the preview aspect ratio and frame geometry between them. | **FR-049 revised**; FR-050 clarified; SC-027 revised |
| **C1** Camera ⇄ dataset isolation unverified | FR-115 now requires the separation to be **enforced automatically** rather than observed by convention, backed by an architecture test. | **FR-115 extended** |
| **C2** SC-030 only implicit | FR-116 now requires the camera substitute to support the **complete** pipeline — initialization, capture, validation, storage, export — so the no-hardware claim is verified end to end rather than assumed. | **FR-116 extended** |
| **E1** Task ordering | The countdown and take-confirmation controls are built in the phases of the stories that need them (P1/P2) rather than in the P3 layout phase. Ordering only. | `tasks.md` — no requirement change |
| **C3** SC-023 untracked | The 30-second first-Operator-take measurement is added to the manual validation matrix. | `quickstart.md` — no requirement change |

**What did not change**: the dataset schema, `schema_version`, the canonical convention, the capture
modes, the metadata fields, and every other R1 decision. `session_uuid` still identifies a **recording
session** — A1 renamed the concept in prose, never the persisted field.

### R2 — Hand Landmark Debug Overlay (2026-07-27)

**Status**: implemented. **Why this is a revision, not a new feature**: the overlay is developer-only
tooling attached to the camera/landmark pipeline this specification already owns — it introduces no
user-visible product capability, no new subsystem, and nothing an end user in a release build can ever
reach (FR-125). Per the numbering policy in this section, that keeps it here rather than in a new
specification, even though the same widget is composed onto both this specification's capture screen and
specification 005's recognition preview screen (see *Clarifications → Session 2026-07-27*).

**What changed**

| Area | Change | Requirements |
|---|---|---|
| Debug overlay | Draws all 21 landmarks and the standard MediaPipe skeleton for every detected hand (up to two), colored by handedness, with handedness/confidence/hand-count shown on screen, updating every frame | FR-117–FR-121 (new) |
| Non-interference | Passive rendering only; never touches recording or recognition data or input handling; releases its frame subscription when disabled | FR-122, FR-126 (new) |
| Runtime toggle | A visible control turns the overlay on or off on each screen it appears on, without a restart | FR-123 (new) |
| Architecture | A self-contained, reusable rendering component, decoupled from recording/recognition business logic | FR-124 (new) |
| Production safety | The toggle is unreachable in a release build with no configuration required | FR-125 (new) |

**Acceptance criteria**: User Story 11 added (P3). Success criteria SC-033–SC-036 added. Five edge cases
added.

**Decisions taken during this revision** (full Q&A in *Clarifications → Session 2026-07-27*):

1. The overlay is a revision of this specification, not a new numbered one, because it is developer
   tooling over an existing subsystem rather than a new product capability.
2. It is available on both the capture screen and the recognition preview screen, since both already
   share the same `PreviewStage` widget and the same camera session's frame stream.
3. Visibility of the toggle is gated at compile time (`kReleaseMode`), not by a runtime setting, so
   "unreachable in production" needs no configuration to get right or to accidentally get wrong.

**Downstream artifacts**: `plan.md` and `tasks.md` were updated for R2 on 2026-07-27.
`data-model.md`/`contracts/` were not touched — the overlay introduces no persisted entity and no new
contract, only ephemeral presentation state over the existing `LandmarkFrame` stream.

### R3 — Persistent Per-Device Camera Calibration (2026-07-28)

**Status**: implemented. **Why this is a revision, not a new feature**: like R2, this is developer-only
tooling attached to the camera/landmark pipeline this specification already owns — no user-visible
product capability, no new subsystem, and nothing reachable in a release build (FR-131).

**Context**: research D23–D25 (this document's companion `research.md`) established, on real hardware,
that inferring the correct preview/overlay transform from platform-reported rotation and lens facing
alone repeatedly failed, and built a manual calibration screen (D25) as a throwaway instrument to find
working values by hand. A working combination was found for the reference device. R3 is the explicit
decision that followed: stop trying to derive one universal transform, and instead treat "find it once,
per device, by hand" as the permanent mechanism — the found values become this device's default, every
device remembers its own, and the calibration screen that finds them stays in the app rather than being
deleted.

**What changed**

| Area | Change | Requirements |
|---|---|---|
| Per-device calibration | A persisted, per-lens display calibration (preview rotation/mirror/fit, overlay rotation/mirror/swap-XY/scale/X-Y offset) now governs the live preview and debug overlay on both the capture and recognition screens, replacing rotation-degrees-based inference | FR-127, FR-130 (new) |
| Defaults | Each lens defaults to the values found for the reference device until a device saves its own | FR-128 (new) |
| Persistence & isolation | Survives an application restart; stored outside the dataset tree; has no effect on recording or recognition | FR-129 (new) |
| Developer tool made permanent | The calibration screen (D25) is no longer deleted once a fix ships — it stays reachable exactly like the debug overlay's other controls | FR-131 (new) |
| Developer UX | Reset the active lens to its default; export the full calibration as JSON; import a document to replace it, with malformed input rejected safely | FR-132–FR-134 (new) |
| Overlay alignment scope | Chrome overlays still align to the visible image, not the bands; the developer landmark overlay is now the documented exception, aligned entirely by calibration | **FR-101 revised** |

**Acceptance criteria**: User Story 12 added (P3). Success criteria SC-037–SC-040 added. Six edge cases
added.

**Decisions taken during this revision** (full Q&A in *Clarifications → Session 2026-07-28*):

1. Calibration is a revision of this specification, not a new numbered one — same reasoning as R2: it is
   developer tooling over an existing subsystem, not a new product capability.
2. The calibration screen now renders through the same `PreviewStage`/landmark-overlay widgets the real
   capture and recognition screens use, instead of D25's deliberately standalone pipeline — so a value
   found on the calibration screen is guaranteed to produce the identical result in production. This is
   also why FR-101 needed revising: the geometry the working values were tuned against (overlay filling
   the whole preview pane) is now production's geometry too, not just the calibration screen's.
3. `CameraXController.kt` and the native camera pipeline are explicitly untouched — there is no evidence
   they are wrong, and the remaining device-specific differences are fully absorbed by calibration. A
   native change, if evidence ever points there, is a separate future specification.
4. Calibration is stored as a sibling of `datasets/`, never inside it, so it can never be swept into
   export scanning or integrity validation — the same isolation discipline FR-115 already applies between
   camera management and dataset storage.

**Downstream artifacts**: `plan.md`, `research.md`, `quickstart.md`, and `tasks.md` were updated for R3
on 2026-07-28. `data-model.md`/`contracts/` were not touched — calibration is presentation-only state with
its own dedicated local file, not a dataset entity or a platform-channel contract change.
