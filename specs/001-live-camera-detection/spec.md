# Feature Specification: Live Camera Hand Detection

**Feature Branch**: `001-live-camera-detection`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Phase 1 — Live Camera. Create a runnable application that opens the webcam, detects hands, draws landmarks, displays FPS, handedness, and confidence, and shuts down cleanly. Nothing more."

## Clarifications

### Session 2026-07-24

- Q: Should the live preview be mirrored (selfie view)? → A: Mirror (selfie view) — the feed is
  flipped horizontally so it behaves like a mirror; handedness labels still name the actual
  physical hand regardless of the flip.
- Q: What action triggers the clean exit while the feed is running? → A: Pressing `q` or `Esc`,
  and the window's native close (X) button, all trigger a clean shutdown.

### Session 2026-07-24 (architecture refinements)

- Q: What exactly is the displayed "confidence"? → A: MediaPipe's handedness classification
  confidence (the Left/Right label score), rendered as `Left 0.98`; never labelled "detection
  confidence".
- Q: Startup-latency wording? → A: Standardized to the measurable "under 10 seconds" (SC-001);
  the vague "a few seconds" phrasing is removed.
- Q: MediaPipe default configuration for Phase 1? → A: `model_complexity = 0` (fastest) by
  default to maximize FPS, remaining configurable via centralized configuration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See my hands detected live (Priority: P1)

A creator building a gesture library launches the application with a single command. A window
opens showing the live webcam feed, and when they raise a hand into view the application
overlays the 21 tracked hand points on top of their hand in real time, following their
movement.

**Why this priority**: This is the foundational proof that the detection pipeline works. Every
future phase (pose recording, sequence recording, recognition) depends on hands being detected
and located reliably. Without this, nothing else in the project can be built or trusted.

**Independent Test**: Launch the application, place one hand in front of the camera, and confirm
the landmark overlay appears on the hand and tracks its motion smoothly. Delivers immediate
visible value: the user can verify detection works on their own hardware.

**Acceptance Scenarios**:

1. **Given** a working webcam is connected, **When** the user launches the application, **Then**
   a live video window opens showing the camera feed in under 10 seconds.
2. **Given** the live window is open, **When** the user places a hand clearly in view, **Then**
   the application overlays 21 landmark points (and their connecting skeleton) aligned to the
   hand and updates them as the hand moves.
3. **Given** a hand is being tracked, **When** the user removes the hand from view, **Then** the
   overlay for that hand disappears and the feed continues without error.

---

### User Story 2 - Read live detection metrics (Priority: P2)

While the feed is running, the creator wants on-screen feedback about detection quality so they
can judge whether lighting, distance, and framing are good enough before they start recording
gestures in a later phase. The application shows the current frame rate, which hand (left or
right) each detected hand is, and how confident the detector is for each hand.

**Why this priority**: Metrics turn a black-box demo into a usable tool. They let the user tune
their environment for high-quality detection, which directly improves the dataset quality that
later phases depend on. Valuable, but the feed and overlay (US1) must exist first.

**Independent Test**: With the feed running and a hand in view, confirm an FPS readout is
visible and updating, a left/right label is shown for the hand, and a confidence value is shown
and changes as detection quality changes (e.g., moving the hand partially out of frame).

**Acceptance Scenarios**:

1. **Given** the live window is open, **When** the application is running, **Then** a frame-rate
   indicator is continuously displayed and updates as performance changes.
2. **Given** a hand is detected, **When** the overlay is drawn, **Then** the application labels
   that hand as left or right.
3. **Given** a hand is detected, **When** the overlay is drawn, **Then** the application displays
   the handedness classification confidence for that hand (e.g. `Left 0.98`).
4. **Given** both hands are in view, **When** they are detected, **Then** each hand shows its own
   handedness label and confidence value independently.

---

### User Story 3 - Exit cleanly (Priority: P3)

When finished, the creator ends the session with a clear, obvious action, and the application
closes the window, releases the camera, and terminates without errors or leaving the camera
locked for other applications.

**Why this priority**: A clean shutdown is required for the tool to be trustworthy and reusable
session after session, but it only matters once there is a running session to exit. It is the
final polish on the Phase 1 experience.

**Independent Test**: With the application running, trigger the exit action and confirm the
window closes, the process ends, no error is printed, and the camera can immediately be opened
again by relaunching or by another application.

**Acceptance Scenarios**:

