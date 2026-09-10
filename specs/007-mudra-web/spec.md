# Feature Specification: Mudra Web — Pose-Driven Effect Runtime

**Feature Branch**: `007-mudra-web`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "Mudra Web is a web-based interactive visual-effects playground driven by Mudra pose recognition. The core experience is: camera → detect hand landmarks → recognize a pose → emit a pose event → trigger a visual effect → transform the scene in real time. The purpose of this milestone is not to demonstrate hand tracking technically. The user should experience Mudra as an interactive visual system where making a pose causes something visually meaningful to happen. The first milestone should prove that this interaction is fun, responsive, and technically viable."

**Governing authorization**: Constitution v1.6.0, Principle VI — *Mudra Web — Milestone 1: Pose-Driven Effect Runtime*.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Make a pose, see something happen (Priority: P1)

A curious visitor opens Mudra Web, allows the camera, and sees themselves on screen. Nothing technical
is presented — no dots on their hands, no numbers. They raise a hand into one of the supported poses
and hold it. After a brief, visible build-up, the scene transforms: the screen flashes and particles
burst outward. They laugh, drop their hand, and try it again. Within a minute they have discovered a
second pose and its effect.

**Why this priority**: This *is* the milestone. Every other story exists to support, explain, or
extend this one. If only this story ships, Mudra Web is already a demonstrable product, and the
question the milestone exists to answer — *can the Mudra pipeline drive an experience?* — is answered.

**Independent Test**: Open the application on a machine with a webcam, grant camera access, perform a
supported pose, and observe a visible transformation of the scene. Requires no configuration, no
documentation, and no technical knowledge from the tester.

**Acceptance Scenarios**:

1. **Given** a first-time visitor with a working webcam, **When** they open the application and grant
   camera access, **Then** a live, correctly-oriented view of themselves appears with no landmark
   overlay, no numeric readouts, and no technical vocabulary on screen.
2. **Given** the live view is running, **When** the visitor forms a supported pose and holds it,
   **Then** an indication of progress toward confirmation is visible, and on confirmation the
   associated effect plays.
3. **Given** an effect has just played, **When** the visitor releases the pose and forms it again,
   **Then** the effect plays again.
4. **Given** the visitor holds a supported pose continuously past confirmation, **When** several
   seconds pass without releasing, **Then** the effect plays exactly once — it does not repeat or
   stutter while the hold continues.
5. **Given** the visitor's hands leave the frame entirely, **When** no hands are detected, **Then**
   no effect is triggered and the experience remains stable.
6. **Given** the visitor denies camera access or has no camera, **When** the application loads,
   **Then** a plain-language explanation of what is needed is shown, with no technical error text.

---

### User Story 2 - Change what a pose does without touching runtime logic (Priority: P2)

A developer wants the "hi" pose to flash blue instead of white, to last longer, and to add a particle
burst anchored to the palm. They edit the effect configuration, reload, and see the change. They then
add an entirely new effect for a different pose — still without modifying any runtime logic.

**Why this priority**: This is the architectural claim the milestone must prove. A playground whose
effects are hardcoded cannot become an editor later. Demonstrating that an effect is *configuration*
is what makes the next milestone possible, and it is verifiable now.

**Independent Test**: Modify only effect configuration data — no runtime source — and observe changed
behavior. Then add a new effect entry mapping an unused pose to existing actions, and observe it
trigger. Both without editing any logic that interprets, schedules, or renders effects.

**Acceptance Scenarios**:

1. **Given** an existing effect, **When** a parameter such as colour, duration, intensity, or anchor
   is changed in configuration only, **Then** the observed behaviour changes accordingly with no
   change to runtime logic.
2. **Given** a pose with no effect configured, **When** a new effect entry is added in configuration
   referencing only already-supported action types, **Then** that pose triggers the new effect.
3. **Given** an effect configuration, **When** the order or timing of its actions is changed, **Then**
   the actions occur in the new order and at the new times.
4. **Given** the runtime source, **When** it is inspected, **Then** it contains no branch, mapping, or
   conditional keyed to a specific pose identifier or a specific named effect.
5. **Given** a configuration containing an unknown action type or a malformed entry, **When** the
   application loads it, **Then** the problem is reported clearly and identifiably rather than
   failing silently or crashing the experience.

---

### User Story 3 - Effects that unfold over time (Priority: P2)

An effect is not a single flash. A developer composes a sequence: the screen flashes immediately,
particles burst shortly after, the background transitions over the following second, and a trail
follows the user's fingertip for as long as the effect runs. Each part starts at its own moment and
lasts its own length.

**Why this priority**: One-shot effects would prove far less than the milestone needs. Time-based
composition is what makes the conceptual "teleport" effect reachable later without re-architecting,
and it is the capability a future timeline editor edits.

