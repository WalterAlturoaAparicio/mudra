# Feature Specification: Mudra Web — Gated Web Capture Mode

**Feature Branch**: `009-web-capture-mode`

**Created**: 2026-09-07

**Status**: Draft

**Input**: Continue Mudra Web with the Web Capture Mode described in `specs/008-effect-editor/future-work.md` section B: a gated, local-first path for collecting additional hand-landmark samples that exports exactly the canonical pose-sample schema, under constitution v1.8.0's Milestone 3 authorization.

**Constitutional basis**: constitution v1.8.0, Principle VI — "Mudra Web — Milestone 3: Gated Web
Capture Mode". This specification implements that authorization and nothing beyond it.

---

## Why this feature exists

The Mudra pose dataset improves by collecting more samples, across more people, hand sizes,
distances, rotations and lighting. Today that requires Mudra Capture on an Android device. A
collaborator with a laptop and a browser cannot contribute, even though Mudra Web already runs the
same MediaPipe model against the same normalization the dataset was built with.

Web Capture closes that gap and nothing else. It is **not** a crowdsourcing platform, **not** an
account system, **not** a second recognition engine, and **not** a dataset-management tool. The
governing sentence for every decision below is: *the smallest possible local-first data collection
path that produces canonical Mudra samples.*

Mudra Capture remains the primary recorder. Web Capture is a complementary convenience path. The two
applications exchange nothing; both write the same versioned schema to disk for Engine to consume.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Collect samples for a pose and export them (Priority: P1)

An authorized collaborator opens the capture build, agrees to the capture consent, names themselves
with a short contributor label, picks the pose they are going to perform, and starts a session. They
raise the pose, trigger a take, and a countdown gives them time to hold it steady; a small burst of
samples is recorded. They repeat this a few dozen times, watching the sample count climb. When done,
they export the session and get a single archive file on their disk.

**Why this priority**: This is the entire feature. Without it there is no reason to build any of the
rest. It delivers the one thing the milestone exists for — more canonical samples — and it is
independently valuable the moment one archive lands in `datasets/poses/`.

**Independent Test**: Run the capture build, complete one session for one pose, export, unzip, and
load every produced file through Engine's `PoseSerializer.from_json` without modification.

**Acceptance Scenarios**:

1. **Given** the capture build is running and the camera has not been started, **When** the
   collaborator opens Capture Mode, **Then** a consent step is shown that names what will be
   recorded (landmark coordinates and session metadata), what will never be recorded (camera images
   or video), and where it is kept (this browser only) — and no camera is started and no sample is
   recorded until it is explicitly accepted.
2. **Given** consent has been given and the camera is running, **When** the collaborator has not yet
   chosen a contributor label and a pose, **Then** the control that starts a session is unavailable
   and states what is missing.
3. **Given** an active session for pose `dragon` with a two-second countdown and a burst of five,
   **When** the collaborator triggers a take while holding a valid pose, **Then** the countdown is
   visibly displayed, five samples are recorded at the configured interval, and the session's sample
   count increases by exactly five.
4. **Given** an active session, **When** the collaborator triggers a take with no hands in frame,
   **Then** no sample is recorded, the count does not change, and the reason is displayed in plain
   language.
5. **Given** a session with at least one sample, **When** the collaborator chooses Export, **Then** a
   single archive is offered for download containing `manifest.json` and one JSON file per sample
   under `datasets/poses/<pose_id>/`.
6. **Given** an exported archive, **When** it is extracted and every sample file is loaded by
   Engine's serializer, **Then** every file loads without error and reports `schema_version` 1.

---

### User Story 2 - Review and delete before exporting (Priority: P2)

The collaborator notices some takes were performed sloppily. They open the session's sample list,
see each sample with enough context to judge it (its index, when it was taken, how many hands, and a
small landmark rendering), delete the bad ones individually, and export what remains. Later they
clear the whole session so the browser holds nothing.

**Why this priority**: Data quality is the point of collecting more data; an unreviewable pile of
samples is worth less than a smaller reviewed one. It is also a constitutional requirement — what is
stored MUST be enumerable and removable. But P1 delivers value without it, so it follows.

**Independent Test**: Record ten samples, delete three individually, confirm the count is seven,
export and confirm the archive holds exactly seven sample files, then clear the session and confirm
the browser's capture storage holds nothing.

**Acceptance Scenarios**:

