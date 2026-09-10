# Feature Specification: Mudra Web — Visual Effect Editor

**Feature Branch**: `008-effect-editor`

**Created**: 2026-08-24

**Status**: Draft

**Governing authorization**: Constitution v1.7.0, Principle VI — *Mudra Web — Milestone 2: Visual
Effect Editor & Capability-Gated Person Segmentation*.

**Input**: User description: "We are starting the next Mudra Web milestone. The previous milestone
established the pose-driven effect runtime, ActionRegistry, RenderCommand boundary, Canvas2D
renderer, ActivePoseSet, local/privacy constraints, and the initial data-driven effect model. The
next milestone should evolve this into a visual effect editor: an inspector for editing action
properties, a timeline for composing multiple actions, pose/trigger selection, preview/test mode,
local project save/load, an asset library, and Person Segmentation as a capability-gated,
segmentation-dependent action family — all authoring the *existing* effect data model through the
*existing* runtime, never a second effect runtime or a second renderer."

## Clarifications

### Session 2026-08-24

- Q: How should an editor project relate to the default, minimal Mudra Web visitor experience
  Milestone 1 shipped (camera → pose → effect, no UI chrome)? → A: **Explicit "set active" step.**
  Editor and default experience stay separate routes/views. An author can explicitly mark at most
  one saved project as active; only then does the default, zero-chrome experience run that
  project's effects instead of the shipped default catalog.
- Q: Should editor UI interactions (dragging a timeline clip, editing an inspector field) be held
  to the same ~30fps live-pipeline budget Milestone 1 set, or a separate, looser bar? → A: **The
  live pipeline's existing budgets hold unconditionally, even while the editor UI is being
  interacted with; editor UI responsiveness itself is held to an ordinary-interactive-UI bar
  (no dropped input, no visible jank), not a numeric frame budget, in this milestone.**

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build and preview an effect without touching code (Priority: P1)

A developer opens the editor, sees the live camera on a central stage, and picks a pose from a
list. They add an action from a palette — say, a screen flash — and a properties panel appears
showing exactly that action's parameters: colour, intensity, duration, blend. They change the
colour and drag the action's clip on a timeline to start half a second in. They add a second
action, a particle burst anchored to the hand, positioned to start a little after the flash ends.
Without ever performing the pose, they press "Test Trigger" and watch the effect play in full,
exactly as if the pose had been recognized. They also form the actual pose in front of the camera
and watch the same effect fire for real.

**Why this priority**: This *is* the milestone. It proves the central architectural claim — that
an editor can author the data model the previous milestone already runs — and it is the loop every
other story supports. If only this story ships, an author can already build and validate an effect
entirely visually.

**Independent Test**: Open the editor with no saved project, add two actions to a new effect via
the palette, change at least three properties across them in the inspector, position both on the
timeline at distinct offsets, and trigger the effect through both Test Trigger and a real pose
hold. Observe the same visible result from both triggers. Requires no persistence, no asset
library, and no segmentation to be present.

**Acceptance Scenarios**:

1. **Given** the editor is open with an empty or default project, **When** the author adds an
   action from the palette to the selected effect's timeline, **Then** a clip representing it
   appears on the timeline and its properties appear in the inspector, each showing that action's
   actual default value.
2. **Given** an action's clip is selected, **When** the author changes a property in the inspector
   (colour, opacity, intensity, duration, size, anchor, or another parameter that action declares),
   **Then** the underlying effect data changes accordingly and the change is reflected the next
   time the effect plays — no runtime source is touched.
3. **Given** two actions are placed on the timeline, **When** the author drags one clip to a new
   start time or drags its edge to change its duration, **Then** only that clip's offset and/or
   duration change; no other clip's position is recomputed as a side effect.
4. **Given** a clip is selected, **When** the author deletes it or duplicates it, **Then** the
   timeline reflects exactly one fewer, or one more, entry, and every other clip is unaffected.
5. **Given** an effect with a configured trigger, **When** the author presses "Test Trigger",
   **Then** the effect plays through the same execution and rendering path a real pose
   confirmation would use, without the author performing any pose.
6. **Given** the same effect, **When** the author instead performs the configured pose in front of
   the live camera and holds it to confirmation, **Then** the effect plays with the same visible
   outcome Test Trigger produced.
7. **Given** an effect is playing (via preview or a real trigger), **When** the author edits a
   different, not-currently-playing effect's properties, **Then** the running playback is
   unaffected — edits apply to future plays.
