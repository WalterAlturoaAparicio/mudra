# Feature Specification: Phase 2.75 — Live Recognition Preview

**Feature Branch**: `005-live-recognition-preview`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Phase 2.75 — Live Recognition Preview. A new capability in the
existing apps/capture Flutter app (mobile), authorized as a bounded exception under
constitution v1.4.0 / Principle VI. It does NOT replace or modify Capture's dataset-collection
purpose (spec 003) — it is a new, separate screen/mode reusing spec 003's camera pipeline
(CameraSource/CameraSession, CanonicalViewConverter, TranslationScaleNormalizer, the pose
catalog and its already-recorded local dataset). Pipeline: Camera → MediaPipe Hands →
Canonicalization → Normalization → Pose Matcher → Live Prediction. No neural network, no model
training, no cloud, no backend — deterministic matching only. Recognition output, updated
continuously: predicted pose, confidence, top-3 candidates, recognition latency, and a
stability indicator. A pose becomes 'confirmed' after remaining the stable top prediction for a
configurable duration (example: 3–5 seconds), then triggers a themed visual effect. Purpose: (a)
validate that the collected dataset supports stable recognition — an instability signal means
the pose needs more/better samples — and (b) produce a visually engaging demo. Sync/export
packaging changes are a separate revision of specification 003, referenced but not duplicated
here."

## Overview

Mudra Capture can now collect pose datasets (specification 003). Phase 2.75 answers a question
that collection alone cannot: **is what was collected actually good enough to recognize a pose
reliably?** This feature adds a second screen to the same app — a live camera view that
continuously predicts which catalog pose the camera currently sees, using only the samples
already recorded on the device, and confirms a pose after it has been held steadily long enough
to rule out a lucky guess.

It has two audiences at once. For the person building the dataset, an unstable or wrong
prediction on a pose they know they are performing correctly is a direct, immediate signal that
the pose needs more or better samples — this screen is the dataset's own test suite, running
live. For anyone watching, a correctly recognized pose triggers a small themed visual effect,
which is what makes the validation loop itself worth showing off before the next milestone
("Mudra Studio") begins.

Nothing here trains a model, calls a network, or persists a new sample. Recognition is
deterministic distance/similarity matching against the normalized landmarks already on disk,
computed fresh every time the screen opens.

## Clarifications

### Session 2026-07-26

- Q: What's the target recognition latency (camera frame → displayed prediction) for the
  preview to feel live? → A: Under 200ms. Comfortable buffer above typical perceptual
  "feels live" thresholds (~100–150ms), leaving headroom for the mid-range hardware
  assumption specification 003 already uses, and consistent with a simple
  distance-comparison matcher's expected cost.
- Q: What dataset scale must the recognition preview stay responsive at? → A: 5,000 samples
  across the catalog — matches specification 003's existing SC-011 benchmark exactly, so both
  features share one comparable, already-validated scale target.

## Glossary

| Term | Meaning |
|---|---|
| **Recognition preview** | This feature: the live camera screen that continuously predicts a pose and confirms it after stability. |
| **Pose Matcher** | The deterministic component that compares live, canonical, normalized landmarks against stored samples and produces ranked candidates. No learning, no training — comparison only. |
| **Exemplar** | One stored sample's normalized landmark vector, used as a reference point the matcher compares live frames against. Exemplars are read from the existing dataset, never newly recorded here. |
| **Candidate** | One pose considered for the current frame, with a score and a derived confidence. |
| **Prediction** | The top-ranked candidate for the current frame. |
| **Stability** | How long the same pose has remained the top prediction, above the confidence floor, without interruption. |
| **Confirmed pose** | A prediction that has been stable for the configured duration; triggers its visual effect exactly once per confirmation. |
| **Canonical convention**, **canonicalization** | As defined in specification 003 — the single mirrored-front-camera viewing convention every stored sample and every live frame is expressed in before comparison. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a pose get recognized live (Priority: P1)