1. **Given** a session with ten samples, **When** the collaborator deletes one, **Then** the count
   becomes nine, that sample is gone from the list, and it is absent from a subsequent export.
2. **Given** a session with samples, **When** the collaborator clears the session and confirms,
   **Then** the session and every one of its samples are removed from browser storage entirely — no
   tombstone, no hidden copy, and no way to restore them.
3. **Given** a deletion has been performed, **When** the browser's storage is inspected directly,
   **Then** the deleted records are absent rather than flagged.
4. **Given** a session with samples, **When** the browser page is reloaded, **Then** the session and
   its samples are still present and the collaborator can continue where they left off.

---

### User Story 3 - Verified schema fidelity (Priority: P2)

A maintainer changes something in Engine's serializer, regenerates the golden fixtures, and the Web
test suite fails — surfacing the divergence as a deliberate cross-application event rather than
letting Web quietly start writing samples Engine can no longer read.

**Why this priority**: The constitution states plainly that a port which cannot be checked against
Engine's output is not authorized. The serializer is unusable without this, so it is delivered
alongside P1 rather than after it — it is listed separately because it is independently testable and
has its own acceptance criteria.

**Independent Test**: Run the new fixture-export script, then run the Web test suite; the serializer
suite must pass. Hand-edit one key name in the Web serializer and confirm the suite fails.

**Acceptance Scenarios**:

1. **Given** Engine-generated fixtures of known landmark inputs and their serialized documents,
   **When** the Web serializer serializes the same inputs, **Then** the resulting document matches
   structurally: identical key sets, identical key order at every level, identical array lengths and
   order, exact equality for every numeric value, and identical string and boolean values.
2. **Given** the Web serializer emits an extra, missing, or reordered key, **When** the fixture suite
   runs, **Then** it fails and names the differing path.
3. **Given** a generated export archive, **When** it is opened by Python's standard `zipfile`,
   **Then** it opens without warning, every entry's CRC validates, and every entry name matches the
   specified layout.

---

### User Story 4 - Undo and redo in the effect editor (Priority: P3)

An author editing an effect makes a change they regret and undoes it; then redoes it.

**Why this priority**: Explicitly the lowest priority in this milestone. It is the one Section C item
authorized (constitution v1.8.0), it touches nothing Capture Mode touches, and it is structurally
ready because every editor edit is already a pure `Project → Project` function. If it slips, Capture
Mode is unaffected.

**Independent Test**: In the editor, perform a sequence of edits, undo them all back to the opened
state, redo them all forward, and confirm the resulting project is identical to the pre-undo one.

**Acceptance Scenarios**:

1. **Given** a project with a series of edits applied, **When** the author undoes N times, **Then**
   the project matches the state N edits ago and the editor surfaces all reflect it.
2. **Given** an undone edit, **When** the author performs a new edit, **Then** the redo stack is
   discarded and cannot resurrect the abandoned branch.
3. **Given** an empty history, **When** the author invokes undo, **Then** nothing happens and the
   control indicates it is unavailable.

---

### Edge Cases

- **The camera is refused or unavailable.** Capture Mode reports the specific reason exactly as the
  existing experience does and offers no way to record; consent alone never implies a working camera.
- **A take fires with fewer hands than the pose requires.** Rejected, counted as discarded, and the
  reason shown. The count of accepted samples does not move.
- **A take fires with a non-finite coordinate.** Rejected for the same reason and by the same rule
  Mudra Capture already applies.
- **The pose identifier is new and not in the dataset.** Permitted — collecting samples for a pose
  that does not exist yet is a core reason the feature exists. The operator supplies the identifier
  and states how many hands it requires.
- **The pose identifier is malformed.** Rejected before a session can start; the identifier must
  match the identity rule the dataset already uses.
- **The contributor label looks like personal data.** The label is length-limited and
  character-limited so an email address or full name cannot be entered, and the consent text says the
  label travels with the exported samples.
- **Browser storage is full or unavailable (private window, blocked site data).** Reported plainly
  before a session starts; Capture Mode does not silently collect samples it cannot persist.
- **Export with zero samples.** The export control is unavailable and says why.
- **Two sessions exist for the same pose.** Both export into the same pose directory with a single
  continuous numbering sequence; sample identifiers remain globally unique so duplicates are always
  detectable.
- **The capture build flag is off.** No capture entry point exists in the built output, no capture
  code is reachable, and no capture route resolves.