**Independent Test**: Configure a multi-action effect with actions at distinct start times and
distinct durations, trigger it, and verify each action begins and ends when configured — including at
least one action that updates continuously across many frames rather than firing once.

**Acceptance Scenarios**:

1. **Given** an effect with actions configured at different start offsets, **When** it is triggered,
   **Then** each action begins at its configured offset relative to the effect's start.
2. **Given** an action configured with a duration, **When** the effect plays, **Then** the action
   remains active for that duration and then stops.
3. **Given** an action that follows a live landmark, **When** the user moves their hand during
   playback, **Then** the action's visual output tracks the hand across frames.
4. **Given** an effect is playing, **When** its total duration elapses, **Then** all of its actions
   have ended and the scene returns to its resting state.
5. **Given** two effects are triggered close together, **When** both are still within their
   durations, **Then** both continue to play without one cancelling or corrupting the other.

---

### User Story 4 - Understand what the system is doing (Priority: P3)

A developer tuning recognition, or diagnosing why a pose is not triggering, switches on a debug view.
It reveals hand landmarks, the ranked candidate poses with their confidences, the current event state
and hold progress, the frame rate, and which capabilities are unavailable. Switching it off restores
the clean experience.

**Why this priority**: Necessary for development and for honest failure reporting, but no visitor
needs it. Deliberately last so that the default experience is never designed around it.

**Independent Test**: Toggle debug mode on and off and confirm that technical information appears and
disappears, and that the visitor-facing experience is unchanged when it is off.

**Acceptance Scenarios**:

1. **Given** the default experience, **When** the application loads, **Then** debug information is
   off and no technical readout is visible.
2. **Given** debug mode is enabled, **When** hands are visible, **Then** the 21 landmarks per hand,
   their connections, and the detected handedness are drawn over the camera view.
3. **Given** debug mode is enabled, **When** a pose is being recognized, **Then** the ranked
   candidates, their confidences, the active event state, and hold progress are shown.
4. **Given** debug mode is enabled, **When** an effect references a capability the application cannot
   currently provide, **Then** that unavailability is reported explicitly and identifiably.
5. **Given** debug mode is enabled, **When** the pipeline is running, **Then** the measured frame rate
   and end-to-end latency are displayed.

---

### Edge Cases

- **No camera / permission denied / camera in use by another application**: each is reported in plain
  language with a distinct, actionable message; the application does not present a technical error.
- **Camera permission revoked mid-session**: the experience stops cleanly and explains what happened.
- **No hands in frame**: recognition reports no detection; any in-flight effect continues to its
  natural end rather than being cut off.
- **Hands present but no pose matches**: nothing triggers; debug mode shows why (below confidence
  floor, or ambiguous).
- **Two candidate poses too close to call**: the ambiguity gate suppresses triggering rather than
  guessing; hold progress resets.
- **Pose broken and immediately re-formed**: hold progress restarts from zero; confirmation requires a
  fresh continuous hold.
- **Pose held continuously past confirmation**: exactly one confirmation for that hold.
- **A pose whose dataset has too few samples**: excluded from the bundle and from recognition
  entirely, and reported as a dataset limitation — never worked around by lowering the threshold.
  `domain_expansion` currently has 1 sample against a minimum of 20 and **will not be recognizable in
  this milestone**.
- **A pose present in the bundle but outside the active pose set**: never matched and never
  contributing to confidence; its exclusion is configuration, and debug mode makes the active pose set
  visible so "why didn't my pose fire?" has an answer.
- **Audio blocked by browser policy or asset missing**: the effect's visual actions still play in full;
  the audio failure is reported in debug mode. An effect must remain legible with sound muted.
- **Effect configuration references a missing asset**: reported clearly; the rest of the effect still
  plays rather than the whole experience failing.
- **Effect configuration references an unavailable capability** (e.g. person visibility, which
  requires segmentation not present in this milestone): the action is inert, and its inertness is
  explicitly observable in debug mode — never silently skipped, never fake-succeeding.
- **Exemplar data is stale or was built from a different dataset revision**: detected and reported at
  load rather than silently producing degraded recognition.
- **Browser tab backgrounded**: the pipeline pauses or degrades gracefully and recovers on return
  without stuck effects or a stuck hold.
- **Very low frame rate on weak hardware**: effects remain time-correct (driven by elapsed time, not
  by frame count) so a slow machine plays effects at the right speed, just less smoothly.
- **Window resized or aspect ratio changed mid-session**: the camera view and effect output stay
  aligned; anchors resolve to the correct on-screen positions.

## Requirements *(mandatory)*

### Camera, presentation, and privacy