A contributor opens the recognition preview, holds up a hand shape from the catalog, and
immediately sees a predicted pose name, a confidence value, and how it compares to the next two
most likely poses — updating continuously as they move, with no perceptible lag.

**Why this priority**: This is the feature. Everything else — stability, confirmation, effects —
is built on top of a prediction that already updates live and feels immediate.

**Independent Test**: Open the recognition preview with a hand in view, hold a pose that has
recorded samples, and verify a prediction, a confidence value, and a top-3 list all appear and
update as the hand moves, without navigating anywhere else.

**Acceptance Scenarios**:

1. **Given** the recognition preview is open and a hand is visible, **When** the contributor
   holds a shape matching a recorded pose, **Then** that pose appears as the top prediction with
   a confidence value, and the two next most likely poses are shown alongside it.
2. **Given** a prediction is showing, **When** the contributor changes their hand shape, **Then**
   the prediction, confidence, and top-3 list update within a perceptibly immediate delay, never
   freezing on the previous shape.
3. **Given** no hand is in view, **When** the contributor looks at the screen, **Then** it states
   plainly that no hand is detected rather than showing a stale or fabricated prediction.
4. **Given** the recognition preview is open, **When** the contributor looks at the screen at any
   time, **Then** the current recognition latency (time from camera frame to displayed
   prediction) is visible.

---

### User Story 2 - Confirm a pose and see its effect (Priority: P1)

A contributor holds a pose steadily. After a short, visible countdown-like stability period, the
pose is marked confirmed and a small themed visual effect plays — horse ears for the horse pose,
a green glow for the snake pose, and so on — turning a correct, steady pose into a rewarding,
demo-worthy moment.

**Why this priority**: Confirmation is what turns a raw prediction into a validated result, and
the effect is what makes the validation loop itself the demo the milestone asks for.

**Independent Test**: Hold a recorded pose steadily for the configured stability duration and
verify the screen marks it confirmed and plays that pose's visual effect exactly once, without
recording any new sample or leaving the screen.

**Acceptance Scenarios**:

1. **Given** a pose has been the stable top prediction for the whole configured duration,
   **When** that duration elapses, **Then** the pose is marked confirmed and its visual effect
   plays once.
2. **Given** a pose is partway through its stability window, **When** the contributor changes
   their hand shape before the duration elapses, **Then** the stability progress resets and no
   effect plays.
3. **Given** a pose has just been confirmed and its effect has played, **When** the contributor
   keeps holding the exact same pose, **Then** the effect does not replay on every subsequent
   frame — confirmation is a one-time event per held pose, not a per-frame one.
4. **Given** the contributor releases the pose and later holds it again, **When** it becomes
   stable again, **Then** it is confirmed and its effect plays again, independently of the first
   confirmation.
5. **Given** a pose has no themed effect defined, **When** it is confirmed, **Then** a generic
   confirmation effect plays instead of nothing happening.

---

### User Story 3 - Use recognition to find weak spots in the dataset (Priority: P2)

A contributor believes they are performing a pose correctly, but the recognition preview keeps
predicting something else, or never stabilizes. This tells them, without any external tool, that
this pose's samples need attention — more volume, more variety, or a re-check of how it was
recorded — sending them back to Capture's Record flow with a concrete target.

**Why this priority**: This is the other half of the milestone's purpose — the recognizer as a
dataset debugging tool — but it depends on User Story 1 already working.

**Independent Test**: Deliberately use a pose with very few recorded samples (or none) and
confirm the screen distinguishes "recognized correctly," "recognized incorrectly / unstable,"
and "not enough data to try" as three visibly different states.

**Acceptance Scenarios**:

1. **Given** a pose has too few recorded samples to be matched against reliably, **When** it is
   performed, **Then** it is excluded from the top-3 candidates and the screen states plainly
   that this pose does not yet have enough data, rather than guessing.