- **The page is closed mid-session.** Samples already accepted are already persisted; the in-progress
  take is lost. Nothing is left half-written.

---

## Requirements *(mandatory)*

### Gating and access

- **FR-001**: Capture Mode MUST be behind a build-time flag (`VITE_MUDRA_CAPTURE=1`). When the flag
  is not set, the built output MUST contain no capture entry point, no capture route, and no
  reachable capture code.
- **FR-002**: The default public build (flag unset) MUST be unchanged in behavior from the
  application before this feature: no new control, label, storage, or network activity.
- **FR-003**: Capture Mode MUST NOT introduce accounts, passwords, sign-in, OAuth, an identity
  system, a backend service, or a server-side database.
- **FR-004**: Capture Mode MUST NOT implement an in-browser invite token, access code, or passphrase
  as a means of restricting access. Documentation of the feature MUST state that build-time gating is
  **feature gating, not deployment security**, and that restricting who can reach a deployed capture
  build is a hosting-layer concern outside this feature.
- **FR-005**: The contributor label MUST be documented and treated as **dataset provenance metadata
  only**. It MUST NOT be used for authentication, authorization, access control, or as a user
  identity.

### Consent and visible state

- **FR-006**: Entering Capture Mode MUST require an explicit consent action that is separate from,
  and additional to, granting camera access. Camera permission alone MUST NOT enable capture.
- **FR-007**: The consent text MUST state: what is recorded (normalized and canonical-raw landmark
  coordinates plus session metadata), what is never recorded (camera images, video, or any
  derivative), where it is kept (this browser only), that nothing is transmitted, and that the
  contributor label travels with exported samples.
- **FR-008**: While Capture Mode is active, the interface MUST display a persistent, unambiguous
  indication that Capture Mode is on and that landmark samples are being collected.
- **FR-009**: While a take is in progress (countdown or burst), the interface MUST make that state
  visibly distinct from merely being in Capture Mode.
- **FR-010**: Leaving Capture Mode MUST be an explicit action, and MUST stop the camera.
- **FR-011**: No sample may be recorded without a deliberate per-take operator action. Continuous or
  automatic background recording is prohibited.

### Session and sample collection

- **FR-012**: A capture session MUST be created explicitly and MUST carry a contributor label, a
  target pose identifier, and the number of hands that pose requires.
- **FR-013**: The pose identifier MUST be validated against the dataset's existing identity rule
  (lowercase alphanumeric and underscore). A pose identifier that is not yet present in the dataset
  MUST be permitted.
- **FR-014**: When the chosen pose already exists in the loaded exemplar data, its required hand
  count MUST be derived from that data. When it does not, the operator MUST supply it.
- **FR-015**: The system MUST NOT read Mudra Capture's pose catalog or any other application's files
  to determine pose metadata.
- **FR-016**: A take MUST support a countdown before the first sample is recorded, configurable
  including a value that disables it, and a burst of one or more samples at a configured interval.
- **FR-017**: Every candidate frame MUST be validated before it becomes a sample. A frame MUST be
  rejected when: no hand is present; fewer hands are present than the pose requires; any hand does
  not carry exactly 21 landmarks; or any coordinate is not finite.
- **FR-018**: Validation MUST use the same invariants Mudra Capture already enforces, and MUST NOT
  introduce Web-specific validity rules.
- **FR-019**: A rejected frame MUST NOT be persisted, MUST be counted as discarded, and its reason
  MUST be reported to the operator.
- **FR-020**: The current accepted-sample count for the session MUST be visible at all times while
  Capture Mode is active.
- **FR-021**: Accepted samples MUST be persisted as they are accepted, so that closing the page loses
  at most the take in progress.

### Recognition boundary

- **FR-022**: The capture pipeline MUST be exactly: camera → detector → normalization → validation →
  sample. It MUST NOT invoke pose classification or matching, MUST NOT emit pose events, and MUST NOT
  drive the effect runtime.
- **FR-023**: Capture Mode MUST NOT read, alter, or depend on recognition thresholds, matching
  weights, the softmax formulation, or hold/stability semantics.
- **FR-024**: Capture Mode MUST reuse the application's existing normalization implementation. A
  second normalization algorithm, a second matching representation, or a second landmark value object
  is prohibited.
- **FR-025**: The pose a sample is labelled with MUST be the pose the operator selected. The system
  MUST NOT infer, confirm, or override it by recognition.

### Coordinate convention