- **FR-001**: System MUST request camera access on an explicit user action and MUST present the live
  camera view once granted.
- **FR-002**: System MUST present the camera view **mirrored**, as a user expects of a selfie view.
- **FR-003**: System MUST distinguish and report, in plain language, the cases: no camera present,
  permission denied, permission dismissed, and camera unavailable because another application holds it.
- **FR-004**: System MUST release the camera when the experience is stopped or the page is left.
- **FR-005**: System MUST NOT persist camera frames, still images, video, or any derivative imagery —
  not to disk, not to storage, not to a network destination, and not to a downloadable artifact.
- **FR-006**: System MUST NOT transmit camera imagery off the device. All processing is local to the
  browser session.
- **FR-007**: System MUST NOT provide any recording, capture, screenshot, clip-saving, or sharing
  capability in this milestone.
- **FR-008**: System MUST NOT record, write, or contribute samples to any pose dataset.

### Coordinate space and mirroring *(high-risk correctness area)*

- **FR-009**: System MUST feed the hand-detection stage imagery in the **same mirroring convention as
  the recorded dataset**, so that reported handedness names the user's physical hand and normalized
  landmarks are directly comparable to stored exemplars.
- **FR-010**: System MUST maintain a single, documented definition of the recognition coordinate
  space, and the presented view MUST agree with it: a landmark drawn in debug mode MUST appear over
  the corresponding point of the user's hand as displayed.
- **FR-011**: System MUST resolve effect anchors into the same on-screen space as the presented camera
  view, so that an effect anchored to a hand appears on that hand as the user sees it.
- **FR-012**: System MUST verify mirroring correctness by test rather than by inspection: a known
  input in a known convention MUST produce known handedness and known normalized coordinates.
- **FR-013**: System MUST NOT allow presentation mirroring and recognition mirroring to be configured
  independently in a way that permits them to disagree.

### Landmark detection

- **FR-014**: System MUST detect up to two hands per frame, each with exactly 21 landmarks, a
  handedness label, and a per-hand confidence.
- **FR-015**: System MUST emit one detection result per processed frame **including frames with zero
  hands**, so that absence is data rather than silence.
- **FR-016**: System MUST access detection behind a replaceable interface, such that the detection
  backend can be substituted without changes to normalization, recognition, events, or effects.
- **FR-017**: System MUST report detection initialization failure (model unavailable, unsupported
  browser) in plain language rather than failing silently.

### Pose vocabulary

Three distinct pose populations exist, and conflating them is how a pose disappears silently. All
three are necessary; counts below are **verified against the repository on 2026-08-20**.

| Term | Definition | Count | Determined by |
|---|---|---|---|
| **Catalog poses** | Every pose identity the project defines | **18** | The shared pose catalog |
| **Eligible poses** | Catalog poses with enough recorded samples to be matched against | **17** | The minimum-sample threshold (20) |
| **Active poses** | Eligible poses participating in matching for the current configuration | **3–5** | Runtime configuration |

- **FR-023a**: System MUST make all three populations explicit and reportable. A pose that is in the
  catalog but not eligible, or eligible but not active, MUST be identifiable **with its reason**, in
  debug mode. No pose may vanish silently through a build filter or a configuration default.
- **FR-023b**: Exactly one catalog pose is currently ineligible: **`domain_expansion`**, which holds
  **1** recorded sample against a minimum of **20**. This is a dataset limitation to be reported, never
  a threshold to be lowered.
- **FR-023c**: Of the 17 eligible poses, **5 are one-handed** (`hi`, `militar_hi`, `ok`, `peace`, `tp`)
  and **12 are two-handed** (`bird`, `dog`, `dragon`, `hare`, `horse`, `monkey`, `ox`, `ram`, `rat`,
  `snake`, `tiger`, `wild_boar`). The default active pose set MUST include at least one of each, so both
  matching paths are exercised by the shipped configuration.

### Normalization and recognition

- **FR-018**: System MUST normalize each detected hand using the dataset's established
  translation-and-scale convention: the wrist becomes the origin and coordinates are divided by the
  wrist-to-middle-finger-MCP span.
- **FR-019**: System MUST produce normalization output that is **numerically identical, within a
  documented tolerance, to the reference implementation**, verified against committed golden fixtures
  generated from that reference.
- **FR-020**: System MUST score each eligible pose by weighted nearest-neighbour distance against
  stored exemplars, using per-landmark weights of **0.5 for the wrist, 2.0 for the five fingertips,
  and 1.0 for every other landmark**.
- **FR-021**: System MUST match a **one-handed** pose hand-agnostically: either live hand may be
  compared against any of that pose's exemplars, and the lowest-distance pairing wins.