8. **Given** the author selects a pose for the effect's trigger, **When** they inspect the
   selection control, **Then** it distinguishes a pose that is in the dataset's catalog, eligible
   for matching, and currently in the active pose set from one that is not — so a trigger
   configured against an inactive pose is a visible, understood choice, not a silent dead end.

---

### User Story 2 - Save work and come back to it (Priority: P2)

An author who has built several effects across a session closes the browser tab and, the next
day, wants their work back exactly as they left it. They also want to hand a colleague a single
file containing an effect so it can be tried on another machine, and to start a new variant of an
existing project without losing the original.

**Why this priority**: Without this, every session starts from zero — a demonstrable editor that
cannot be resumed is not yet a usable tool. It is P2, not P1, because Story 1 is independently
valuable and testable without it, and the milestone's central architectural claim does not depend
on persistence.

**Independent Test**: Build an effect, save the project, reload the page (or open a fresh session
on the same device), load the saved project, and confirm every effect, timeline, and property is
identical to what was saved. Separately, export the project to a file, and import that file into a
new, empty project.

**Acceptance Scenarios**:

1. **Given** a project with at least one authored effect, **When** the author saves it, **Then**
   the project persists locally on the same device, with no data leaving the device.
2. **Given** a previously saved project, **When** the author loads it, **Then** every effect,
   trigger, timeline, and property is restored exactly as saved.
3. **Given** an open project, **When** the author duplicates it, **Then** a second, independent
   project exists with the same content, and editing one does not alter the other.
4. **Given** a saved project, **When** the author exports it, **Then** a single portable artifact
   is produced that can be imported into another project slot, on the same or a different device,
   reproducing the original content.
5. **Given** a project saved by an older or incompatible version of the editor, **When** it is
   loaded, **Then** a version mismatch is reported clearly rather than the project loading
   incorrectly or silently.
6. **Given** any point in this story, **When** the project is inspected on disk or in browser
   storage, **Then** it contains no camera frame, image, video, or other captured imagery — only
   effect data.
7. **Given** a saved project, **When** the author marks it as the active project, **Then** the
   default, zero-chrome visitor experience runs that project's effects the next time it loads,
   in place of the shipped default catalog.
8. **Given** a project is marked active, **When** the author marks a different project active, or
   clears the active designation, **Then** the default experience runs the newly active project,
   or reverts to the shipped default catalog, accordingly — never both, never neither in a way
   that leaves the default experience running stale or partial data.

---

### User Story 3 - Reference project assets instead of typing paths (Priority: P2)

An author adding a `play_audio` action wants to pick a sound from the project's own small
collection of assets rather than typing a logical identifier from memory. They open an asset
picker from the relevant property, see the assets available to this project, and select one. If an
effect references an asset that has since gone missing, the author sees exactly which reference is
broken rather than discovering it only when the effect plays and part of it silently fails to
appear.

**Why this priority**: Directly serves Story 1's authoring loop for the two action types that take
asset references, and prevents the class of error the milestone already treats seriously (a
reported, non-fatal missing-asset condition) from being invisible during authoring. P2 because
Story 1 remains usable — an author can still type a known logical identifier by hand — without it.

**Independent Test**: With a project containing at least one asset, add an action with an asset
parameter, open the picker, select an asset, and confirm the property is set to that asset's
logical reference. Separately, remove an asset the project still references and confirm the editor
surfaces the broken reference.

**Acceptance Scenarios**:

1. **Given** an action parameter of the asset kind, **When** the author opens its picker, **Then**
   the project's available assets are listed by name, not by physical path.
2. **Given** an asset is selected from the picker, **When** the property is inspected afterward,
   **Then** it holds a logical reference, never a filesystem or URL path typed or embedded
   directly.
3. **Given** an effect references an asset no longer available to the project, **When** the
   project is loaded or the effect is inspected, **Then** the broken reference is identified by
   name, and the rest of the effect remains usable.

---

### User Story 4 - Author an effect that depends on person segmentation (Priority: P3)

An author wants an effect where the person's silhouette gets a color tint, or the background
behind them changes, independent of a full-frame overlay. They add a segmentation-dependent action
from the palette. If their browser and device can actually run person segmentation, the action
behaves like any other in the editor and its live preview shows a real, per-pixel separation of
person from background. If segmentation is not available, the action is still addable and
editable — so the author can build for it — but it is unmistakably marked as unavailable in this
environment, in the palette, on its clip, and in preview, and it never appears to work when it
cannot.