- **FR-026**: The stored landmark coordinates MUST be in the same convention the existing dataset
  uses. Mirroring is applied to the camera **pixels** before detection, so detected coordinates are
  natively in mirrored (selfie) space; **mirroring is not a display-only treatment, and no landmark
  coordinate is ever flipped afterwards**.
- **FR-027**: The `raw` landmark set MUST be the earliest **canonical** observation — the detector's
  output in the convention above — matching the meaning Mudra Capture's samples already carry. The
  `normalized` set MUST be the output of the existing normalization applied to that raw set.
- **FR-028**: The recorded normalization strategy and version MUST be the ones the application
  actually applied, and MUST match the values Engine records for the same strategy.

### Canonical schema and exported fields

- **FR-029**: Exported samples MUST use the existing pose-sample JSON schema, `schema_version` 1,
  exactly. A Web-specific pose-sample format, a variant, or a second landmark representation is
  prohibited.
- **FR-030**: Every field the canonical schema requires MUST be populated with a truthful value.
  Where the browser genuinely cannot determine a value that a device application can, the
  specification MUST record the convention used rather than invent a plausible one.
- **FR-031**: Additive fields are permitted **only** when additive, optional, placed inside a block
  the schema already defines, tolerated when absent, and individually justified in the schema
  contract. The set for this feature is exactly:
  - `metadata.capture.session_uuid` — which recording session produced this sample; the unit of
    review, deletion and export. Already established by Mudra Capture with the same meaning.
  - `metadata.capture.contributor_label` — which collaborator contributed the sample, so a batch can
    be reviewed or withdrawn after it has been merged into the dataset, at which point no external
    manifest is available. New in this feature.
  - `metadata.capture.countdown_enabled` — distinguishes "no countdown" from "a countdown of zero
    seconds", which `countdown_seconds` alone cannot. Already established by Mudra Capture.
  - `metadata.camera.mirrored_preview` — records the coordinate convention of the `raw` set, so a
    future normalization strategy re-derived from `raw` cannot inherit an ambiguity. Already
    established by Mudra Capture.
- **FR-032**: `metadata.camera.position` and `metadata.camera.lens_facing` MUST NOT be written. The
  browser cannot determine which physical lens is in use, and an absent optional field is correct
  where an invented value would be false.
- **FR-033**: No field may be added merely because Capture Mode happens to know it. Burst size,
  capture interval, viewport size, user agent, locale, and any UI configuration MUST NOT appear in an
  exported sample.
- **FR-034**: The application and detector versions recorded MUST identify Mudra Web and the
  detection backend it used, so a sample's producing application is determinable from the sample
  itself with no additive field.
- **FR-035**: Exported samples MUST be consumable by Engine with zero manual processing.

### Persistence boundary

- **FR-036**: Captured sessions and samples MUST be persisted in browser-local storage only, in a
  storage boundary dedicated to Capture Mode and separate from the editor's project persistence.
- **FR-037**: Capture data MUST NOT be written into, referenced by, or derived into the editor's
  project-document model, and a project MUST NOT be written into the capture store.
- **FR-038**: The capture store MUST be reachable only through a dedicated capture repository
  abstraction, mirroring the existing repository-port discipline, so the rules about what a capture
  session is stay testable with no browser attached.
- **FR-039**: Access to browser storage MUST remain confined to the single directory already
  permitted to touch it. No additional directory may gain that permission, and every other storage
  mechanism remains prohibited everywhere.
- **FR-040**: The persisted capture record MUST contain only landmark coordinates and the session
  metadata this specification names. Camera frames, video, canvas pixels, detector result objects,
  the mirrored camera surface, and segmentation data MUST NOT be persistable — and MUST NOT be
  representable in the persisted type at all.

### Deletion

- **FR-041**: Every persisted sample MUST be enumerable by the operator who recorded it.
- **FR-042**: An individual sample MUST be deletable.
- **FR-043**: An entire session, including all its samples, MUST be deletable in one action, behind a
  confirmation.
- **FR-044**: Deletion MUST remove the data. Soft deletion, tombstones, status flags standing in for
  removal, shadow copies, and undo buffers retaining deleted samples are prohibited.
- **FR-045**: After deletion, the deleted records MUST be absent from the underlying store when it is
  inspected directly.

### Export

- **FR-046**: Export MUST happen only by an explicit operator action, to the operator's own disk.
  There MUST be no automatic, scheduled, or background export.