- **FR-022**: System MUST match a **two-handed** pose like-for-like — live left against exemplar left,
  live right against exemplar right — and only against the two hands **of the same original sample**,
  never two different samples' hands combined.
- **FR-023**: System MUST combine a two-handed pose's per-hand distances as their **mean, not their
  sum**, so a two-handed match is on the same confidence scale as a one-handed match.
- **FR-024**: System MUST consider a pose eligible only when it is in the **active pose set** and the
  frame contains at least the number of hands that pose requires.
- **FR-024a**: System MUST support an **active pose set** — the subset of eligible poses that
  participate in matching — supplied as a **configurable runtime input**, changeable without
  regenerating the exemplar bundle and without modifying any logic. This milestone ships a default
  active pose set of 3–5 mutually distinct poses.
- **FR-024b**: The active pose set is a **candidate-set restriction only**. It MUST NOT alter the
  distance function, the per-landmark weights, the softmax formulation, the confidence floor, the
  ambiguity margin, or the stability rules. Its sole effect is which poses are offered to the matcher.
- **FR-024c**: Because confidence is normalized across the candidate set, confidence values **are not
  comparable across different active sets**. System MUST report the active pose set alongside confidence in
  debug mode, so a confidence figure is never read without the context that gives it meaning.
- **FR-024d**: A future grouping abstraction (an "experience" owning an active pose set and its
  effects) is **out of scope**. This milestone requires only that the candidate set be explicit and
  configurable — nothing may assume a single global active pose set is permanent, and nothing may implement
  the grouping.
- **FR-025**: System MUST derive confidence by softmax over negated distances across the whole
  eligible candidate set, so confidence means the same thing for every pose. Poses outside the active
  set MUST NOT contribute to the softmax denominator.
- **FR-026**: System MUST classify a frame as **not recognized** when the top candidate's confidence
  is below the confidence floor of **0.5**.
- **FR-027**: System MUST classify a frame as **ambiguous** when the gap between the top two
  candidates' confidences is below the ambiguity margin of **0.12**.
- **FR-028**: System MUST expose the recognition thresholds as configuration, and MUST NOT alter them
  per-pose or lower them to make an individual pose easier to recognize.
- **FR-029**: System MUST verify matcher behaviour against committed golden fixtures covering
  one-handed matching, two-handed matching, the averaging rule, the confidence floor, and the
  ambiguity margin.
- **FR-030**: System MUST rank and expose the top candidates (at least three, or fewer when fewer are
  eligible) for debug presentation.

### Pose lifecycle events

- **FR-031**: System MUST emit pose lifecycle events distinguishing at least four states: a pose
  **becoming** active, a pose **remaining** active, a pose **satisfying confirmation**, and a pose
  **ceasing** to be active.
- **FR-032**: System MUST treat any recognition outcome that is not a confident, unambiguous match of
  the *same* pose as ending the current hold.
- **FR-033**: System MUST require a **continuous, uninterrupted** hold of **1.0 second** to reach
  confirmation; a broken and re-formed hold restarts from zero. The duration MUST be configuration,
  not a literal, so it can be retuned against real use without a logic change.
- **FR-034**: System MUST emit **exactly one** confirmation per continuous hold, regardless of how
  long the hold continues afterwards or how many frames are processed.
- **FR-035**: System MUST expose hold progress as a continuously-updating value between 0 and 1 so the
  experience can show the user that something is building.
- **FR-036**: System MUST drive hold timing by **elapsed wall-clock time, not frame count**, so the
  required hold is the same duration on fast and slow hardware.
- **FR-037**: Pose events MUST carry at minimum the pose identity, the event kind, the confidence, and
  the time of the event, so an effect trigger can evaluate conditions without re-deriving them.
- **FR-038**: The event model MUST be stable and independent of the effect system: adding, removing,
  or changing effects MUST NOT require changing the event model.

### Effect definitions and triggering

- **FR-039**: An effect MUST be expressed as **data**: a definition record loaded from configuration,
  not a code path.
- **FR-040**: The effect runtime MUST NOT contain a branch, lookup, or conditional keyed to a specific
  pose identifier or a specific named effect. Adding or changing an effect MUST be a configuration
  change only.
- **FR-041**: An effect definition MUST carry a stable identity, a human-readable name, a trigger, and
  a timeline of actions.
- **FR-042**: A trigger MUST specify which pose lifecycle event it responds to and for which pose.
- **FR-043**: A trigger MUST support zero or more **conditions** evaluated against the event and
  runtime state, including at minimum a minimum-confidence condition and a re-trigger cooldown.
- **FR-044**: System MUST support more than one effect being configured, and MUST define and document
  deterministic behaviour when multiple effects match the same event.