2. **Given** a pose is performed correctly but the prediction repeatedly favors a different pose
   or never stabilizes, **When** the contributor watches this happen across several attempts,
   **Then** the on-screen stability indicator makes the instability visible rather than only
   showing a final right/wrong result.
3. **Given** a contributor wants to see which poses in the catalog are currently
   recognition-ready, **When** they look at the recognition preview's summary of the catalog,
   **Then** poses with enough samples to be matched are visibly distinguished from those that are
   not.

---

### User Story 4 - Works across the whole catalog without special-casing (Priority: P3)

The recognition preview considers every catalog pose that currently has enough recorded data,
including two-handed poses, without the contributor needing to pick which pose they intend to
show in advance.

**Why this priority**: Breadth matters for the demo and for dataset validation to be meaningful,
but the feature is already useful for a single pose without full-catalog coverage.

**Independent Test**: Record a small number of samples for a two-handed pose, perform it with
both hands, and verify it can appear as a candidate and be confirmed exactly like a one-handed
pose.

**Acceptance Scenarios**:

1. **Given** a two-handed pose has recorded samples, **When** the contributor shows both hands in
   the shape of that pose, **Then** it can be predicted, become stable, and be confirmed.
2. **Given** a two-handed pose is being evaluated, **When** only one hand is visible, **Then**
   that pose is not offered as the top prediction, consistent with its declared hand requirement.
3. **Given** the contributor performs any catalog pose with enough recorded samples, **When**
   they hold it steadily, **Then** the same recognition, stability, and confirmation behavior
   applies regardless of which pose it is.

---

### Edge Cases

- **No hand in view**: no prediction is shown; the screen states plainly that no hand is
  detected. Stability progress resets.
- **Fewer hands than a candidate pose requires**: that pose is excluded from candidates for that
  frame, the same rule Capture's recording already applies to stored samples.
- **A pose with zero or too few recorded samples**: excluded from every candidate list and
  flagged as not yet recognizable, never silently guessed at.
- **Two top candidates are nearly tied**: shown as low-confidence / ambiguous rather than
  reported as a confident prediction; an ambiguous frame does not contribute toward stability.
- **The camera is lost or the app is backgrounded mid-stability**: stability progress resets to
  zero and no effect plays, consistent with how an in-flight recording take is abandoned
  elsewhere in the app.