**Why this priority**: This is the second capability this milestone authorizes, alongside the
editor itself, but it depends on the editor existing to be authored at all, and no shipped effect
requires it to be demonstrable. P3 because the honest, gated absence is itself the acceptance bar
— a device without segmentation support must never be worse off than one that silently pretends.

**Independent Test**: With segmentation unavailable (the common case on most current setups), add
a segmentation-dependent action, confirm it is visibly marked unavailable in the palette and in
the inspector, and confirm triggering the effect containing it plays every other action in that
effect normally while the segmentation-dependent one visibly does nothing. Where a supporting
environment is available, repeat with segmentation enabled and confirm the same action produces a
real, per-pixel-separated visual result rather than a full-frame overlay standing in for it.

**Acceptance Scenarios**:

1. **Given** person segmentation is unavailable in the current browser session, **When** the
   author opens the action palette, **Then** every segmentation-dependent action is visibly marked
   as unavailable, while remaining addable for future authoring.
2. **Given** a segmentation-dependent action is already placed on a timeline and segmentation is
   unavailable, **When** the author selects its clip, **Then** the inspector states plainly that
   this environment cannot run it, distinct from an ordinary validation error.
3. **Given** an effect containing both a segmentation-dependent action and ordinary actions,
   **When** it is triggered with segmentation unavailable, **Then** the ordinary actions play
   normally and the segmentation-dependent one visibly produces nothing — never a fallback that
   looks like it worked.
4. **Given** person segmentation is available, **When** a segmentation-dependent action plays,
   **Then** its effect is a genuine separation of the person from the background — never a
   full-frame image or colour composited over an undifferentiated camera view.

---

### Edge Cases

- **Camera unavailable while editing**: the stage reports the same plain-language camera states
  Milestone 1 already defines; Test Trigger and Play Timeline preview remain usable without a live
  camera, since a synthetic pose event does not require one — an effect with no anchor-dependent
  actions plays in full, and one that anchors to a hand behaves exactly as the runtime's
  documented "anchor unresolved" case already requires.
- **Editing a project with no effects yet**: the timeline and inspector show an empty, valid state,
  not an error — a project starts as a container waiting for its first effect.
- **A trigger names a pose outside the current active pose set**: the pose/trigger panel makes this
  visible rather than treating it as invalid; the effect is fully editable and testable via Test
  Trigger, but will not fire from a real pose until that pose is made active — exactly the
  distinction Milestone 1's active-pose-set semantics already draws.
- **Two clips overlap in time, on the same or different actions**: both are scheduled and play
  concurrently, matching the runtime's existing support for concurrent playbacks and overlapping
  timeline entries; the timeline visualizes the overlap rather than forbidding it.
- **A clip is resized shorter than the effect's declared total duration, or moved past it**: the
  effect's total duration is derived from its entries rather than silently truncating a clip's
  visible tail.
- **An imported project file is malformed, is not a Mudra Web project, or carries an unrecognized
  schema version**: import fails with a clear, specific reason and does not partially apply.
- **Duplicating a project or an effect while one of its effects is mid-preview**: the running
  preview is unaffected; the duplicate is an independent copy from the moment of duplication.
- **An asset the project references is renamed or removed outside the editor** (e.g. the
  project-local asset folder is edited directly): the next load surfaces the broken reference by
  name, exactly as an effect referencing any other unresolvable asset already does.
- **Segmentation capability changes mid-session** (e.g. a permission prompt is dismissed, or a
  model fails to initialize partway through): the affected actions transition to unavailable and
  are reported, without corrupting other running effects.
- **The browser tab is backgrounded during a preview**: the same graceful pause-and-recover
  behaviour Milestone 1 already requires of the live pipeline applies to editor previews.
- **The active project is deleted, or its schema fails to load, while it is marked active**: the
  default experience falls back to the shipped default catalog rather than failing to load or
  running a partial project; the active designation is cleared, not silently left dangling.