- **FR-047**: The exported artifact MUST be a single archive containing `manifest.json` at its root
  and sample files at `datasets/poses/<pose_id>/sample_NNNNNN.json`, where `NNNNNN` is zero-padded to
  six digits and sequential per pose within the archive.
- **FR-048**: `manifest.json` MUST NOT be part of the pose-sample schema and MUST be inert to any
  reader of individual samples. It records what the export contains — schema version, producing
  application and version, export timestamp, normalization strategy and version, per-pose counts,
  total count, the sessions included, and the dataset fingerprint the browser was running against.
- **FR-049**: The archive MUST be produced deterministically: for the same session content it MUST be
  byte-identical across runs. Entry order MUST be `manifest.json` first, then sample entries sorted by
  their full entry name; entry names MUST use forward slashes, no leading slash, no `..` segment, and
  UTF-8 encoding; every entry MUST carry a correct CRC-32; and all entry timestamps MUST be a fixed
  constant rather than the current clock.
- **FR-050**: The archive MUST be readable by standard ZIP tooling, verified against Python's
  standard library implementation in the repository's own test tooling.
- **FR-051**: Export MUST be unavailable, with a stated reason, when the session holds no samples.
- **FR-052**: The export path MUST NOT read canvas pixels, capture the stage, or include any imagery.

### Network

- **FR-053**: Captured samples MUST NOT be transmitted, automatically or otherwise. There MUST be no
  upload, sync, telemetry, analytics, error reporting, or any outbound request carrying capture data.
- **FR-054**: The application's existing network posture MUST be unchanged: inbound `GET` only.

### Privacy guarantees preserved

- **FR-055**: Every existing prohibition on reading back or persisting imagery remains in force
  everywhere, including inside Capture Mode: canvas pixel readback, data-URL and blob conversion of
  canvas contents, stream capture, media recording, and image-bitmap creation.
- **FR-056**: Every existing prohibition on storage mechanisms other than the one permitted mechanism
  remains in force everywhere, including inside Capture Mode.
- **FR-057**: Exactly two narrowly scoped exemptions to the existing capture-affordance checks are
  authorized, both confined to Capture Mode's own surface:
  - a download affordance, for explicit dataset export only;
  - user-facing control labels using capture/record/save/download vocabulary, which are the correct
    words for this interface.
  Both MUST be scoped to named Capture Mode files, in the same manner the existing project-export
  exemption is scoped. Neither may be implemented by relaxing, broadening, or removing the existing
  checks.
- **FR-058**: The prohibition on any recording, capture, screenshot, or sharing affordance for the
  **camera view and its effects output** remains fully in force. The exemption above covers dataset
  export controls only.

### Architecture boundaries

- **FR-059**: Capture Mode MUST be a separate surface with its own entry point, emitted only when the
  build flag is set — not a mode grafted onto the default experience or the editor.
- **FR-060**: The capture domain MUST be framework-free and testable with no browser, no camera and
  no display, exactly as the existing domain is.
- **FR-061**: The capture tree MUST NOT depend on the project/editor model, and the project/editor
  tree MUST NOT depend on the capture model. This MUST be enforced by an automated architecture check,
  not by convention.
- **FR-062**: Capture Mode MUST NOT import from, name a path inside, or vendor anything from another
  application in the monorepo.
- **FR-063**: The capture serializer MUST be treated as a cross-language port of Engine's serializer
  and MUST be verified against fixtures generated from Engine's own implementation.

### Golden fixtures and cross-language verification

- **FR-064**: A repository-level Python script MUST generate serialization fixtures from Engine's own
  serializer and write them into the Web test suite. It MUST live with the existing export scripts,
  never inside the Web application tree.
- **FR-065**: The fixture suite MUST cover, at minimum: a one-handed sample; a two-handed sample;
  absent optional fields; a countdown-disabled sample; and coordinate values that stress numeric
  formatting (very small magnitudes, negative values, and values requiring full double precision).
- **FR-066**: A **structural match** is defined as: the same key set at every object level; the same
  key **order** at every object level; the same array lengths and element order; exact equality of
  every numeric value when compared as double-precision numbers; and identical string, boolean and
  null values. Byte-for-byte textual equality MUST NOT be required, because language-specific numeric
  formatting (for example `e-07` versus `e-7`) differs without any difference in value.