- **FR-045**: System MUST validate effect configuration when it is loaded, reporting the offending
  entry by identity, and MUST NOT allow an invalid entry to fail silently at play time.

### Timeline and action semantics

- **FR-046**: A timeline MUST position each action by an **absolute offset** from the effect's start,
  not as a chain of relative delays from the preceding action.
- **FR-047**: Reordering or moving one action on a timeline MUST NOT require recomputing any other
  action's position.
- **FR-048**: System MUST support three action behaviours and MUST distinguish them:
  **instantaneous** (occurs at its offset and is done), **duration-based** (occupies a span and
  typically progresses across it), and **continuous** (updates every frame while active, tracking
  live state).
- **FR-049**: System MUST advance running effects by elapsed time each frame, supporting effects that
  update over many frames rather than one-shot playback only.
- **FR-050**: System MUST support multiple effect playbacks being active simultaneously without one
  corrupting or cancelling another.
- **FR-051**: System MUST end a playback when its timeline completes and MUST release its resources.

### Initial action set

- **FR-052**: System MUST provide a **screen flash** action with configurable colour, intensity, and
  duration.
- **FR-053**: System MUST provide a **background change** action that composites a full-screen colour,
  gradient, or image **over** the camera view, with configurable opacity, blend, and a transition in
  and out over a configurable duration. It MUST NOT claim or imply that content is placed behind the
  user; nothing in this milestone can distinguish person from background.
- **FR-054**: System MUST provide a **particle burst** action with configurable particle count,
  appearance, duration, and anchor.
- **FR-054a**: System MUST provide an **audio playback** action that plays a sound identified by a
  logical asset reference. Playback MUST be unlocked by the user gesture that grants camera access, and
  a blocked or failed playback MUST be reported in debug mode rather than failing silently.
- **FR-055**: System SHOULD provide a **landmark trail** action that follows a live landmark for the
  duration of the effect, demonstrating continuous behaviour.
- **FR-056**: The initial action set MUST demonstrate all three action behaviours from FR-048 rather
  than being three cosmetic variants of the same behaviour.
- **FR-057**: System MUST NOT ship a large effect library in this milestone.

### Anchors

- **FR-058**: An action's position MUST be expressed as **data**, resolved against runtime state.
- **FR-059**: System MUST support at minimum these anchor kinds: a fixed **screen** position, a
  **hand centroid**, and a **specific landmark** of a specified hand.
- **FR-060**: An action MUST NOT require its own code to locate a landmark or a hand; anchor
  resolution MUST be a shared capability.
- **FR-061**: An anchor that cannot currently be resolved (e.g. it names a hand not in frame) MUST
  have documented, non-crashing behaviour, and that behaviour MUST be observable in debug mode.

### Asset references

- **FR-062**: Effect configuration MUST reference assets by **logical identifier**, never by physical
  path.
- **FR-063**: System MUST resolve logical identifiers to physical assets through an indirection that
  can change without any effect definition changing.
- **FR-064**: System MUST report an unresolvable asset reference clearly, and MUST continue playing
  the remainder of the effect.
- **FR-065**: Only assets local to the project are required in this milestone. Assets MUST be
  Mudra-owned or otherwise licensed for the project's use.

### Runtime / renderer separation

- **FR-066**: The effect runtime MUST NOT draw. It MUST produce **declarative render instructions**
  describing what should appear.
- **FR-067**: The renderer MUST consume those instructions and MUST be the only component that draws.
- **FR-068**: The render instruction vocabulary MUST be independent of any particular drawing
  technology, such that an alternative renderer can be substituted without changing effect
  definitions, the runtime, or the domain model.
- **FR-069**: The effect runtime MUST be testable without a browser, a display, or a camera: given a
  sequence of events and elapsed times, it MUST produce a verifiable sequence of render instructions.
- **FR-070**: The renderer MUST composite effect output over the live camera view in real time.

### Action registration and editor readiness

- **FR-071**: Action types MUST be extensible through registration rather than through a runtime
  switch enumerating every action type.
- **FR-072**: Each registered action type MUST expose machine-readable metadata describing its
  parameters — at minimum each parameter's identity, kind, and default — sufficient for a future
  editor to discover them and generate controls without hardcoded knowledge of that action.
- **FR-073**: Adding a new action type MUST NOT require modifying the timeline scheduler, the event
  system, or the renderer's dispatch logic.
- **FR-074**: The visual editor is **not** part of this feature. No editor UI is built. Only the
  discoverability described in FR-072 is required.

### Capability gating

- **FR-075**: System MUST represent capabilities that an effect may require but the application may
  not provide.
- **FR-076**: The effect model MAY reserve a **person visibility** action. Person segmentation MUST
  NOT be implemented and no segmentation dependency MUST be introduced in this milestone.