- **The live pipeline is running (in the editor's own stage) while the author drags a timeline
  clip or edits an inspector field**: the live pipeline's frame and latency budgets are
  unaffected; if anything lags under load, it is the editor UI's own redraw, never the camera →
  recognition → render loop.
- **An author sets a camera visual treatment (brightness, contrast, mirror, zoom) to an extreme
  value**: the stage and the live experience remain stable and reversible — no treatment can leave
  the camera view blank, inverted unintentionally, or permanently altered outside the editor's own
  controls.

## Requirements *(mandatory)*

### Editor authoring surface

- **FR-001**: The editor MUST present a central live camera/canvas stage, an action palette, a
  pose/trigger panel, a property inspector, and a timeline, as the surfaces through which an
  effect is authored.
- **FR-002**: The editor MUST operate on the same `EffectDefinition`/`Timeline` data model
  Milestone 1 already defined. It MUST NOT introduce a second representation of an effect that the
  runtime does not also understand.
- **FR-003**: The editor MUST NOT execute effect logic itself. Playing an effect, in preview or
  for real, MUST go through the existing effect runtime; the editor's role is limited to producing
  and modifying the data the runtime consumes.
- **FR-004**: The editor MUST NOT draw effect output itself. All visible effect output, in preview
  and in the live experience alike, MUST be produced by the existing renderer.
- **FR-005**: Adding, removing, or modifying an action on the timeline MUST be possible without
  writing or editing any configuration file by hand.
- **FR-006**: The editor MUST NOT constitute a general-purpose graphics editor: it supports
  authoring instances of already-registered action types with already-declared parameters, not
  arbitrary freeform drawing, shape creation, or vector editing.

### Schema-driven inspector

- **FR-007**: The inspector MUST derive the set of editable properties for a selected action from
  that action type's own registered parameter schema, not from a hand-written description of that
  specific action.
- **FR-008**: Adding a new action type to the registry MUST make it editable in the inspector
  without a corresponding change to inspector logic, provided its parameters use already-supported
  parameter kinds.
- **FR-009**: The inspector MUST support editing, at minimum, parameters of these kinds: numeric
  values (used for opacity, intensity, duration, size, and similar), colour, an enumerated choice
  (used for blend mode and similar), a logical asset reference, an anchor (position/target), a
  boolean toggle, and free text.
- **FR-010**: Each editable property MUST show the value currently in effect (an explicit override
  or the action's declared default) and MUST reject a value outside that property's declared
  constraints (range, allowed set, or required format) with a specific, attributable message.
- **FR-011**: Where a property is an anchor, the inspector MUST let the author choose among the
  anchor kinds the runtime already supports (a fixed screen position, a hand's centroid, or a
  specific hand landmark) rather than requiring hand-authored coordinates.
- **FR-012**: Where a property is a duration or a start time, the inspector and the timeline MUST
  present and edit the same underlying value — changing one MUST be reflected in the other.

### Timeline

- **FR-013**: The timeline MUST represent each action as a clip positioned by the same absolute
  offset from the effect's start (`atMs`) the runtime already uses; the timeline MUST NOT
  introduce relative, chained positioning where moving one clip silently repositions another.
- **FR-014**: The timeline MUST support: viewing all of a selected effect's clips on one or more
  tracks; selecting a clip; moving a clip to a new start offset; resizing a clip's duration;
  deleting a clip; and duplicating a clip.
- **FR-015**: Moving or resizing one clip MUST NOT alter any other clip's offset or duration.
- **FR-016**: The timeline MUST distinguish, visibly, the three action behaviours the runtime
  already defines — instantaneous, duration-based, and continuous — since they are edited
  differently (an instantaneous clip has no meaningful duration handle; a continuous clip's
  duration is its active window, not a progress span it recomputes once).
- **FR-017**: The timeline MUST NOT implement keyframes, easing/Bézier curves, expressions, or
  nested/child timelines in this milestone.
- **FR-018**: The timeline is a view over effect data and MUST NOT independently schedule,
  advance, or evaluate actions; scheduling remains the effect runtime's exclusive responsibility,
  including during preview.

### Pose / trigger selection

- **FR-019**: The editor MUST let the author choose which pose an effect's trigger responds to,
  from the poses the running session's dataset actually defines.
- **FR-020**: The pose/trigger panel MUST distinguish, for any pose under consideration, whether it
  is merely present in the pose catalog, eligible for matching, and a member of the current active
  pose set — the same three populations Milestone 1 already defines and requires to be
  reportable.
- **FR-021**: The editor MUST NOT modify recognition thresholds, per-landmark matching weights, the
  softmax formulation, or hold/stability timing. Pose/trigger authoring is restricted to choosing
  an existing pose, a lifecycle event to respond to, and the trigger's own conditions (minimum
  confidence, cooldown).
- **FR-022**: The editor MUST NOT alter which poses belong to the active pose set as a side effect
  of authoring a trigger; associating a trigger with a pose outside the active set MUST be
  permitted and MUST be visibly distinguished from one that will actually fire live.

### Preview and test-trigger mode

- **FR-023**: The editor MUST provide a way to play a selected effect's timeline on demand
  ("preview"), without requiring the author to perform its trigger's pose.
- **FR-024**: The editor MUST provide a way to simulate the effect's configured trigger condition
  directly ("test trigger") by constructing a pose lifecycle event and passing it into the same
  event-to-effect path a real recognized pose uses.
- **FR-025**: Both preview and test-trigger playback MUST use the same effect runtime and the same
  renderer the live, pose-driven experience uses. Neither MUST be served by a separate,
  preview-only effect implementation.
- **FR-026**: Test-trigger playback MUST be usable when no hand is currently visible to the camera,
  or when no camera is available at all; anchor-dependent actions MUST behave exactly as the
  runtime's existing unresolved-anchor handling already specifies.
- **FR-027**: Triggering the same effect through preview, test-trigger, and an actual recognized
  pose MUST produce the same visible result, given the same parameters and the same simulated
  timing.

### Local project persistence

- **FR-028**: The editor MUST let the author create a new project, save the current project,
  load a previously saved project, duplicate a project, export a project to a portable artifact,
  and import a project from one.
- **FR-029**: All project persistence MUST be local to the device. No project data, and no part of
  it, MUST be transmitted to a network destination as part of create, save, load, duplicate,
  import, or export.
- **FR-030**: The editor MUST NOT provide, and MUST NOT lay groundwork for, accounts, cloud
  storage, publishing, a marketplace, social sharing, or collaborative multi-user editing of a
  project.
- **FR-031**: A saved or exported project MUST NOT contain a camera frame, image, video, or any
  other derivative of captured imagery. A project is effect data — trigger and timeline
  definitions, action parameters, asset references, and pose selections — and nothing else.
- **FR-032**: A project MUST carry a version identifier sufficient to detect a project saved by an
  incompatible schema at load time, and loading such a project MUST report the mismatch rather than
  applying it partially or silently.
- **FR-033**: Loading a malformed or invalid project file MUST fail clearly, naming what is wrong,
  and MUST NOT leave the editor in a partially-applied state.
- **FR-033a**: The editor MUST let the author mark at most one saved project as **active**, and
  MUST let them clear that designation or move it to a different project.
- **FR-033b**: The default, zero-chrome visitor experience MUST run the currently active
  project's effects in place of the shipped default catalog when one is marked active, and MUST
  run the shipped default catalog when none is. Marking a project active or inactive MUST NOT
  alter the editor's own authoring surfaces or any other saved project.
- **FR-033c**: If the active project becomes unloadable (deleted, corrupted, or an incompatible
  schema version), the default experience MUST fall back to the shipped default catalog and MUST
  clear the active designation, rather than failing to load or running a partial project.

### Asset library

- **FR-034**: The editor MUST provide a way to browse the assets available to the current project
  and select one for an asset-kind property, rather than requiring the author to type a logical
  identifier or a physical path from memory.
- **FR-035**: An asset selected through the library MUST be written into the action's parameter as
  a logical reference, through the same indirection mechanism the runtime already resolves —
  never as a physical filesystem path or URL embedded directly in effect data.
- **FR-036**: The asset library in this milestone is scoped to a project's own local assets. It
  MUST NOT implement upload to, or retrieval from, any network or cloud asset store.
- **FR-037**: The asset library's design MUST NOT preclude a later milestone adding
  user-imported assets; it MUST NOT implement that capability now.
- **FR-038**: When an effect references an asset the project's library no longer contains, the
  editor MUST identify the broken reference by name, at the point the project or the effect is
  inspected, not only the first time the effect plays.

### Person segmentation capability

- **FR-039**: The editor and runtime MUST represent person segmentation as one named capability in
  the same capability-registry mechanism Milestone 1 already established, alongside the
  `person_visibility` reservation it created.
- **FR-040**: Where the current browser and device can run person segmentation, the application
  MUST use the same detection-model family already governing hand-landmark detection, accessed
  behind a replaceable interface, rather than introducing a second machine-learning runtime.
- **FR-041**: Availability of the segmentation capability MUST be determined by the application at
  runtime, from the actual current environment, never assumed or hardcoded to a fixed value.
- **FR-042**: An action that requires segmentation and finds it unavailable MUST be inert and MUST
  report that unavailability explicitly, exactly as Milestone 1's existing capability-gating rule
  already requires of any capability-dependent action; it MUST NOT appear to succeed and MUST NOT
  silently degrade to a visually different behaviour that looks intentional.
- **FR-043**: The unavailability of segmentation MUST NOT prevent the rest of an effect — its
  non-segmentation-dependent actions — from playing.

### Segmentation-dependent actions

- **FR-044**: The action set MUST distinguish actions that require segmentation from those that do
  not; this distinction MUST be visible to the author in the palette and in the inspector, not only
  discoverable by triggering the effect and observing what happens.
- **FR-045**: A segmentation-dependent action MUST be addable, editable, and placeable on a
  timeline regardless of whether segmentation is currently available, so an author can build for
  the capability ahead of it being present in their own environment.
- **FR-046**: Where segmentation-dependent behaviour is implemented, it MUST perform a genuine
  per-pixel or per-region separation of the person from the background. It MUST NOT be simulated by
  compositing an image or colour over an undifferentiated, full-frame camera view — the exact
  substitute Milestone 1's background-wash action deliberately avoided claiming.
- **FR-047**: This milestone is not required to implement every segmentation-dependent behaviour
  named as a future direction (person-only tint, background replacement, background effects behind
  the person, foreground/background compositing, person isolation). It MUST implement at least one
  such action end to end, demonstrating the capability-gated pattern for the rest.

### Camera visual treatment vs. camera input configuration

- **FR-048**: The editor MAY expose visual adjustment of the camera feed — at minimum brightness,
  contrast, saturation, mirroring, zoom/scale, and crop/framing — as part of authoring an
  experience.
- **FR-049**: A camera visual adjustment MUST be implemented as a render-time transformation
  applied by the existing renderer, never as a request that reconfigures the physical camera
  device, unless a specific adjustment (e.g. an optical zoom or torch control a device actually
  exposes) is only obtainable through the camera's own device configuration — and where that is
  used, it MUST be visibly distinguished from the render-time adjustments.
- **FR-050**: The editor MUST NOT expose a webcam hardware control that browsers cannot reliably
  provide across common devices; any such control offered MUST degrade to reporting its
  unavailability rather than silently failing.
- **FR-051**: Camera visual treatment settings apply to how the feed is presented and MUST NOT
  alter the imagery handed to hand-landmark detection or pose recognition, preserving Milestone 1's
  single, documented recognition coordinate space.

### Architectural boundaries

- **FR-052**: The `ActionRegistry → action handlers → effect runtime → render commands → renderer`
  architecture Milestone 1 established MUST remain unchanged in responsibility: the editor
  configures and uses existing action definitions; it MUST NOT register, execute, or render an
  action type through any editor-specific path.
- **FR-053**: The renderer MUST remain the only component that draws, in both the live experience
  and every editor preview mode.
- **FR-054**: The effect runtime MUST remain the only component that schedules and advances
  actions, in both the live experience and every editor preview mode.
- **FR-055**: The editor MUST NOT contain a branch, lookup, or conditional keyed to a specific
  pose identifier or a specific named effect, extending the same rule Milestone 1's runtime is
  already held to.

### Privacy

- **FR-056**: Every privacy guarantee Milestone 1 established — no persisted camera imagery, no
  imagery transmitted off the device, no recording or capture affordance — MUST hold throughout the
  editor, including during preview, test-trigger playback, and project persistence.
- **FR-057**: The editor MUST NOT introduce any new mechanism for recording, capturing,
  screenshotting, or sharing the camera view or its effects output.

### Performance

- **FR-058**: Milestone 1's existing live-pipeline performance budgets (approximately 30 frames
  per second sustained, recognition latency, and trigger-to-first-paint) MUST continue to hold
  unconditionally while the editor UI is open and being interacted with — dragging a clip,
  editing an inspector field, or any other editor interaction MUST NOT degrade the live camera →
  recognition → render loop.