- **FR-067**: Fixtures MUST be regenerated whenever Engine's schema handling changes, and a resulting
  diff MUST be treated as a cross-application event handled deliberately, never silently
  re-baselined.

### Non-functional requirements

- **FR-068**: Capture Mode MUST sustain a live camera preview with landmark detection at a frame rate
  no worse than the existing experience achieves on the same machine, since it does strictly less
  work per frame (no matching, no effect runtime).
- **FR-069**: Recording a take MUST NOT stall the preview: the operator MUST continue to see live
  video and landmarks throughout the countdown and burst.
- **FR-070**: Persisting an accepted sample MUST NOT block the frame loop.
- **FR-071**: Every user-facing failure — camera, storage, validation, export — MUST be reported in
  plain language naming what happened and what to do, never a raw error string.
- **FR-072**: All capture configuration (countdown length, burst size, burst interval, label
  constraints, storage names) MUST be data loaded and validated at runtime, never hardcoded at call
  sites.
- **FR-073**: Type checking and linting MUST be clean, and the capture domain MUST be covered by
  automated tests, as the existing definition of done requires.

### Editor undo/redo (P3)

- **FR-074**: The editor MUST provide undo and redo over authoring edits, built on the existing pure
  project-edit functions rather than a new mutation mechanism.
- **FR-075**: A new edit after an undo MUST discard the redo branch.
- **FR-076**: Undo/redo MUST be editor state only. It MUST NOT be persisted into a project document,
  MUST NOT interact with capture data, and MUST NOT retain anything a deletion was meant to remove.
- **FR-077**: Undo/redo MUST NOT change what a project *is*: no project schema field is added,
  removed, or reinterpreted.

---

### Key Entities

- **CaptureSession**: one operator's recording session for exactly one pose. Carries a stable
  identifier, a contributor label, the pose identifier, the required hand count, a status (active or
  closed), the instant it started, and its accepted samples. It is the unit of review, deletion and
  export, and it is what `session_uuid` names in an exported sample.
- **CaptureSample**: one accepted observation. Carries a stable identifier, the instant it was
  captured, the take's countdown context, the source frame's dimensions, and per detected hand:
  handedness, handedness confidence, 21 canonical-raw landmarks and 21 normalized landmarks. It
  carries nothing else — there is deliberately no field in which an image could be placed.
- **CaptureValidationOutcome**: accepted, or rejected with a named reason drawn from the existing
  vocabulary (no hands, insufficient hands, wrong landmark count, non-finite coordinates).
- **CaptureRepository**: the boundary through which sessions and samples are stored, listed, and
  deleted. It knows nothing about projects.
- **ExportArchive**: the deterministic artifact handed to the operator — a manifest plus canonical
  sample documents in the dataset's own directory layout.
- **CaptureManifest**: the archive's inert entry point describing what the archive contains. Not part
  of the pose-sample schema.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of exported sample files load through Engine's own serializer without
  modification, and report `schema_version` 1.
- **SC-002**: 100% of exported sample files pass Engine's dataset validation with zero manual
  processing steps between export and validation.
- **SC-003**: The Web serializer matches Engine-generated fixtures structurally on 100% of fixture
  cases, including key order and exact numeric equality.
- **SC-004**: An operator can go from opening the capture build to their first accepted sample in
  under 60 seconds, including consent, label, and pose selection.
- **SC-005**: An operator can record 100 samples for one pose in a single sitting without leaving the
  capture surface or performing any step other than repeating a take.
- **SC-006**: Deleting a sample or clearing a session removes the corresponding records from browser
  storage completely, verified by direct inspection of the store — 0 residual records.
- **SC-007**: Across a full capture session (consent, collection, review, deletion, export), 0 network
  requests leave the origin other than inbound GETs for the application's own assets.
- **SC-008**: Across the same session, browser storage contains only capture sessions and samples;
  other storage mechanisms remain empty, and no stored value is an image, video, or canvas pixel.
- **SC-009**: Exporting the same session twice produces byte-identical archives.
- **SC-010**: Every generated archive opens in standard ZIP tooling with all CRCs valid — 0 warnings,
  0 unreadable entries.
- **SC-011**: With the build flag unset, the built output contains 0 capture entry points, 0 capture
  routes, and 0 reachable capture modules.
- **SC-012**: An invalid take (no hands, too few hands, non-finite coordinates) results in 0 persisted
  samples and a stated reason, in 100% of attempts.