- **FR-077**: When an effect references an unavailable capability, the action MUST be inert, MUST NOT
  appear to succeed, and its inertness MUST be explicitly reported in debug mode.
- **FR-078**: An unavailable capability MUST NOT prevent the rest of the effect from playing.

### Exemplar data

- **FR-079**: System MUST NOT ship the full pose dataset to the browser.
- **FR-080**: A **build-time export** MUST produce a compact bundle containing only the normalized
  landmark data the matcher requires, plus the pose identities and hand requirements, for **every**
  pose meeting the minimum-sample threshold. The bundle's contents are independent of the active pose
  set, so widening recognition coverage never requires re-exporting.
- **FR-081**: The export MUST be **deterministic**: the same dataset produces a byte-identical bundle.
- **FR-082**: The bundle MUST be **traceable to its source dataset**, carrying enough provenance to
  identify which dataset revision and how many samples per pose it was built from.
- **FR-083**: The bundle MUST carry a version identifier sufficient for the application to detect a
  **stale or mismatched** bundle at load, and MUST report that condition rather than degrading
  recognition silently.
- **FR-084**: The bundle's contents MUST be verified against golden fixtures so that a change in
  export behaviour is caught rather than shipped.
- **FR-085**: A pose with fewer than the minimum of **20** samples MUST be excluded from the bundle and
  from recognition, and MUST be reported as a dataset limitation with its actual sample count. Of the
  **18** catalog poses, **17** currently qualify; the single exclusion is `domain_expansion` at **1**
  sample. The exclusion MUST be documented and visible, never worked around by lowering the threshold.
- **FR-086**: The export MUST NOT modify the source dataset in any way.

### Experience and debug mode

- **FR-087**: The default experience MUST prioritize visual interaction: no landmarks, no confidence
  values, no frame rate, no event state, and no technical vocabulary visible by default.
- **FR-088**: System MUST make hold progress visible to the user in a non-technical way, so a pose in
  progress does not feel unresponsive.
- **FR-089**: System MUST provide a discoverable way for a visitor to learn which poses are supported,
  without turning the default screen into a technical readout.
- **FR-090**: System MUST provide a **debug mode**, off by default, exposing landmarks and their
  connections, handedness, ranked candidates with confidences, event state and hold progress, frame
  rate, end-to-end latency, unavailable capabilities, and asset-resolution failures.
- **FR-091**: Toggling debug mode MUST NOT alter recognition or effect behaviour.

### Performance

- **FR-092**: The complete pipeline — camera through recognition through effect rendering — MUST
  sustain approximately **30 frames per second** on a reasonable modern desktop browser.
- **FR-093**: Performance MUST be **measured and reported**, not assumed. The measurement MUST be
  visible in debug mode and MUST be reproducible.
- **FR-094**: End-to-end latency from frame capture to recognition outcome MUST be measured, with a
  target of **200 milliseconds or less**.
- **FR-095**: An effect MUST begin visibly within **200 milliseconds** of the event that triggers it.
- **FR-096**: Frame scheduling MUST be driven by the browser's video-frame delivery where available,
  rather than by an independent timer that can drift from the camera.
- **FR-097**: System MUST NOT introduce a worker or alternative rendering architecture in this
  milestone unless measurement demonstrates the need; any such need MUST be recorded as a finding
  rather than pre-empted.

### Boundaries

- **FR-098**: Mudra Web MUST NOT import source code from Mudra Engine or Mudra Capture.
- **FR-099**: Functionality already implemented in another Mudra application that Mudra Web needs MUST
  be independently implemented, and where it is an algorithm the Engine owns, verified against golden
  fixtures generated from the Engine's implementation.
- **FR-100**: A new shared cross-language library MUST NOT be created to avoid this duplication.
- **FR-101**: The existing hand-landmark model MUST be consumed as a shared repository-level asset and
  MUST NOT be copied into the application's tree.
- **FR-102**: Mudra Web MUST NOT implement, or lay groundwork requiring, any of: a visual effect
  editor, person segmentation, a 3D rendering stack, gameplay or combat mechanics, machine learning or
  model training, a backend, accounts, cloud storage, a marketplace, social features, or
  user-generated-content infrastructure.

### Key Entities

- **LandmarkFrame**: One processed camera frame — zero or more hands, each with 21 landmarks, a
  handedness, and a confidence, plus a timestamp. Emitted even when empty.
- **NormalizedHand**: One hand's landmarks after wrist-origin translation and span scaling; the form
  in which live hands and stored exemplars are comparable.
- **Exemplar**: One stored sample-hand used as a comparison reference — its pose identity, its
  originating sample identity (needed to keep a two-handed pair together), its handedness, and its
  normalized landmarks.