- **FR-059**: Editor UI interactions themselves (clip drag, resize, property edits) are held to an
  ordinary-interactive-UI bar — no dropped input, no visible stalling — rather than a numeric
  frame-budget target in this milestone.

### Key Entities

- **Project**: The editor's document — a named, versioned local artifact containing one or more
  effects, the project's own asset library, and (optionally) camera visual treatment settings. A
  project's effects are the same `EffectDefinition`/`Timeline` shape the runtime consumes; the
  project is a versioned container around that shape, not a replacement for it. At most one saved
  project may be marked **active** at a time; the active project, if any, is what the default
  visitor experience runs.
- **Clip**: The editor's on-timeline representation of one `TimelineEntry` — an action reference,
  its start offset, and its duration where applicable. Editing a clip edits the underlying entry
  directly; a clip has no behaviour of its own.
- **Inspector Field**: A generated control bound to one `ParamSpec` of a selected action's
  registered descriptor — its kind determines which control appears, and its constraints determine
  what is accepted.
- **Asset Library Entry**: One asset available to a project, addressable by a logical reference
  through the existing asset-reference indirection; distinct from the shipped, global asset
  manifest, though resolved through the same mechanism.
- **Segmentation Capability**: A named entry in the existing capability registry, determined at
  runtime from the current browser/device, gating every segmentation-dependent action uniformly.