- **SC-013**: Recognition behaviour is unchanged: the existing recognition and effect test suites pass
  without modification to any threshold, weight, or hold value.
- **SC-014**: In the editor, undoing every edit in a session returns the project to a state identical
  to the one it was opened in.

---

## Assumptions

- Web Capture's operators are the project owner and a small number of invited collaborators using a
  desktop or laptop browser with a working camera. Mobile browser support is not a goal of this
  milestone; it is not prevented either.
- One capture session covers exactly one pose. Collecting a second pose means a second session. This
  keeps the session model minimal and matches how the exported directory layout is organized.
- The contributor label is short, self-chosen, and constrained so that personal data cannot reasonably
  be entered. It is provenance, not identity.
- A countdown is genuinely needed because the operator is usually also the subject and cannot hold a
  two-handed pose while reaching for a control. A burst is genuinely needed because samples of the
  same held pose at slightly different instants are exactly the variation the dataset benefits from.
- Sample file numbering within an archive starts at 1 per pose. Merging an archive into an existing
  dataset can therefore collide with existing filenames; the schema contract records this consequence
  explicitly and the recommended handling is extraction to a staging directory. Globally unique sample
  identifiers make duplicates detectable regardless.
- The dataset fingerprint the browser was built against is recorded in the export manifest, not in
  samples: it describes the context of the export, not a property of any sample.
- Web samples record the same additive keys Mudra Capture records, with the same meanings, so a merged
  dataset does not carry two divergent conventions. `session_uuid` denotes "the recording session that
  produced this sample" in both; its granularity differs (one take in Capture, one operator session in
  Web) and the schema contract states so.
- Undo/redo is bounded to a reasonable depth rather than unbounded, so long editing sessions do not
  accumulate unbounded state.
- The existing persistence mechanism is sufficient for capture volumes at this milestone's scale; no
  new storage technology is introduced.

---

## Technical Constraints *(given, not derived)*

- Constitution v1.8.0 governs. Milestone 3's authorization defines the four data categories, and only
  categories 3 (landmark samples) and 4 (minimal session metadata) are persistable.
- Principle II is unchanged and binds everywhere: coordinates, never images.
- The versioned pose-sample JSON schema is the only contract between applications. Web writes it or it
  is not a capture mode.
- Cross-language ports must be verified against Engine-generated golden fixtures.
- Shared repository assets are consumed in place, never vendored.
- No new runtime dependency may be introduced without a concrete architectural reason. A deterministic
  archive writer is expected to be implementable within the application; a dependency is justified
  only if the specification's determinism requirements cannot be met reliably without one.

---

## Out of Scope

- **Face tracking, face landmarks, and face effects** (future-work section A) — entirely untouched.
- **Uploading, syncing, or transmitting captured data** in any form.
- **Public or crowdsourced contribution**, contributor discovery, or any multi-user workflow.
- **Accounts, authentication, authorization, OAuth, identity, and any backend service or database.**
- **Any in-browser token, invite code, or passphrase** presented as access control.
- **Deployment-level access restriction** — a hosting concern, deliberately outside this feature.
- **Recognition changes of any kind**: thresholds, weights, softmax, hold semantics, matching, and the
  effect runtime are untouched.
- **A second pose-sample schema, a Web-specific landmark format, or a second normalization.**
- **Sequence capture.** Only pose samples are in scope; sequences remain Engine/Capture territory.
- **Dataset management**: browsing the shipped dataset, editing existing samples, re-labelling,
  statistics, quality scoring, deduplication, or importing an archive back into the browser.
- **Regenerating the exemplar bundle in the browser** from captured samples, or any runtime effect of
  captured samples on recognition. Captured samples influence recognition only after they are exported,
  merged into the dataset, and the bundle is rebuilt by the existing build script.
- **Persisting camera imagery in any form**, including thumbnails or previews of a captured sample.
  Sample review renders landmark coordinates only.
- **Panel docking, timeline multi-select, and sprite/per-particle textures** — deferred Section C
  items, explicitly not in this milestone.

---

## Dependencies

- Constitution v1.8.0, Principle VI, Milestone 3 — the authorization this specification implements.
- The existing pose-sample JSON schema and Engine's serializer, which remain authoritative.
- The existing Web camera, detection, and normalization implementations, reused rather than
  reimplemented.
- The existing repository-level fixture-export tooling pattern, extended with one new script.
- The existing browser-storage boundary, extended with a separate capture store inside it.