1. **Given** the live window is open, **When** the user presses `q` or `Esc` (or clicks the
   window's close button), **Then** the window closes and the application process terminates.
2. **Given** the application has exited, **When** the user inspects the system, **Then** the
   camera is released and available to other applications.
3. **Given** the application is shutting down, **When** it terminates, **Then** it records a clear
   shutdown log entry and exits without an error or stack trace.

---

### Edge Cases

- **No camera available**: When no webcam is connected or the camera cannot be opened, the
  application reports a clear, human-readable message and exits cleanly instead of crashing.
- **Camera in use**: When the camera is already claimed by another application, the failure is
  reported clearly rather than hanging indefinitely.
- **No hands in frame**: The feed continues to display smoothly with no overlay and no error when
  no hands are present.
- **Two hands at once**: Both hands are tracked and labelled independently without one overwriting
  the other's metrics.
- **Poor lighting / partial hand**: Detection confidence drops and may fluctuate; the application
  keeps running and reflects the lower confidence rather than failing.
- **Rapid hand movement**: The overlay may lag or briefly lose the hand, but the application must
  not crash or freeze.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST be startable with a single launch command and require no
  interactive configuration to begin showing the live feed.
- **FR-002**: The application MUST open the default webcam and display its live video feed in a
  window.
- **FR-003**: The application MUST detect human hands present in the video feed in real time.
- **FR-004**: The application MUST support detecting more than one hand simultaneously (at least
  two).
- **FR-005**: For each detected hand, the application MUST overlay its 21 landmark points and the
  skeleton connecting them, aligned to the hand's position, updated every frame.
- **FR-006**: The application MUST continuously display the current processing frame rate (FPS).
- **FR-007**: The application MUST display, for each detected hand, whether it is the left or right
  hand.
- **FR-008**: The application MUST display, for each detected hand, the **handedness
  classification confidence** reported by MediaPipe (the score for the Left/Right label),
  rendered next to the label as e.g. `Left 0.98`. This value MUST NOT be labelled "detection
  confidence" — it is specifically the handedness classification confidence.
- **FR-009**: The application MUST exit cleanly when the user presses `q` or `Esc`, or activates
  the window's native close (X) button, at any time while the feed is running.
- **FR-010**: On exit, the application MUST close the display window, release the camera, and
  terminate without errors.
- **FR-011**: The application MUST emit clear startup and shutdown log entries.
- **FR-012**: When the camera cannot be opened or accessed, the application MUST report a clear,
  human-readable message and exit cleanly rather than crashing.
- **FR-013**: The application MUST NOT capture, save, or export any images, video frames, or
  landmark data in this phase — it is display-only. (Recording is a later phase.)
- **FR-014**: The application MUST display the preview mirrored (horizontally flipped, selfie
  view) so the user's motion matches the on-screen image. Handedness labels (FR-007) MUST name
  the actual physical hand, unaffected by the mirroring.

### Key Entities *(include if data involved)*

- **Detected Hand**: A single hand found in the current frame. Attributes relevant to the user:
  handedness (left/right), detection confidence, and its set of 21 landmark points used for the
  overlay. Exists only for the lifetime of the frame; nothing is persisted in this phase.
- **Landmark**: One of the 21 tracked points on a hand, described by a position in the frame.
  Used only to draw the overlay in this phase.
- **Frame Metrics**: The transient, per-frame measurements shown to the user — current frame rate
  and the per-hand handedness and confidence values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from launching the application to seeing their hand's landmark
  overlay in under 10 seconds on a machine with a working webcam, without editing any
  configuration.
- **SC-002**: With a single hand clearly in view under normal indoor lighting, the landmark
  overlay stays aligned to the hand at least 95% of the time it is visible.
- **SC-003**: The live feed sustains a frame rate of at least 15 frames per second on a typical
  consumer laptop with an integrated webcam.
- **SC-004**: Both hands, when presented together, are each labelled with the correct handedness
  and shown with an independent handedness classification confidence value at least 90% of the
  time they are clearly visible.
- **SC-005**: In 100% of normal exit actions, the application closes and releases the camera so it
  can be reopened immediately, with no error output.
- **SC-006**: When no camera is available, 100% of launches produce a clear message and a clean
  exit rather than an unhandled crash.

## Assumptions

- The user has a single default webcam; multi-camera selection is out of scope for this phase and
  the first available/default camera is used.
- The application runs on a local desktop machine with a display; headless operation is out of
  scope for Phase 1.
- "Confidence" refers specifically to MediaPipe's **handedness classification confidence** (the
  score attached to the Left/Right label), surfaced to the user as-is (e.g. `Left 0.98`).
  Defining a quality threshold is out of scope for this phase.
- The exit action is bound to the `q` key, the `Esc` key, and the window's native close button
  (resolved in Clarifications).
- No data is persisted in this phase; the coordinate-only, human-readable storage model mandated
  by the project constitution applies to the recording phases that follow, not to this display-only
  feature.
- Normalization of landmarks is not required for display in this phase; raw detected positions are
  sufficient to draw the overlay.