- **Synthetic Pose Event**: An author-constructed pose lifecycle event, carrying the same fields a
  recognized event carries, used to drive test-trigger playback through the unmodified event-to-
  effect path.
- **Camera Treatment Settings**: Render-time visual adjustments to the presented camera feed,
  distinct from, and never affecting, the imagery used for detection and recognition.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time editor user builds a two-action effect — adding both actions, changing
  at least three properties across them, and positioning both on the timeline — and triggers a
  preview, within 5 minutes of opening the editor with no prior instruction beyond what the
  interface itself shows.
- **SC-002**: Adding a new action type to the registry, with parameters using already-supported
  parameter kinds, requires zero changes to inspector source — verified the same way Milestone 1
  verified its own configuration-only claim: by the fact that no inspector file is modified.
- **SC-003**: Triggering a given effect through Test Trigger and through an actual recognized pose
  produces the same sequence of render commands, given the same simulated timing.
- **SC-004**: A project round-tripped through save and load, or through export and import,
  reproduces 100% of its effects, timelines, and properties with zero data loss.
- **SC-005**: Across a full editing session — building effects, previewing, saving, loading,
  exporting, and importing — zero camera frames, images, or video are written to storage or sent
  off the device, verifiable by inspection of storage and network activity.
- **SC-006**: When person segmentation is unavailable, 100% of segmentation-dependent actions are
  identifiable as such in the palette and in the inspector before the author ever triggers the
  effect; none appears to have succeeded when triggered.