- **The screen is left and reopened**: exemplars are freshly read from the current dataset on
  every entry, so samples recorded in the meantime (via Capture's Record flow) are reflected
  without restarting the app.
- **A very large dataset** (at least 5,000 samples across the catalog, specification 003's own
  scale benchmark): recognition and the screen remain responsive, and the 200ms latency target
  still holds; this is a functional requirement, not an incidental property.
- **A confirmed pose has no themed visual effect authored yet**: a generic confirmation effect
  plays instead, the same placeholder-safety pattern specification 003 uses for missing reference
  images — dropping in a themed effect later requires no code change.
- **The dataset changes size while the screen is open** (e.g., a sample is deleted or added by
  another means): the next screen entry re-reads it; the feature makes no claim about mid-session
  live updates to the exemplar set.

## Requirements *(mandatory)*

**Reuse of the existing camera pipeline**

- **FR-001**: The recognition preview MUST reuse specification 003's camera abstraction
  (`CameraSource`/`CameraSession`) to acquire the camera, with the same lifecycle discipline
  already required there — released when the screen is left, reacquired cleanly when it is
  reopened, at most one camera session live at any time.
- **FR-002**: Every frame the recognition preview evaluates MUST already be in the canonical
  viewing convention (specification 003, FR-053–FR-058) before it reaches the matcher, using the
  existing conversion — this feature MUST NOT re-implement or bypass that conversion.
- **FR-003**: The recognition preview MUST default to the front lens with a mirrored preview,
  matching how a contributor would naturally use it to watch and correct their own hands; lens
  switching, where the device supports it, MUST behave exactly as it already does elsewhere in
  the app.
- **FR-004**: The recognition preview MUST NOT persist any sample, session record, or dataset
  file. It is read-only with respect to the dataset: it reads stored samples to build exemplars
  and writes nothing back.

**Reference data (exemplars)**

- **FR-005**: For each catalog pose, the recognition preview MUST build its set of exemplars from
  that pose's currently stored samples' normalized landmark vectors — the same normalized
  representation specification 003 already persists (`translation_scale` v1.0) — computed fresh
  each time the screen is opened, never cached across app restarts.
- **FR-006**: A pose whose stored sample count is below a configured minimum MUST be excluded
  from matching entirely and reported as not yet recognizable, rather than matched against a
  statistically meaningless handful of examples.
- **FR-007**: Building exemplars MUST NOT require or trigger any network access, cloud service,
  or backend of any kind.

**Pose Matcher (deterministic only)**

- **FR-008**: The application MUST recognize poses using deterministic distance- or
  similarity-based comparison against stored exemplars only. Machine learning, model training,
  and neural-network inference of any kind are explicitly prohibited for this feature, per the
  constitution's Phase 2.75 exception.
- **FR-009**: For a two-handed pose, matching MUST consider both hands together — a candidate
  MUST NOT be offered as the top prediction unless the live frame's hand count meets that pose's
  declared requirement (mirroring specification 003's `required_hands` rule).
- **FR-010**: The matcher MUST produce, for every eligible candidate pose, a score from which a
  bounded, comparable confidence value is derived, so that "confidence" means the same thing
  across every pose in the catalog.
- **FR-011**: The matcher's comparison MUST run entirely on-device, with no network dependency,
  consistent with specification 003's offline-only constraint.

**Live recognition output**

- **FR-012**: The recognition preview MUST continuously display, updated on every processed
  frame: the current top-predicted pose, its confidence, the next two candidates (top 3 total),
  and the current recognition latency (time from frame capture to displayed prediction), which
  MUST stay under 200ms so the preview reads as live (SC-002).
- **FR-013**: When no candidate clears the minimum confidence needed to be considered a real
  prediction (including "no hand visible" and "ambiguous between top candidates"), the screen
  MUST say so in plain language rather than displaying a low-quality guess as if it were
  confident.
- **FR-014**: The reference pose image and catalog navigation used elsewhere in the app are not
  required on this screen; the recognition preview's layout MUST prioritize the live prediction,
  the top-3 list, and the stability indicator as its primary content.

**Pose stability and confirmation**

- **FR-015**: The application MUST track, per current top prediction, how long it has remained
  the stable top prediction above the confidence floor, and MUST display this as a stability
  indicator that updates continuously (not only at the moment of confirmation).
- **FR-016**: A change of top prediction, a drop below the confidence floor, or the loss of a
  detected hand MUST reset the stability tracking to zero immediately.
- **FR-017**: A pose MUST be marked confirmed only after remaining the stable top prediction,
  continuously, for a configured duration. This duration MUST be configuration data (not a
  hardcoded literal at a call site), defaulting to a value in the 3–5 second range the milestone
  description names as its example.
- **FR-018**: Confirmation MUST fire exactly once per continuous stable hold — holding the same
  confirmed pose afterward MUST NOT retrigger its effect on every frame. A new confirmation MUST
  be possible only after the pose stops being the top prediction and later becomes stable again.

**Visual effects**

- **FR-019**: Each catalog pose MAY declare a themed visual effect, triggered exactly once when
  that pose is confirmed. Effect definitions MUST be data (not hardcoded per-pose branches in
  UI code), so an effect can be authored or changed without touching application logic — the same
  pattern specification 003 uses for the pose catalog and reference images.
- **FR-020**: A pose with no themed effect declared MUST still play a generic confirmation effect
  when confirmed; a missing themed effect MUST NOT mean no effect, and MUST NOT break the screen.
- **FR-021**: Visual effects are explicitly demo-quality: they MUST NOT require any asset,
  library, or technique beyond what a 2D overlay driven by hand-landmark positions can produce.
  No face mesh, 3D rendering, or production-quality animation is required or expected.
- **FR-022**: A visual effect MUST NOT block or delay the recognition preview's continuous
  prediction updates — the live pipeline keeps running while an effect plays.

**Dataset-quality debugging**

- **FR-023**: The recognition preview MUST make three states visibly distinct at all times: a
  pose is confidently and stably recognized; a pose is being attempted but is unstable, low
  confidence, or contested by another candidate; and a pose does not yet have enough recorded
  samples to be attempted at all.
- **FR-024**: The application MUST provide a view of catalog-wide readiness — which poses
  currently have enough samples to be matched and which do not — so a contributor can identify
  gaps without leaving the recognition preview.
- **FR-025**: Nothing in this feature MUST be interpreted as a measurement of dataset
  correctness beyond recognition stability; it MUST NOT claim to validate anything about a
  pose's semantic meaning, only whether its recorded samples support stable, repeatable
  recognition.

**Platform, lifecycle, and scope boundaries**

- **FR-026**: The recognition preview MUST be reachable from the application without altering
  specification 003's home screen requirement of exactly two primary actions (Record, Sync); it
  MUST be a secondary, clearly-labeled entry point.
- **FR-027**: Camera lifecycle rules already required elsewhere in the app apply unchanged here:
  the camera MUST be released within one second of leaving this screen, and reacquired cleanly
  when it is reopened.
- **FR-028**: The application MUST NOT include machine learning, model training, neural-network
  inference, cloud services, a backend, or gameplay/"attacks" mechanics of any kind in this
  feature, beyond the confirmed-pose visual effect itself, per the constitution's Phase 2.75
  exception.
- **FR-029**: This feature MUST NOT modify specification 003's dataset-collection requirements
  (including FR-040/FR-041, which remain in force for Capture's recording flow) and MUST NOT
  change the export/Sync archive format — packaging changes are governed by a separate revision
  of specification 003.
- **FR-030**: The recognition preview MUST function correctly regardless of dataset size,
  remaining responsive — including the 200ms latency target (FR-012) — with a catalog-wide
  sample count of at least 5,000 (specification 003's own SC-011 scale benchmark).

### Key Entities

- **Exemplar**: One stored sample's normalized landmark vector plus its `pose_id` and handedness,
  read from the existing dataset and used as a comparison reference. Never newly created by this
  feature.
- **Candidate**: One pose considered for the current frame: a `pose_id`, a raw match score, and a
  derived confidence.
- **Recognition result**: The outcome for one processed frame — the ranked top-3 candidates (or
  "no hand" / "ambiguous"), and the latency from frame capture to this result being available.
- **Stability state**: The current top prediction, how long it has held that position above the
  confidence floor, and whether it has reached confirmation for this hold.
- **Confirmation event**: A one-time occurrence — which pose, when — that triggers exactly one
  playback of that pose's visual effect (or the generic fallback).
- **Effect definition**: Data associating a `pose_id` with a themed visual effect; absent for a
  pose, the generic fallback effect is used instead.
- **Catalog readiness**: Per pose, whether its current stored sample count meets the minimum
  needed to be matched at all — the dataset-debugging summary this feature surfaces.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a pose with a healthy number of correctly-recorded samples, performing it
  correctly results in it becoming the top prediction and reaching confirmation within the
  configured stability window, in at least 9 out of 10 trials — this is the primary
  dataset-validation signal the feature exists to produce.
- **SC-002**: Recognition latency (frame captured → prediction displayed) stays **under 200ms**
  for at least 95% of frames across a continuous 2-minute session, so the preview reads as live
  rather than delayed.
- **SC-003**: A pose below the minimum sample threshold is never offered as a top-3 candidate, in
  100% of trials — insufficient data never produces a confident-looking wrong answer.
- **SC-004**: Confirmation never fires before the configured stability duration has fully
  elapsed, in 100% of trials, and fires within a small, consistent margin after it.
- **SC-005**: Every confirmation — themed or generic fallback — visibly plays its effect, in 100%
  of trials; no confirmation is ever silent.
- **SC-006**: A contributor can determine, from the recognition preview alone and without any
  external tool, which catalog poses are currently recognition-ready and which need more samples,
  in under 30 seconds.
- **SC-007**: The recognition preview remains responsive (no frozen interface, no dropped camera
  session, and the latency target in SC-002 still holds) with a dataset containing **at least
  5,000 samples** across the catalog — the same scale specification 003's SC-011 already
  commits to for storage and export.
- **SC-008**: Repeating a stable hold of the same pose after an earlier confirmation produces a
  second, independent confirmation and effect playback, in 100% of trials — confirmation never
  "sticks" or blocks itself from firing again.
- **SC-009**: A two-handed pose reaches confirmation through the same flow as a one-handed pose,
  with no special-cased user action, in every trial where enough samples exist.

## Assumptions

- **Matching algorithm**: left as an implementation decision per the milestone description ("the
  simplest architecture that works well with our normalized landmark representation"). The
  natural fit is nearest-neighbor / weighted distance comparison directly over the
  `translation_scale`-normalized landmark vectors already persisted by specification 003 — no new
  normalization step, no re-derivation from canonical raw landmarks. The specific distance
  measure and neighbor count are a planning-phase decision, not fixed here, provided the result
  stays deterministic and reproducible for the same stored dataset.
- **Exemplar source**: exemplars are built from each sample's already-persisted `normalized`
  landmark field, not recomputed from `canonical_raw` — the two are equivalent for a given
  normalizer version, and using the persisted value avoids a second normalization pass.
- **Minimum sample threshold**: a configuration value (not fixed here) below which a pose is
  excluded from matching; the exact number is a planning-phase decision informed by how many
  examples the chosen matching approach needs to be stable.
- **Confidence floor and stability window**: both are configuration data with the milestone's
  named example (3–5 seconds) as the stability default; neither is a fixed, hardcoded literal.
- **Effect authoring**: effect definitions are data, following FR-019. Poses named in the
  milestone description (horse, dog, snake, dragon, bird, tp) get themed effects first; every
  other catalog pose uses the generic fallback effect (FR-020) until a themed one is authored —
  authoring more themed effects requires no specification change.
- **Entry point**: reached from the home screen as a secondary, clearly-labeled action (for
  example, an icon alongside the app bar) rather than a third primary action, preserving
  specification 003's FR-007 exactly.
- **No new persistence**: this feature reads the dataset and writes nothing to it — no new
  sample, session record, or configuration is persisted as a side effect of using the recognition
  preview.
- **Export/Sync packaging**: the archive filename and internal folder layout changes described
  alongside this milestone belong to a separate revision of specification 003 and are out of
  scope here; this feature does not read or produce export archives.
- **Single contributor, on-device only**: consistent with specification 003, there is no
  multi-user, multi-device, or networked aspect to recognition — matching happens against
  whatever is currently stored on this device.

## Dependencies

- Specification 003 (Mudra Capture): the camera abstraction (`CameraSource`/`CameraSession`),
  the canonical viewing convention and its converter, the `translation_scale` v1.0 normalizer,
  the pose catalog, and the on-device sample repository are all reused as-is. This feature adds
  no new camera or storage capability of its own.
- The constitution's Phase 2.75 exception (v1.4.0, Principle VI): the authority under which
  deterministic recognition and demo visual effects are permitted at all in this application.
- The existing local dataset: recognition quality is entirely dependent on what has already been
  recorded via specification 003's Record flow; this feature has no data of its own to fall back
  on.