- **ExemplarBundle**: The browser-ready collection of exemplars for every pose meeting the minimum
  sample threshold, with provenance and a version identifier for staleness detection.
- **ActivePoseSet**: The configured subset of bundled poses that participate in matching. Determines
  the softmax denominator, and therefore what confidence *means* in a given configuration.
- **Candidate**: One pose considered for the current frame, with its distance and derived confidence.
- **RecognitionOutcome**: The frame's verdict — no hands, unrecognized, ambiguous, or recognized —
  carrying ranked candidates and measured latency.
- **PoseEvent**: A lifecycle event for one pose — becoming active, remaining active, confirmed, or
  ended — with pose identity, confidence, and time.
- **HoldState**: Which pose is currently being held, since when, whether it has already confirmed, and
  its progress toward confirmation.
- **EffectDefinition**: The data record for one effect — identity, name, trigger, timeline.
- **Trigger**: Which pose event, for which pose, subject to which conditions.
- **Condition**: A data-expressed predicate over the event and runtime state (minimum confidence,
  cooldown).
- **Timeline**: An ordered set of entries, each placing one action at an absolute offset with an
  optional duration, plus the effect's total length.
- **Action**: A configured unit of effect behaviour — its type, its parameters, its behaviour class
  (instantaneous, duration-based, continuous).
- **ActionDescriptor**: The registration record for an action type, including the parameter metadata a
  future editor would need.
- **Anchor**: A data-expressed screen position — fixed, hand centroid, or specific landmark.
- **AssetReference**: A logical identifier resolved to a physical asset through an indirection.
- **RenderCommand**: One declarative drawing instruction produced by the runtime and consumed by the
  renderer.
- **Capability**: A named ability the application may or may not provide (e.g. person segmentation),
  determining whether a dependent action is live or inert.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor, given no instruction beyond a list of supported poses, triggers
  their first effect within **60 seconds** of granting camera access.
- **SC-002**: In a session of 10 deliberate attempts at supported poses, at least **8** produce the
  intended effect.
- **SC-003**: Holding a supported pose continuously for 15 seconds produces **exactly one** effect
  playback.
- **SC-004**: The experience remains visually smooth, sustaining approximately **30 updates per
  second** on a reasonable modern desktop browser, measured and reported rather than asserted.
- **SC-005**: An effect becomes visible within **200 milliseconds** of the triggering event.
- **SC-006**: A developer changes an existing effect's appearance, timing, and anchor, and adds one
  new effect for a previously-unused pose, **editing only configuration data** — verified by the fact
  that no runtime logic file is modified.
- **SC-007**: Normalization and matching reproduce the reference implementation's results on **100%**
  of golden-fixture cases within the documented tolerance.
- **SC-008**: A deliberately mirrored-wrong input is **detected by the test suite**, not by a human
  noticing degraded recognition.
- **SC-009**: The exemplar bundle is at most **2 megabytes** and regenerates byte-identically from the
  same dataset.
- **SC-010**: Across a full session, **zero** camera frames, images, or video are written to storage or
  sent off the device — verifiable by inspection of storage and network activity.
- **SC-011**: Every effect referencing an unavailable capability is **identifiable in debug mode**;
  none appears to have succeeded.
- **SC-012**: The default experience displays **zero** technical readouts; every technical readout is
  reachable through debug mode.
- **SC-013**: A pose excluded for insufficient samples is reported as such, and the recognition
  thresholds in the shipped configuration are unchanged from the established values.
- **SC-014**: An effect composed of at least four actions at distinct offsets executes each action
  within **50 milliseconds** of its configured time.

## Clarifications

### Session 2026-08-20

- Q: How long must a pose be held continuously before it confirms and fires its effect? → A: **1.0
  second**. The established 3.0 s value came from a dataset-validation context and would feel sluggish
  for a playground; 1.0 s still requires a deliberate continuous hold, so the stability gate continues
  to suppress flicker and transitional false positives. All hold *semantics* — continuous hold, single
  confirmation per hold, reset on break — are preserved unchanged.

- Q: Which poses should the exemplar bundle contain, and which participate in matching? → A: **The
  bundle contains every eligible pose; matching is restricted to a configured active pose set** of 3–5
  visually distinct poses for this milestone. Confidence is softmax over eligible candidates, so the
  0.5 floor requires the top pose to dominate every rival; with 17 similar candidates (several are
  near-identical two-handed interlocks) that floor would rarely be passed, and FR-028 forbids lowering
  it. Bundling everything keeps provenance complete and makes widening coverage a configuration change
  rather than a re-export.