- **SC-007**: Moving, resizing, deleting, or duplicating a clip never changes any other clip's
  offset or duration — verified across a sequence of at least ten such operations on a
  multi-action effect.
- **SC-008**: A developer builds an entirely new effect for a previously unused pose, including its
  trigger, timeline, and at least one asset reference, using only the editor's surfaces — verified
  by the fact that the resulting effect data is usable by the runtime unchanged.
- **SC-009**: Marking a project active, then loading the default experience, runs that project's
  effects with zero manual configuration; clearing the active designation reverts the default
  experience to the shipped default catalog on the next load.
- **SC-010**: With the editor's live stage running and a timeline clip being actively dragged, the
  live pipeline continues to meet Milestone 1's existing ~30fps and latency budgets, measured the
  same way those budgets are already measured.

## Assumptions

Reasonable defaults chosen where the description did not specify. Each is a decision that can be
revisited without re-architecting.

- **Relationship to the default visitor experience**: resolved by clarification — see
  `## Clarifications`, FR-033a–c, and SC-009. The editor is an additional mode of Mudra Web,
  reached deliberately, alongside the unchanged default minimal experience Milestone 1 shipped (no
  landmarks, no readouts, camera → pose → effect). The editor's currently open project is always
  what preview and test-trigger play against; the default experience runs the shipped default
  catalog unless the author has explicitly marked a saved project active, in which case it runs
  that project instead.
- **One open project at a time**: the editor holds a single open project as its working document,
  consistent with "create, save, load, duplicate, import, export" all acting on one document at a
  time. Multiple simultaneous open projects are not required by this milestone.
- **Undo/redo**: not required in this milestone. The explicit instruction against building a
  general-purpose graphics editor, combined with local save/duplicate already providing a recovery
  path (save before a risky edit; duplicate before experimenting), makes this a reasonable
  deferral rather than a gap.
- **Persistence mechanism**: "save/load" is satisfied by fast, local, on-device persistence for the
  iterate-and-resume loop; "import/export" is satisfied by a portable, single-artifact file for
  moving a project between sessions or machines. Both are local-only; neither implies a specific
  storage technology, which remains a plan-level choice.
- **Test-trigger confidence and timing**: a synthetic pose event uses a confidence at or above the
  trigger's own minimum-confidence condition (so a correctly authored trigger reliably fires under
  test) and the current wall-clock time; it does not attempt to simulate a partial or failing hold.
- **Segmentation scope**: exactly one segmentation-dependent action is required to ship in this
  milestone as a full demonstration of the capability-gated pattern (FR-047); the remaining
  named directions (background replacement, foreground/background compositing, person isolation,
  and the rest) are future, separately-scoped work the capability model must not preclude.
- **Editor UI performance**: resolved by clarification — see `## Clarifications` and FR-058/FR-059.
  The live pipeline's existing numeric budgets are non-negotiable even while the editor UI is in
  use; the editor UI's own responsiveness is a qualitative bar in this milestone, not a new
  numeric target.
- **UI framework and rendering technology for the editor's own controls** (palette, inspector,
  timeline chrome) are plan-level decisions; this specification requires only that they never
  become a second execution or drawing path for effect output itself (FR-003, FR-004).
- **Supported browsers**: unchanged from Milestone 1 — current evergreen desktop browsers with
  camera access. Segmentation availability is expected to vary by browser and device; that
  variance is exactly what the capability gate exists to handle honestly.
- **Golden fixtures and architecture tests**: extended, not replaced — the existing
  no-hardcoded-effects and privacy architecture tests are expected to gain editor-directory
  coverage rather than being superseded by new ones.

## Technical Constraints *(given, not derived)*

These were specified by the requesting stakeholder as milestone constraints, recorded here rather
than embedded in the requirements above, because they are implementation decisions for *this*
milestone, not properties of the problem.

- Application location: `apps/web/`, the same application Milestone 1 established — this is an
  evolution of it, not a new application.
- The editor MUST NOT introduce a second effect runtime or a second renderer; it authors data
  consumed by the existing `EffectRuntime` and drawn by the existing renderer.
- Person segmentation, where implemented, MUST use the existing MediaPipe Tasks Vision family,
  consistent with the hand-landmark detection backend, unless technical investigation during
  planning demonstrates it cannot satisfy the requirement.
- Canvas2D remains the default and required renderer. WebGL, Three.js, Pixi.js, or any 3D rendering
  stack is out of scope unless the existing Canvas2D implementation is demonstrably incapable of a
  concrete, required editor feature — and even then requires its own authorization.
- No backend, accounts, or cloud service of any kind is introduced by this milestone.

## Out of Scope

Explicitly excluded. These exclusions are intentional and must not be expanded through
implementation detail; each requires its own authorization and specification.

- Publishing, user accounts, cloud persistence, a marketplace, social sharing, or collaborative
  multi-user editing.
- Gameplay, combat, scoring, or progression mechanics.
- Arbitrary scripting or code authoring by users.
- Any backend service.
- WebGL, Three.js, Pixi.js, or any 3D rendering stack (see Technical Constraints).
- Keyframes, easing/Bézier curves, expressions, or nested/child timelines.
- Uploading assets to, or retrieving assets from, any network or cloud asset store.
- A general-purpose graphics or vector editor.
- Undo/redo (see Assumptions).
- Full implementation of every named segmentation-dependent action; only a demonstrative subset is
  required (FR-047).

## Dependencies

- The Mudra Web Milestone 1 application (`apps/web/`) and its existing domain model:
  `EffectDefinition`, `Timeline`/`TimelineEntry`, `ActionRegistry`/`ActionDescriptor`/`ParamSpec`,
  `EffectRuntime`, `RenderCommand`, the capability registry, the asset-reference indirection, and
  `SessionConfig`'s active pose set.
- The existing pose dataset and its catalog/eligible/active-pose-set distinctions, unchanged.
- The existing repository-level hand-landmark model asset and MediaPipe Tasks Vision backend, on
  which person segmentation is expected to build.
- Constitution v1.7.0's authorization of this milestone and its restated architectural rules
  (effects remain data; the runtime and renderer remain the sole executor and drawer).