- Q: What should the "background change" action do, given that nothing can be placed behind the user?
  → A: **A full-screen tinted overlay wash composited over the camera view** — a colour, gradient, or
  image with configurable opacity and blend, transitioning in and out over a configurable duration.
  Person segmentation is out of scope, so the camera video is an opaque rectangle and nothing can be
  drawn behind it; an overlay reads as "the world changed" while keeping the person visible, and is
  honest about the missing capability rather than simulating it. Replacing the camera view outright
  remains available as a separate future action, not as this one's behaviour.

- Q: Should an audio playback action ship in this first milestone? → A: **Yes.** Audio is inexpensive
  in a browser, the camera-permission gesture already satisfies the autoplay policy, and it materially
  raises the "is this fun?" bar the milestone exists to answer. Architecturally it is the more
  valuable choice: it proves the logical-asset indirection across **two** media kinds rather than one,
  which is the property that makes the indirection worth having.

## Assumptions

Reasonable defaults chosen where the description did not specify. Each is a decision that can be
revisited without re-architecting.

- **Pose-to-effect mapping**: The active pose set (3–5 poses, see Clarifications) is chosen for mutual
  visual distinctness and to cover both one-handed and two-handed recognition. Each of the required
  effects is mapped to a distinct active pose. An active pose without a configured effect is still
  recognized but triggers nothing — no generic fallback effect ships in this milestone, so "nothing
  happened" is unambiguous during development.
- **Trigger event for the shipped examples**: The shipped example effects trigger on **confirmation**.
  The trigger model supports the other lifecycle events; no shipped example needs them yet.
- **Repeat behaviour**: Inherited from the established semantics — one confirmation per continuous
  hold, requiring the hold to break and restart. A configurable cooldown condition additionally guards
  rapid re-triggering.
- **Multiple matching effects**: All matching effects play, composited in a deterministic order. This
  is documented behaviour rather than an error condition.
- **Hold progress presentation**: Shown as a non-numeric visual build-up, not a percentage.
- **Supported browsers**: Current evergreen desktop browsers with camera access. Mobile browsers are
  not a target of this milestone and are not tested.
- **Single camera**: The default camera is used; no camera-selection interface ships.
- **Audio**: Included (see Clarifications, FR-054a) and following the same logical-asset-reference rule
  as every other asset. Browser autoplay policy requires a prior user gesture; granting camera access
  satisfies it. Audio is a convenience, never a carrier of meaning — an effect must still read
  correctly with the sound muted.
- **Debug mode activation**: Reachable without a rebuild, and not discoverable by accident from the
  default experience.
- **Golden fixtures**: Generated by an addition to the repository's existing script area, following
  the established precedent, and committed to this application's test suite.
- **Dataset access**: The bundle is built from the repository's existing dataset at build time; the
  application does not read the dataset at runtime.

## Technical Constraints *(given, not derived)*

These were specified by the requesting stakeholder as milestone constraints. They are recorded here
rather than embedded in the requirements above, because they are implementation decisions for *this*
milestone, not properties of the problem — and per constitution v1.6.0 the build toolchain is
explicitly a plan-level choice.

- Application location: `apps/web/`, a separate application under the monorepo's application layout.
- Language and toolchain: TypeScript, Vite, Vitest.
- Hand landmark detection: MediaPipe Tasks Vision, consuming the existing repository-level
  `assets/hand_landmarker.task` model as a shared asset.
- Rendering: Canvas2D.
- **No UI framework** and **no WebGL/3D engine** in this milestone.

## Out of Scope

Explicitly excluded. These exclusions are intentional and must not be expanded through implementation
detail; each requires its own authorization and specification.

- Visual effect editor (the underlying model must merely not preclude it)
- Person segmentation (the action concept may be reserved; the capability must not be built)
- WebGL, Three.js, Pixi.js, or any 3D rendering stack
- Gameplay, combat, or "attacks" mechanics
- Backend, accounts, cloud storage, marketplace, social features, user-generated-content infrastructure
- Recording, persistence, or sharing of camera frames, images, or video
- Dataset collection through Mudra Web
- Machine learning, model training, or new neural networks
- Mobile browser support
- Sequence recognition (multi-pose combinations over time)
- An "experience" abstraction grouping an active pose set with its effects (FR-024d) — the seam must
  not be foreclosed, but nothing may implement it

## Dependencies

- The existing pose dataset at the repository level, as the source of exemplars.
- The existing repository-level hand-landmark model asset.
- The existing pose catalog's pose identities and per-pose hand requirements.
- A reference implementation of normalization and matching from which golden fixtures are generated.
- Constitution v1.6.0's authorization of this milestone and its two boundary rules (shared binary
  assets; cross-language ports verified by golden fixtures).
