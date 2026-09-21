<!--
SYNC IMPACT REPORT
==================
Version change: 1.9.0 → 1.10.0
Rationale: A fourth Mudra Web milestone is authorized, in stages: Face Tracking and Face Effects.
Every earlier authorization excluded it (v1.6.0 and v1.7.0 grant no face capability; specs/009 Out
of Scope; future-work.md Section A), and a reconciliation audit on 2026-09-21 established the facts
the amendment rests on: `@mediapipe/tasks-vision` 0.10.35 is already installed and exports
`FaceLandmarker`; no face model, port, capability, anchor kind or command exists in the repository;
`probeCapabilities` is shaped for one capability; `AnchorResolver` sees hands only; region masks
are named `'person' | 'background'` and carry no geometry; the renderer is Canvas2D only; and the
privacy scan gained `readPixels`/`convertToBlob`. MINOR — one new authorized-milestone entry
(Principle VI) and one new Web-standards bullet; no principle is removed, weakened, or redefined.
Principle II is restated as binding, not amended.

Modified in this amendment (1.10.0):
  - Principle VI (Scope Discipline) — NEW entry, "Mudra Web — Milestone 4: Face Tracking and Face
    Effects (authorized in stages, added in v1.10.0)": (a) a `face_landmarks` capability, probed
    like `person_segmentation` and independently of it; (b) reuse of the existing MediaPipe Tasks
    Vision runtime, and a repository-level face model asset under the shared-asset rule with
    stated provenance, no runtime model download, and no placeholder dependency; (c) a
    framework-free domain face abstraction behind a replaceable port, MediaPipe types outside
    `src/domain/`; (d) face anchors and regions through the one centralized anchor system, existing
    actions reused rather than duplicated, and a generalized geometry/masking representation left
    to the specification; (e) an initial non-mesh effect family Canvas2D can honestly perform;
    (f) mesh deformation/warping explicitly NOT authorized, WebGL/WebGPU not committed to, a mesh
    renderer to be evaluated by its own amendment; (g) Principle II restated: no readback,
    screenshot, recording, image serialization, upload or face-image persistence, and face-derived
    numeric data is transient and never persisted; (h) a recognition boundary — landmark tracking
    and effects authorized; face recognition, identity matching, biometric identification and
    attribute/expression inference not; (i) Capture Mode, the pose-sample schema, docking/tabs and
    undo/redo untouched; (j) staging direction, smallest vertical slice first.
  - Technology & Code Quality Standards, "Web applications" subsection — NEW bullet stating the
    face backend/asset/domain-boundary rules as standing standards for `apps/web/`.
  - Principle VI rationale — one passage added for Milestone 4.

Principles I–VI: unchanged in intent. No earlier authorization is narrowed or widened, and the
v1.7.0 rule that Canvas2D is the default and required renderer (no WebGL/Three.js/Pixi.js/3D
stack) remains in force.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check reads "[Gates determined based on
    constitution file]"; it is principle-generic and evaluates the new entry with no edit.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.
  - ⚠ future-work.md Section A.9 — still says constitutional authorization is "blocked"; update
    it to "authorized in v1.10.0, in stages" (see follow-ups).

Deferred / follow-up TODOs:
  - future-work.md Section A.9: update the "blocked" line together with the Spec 011 work.
  - The Face Landmarker model choice, version, provenance record, source and integrity identifier
    — deliberately NOT selected here; the specification/plan picks them, and the asset is added
    only in the feature that uses it.
  - Whether an additional user-facing disclosure or opt-in beyond camera start is needed — this
    amendment requires the specification to decide and state it; it does not pre-decide it.
  - Mesh/deformation rendering (WebGL/WebGPU) — needs its own amendment with a demonstrated
    Canvas2D incapability; not authorized here.
  - Face recognition, identity or biometric matching, attribute/expression inference, face-driven
    triggers, and face data in any persisted schema — not authorized here.

--- previous report (1.9.0 supersedes the reports below it) ---
Version change: 1.8.0 → 1.9.0
Rationale: A third round of Mudra Web editor work is authorized, all scoped to the existing
effect editor and none of it a new top-level milestone: panel docking and tabs over the editor's
existing named-region panel registry, a lockable/contextual Inspector, collapsible panels and
sections, and an explicit editor-preview isolation rule correcting a runtime-matching gap found
while using the shipped editor (an unrelated saved effect could be accidentally triggered by live
pose detection while a different effect was being edited/tested). MINOR — one authorization entry
refining and extending Milestone 2's already-granted editor UI, plus one clarifying addition to
the Web applications standards subsection; no principle is removed, weakened, or redefined
incompatibly.

Modified in this amendment (1.9.0):
  - Principle VI (Scope Discipline) — extends the Mudra Web Milestone 2 authorization (v1.7.0)
    with: (a) panel docking — a small, fixed set of predefined layouts, each defining its own
    docking zones; zones persist and occupy their defined space whether or not a panel is
    currently docked into them (an empty zone MUST NOT collapse, and no neighboring zone MUST
    expand to fill it); a panel is relocated between a layout's valid zones by drag-and-drop, with
    a keyboard-operable equivalent required alongside it; (b) tabs — a zone MAY hold more than one
    panel, presented as switchable tabs, one visible at a time; (c) a lockable Inspector — the
    Inspector continues to follow the editor's one existing selection model by default, and MAY be
    explicitly locked to hold its current content across further selection changes until
    unlocked; (d) collapsible panels and sections — a whole panel and, independently, a panel's
    own internal sections MAY be collapsed and expanded, session-scoped, without removing the
    panel from its zone or the View menu; and (e) editor-preview isolation — while an effect is
    selected for editing, only that effect's own playback (explicit Play/Play Selected/Test
    Trigger, or the author genuinely performing its own pose live) may start in the editor's
    preview session; a live-detected pose matching a different, unselected effect's trigger MUST
    NOT start that effect's playback, though the effect's own saved definition is untouched and
    becomes eligible again the moment it is itself selected. Two rules are binding as part of this
    authorization, the same way Milestone 1/2's architectural rules were: **panel docking is
    predefined zones only** — an arbitrary, freely-splittable docking surface (nested rows/
    columns, user-defined splits, floating/undocked windows) is explicitly NOT authorized by this
    amendment and would need its own; and **editor-preview isolation is scoped to the editor's own
    runtime instance only** — it MUST NOT change how effects are triggered, matched, or played on
    the public-facing default experience, whose existing "every matching effect plays, nothing
    picks a winner" behavior is unaffected.
  - Technology & Code Quality Standards, "Web applications" subsection — NEW bullet naming panel
    docking/tabs/Inspector-lock/collapse state as editor-only presentation-layer state (never
    domain state, never part of a saved project document), extending the existing "editor-only
    state is application/presentation state" rule to name these specifically.

Principles I–VI: unchanged in intent. Principle VI's Milestone 2 entry is extended, not replaced;
no principle text is weakened.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check is principle-generic; the extended
    authorization is evaluated by the existing gate with no edit.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.

Deferred / follow-up TODOs:
  - Arbitrary/freely-splittable docking (nested splits, user-defined ratios, floating panels) —
    explicitly not authorized here; would require its own amendment if a later need is
    demonstrated.
  - Timeline multi-select and per-particle/sprite textures — both named in
    specs/008-effect-editor/future-work.md Section C alongside docking/tabs — remain unauthorized;
    this amendment grants none of them, by the requesting specification's own explicit choice.
  - The specs/010-editor-workspace-refinements feature specification itself is the separate SDD
    artifact this amendment authorizes work on; it does not substitute for it.

--- previous report (1.8.0 → 1.9.0 supersedes the report below it; both are new in this pass) ---
Version change: 1.7.0 → 1.8.0
Rationale: Reconstructed 2026-09-17. This amendment existed and was implemented — specs/009's own
artifacts cite "constitution v1.8.0" as their authorization throughout, and
specs/008-effect-editor/tasks.md records a README follow-up "recorded in the constitution's v1.8.0
sync report" — but the amendment itself was never durably committed before a disk failure lost it;
the recovery that followed restored the *implementation* (specs/009's code, now shipped) without
restoring the constitution entry that had licensed it. This text is rebuilt from that surviving
evidence — specs/009's spec.md, plan.md, tasks.md, research.md and contracts/, and
specs/008-effect-editor/future-work.md Section C (undo/redo) and Section B (the five things a
capture-mode amendment "would need to state, at minimum," which specs/009's own checklist confirms
this authorization covered) — not reauthored from present intent. Where the original wording could
not be recovered with confidence, this text says so rather than inventing detail. MINOR — a new
authorized-milestone entry and one clarifying addition to the Web applications standards
subsection; no principle is removed, weakened, or redefined incompatibly.

Modified in this amendment (1.8.0):
  - Principle VI (Scope Discipline) — adds the Mudra Web Milestone 3 authorization: **Gated Web
    Capture Mode** — a build-time-gated third entry point (enabled only by an explicit build flag,
    never a runtime conditional, so an unflagged build contains none of this code) collecting
    additional hand-landmark pose samples directly from the browser and exporting them in the
    exact same versioned pose-sample JSON schema Engine and Mudra Capture already write — a
    web-specific schema variant is not authorized. Persistence is bounded to exactly four data
    categories: (1) raw camera imagery, video, canvas pixels, screenshots, and thumbnails — NEVER
    persisted; (2) transient detector/segmentation result objects and camera-surface handles —
    NEVER persisted; (3) per-hand landmark coordinates (canonical-raw and normalized), handedness,
    and confidence — persistable, inside the one permitted storage location only; and (4) minimal
    session metadata (pose identity, a self-chosen contributor label, session/sample identifiers,
    timestamps, frame dimensions, countdown context, application/detector versions) — persistable,
    at the minimum needed for dataset provenance. The mode requires its own, separate,
    unmistakable consent distinct from the ordinary camera-start gesture, with a visible
    indication while active; export is local-only, by explicit user action; every stored sample is
    enumerable and deletable by the person who recorded it; and its "record"/"capture" controls
    are a narrowly-written exception to the standing prohibition on recording/capture/download/
    share language elsewhere in the application, not a loosening of it. **Build-time gating is
    feature gating, not deployment security**: no in-browser token, invite code, passphrase,
    account, or identity system may be used or presented as access control — restricting who can
    reach a deployed capture build is a hosting-layer concern outside this authorization. Also
    authorized in this same amendment, as the one item `future-work.md` Section C named as ready
    and explicitly granted alongside Capture Mode: **editor undo/redo** — a bounded snapshot stack
    over the editor's existing pure `Project → Project` edit functions, editor-state only, never
    persisted, adding no field to a saved project document.
  - Technology & Code Quality Standards, "Web applications" subsection — NEW bullet naming Capture
    Mode's own entry point (emitted only when its build flag is set), its own controller (runs no
    recognition — Capture Mode cannot become a second recognition system), its own repository and
    storage location (inside the one directory already permitted to touch persistence, as a
    separate database from the editor's own), and its own schema serializer (verified against
    Engine-generated golden fixtures, the same cross-language port discipline v1.6.0 established),
    reusing the existing normalization implementation rather than re-deriving it.
  - Principle II is restated as binding without exception on Capture Mode specifically, because it
    is the first Mudra Web surface whose entire purpose is persisting camera-derived data: only
    landmark coordinates and the named session metadata may be written; camera frames, video,
    canvas pixels, detector result objects, the mirrored camera surface, and segmentation data
    MUST NOT be persistable, and MUST NOT be representable in the persisted type at all.

Principles I–VI: unchanged in intent. Principle VI gains one authorization entry; no principle
text is weakened. Principle II is cited, not modified.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check is principle-generic; the new
    authorization is evaluated by the existing gate with no edit.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.
  - ⚠ README.md — pending at the time this amendment was originally in force: the Monorepo table
    and Folder Structure section needed to list Mudra Web's capture entry point. Resolved
    2026-09-17, in the same session that reconstructed this record — the Monorepo table now names
    `index.html`/`editor.html`/`capture.html` as Mudra Web's three entry points.

Deferred / follow-up TODOs:
  - Uploading, syncing, public/crowdsourced contribution, accounts, authentication, and any
    backend or database — none authorized by this amendment.
  - Reconstruction note: the precise original prose of this amendment (exact wording, any detail
    beyond what specs/009 and future-work.md Section B/C evidence directly support) could not be
    recovered — no pre-failure git history for this file survives (verified: `git log --all` for
    this path shows nothing between the Phase-1-era commits and the post-recovery commit). What is
    recorded above is reconstructed from what specs/009's own artifacts already depend on and cite
    as true of v1.8.0, not reauthored from scratch.

--- previous report (1.6.0 → 1.7.0) -------------------------------------------
Version change: 1.6.0 → 1.7.0
Rationale: Mudra Web's second milestone is authorized: a visual effect editor and Person
Segmentation as a capability-gated addition, both explicitly excluded by v1.6.0. This amendment
lifts exactly those two exclusions, bounded to the scope a new specification will detail, and
nothing else. MINOR — a new authorized-milestone entry within Principle VI and one clarifying
addition to the Web applications standards subsection; no principle is removed, weakened, or
redefined incompatibly. The two architectural rules v1.6.0 made binding on the effect runtime —
effects are data, and the runtime never draws — are restated as binding on the editor too: it
authors data through the existing pipeline and never executes or draws effect output itself.

Modified in this amendment (1.7.0):
  - Principle VI (Scope Discipline) — adds the Mudra Web Milestone 2 authorization: a visual
    effect editor (live camera/canvas stage, action palette, pose/trigger panel, a
    schema-driven inspector reading each action's registered parameter metadata, and a
    timeline over the existing absolute `at_ms` offsets — tracks, clips, select/move/resize/
    delete/duplicate, no keyframes or curves) that authors `EffectDefinition`/`Timeline` data
    through the unchanged `EffectRuntime → RenderCommand[] → Renderer` pipeline; a pose/trigger
    panel that must not alter recognition thresholds, matching weights, softmax, or hold/
    stability semantics; preview and test-trigger modes that inject a synthetic `PoseEvent`
    into the same runtime and renderer a real pose confirmation uses; **local-only** project
    persistence (create, save, load, duplicate, import, export); a small local asset library
    compatible with the existing `AssetReference` indirection; and **Person Segmentation**,
    authorized for the first time, as one more capability-registry entry using the existing
    MediaPipe Tasks Vision family, gating segmentation-dependent actions (person visibility,
    person-only tint, background replacement, background effects, foreground/background
    compositing, person isolation) to the same inert-and-reported rule Milestone 1 already
    established — never simulated by compositing over an undifferentiated full-frame camera
    image. Publishing, accounts, cloud persistence, a marketplace, social or collaborative
    features, gameplay mechanics, arbitrary user scripting, backend services, and any
    WebGL/3D rendering stack remain explicitly NOT authorized; Canvas2D remains the default
    and required renderer.
  - Technology & Code Quality Standards, "Web applications" subsection — NEW bullet naming the
    editor as a presentation-layer authoring surface with no parallel effect-execution path,
    and Person Segmentation as accessed behind the same replaceable detection-interface
    discipline already required for hand-landmark detection.
  - Principle II is restated as binding without exception on the new persistence surface: a
    saved project MUST NOT contain a camera frame, image, video, or any derivative of captured
    imagery — only effect data.

Principles I–VI: unchanged in intent. Principle VI gains one authorization entry; no principle
text is weakened. Principle II is cited, not modified.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check is principle-generic; the new
    authorization is evaluated by the existing gate with no edit.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.

Deferred / follow-up TODOs:
  - Publishing, accounts, cloud persistence, a marketplace, social/collaborative features,
    gameplay mechanics, arbitrary scripting, and backend services each require their own
    explicit authorization amendment; none is granted here.
  - The Mudra Web Milestone 2 feature specification itself is a separate SDD artifact under
    specs/, produced by the normal /speckit-specify → /speckit-plan → /speckit-tasks flow.
    This amendment authorizes that work to begin; it does not substitute for it.

--- previous report (1.5.0 → 1.6.0) -------------------------------------------
Version change: 1.5.0 → 1.6.0
Rationale: Mudra Web — a browser-based, camera-driven interactive experience at apps/web/ — is
authorized for its first milestone (a vertical slice proving camera → pose recognition → pose event
→ effect execution → visible change on screen). Authorizing it requires three supporting rules the
constitution did not previously state: standards for a TypeScript/browser application, an explicit
position on sharing repository-level binary assets such as the MediaPipe model, and a verification
obligation for algorithms that must be re-implemented in a language Engine cannot serve. MINOR — a
new authorized-milestone entry, a new per-application standards subsection, and two new boundary
rules; no principle is removed, weakened, or redefined incompatibly, and the versioned pose-sample
JSON schema remains the only contract between independent applications.

Modified in this amendment (1.6.0):
  - Principle VI (Scope Discipline) — adds the Mudra Web Milestone 1 authorization: browser camera
    capture, in-browser hand landmark detection, deterministic pose recognition over the existing
    dataset, a data-driven effect runtime, and real-time compositing over the camera view. Two
    architectural rules are made part of the authorization because they are what keep the milestone
    extensible: effects MUST be data rather than per-effect code paths, and the effect runtime MUST
    NOT draw (it emits declarative render output for a separate, replaceable renderer). A visual
    effect editor, person segmentation, WebGL/3D, gameplay, ML/training, and any backend, accounts,
    cloud, or social/user-generated-content capability are explicitly NOT authorized. Principle II
    is restated as binding without exception: Mudra Web persists no imagery and builds no dataset.
  - Technology & Code Quality Standards — NEW subsection: "Web applications (TypeScript,
    apps/web/)", mirroring the existing Engine and Capture subsections. Names TypeScript and
    browser platform APIs, names MediaPipe Tasks Vision as the detection backend behind a
    replaceable interface (the same rule and reason as Engine's backend), mandates clean
    architecture layers, typed immutable models, data-driven configuration, domain-layer tests,
    clean static analysis, and permits Mudra-owned experience assets. Build tooling is deliberately
    NOT named — that is a plan-level choice, not a constitutional one.
  - Monorepo & Cross-Application Boundaries — the layout list now includes apps/web/ (TypeScript);
    NEW rule "Shared binary assets are shared, not vendored" (repository-level assets such as
    assets/hand_landmarker.task MAY be consumed directly by any application in any language, and
    MUST NOT be copied into an application tree); NEW rule "Cross-language ports MUST be verified
    against golden fixtures" (codifies the pattern apps/capture/ already established via
    scripts/export_capture_fixtures.py, and makes it binding).

Principles I–VI: unchanged in intent. Principle VI gains one authorization entry; no principle text
is weakened. Principle II is cited, not modified.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check is principle-generic and its
    Language/Version field is already language-agnostic; the new authorization and the two new
    boundary rules are evaluated by the existing gate with no edit.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.
  - ⚠ README.md — pending: the Monorepo table and Folder Structure section must list apps/web/.
    Tracked as work of the forthcoming Mudra Web feature, not as constitution follow-up — the same
    disposition v1.5.0 gave the identical README gap for Studio.

Deferred / follow-up TODOs:
  - Mudra Web's later capabilities (visual effect editor, person segmentation, WebGL/3D rendering,
    gameplay, and any user-generated or social functionality) each require their own explicit
    authorization amendment; none is granted here.
  - The Mudra Web feature specification itself is a separate SDD artifact under specs/, produced by
    the normal /speckit-specify → /speckit-plan → /speckit-tasks flow. This amendment authorizes
    that work to begin; it does not substitute for it.

--- previous report (1.4.0 → 1.5.0) -------------------------------------------
Version change: 1.4.0 → 1.5.0
Rationale: Mudra Studio — the desktop IDE at apps/studio/ — is authorized for its first
milestone (read-only dataset exploration and visual inspection), and Mudra Engine is
reclassified as the repository's shared platform library so same-language applications may
consume its public interfaces. MINOR — a new authorized-milestone entry and materially
expanded Monorepo guidance; no principle is removed, weakened, or redefined incompatibly, and
the versioned pose-sample JSON schema remains the only contract between independent
applications.

Modified in this amendment (1.5.0):
  - Principle VI (Scope Discipline) — adds the Mudra Studio Milestone 1 authorization:
    pose/sample browsing, landmark visualization (raw and normalized), multi-sample overlay,
    per-pose statistics, and a navigation shell with placeholders. Model training, dataset
    export, sample editing, camera capture, and pose recognition are explicitly NOT
    authorized and remain deferred to later, separately-authorized milestones. The milestone
    is read-only with respect to the dataset.
  - Monorepo & Cross-Application Boundaries — reclassifies apps/engine/ as the repository's
    shared platform library. Same-language applications under apps/ MAY import Engine's
    documented public interfaces, one way only; Engine MUST NOT import from any application;
    consuming applications MUST NOT modify, extend, or vendor Engine source, and MUST record
    their consumed Engine surface in a contract document. Application-to-application source
    imports remain forbidden, and the versioned JSON schema remains the only contract between
    independent applications.

Principles I–V: unchanged, not weakened.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check is principle-generic; the new
    authorization and the Engine-library rule are evaluated by the existing gate.
  - ✅ .specify/templates/spec-template.md — no mandatory section added or removed.
  - ✅ .specify/templates/tasks-template.md — no new principle-driven task category.
  - ⚠ README.md — pending: the monorepo layout section should list apps/studio/ and describe
    Engine as the shared platform library. Tracked as tasks T058/T059 of feature
    006-studio-dataset-explorer, not as constitution follow-up.

Deferred / follow-up TODOs:
  - Mudra Studio's later capabilities (training, export, editing, capture, recognition) each
    require their own explicit authorization amendment; none is granted here.

--- previous report (1.3.0 → 1.4.0) -------------------------------------------
Version change: 1.3.0 → 1.4.0
Rationale: Phase 2.75 — Live Recognition Preview is authorized as a narrow, explicitly-bounded
exception to Principle VI: deterministic (non-ML) pose recognition and demo-quality visual
effects in apps/capture, to validate the collected dataset and produce a demo before Mudra
Studio. MINOR — a new authorized-milestone entry is added; no principle is redefined or
weakened, and Capture's existing no-recognition mandate (specification 003, FR-040/FR-041) is
unchanged for its dataset-collection purpose.

Modified in this amendment (1.4.0):
  - Principle VI (Scope Discipline) — adds the Phase 2.75 authorized exception: deterministic
    matching only (nearest-neighbor / distance- or similarity-based), demo-quality visual
    effects only; explicitly excludes ML training, neural networks, cloud, backend, and
    gameplay/"attacks" mechanics, which remain deferred to a later milestone.
  - Principle III (Recognition-Ready) — cross-references Phase 2.75 as the first realization
    of the anticipated similarity-matching strategy, still behind the same stable interface.

Templates requiring updates:
  - ✅ .specify/templates/* — no path or mandatory-section assumptions affected.

Deferred / follow-up TODOs:
  - Phase 2.75 itself is specified independently (a new numbered spec under specs/), not
    embedded in this file; this amendment only records the authorization and its bounds.

--- previous report (1.2.0 → 1.3.0) -------------------------------------------
Version change: 1.2.0 → 1.3.0
Rationale: the monorepo layout is now symmetrical. The Python engine moved from the
repository root (`app/`) to `apps/engine/`, alongside `apps/capture/`, and its
package is imported as `engine`. MINOR — a declared layout is redefined and the CLI
entry point changes; no principle is added, removed, or weakened.

Modified in this amendment (1.3.0):
  - Technology & Code Quality Standards, Engine section — project layout is now
    `apps/engine/` (was `app/`); `python -m engine.main` replaces `python -m app.main`.
  - Monorepo & Cross-Application Boundaries — every application, engine included,
    lives under `apps/`; shared repository-level concerns (tests, datasets, assets,
    scripts, specs, pyproject) stay at the root.

Templates requiring updates:
  - ✅ .specify/templates/* — no path assumptions; no edit required.

Deferred / follow-up TODOs:
  - specs/001-live-camera-detection and specs/002-pose-recorder retain `app/` paths as
    point-in-time records of what was built then; they are deliberately NOT rewritten.

--- previous report (1.1.0 → 1.2.0) -------------------------------------------
Version change: 1.1.0 → 1.2.0
Rationale: Mudra becomes a multi-application monorepo. The Python engine is no
longer the only application: `apps/capture` (Flutter/Android) collects pose
datasets on mobile. MINOR — a new mandatory section plus materially expanded
technology guidance; all six principles are retained unchanged in intent, with
Principle II clarified to bind every application in the repository.

Modified in this amendment (1.2.0):
  - Principle II — explicitly binds every application in the monorepo, including
    mobile capture; reference images are UI guidance assets, never dataset content.
  - Technology & Code Quality Standards — split into engine (Python) and capture
    (Dart/Flutter) standards; layout rules scoped per application.
  - NEW section: Monorepo & Cross-Application Boundaries — the versioned pose-sample
    JSON schema is the ONLY contract between applications; no shared code coupling.

Baseline principle mapping (unchanged since 1.0.0):
  - I. Architecture-First & Modular Boundaries
  - II. Coordinates, Never Images
  - III. Extensibility by Design (Recognition-Ready)
  - IV. Typed, Modeled, and Clean Code
  - V. Centralized Configuration & Structured Observability
  - VI. Scope Discipline (Milestone-Bounded YAGNI)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — no edit required (Language/Testing/Project
    Type are already language-agnostic placeholders; gate derived at plan time).
  - ✅ .specify/templates/spec-template.md — no mandatory-section conflict.
  - ✅ .specify/templates/tasks-template.md — no conflict.
  - ✅ .specify/templates/checklist-template.md — no conflict.

Deferred / follow-up TODOs:
  - ⚠ README.md — add the monorepo layout (engine at root, apps/capture) when the
    capture application lands; tracked as project work, not a constitution placeholder.
-->

# Mudra Constitution

Mudra is an AI-powered hand gesture recognition engine built with computer vision. Its
long-term purpose is to recognize sequences of hand signs, trigger events and effects, and
serve as a reusable engine for games, interactive experiences, AR filters, and social
content. This constitution governs how the project is built so that the foundation laid
today can support that future without rewrites.

## Core Principles

### I. Architecture-First & Modular Boundaries

The project's first and highest priority is a clean, extensible architecture — not features.
Every capability MUST live behind a clear module boundary with a single responsibility, and
any module (camera, detection, normalization, recording, dataset, recognition,
visualization, ui) MUST be replaceable independently without editing unrelated modules.
Modules communicate through explicit interfaces (Protocols / abstract base classes), not by
reaching into each other's internals. Dependencies flow toward abstractions: high-level
policy MUST NOT depend on low-level detail. Files stay small and single-purpose; monolithic
modules are prohibited. Global mutable state is prohibited; dependencies are passed
explicitly (dependency injection) rather than imported as singletons.

**Rationale**: The stated first milestone is the architecture itself. Loose coupling is the
only thing that lets MediaPipe, the storage format, or the future recognition engine be
swapped without cascading rewrites.

### II. Coordinates, Never Images

Mudra records hand landmarks, never pixels. The system MUST NOT save images, video frames,
or screenshots, and MUST NOT build any dataset from captured imagery. Persisted data
contains only normalized landmark coordinates (x, y, z per landmark, plus visibility when
MediaPipe provides it) together with metadata. All persisted artifacts (poses and sequences)
MUST be human-readable JSON — no binary or opaque formats. Every hand carries exactly 21
landmarks; handedness, confidence, and hand count are metadata, not pixel data.

This principle binds **every application in the monorepo**, desktop and mobile alike. A
capture application MAY display reference imagery to guide the user, but such images are UI
guidance assets shipped with the app; they MUST NOT be written into, referenced by, or
derived into any dataset artifact. Camera frames MUST leave memory as landmarks only.

**Rationale**: Coordinate-only storage keeps datasets small, privacy-preserving, diffable,
portable across models, and independent of camera resolution or lighting — the properties a
reusable gesture library depends on. A mobile app collecting data in the wild is exactly
where the temptation to "just save the frame" appears, so the rule is stated there explicitly.

### III. Extensibility by Design (Recognition-Ready)

The architecture MUST make future capabilities possible without implementing them now.
Recognition interfaces MUST be designed so that similarity matching, Dynamic Time Warping,
Hidden Markov Models, and neural approaches (LSTM, GRU, Transformer) can each be added as a
pluggable strategy behind a stable interface. Poses MUST be first-class reusable components
identified by a stable `pose_id`; `display_name`, `aliases`, and `description` are mutable
labels layered on that identity. Datasets, recognition, and future gameplay MUST reference
`pose_id`, never a human-readable name, so poses can be renamed, localized, and evolved
without breaking compatibility. Sequences MUST be able to reference pose identities rather
than only raw per-frame recordings. Datasets MUST be append-only: recording a new sample
never overwrites or mutates existing samples, so the library strengthens over time across
people, hand sizes, distances, rotations, and lighting.

**Rationale**: Every architectural decision optimizes for growth into a full recognition
engine. A stable `pose_id` decouples identity from presentation, making renaming/localization
and dataset evolution safe; append-only guarantees data is never lost as the corpus grows.
Phase 2.75 (Principle VI) is the first realization of this: a deterministic similarity-matching
strategy, still expressed as one pluggable strategy behind the same stable interface.

### IV. Typed, Modeled, and Clean Code

Type hints are mandatory on all functions, methods, and public attributes. Structured data
MUST be represented with Pydantic models (for validation/serialization boundaries such as
persisted JSON and configuration) or dataclasses (for internal value objects) rather than
raw dicts or tuples. Code MUST follow SOLID principles with small classes and small
functions, meaningful names, and docstrings on public modules, classes, and functions. Magic
numbers and duplicated logic are prohibited; named constants and shared helpers replace them.
Automated tests using pytest MUST accompany data models, normalization, and I/O
(serialization round-trips, append-only guarantees) — the logic whose correctness the whole
pipeline depends on.

**Rationale**: This is production-quality software, not a prototype. Types plus validated
models turn the JSON contract into something the compiler and tests enforce, catching
schema drift before it corrupts a growing dataset.

### V. Centralized Configuration & Structured Observability

All tunable values — camera settings, detection thresholds, recording settings, dataset
locations, logging levels, and reserved slots for future model settings — MUST be defined in
centralized configuration, not hardcoded at call sites. Configuration MUST be typed and
validated (Pydantic). Logging MUST use Loguru with structured output and appropriate levels,
including explicit startup and shutdown log lines. Long-running loops (live camera) MUST NOT
log per-frame at INFO or above; per-frame diagnostics belong at DEBUG/TRACE.

**Rationale**: Centralized, validated config makes the engine reconfigurable without code
changes, and structured logs make a real-time vision pipeline debuggable in the field.

### VI. Scope Discipline (Milestone-Bounded YAGNI)

The current objective is a robust data-collection foundation, delivered in order: (1) live
camera + detection, (2) pose recorder, (3) sequence recorder, (4) dataset builder. The
following MUST NOT be implemented until the foundation is complete and a later milestone
explicitly authorizes them: recognition algorithms, machine learning / model training,
gameplay, visual effects, and "attacks"/abilities — **except where explicitly authorized
below**. Interfaces and extension points for these MAY (and per Principle III SHOULD) exist;
their behavior MUST NOT, outside an explicit authorization. When a proposed change adds
feature surface beyond the current milestone or an existing authorization, it is rejected or
deferred by default.

**Phase 2.75 — Live Recognition Preview (authorized exception, added in v1.4.0)**: with
pose-dataset collection (mobile Capture, specification 003) feature-complete, a narrow
exception is authorized ahead of the milestone order above: a live, on-device recognition
preview in `apps/capture`, for two purposes only — validating that the collected dataset
supports stable recognition, and producing a demo. This exception permits **deterministic
pose recognition** (distance- or similarity-based matching over the existing normalized
landmark dataset — e.g. nearest-neighbor, weighted Euclidean distance, cosine similarity;
Principle III's anticipated similarity-matching strategy, realized) and **demo-quality visual
effects** triggered by a confirmed pose. It explicitly does **not** authorize machine
learning, model training, neural networks, cloud services, a backend, or gameplay/"attacks"
mechanics — those remain deferred to a later milestone (Mudra Studio) that must explicitly
authorize them in turn. This exception does not change Capture's core mandate: FR-040/FR-041
of specification 003 stand unchanged for its dataset-collection flow; the recognition preview
is a separate, additive capability, specified independently.

**Mudra Studio — Milestone 1: Dataset Exploration (authorized, added in v1.5.0)**: the Mudra
Studio milestone anticipated above is now explicitly authorized, for its **first milestone
only**. Mudra Studio is a desktop application at `apps/studio/` whose first milestone is
**read-only dataset exploration and visual inspection** — "VS Code for Mudra datasets". This
authorization permits exactly: pose and sample browsing; landmark visualization in both raw
and normalized coordinate spaces; multi-sample overlay comparison; per-pose statistics
summaries; and a navigation shell whose non-Dataset entries are inert placeholders. It is
**read-only with respect to the dataset**: Studio MUST NOT create, modify, rename, or delete
any dataset or sample file, and the dataset on disk MUST be byte-for-byte identical before and
after a session.

This authorization explicitly does **not** cover **model training, dataset export, sample
editing, camera capture, or pose recognition**. Those remain deferred and each requires its
own explicit authorization amendment before any behavior for it is implemented. Per Principle
III, extension points for them MAY exist as type signatures and interfaces; their behavior
MUST NOT. Machine learning, neural networks, cloud services, a backend, and gameplay/"attacks"
mechanics likewise remain unauthorized — the Studio milestone authorized here grants none of
them.

**Mudra Web — Milestone 1: Pose-Driven Effect Runtime (authorized, added in v1.6.0)**: a new
application at `apps/web/` is authorized, for its **first milestone only**. Mudra Web is a
browser-based, camera-driven interactive experience in which a recognized hand pose triggers a
visible transformation of the scene. Its first milestone is a **vertical slice** proving exactly one
interaction end to end: camera → pose recognition → pose event → effect execution → visible change
on screen.

This authorization permits exactly: browser camera capture; hand landmark detection in the browser;
pose recognition over the existing normalized-landmark dataset by the same class of **deterministic**
strategy Phase 2.75 authorized (distance- or similarity-based matching, no training); a **data-driven
effect runtime**; and real-time compositing of effect output over the camera view. A small number of
simple effects is the point of the slice; a large catalogue is not.

Two architectural rules are part of the authorization rather than left to implementation, because
they are the seams that let this milestone grow without a rewrite and are therefore Principle I
obligations at the application's core:

- **Effects MUST be data, not code paths.** Authoring or changing an effect MUST be a configuration
  change. A conditional branch per named effect inside the runtime is prohibited.
- **The effect runtime MUST NOT draw.** It produces declarative render output that a separate
  renderer consumes, so the renderer stays replaceable per Principle I and the runtime stays
  testable with no browser attached.

It explicitly does **not** authorize: a visual effect editor; person segmentation; WebGL or any 3D
rendering stack; gameplay or "attacks" mechanics; machine learning, model training, or neural
networks; or any backend, accounts, cloud storage, marketplace, or social / user-generated-content
capability. Each requires its own explicit authorization amendment and its own specification before
any behavior for it is implemented. Per Principle III, extension points for them MAY exist as
interfaces and type signatures; their behavior MUST NOT.

**Principle II binds Mudra Web without exception.** It is a camera application, which is precisely
where the temptation to persist a frame appears: it MUST NOT save images, video frames, screenshots,
or recordings of the experience, and MUST NOT build any dataset from captured imagery. It reads the
pose dataset and writes none.

**Mudra Web — Milestone 2: Visual Effect Editor & Capability-Gated Person Segmentation (authorized,
added in v1.7.0)**: with the vertical slice proven, a second milestone is authorized for `apps/web/`:
a **visual effect editor** that authors the data Milestone 1 already defined, plus **Person
Segmentation** as a capability-gated addition. Both were explicitly excluded in v1.6.0; this
amendment lifts exactly the following, and nothing else.

This authorization permits exactly: a browser-based editor UI — a live camera/canvas stage, an
action palette, a pose/trigger selection panel, an inspector, and a timeline — that authors
`EffectDefinition` and `Timeline` data through the pipeline Milestone 1 already established
(`Editor → EffectDefinition/timeline data → EffectRuntime → RenderCommand[] → Renderer`); an
inspector driven by each registered action's parameter schema (`ActionDescriptor.params`) rather
than a hand-written UI per action type; a timeline editor over the existing absolute `at_ms` offsets
(tracks, clips, select/move/resize/delete/duplicate — no keyframes, curves, expressions, or nested
compositions); a pose/trigger panel that associates an active pose with a trigger without altering
recognition thresholds, matching weights, the softmax formulation, or hold/stability semantics; a
preview mode and a test-trigger mode that inject a synthetic `PoseEvent` into the same
`EffectRuntime` and `Renderer` used by a real pose confirmation — never a second, preview-only
effect implementation; **local-only** project persistence (create, save, load, duplicate, import,
export) of effect projects; a small local asset library compatible with the existing
`AssetReference`/logical-identifier indirection, scoped to the project's own assets; and **Person
Segmentation**, using the existing MediaPipe Tasks Vision family, as one more entry in the
capability registry Milestone 1 already defined (alongside `person_visibility`'s reservation) —
gating segmentation-dependent actions (person visibility, person-only colour/tint, background
replacement, background effects behind the person, foreground/background compositing, person
isolation) exactly as Milestone 1's capability-gating rule requires: inert and explicitly reported
when unavailable, never silently degraded, and never simulated by compositing over an
undifferentiated full-frame camera image.

Two rules from Milestone 1 are restated as binding on the editor specifically, because an editor is
exactly where the temptation to shortcut them appears: **the editor MUST NOT execute effect logic**
— it produces and edits data, and `EffectRuntime` remains the only component that schedules actions;
and **the editor MUST NOT draw** effect output itself — the `Renderer` remains the only component
that draws, including in preview. A camera-feed visual treatment (brightness, contrast, saturation,
mirror, zoom, crop) introduced by the editor MUST be a render-time transformation, distinguished
from true camera input configuration (device/track constraints), and MUST NOT be implemented as a
third drawing path outside the existing Renderer.

It explicitly does **not** authorize: publishing; user accounts; cloud persistence or storage; a
marketplace; social or user-generated-content features; collaborative/multi-user editing; gameplay,
combat, or scoring mechanics; arbitrary scripting by users; any backend service; or WebGL, Three.js,
Pixi.js, or any 3D rendering stack — Canvas2D remains the default and required renderer unless a
later amendment, backed by a concrete demonstrated incapability, says otherwise. Each of these, like
Milestone 1's exclusions before it, requires its own explicit authorization amendment and its own
specification before any behavior for it is implemented.

**Principle II binds Milestone 2 without exception, restated because persistence is new here**:
local project persistence MUST NOT write a camera frame, image, video, or any derivative of
captured imagery to a project file, to local storage, or to any exported artifact. A saved project
is effect data — timelines, action parameters, asset references, and pose/trigger selections — and
nothing else.

**Mudra Web — Milestone 3: Gated Web Capture Mode, and editor undo/redo (authorized, added in
v1.8.0)**: two further additions to `apps/web/` are authorized. First, **Gated Web Capture Mode**:
a build-time-gated third entry point, alongside the existing default experience and editor
entries, for collecting additional hand-landmark pose samples directly from the browser. Second,
**editor undo/redo**, the one Section C item `specs/008-effect-editor/future-work.md` predicted
was ready to build: every authoring edit was already a pure `Project → Project` function, so an
undo stack is a list of snapshots and a pair of commands rather than a redesign.

This authorization permits exactly: a third build entry point present in the built output **only**
when an explicit build-time flag is set — never a runtime conditional, so an unflagged build
contains no trace of this code, checkable by inspecting the emitted output rather than by trusting
a flag; a capture controller that constructs no matcher, no effect runtime, and no pose-event
emitter — Capture Mode MUST NOT become a second recognition system; export of collected samples in
the exact same versioned pose-sample JSON schema Engine and Mudra Capture already write, by
explicit local user action only; and, for the editor, a bounded snapshot stack of prior project
states reachable through an Edit menu and standard undo/redo keyboard accelerators, discarding the
redo branch on a new edit and bounded to a configured depth.

Persistence under this authorization is bounded to exactly four data categories: (1) raw camera
imagery, video, canvas pixels, screenshots, and thumbnails — **never** persisted; (2) transient
detector/segmentation result objects and camera-surface handles — **never** persisted; (3) per-hand
landmark coordinates (canonical-raw and normalized), handedness, and confidence — persistable,
inside the one storage location Principle-II-compliant persistence already uses; and (4) minimal
session metadata (pose identity, a self-chosen contributor label — dataset provenance, never an
identity or account — session/sample identifiers, timestamps, frame dimensions, countdown context,
and application/detector versions) — persistable, at the minimum needed for that provenance.
Capture Mode requires its own, separate, unmistakable consent, distinct from the ordinary
camera-start gesture already used elsewhere, with a visible indication while active; every stored
sample MUST be enumerable and deletable by the person who recorded it; and its "record"/"capture"
controls are a narrowly-scoped exception to the standing prohibition on recording/capture/download/
share language and affordances elsewhere in the application — a loosening of that prohibition
anywhere else is not authorized.

**Build-time gating is feature gating, not deployment security**, stated here because the
distinction is load-bearing rather than assumed: no in-browser token, invite code, passphrase,
account, or identity system may be used, or presented to a user, as access control for a deployed
capture build. Restricting who can reach one is a hosting-layer concern — HTTP authentication, an
access list, a private URL, or simply not deploying it to the public origin — outside this
authorization. Editor undo/redo is, separately, **editor state only**: it MUST NOT be persisted,
and MUST add no field to a saved project document — the previous project value already *is* the
undo, so there is nothing to invert and nothing new to store.

It explicitly does **not** authorize: uploading, syncing, or transmitting captured data in any
form; public or crowdsourced contribution, contributor discovery, or any multi-user workflow;
accounts, authentication, authorization, or any backend service or database; a second pose-sample
schema or a web-specific landmark format; sequence capture (only pose samples are in scope);
dataset management (browsing, editing, re-labelling, or regenerating the shipped exemplar bundle
from captured samples) inside the browser; or persisting camera imagery in any form, including a
thumbnail or preview of a captured sample. Each requires its own explicit authorization amendment
before any behavior for it is implemented.

**Principle II binds Milestone 3 without exception, restated because Capture Mode is the first
Mudra Web surface whose entire purpose is persisting camera-derived data**: only categories 3 and 4
above may be written; categories 1 and 2 MUST NOT be persistable, and MUST NOT be representable in
the persisted type at all — not merely forbidden by convention, but absent from the type graph a
compiler can check.

**Mudra Web — Milestone 2 refinements: panel docking and tabs, a lockable Inspector, collapsible
panels, and editor-preview isolation (authorized, added in v1.9.0)**: four further additions to the
Milestone 2 editor (v1.7.0) are authorized, none of them a new top-level milestone — each extends a
surface Milestone 2 already granted (the editor UI, the inspector, preview/test-trigger mode)
rather than adding a new capability category.

This authorization permits exactly: **panel docking**, over the editor's existing named-region
panel registry, as a small, fixed set of predefined layouts, each explicitly defining its own set
of docking zones — not an arbitrary, freely-splittable docking surface. A zone always exists and
occupies its layout-defined space whether or not a panel is currently docked into it: an empty zone
MUST NOT collapse, and no neighboring zone MUST expand to fill it. A panel is relocated between a
layout's valid zones by drag-and-drop, with clear visual indication of valid drop targets during
the drag and invalid zones never presented as drop targets, and a keyboard-operable equivalent MUST
exist alongside the drag gesture — full simulated-drag keyboard equivalence (e.g. arrow-key-driven,
matching the WAI-ARIA drag-and-drop pattern step for step) is not required. **Tabs**: a zone MAY
hold more than one panel, presented as switchable tabs with exactly one visible at a time. A
**lockable Inspector**: the Inspector continues to reflect the editor's one existing selection
model by default — this authorization does not permit a second, parallel notion of "what is
selected" — and MAY be explicitly locked to hold its current content across further selection
changes elsewhere, until explicitly unlocked, with the locked/unlocked state visibly distinguishable
at a glance. **Collapsible panels and sections**: a whole panel, and independently each of a
panel's own internal sections, MAY be collapsed to a compact state and expanded again, with that
state kept for the editor session, without removing the panel from its zone or from the existing
View menu's list of panels.

**Editor-preview isolation**, correcting a gap rather than adding a capability: while an effect is
selected for editing in the editor, only that effect's own playback — started explicitly (Play,
Play Selected, Test Trigger) or by the author genuinely performing that effect's own pose live in
front of an attached camera — is eligible to start in the editor's preview session. A live-detected
pose matching a *different*, unselected effect's trigger MUST NOT start that effect's playback; the
excluded effect's own saved definition is untouched and becomes eligible again the moment it is
itself selected. **This isolation is scoped to the editor's own runtime instance only** — it MUST
NOT change how effects are triggered, matched, or played on the public-facing default experience,
whose existing rule (every matching effect plays; nothing picks a winner) is unaffected and remains
available to extend later (e.g. a future overlap/priority system) without this authorization having
foreclosed it.

It explicitly does **not** authorize: arbitrary, freely-splittable docking (nested rows/columns,
user-defined splits or ratios, floating/undocked panel windows) — predefined zones only, for now;
timeline multi-select; per-particle textures or sprite particles; or any change to recognition,
matching, thresholds, hold semantics, or the shipped action catalog. Each of the docking-complexity
items, like every exclusion before it in this principle, requires its own explicit authorization
amendment, backed by a demonstrated need, before any behavior for it is implemented.

**Editor-only state is restated, not newly introduced**: panel docking arrangement, tab-group
membership, Inspector-lock state, and panel/section collapse state are all application/presentation
state under the rule Milestone 2 already established ("editor-only state ... is application/
presentation state, never domain state") — none of them is a project-document field, and none
requires a Principle II restatement, since none of them touches imagery or camera data.

**Mudra Web — Milestone 4: Face Tracking and Face Effects (authorized in stages, added in
v1.10.0)**: a fourth milestone is authorized for `apps/web/`. Face tracking and face effects were
excluded by every earlier authorization; this amendment lifts exactly the following, and nothing
else. It authorizes a *direction and its boundaries*, not a single deliverable: each stage below
MAY be its own specification, and the first specification MUST define the **smallest viable
vertical slice** rather than the whole direction.

This authorization permits exactly:

1. **A `face_landmarks` runtime capability**, one more entry in the capability registry Milestone
   1 defined and Milestone 2 made runtime-probed. Availability MUST be determined by actually
   attempting to construct what the capability needs — never assumed, never hardcoded — and each
   capability MUST be probed independently, so the failure of one (a missing model, an
   unsupported browser) never marks another unavailable. An action that requires `face_landmarks`
   is inert and explicitly reported when it is unavailable, and MUST NOT be simulated (for
   example by drawing a fixed oval over a full-frame camera image), exactly as Milestone 2
   required for segmentation. Face tracking is a **capability that supplies geometry** —
   landmarks, anchors, region shapes, and blendshape values — to effects. It is not a recognition
   system, and it MUST NOT feed the pose matcher, the pose-event emitter, or effect triggering.
2. **Reuse of the existing MediaPipe Tasks Vision runtime** (`@mediapipe/tasks-vision`, already a
   dependency of `apps/web/`) for face landmarks, rather than a second ML runtime; a second
   runtime requires its own amendment and a demonstrated incapability of the first. A face model
   MAY be added as a **repository-level shared asset** under `assets/`, under the same rule as
   `hand_landmarker.task` and `selfie_segmenter.tflite`: referenced from `assets/`, never copied
   into `apps/web/`; absent-by-default, with the capability then reported unavailable rather than
   a build or startup failure; and served from the application's own origin. The feature that
   adds it MUST record its **provenance** — source, model name and version, and an integrity
   identifier — beside the existing assets, and MUST obtain it deterministically (a pinned source,
   by an explicit script). Models MUST NOT be downloaded at runtime from any other origin, and a
   user-supplied or arbitrary model is not authorized, without a separately authorized design. No
   dependency, model, or script MAY be added as a placeholder: each arrives in the change that
   first uses it. *The model itself is deliberately not selected by this amendment.*
3. **A framework-free domain abstraction for face landmarks**, analogous to the hand-landmark
   value objects and the `HandDetector` port: a replaceable detector interface plus an immutable,
   validated value object for one frame's face geometry, constructible in a plain test with no
   browser. The specification decides the exact names and shape (`FaceDetector`/`FaceFrame` are
   the anticipated ones) and whether a frame with no face is a value or an absence. MediaPipe
   symbols and types MUST remain outside `src/domain/`, and the layering test that enforces this
   MUST be extended to name the face symbols rather than rely only on the package name.
4. **Face anchors and face regions through the one centralized anchor system.** `AnchorResolver`
   remains the only place that turns an anchor into a point (FR-058–FR-060): an action MUST NOT
   contain its own landmark or region lookup, for faces any more than for hands. Anchor kinds MAY
   be extended to facial landmarks and named facial regions, with the same documented
   unresolvable-anchor behaviour (hold the last position, else skip and report). Existing actions
   that take an anchor MUST become face-anchorable by that extension rather than being duplicated
   into face-specific variants; a new action is justified only where no existing action can
   express the effect. Where a region needs more than a point, it MUST be carried by a
   **generalized geometry/masking representation** — a region *name* alone carries no geometry —
   whose form the specification chooses; this amendment mandates no particular polygon or mask
   representation, and the existing `'person' | 'background'` region behaviour MUST NOT change.
5. **An initial family of face effects that Canvas2D can honestly perform without a mesh**:
   face-region tinting; eye-colour effects; landmark-anchored decals and overlays; overlays
   modulated by blendshape values; and localized facial masks. These are authored as ordinary
   effect data (action parameters, anchors, region names, colours, asset references) through the
   editor and the `EffectRuntime` → `RenderCommand[]` → `Renderer` pipeline, with the Renderer the
   only component that draws. A new render command is permitted only where the existing
   vocabulary cannot express an effect, and MUST remain implementable by a renderer that is not
   Canvas2D — the renderer-independence rule (FR-068) is unchanged. Blendshape values MAY modulate
   a *running* effect's visual parameters as raw numbers; they MUST NOT be classified into named
   expressions or emotions, and MUST NOT start, select, stop, or choose an effect.
6. **Mesh deformation is NOT authorized.** Stylized deformation, warping, reshaping, and
   animal-like facial transformation are mesh operations that Canvas2D cannot perform acceptably,
   and MUST NOT be presented, specified, or implemented as if it could. They may require a
   mesh-capable renderer (WebGL or WebGPU); this amendment does **not** commit the project to
   either. The v1.7.0 rule stands: Canvas2D remains the default and required renderer, and
   WebGL, WebGPU, Three.js, Pixi.js, or any 3D stack needs its own amendment backed by a concrete,
   demonstrated Canvas2D incapability. Such a renderer would be evaluated separately, as another
   implementation of the existing command vocabulary and not a change to it.

**Principle II binds Milestone 4 without exception, restated because faces are the most sensitive
data Mudra Web has touched**: face tracking MUST NOT create an exemption for image readback,
screenshots, camera recording, arbitrary image serialization, upload, or the persistence of any
face image. The readback and upload prohibitions in the architecture privacy test apply to every
face-related module unchanged, with no exemption. **Face landmarks, blendshape values, transform
matrices, and every value derived from them are transient per-frame runtime data**: they MUST NOT
be persisted (not in a project document, not in the Capture Mode store, not in any exported
artifact), and MUST NOT be transmitted. They are *not* among the v1.8.0 persistable categories,
which name hand landmarks only, and being coordinates does not make them a licence to weaken the
camera-image boundary. If a future mesh renderer must sample the camera, it MUST do so as a
GPU-side rendering operation and MUST NOT read camera pixels back into application memory or
expose them to any storage or transmission path — a condition on that later amendment, not a
permission granted here. Face detection MUST NOT begin before the explicit camera-start gesture
and MUST NOT run in the Capture Mode entry point; the specification MUST state when detection
runs and what the user is told while it does, including whether an additional disclosure or
opt-in beyond camera start is required.

**The recognition boundary is preserved.** Three things are distinct: *face landmark tracking*
(geometry), *face effects* (rendering driven by that geometry), and *face identity/recognition*.
This amendment authorizes the first two. It does **not** authorize, implicitly or otherwise: face
recognition, face identity matching or verification, biometric identification or templates,
inference of attributes (age, gender, emotion, expression classes), face-driven pose or effect
*triggers*, or any face-based extension of the pose matcher. Each requires its own explicit
amendment.

**Nothing else moves.** The versioned pose-sample schema remains the only contract between
applications, and Web Capture is unchanged: this amendment adds no field to the pose-sample
schema, authorizes no second (face) schema — that would need a specification that establishes and
authorizes one — and gives Capture Mode no face capability. Editor docking, tabs, Inspector lock,
panel collapse, and undo/redo semantics are unchanged; face-effect authoring adds project data
only through the existing editing functions and history.

**Staging is a direction, not a checklist.** The intended order is: capability → face-landmark
domain abstraction → face anchors and regions → simple face effects → *separately evaluate*
mesh/deformation. Reaching a later stage requires the earlier ones, but no single specification
is required to deliver more than one, and Spec 011 is not required to deliver all of them. A
specification under this authorization MUST state which stage it covers and MUST NOT add surface
for a later stage (no dormant port, capability entry, render command, or action ahead of the
stage that uses it).

It explicitly does **not** authorize: mesh deformation, warping, or a mesh renderer; WebGL,
WebGPU, or any 3D stack; face recognition, identity, biometric, attribute or expression
inference; face-driven triggers; a second ML runtime; runtime model downloading or user-supplied
models; persistence or transmission of any face-derived data or imagery; any change to the
pose-sample schema, Capture Mode, or recognition semantics; or any placeholder face action, port,
command, capability, dependency, or asset created ahead of the stage that needs it. Each requires
its own explicit authorization amendment before any behavior for it is implemented.

**Rationale**: Discipline protects the foundation. Building recognition or gameplay on an
unproven data pipeline would bake in assumptions before the ground truth (the dataset format)
is stable. The Phase 2.75 exception stays narrow — deterministic matching only, no training,
no cloud — because its purpose is to test whether that foundation holds, not to start
building on it before the question is answered. Studio's first milestone is narrow for the
same reason and in the same direction: it exists to *see* whether the recorded data is any
good, which is the question that must be answered before anything is built on top of it. A
tool that only reads cannot corrupt the ground truth it was built to inspect. Mudra Web is the
first milestone to *spend* that foundation rather than build or inspect it, which is why its
authorization is a vertical slice: one interaction proven end to end answers whether the pipeline
can drive an experience at all, and that answer is worth having before an editor, a rendering
stack, or a content ecosystem is designed on top of an assumption. Milestone 2 is authorized only
because that answer came back yes: an editor is worth building over a runtime already proven to
work, not a speculative one, and Person Segmentation is worth gating rather than assuming, because
the inert-and-reported discipline Milestone 1 established for `person_visibility` is precisely what
makes shipping a capability that may be unavailable safe rather than merely convenient. Milestone 3
follows the same test: Capture Mode is worth authorizing because the schema and normalization it
depends on were already proven correct by Engine and Mudra Capture, so a browser-based collection
path adds a convenience without adding risk to the dataset itself — and undo/redo is authorized
alongside it for the same reason `future-work.md` gave: the editor's edits were already pure
functions, so the feature was shape-ready rather than speculative. The v1.9.0 refinements are
narrower still: each corrects or extends a surface Milestone 2 already proved out (the editor UI,
the inspector, preview mode) rather than opening a new one, which is why they are recorded as
refinements to an existing authorization rather than a fourth milestone. Milestone 4 is a
new milestone because it adds a capability category, and it is authorized in stages for the same
reason the earlier ones were vertical slices: the reusable infrastructure (capability gating, the
detector-port pattern, central anchors, region compositing) is proven, but the parts faces
genuinely need — geometry beyond a name, more than one probed capability — are not, and the one
thing Canvas2D cannot do (mesh deformation) is kept out precisely so that it is decided on
evidence rather than absorbed as an implementation detail.

## Technology & Code Quality Standards

Standards below are grouped by application. Principles I–VI apply to all of them; only the
concrete language, layout, and tooling differ.

### Engine (Python, repository root)

- **Language**: Python 3.14, using modern idioms (type parameter syntax, `match`, pathlib,
  `from __future__` not required at this version).
- **Dependency footprint**: the project keeps its runtime footprint as small as possible.
  Each dependency is introduced only in the phase where it is first required, and adding one
  MUST be justified against an existing capability first. Phase 1 (live camera) requires only:
  mediapipe, opencv-python, numpy, pydantic, rich, typer, loguru (plus pytest for tests).
  Analysis/visualization/training libraries (scipy, pandas, matplotlib) are introduced later,
  in the phase that first needs them (dataset analysis, plotting, or model training).
- **MediaPipe Hands** is the detection backend, accessed behind the detection interface so it
  can be replaced. It MUST surface both hands, handedness, per-hand confidence, and the 21
  landmarks. The live view MUST draw landmarks in real time and display FPS, handedness, and
  confidence.
- **Project layout** follows the agreed structure: `apps/engine/` with `core/`, `camera/`,
  `detection/`, `normalization/`, `recording/`, `recognition/`, `dataset/`, `models/`,
  `visualization/`, `ui/`, `utils/`, `config/`; plus the repository-level `assets/`,
  `datasets/poses/`, `datasets/sequences/`, `recordings/`, `tests/`, `scripts/`, `docs/`.
  Deviations require an amendment. The package is imported as `engine` (e.g.
  `from engine.core.live_app import LiveApp`).
- **CLI**: Mudra is a **multi-command** Typer application. The official command surface is
  `run`, `record-pose`, `record-sequence`, `dataset info`, `dataset validate`, `camera info`,
  and `doctor` (implemented incrementally; only `run` exists in Phase 1). A Typer callback
  makes `python -m engine.main` (no subcommand) execute the exact same logic as `mudra run`, so
  both entry points stay consistent. `mudra run` MUST launch the live application with clean,
  deterministic shutdown (camera released, resources closed).
- **Persistence layout**: datasets are organized as append-only **sample collections**, one
  directory per identity — `datasets/poses/<pose_id>/sample_NNNN.json` and
  `datasets/sequences/<sequence_id>/sample_NNNN.json`. There is NO single-file-per-pose. This
  supports collecting hundreds or thousands of examples per pose without redesign, and new
  samples are always appended, never overwritten. Each sample is human-readable JSON
  containing only normalized landmark coordinates plus metadata; a pose's identity metadata
  (`pose_id`, `display_name`, `aliases`, `description`) travels with the collection, and every
  sample references its `pose_id`. (No persistence occurs in Phase 1 — this governs Phase 2+.)
- **Documentation**: a professional README and `docs/` MUST cover vision, architecture,
  installation, running, folder structure, roadmap, contributing guidelines, and coding
  standards, and MUST stay consistent with this constitution.

### Capture applications (Dart / Flutter, `apps/capture/`)

- **Language & framework**: Dart with Flutter (latest stable channel). Android is the first
  target; the architecture MUST keep platform-specific code behind interfaces so iOS can be
  added without changing domain, application, or presentation layers.
- **Clean architecture layers** are mandatory and dependencies point inward only:
  `domain/` (entities, value objects, repository interfaces — no framework imports),
  `application/` (use cases and state orchestration — no widgets, no plugins),
  `infrastructure/` (camera, platform channels, filesystem, serialization — implements domain
  interfaces), `presentation/` (widgets and screens only). Business logic inside widgets is
  prohibited; a widget MAY read state and dispatch intent, nothing more. Feature-first
  grouping within a layer is preferred once a layer holds more than one feature.
- **Typed, immutable models**: every structured value is an immutable Dart class with typed
  fields and value equality — never a raw `Map`. Public classes, methods, and top-level
  functions carry doc comments. Magic numbers and duplicated logic are prohibited.
- **Configuration**, including the pose catalog, MUST be data (asset/config files) loaded and
  validated at runtime, never hardcoded into widgets — the Principle V rule, restated for
  Flutter.
- **Tests**: `flutter test` MUST cover the domain layer, the application/use-case layer, and
  JSON serialization round-trips against the shared schema. Platform-channel and camera code
  is isolated behind interfaces precisely so the rest stays testable without a device.
- **Static analysis**: `flutter analyze` MUST be clean; analyzer rules live in
  `analysis_options.yaml` and are part of the definition of done.

### Web applications (TypeScript, `apps/web/`)

- **Language & platform**: TypeScript, targeting current evergreen browsers. Browser platform APIs
  (camera capture, canvas, audio, animation timing) MAY be used directly, but every platform
  capability MUST sit behind an application-defined interface so the rest of the application stays
  testable in a plain runtime with no browser, no camera, and no display attached.
- **Detection backend**: **MediaPipe Tasks Vision** is the browser hand-landmark backend, accessed
  behind a detection interface so it can be replaced — the same rule, and the same reason, as
  Engine's MediaPipe backend. It consumes the repository's existing `assets/hand_landmarker.task`
  model directly, under the shared-asset rule below.
- **Clean architecture layers** are mandatory and dependencies point inward only: a framework-free
  **domain** (value objects, normalization, recognition, effect definitions, effect runtime), an
  **application** layer (orchestration and session state), an **infrastructure** layer (camera,
  detection backend, asset and dataset loading), and a **presentation** layer (rendering and UI).
  Business logic inside rendering or UI code is prohibited; a view MAY read state and dispatch
  intent, nothing more.
- **Typed, immutable models**: every structured value is a typed, immutable value object — never an
  untyped object literal, and never `any`. Public modules, types, and functions carry doc comments.
  Magic numbers and duplicated logic are prohibited; named constants and shared helpers replace them.
- **Configuration**, including pose and effect catalogs, MUST be data loaded and validated at
  runtime, never hardcoded into rendering or UI code — the Principle V rule, restated for the browser.
- **Tests**: an automated test runner MUST cover the domain layer — normalization, recognition, and
  effect-runtime behavior — plus every cross-language port's golden-fixture verification (see the
  boundary rules below). Camera, detection, and rendering are isolated behind interfaces precisely
  so this suite runs without a browser or a webcam.
- **Static analysis**: type checking and linting MUST be clean, and are part of the definition of done.
- **Experience assets**: a web application MAY ship its own visual and audio assets (sprites,
  particles, backgrounds, sound) inside its application tree. These are **experience content, never
  dataset content** — the same separation Principle II already draws for Capture's reference imagery.
  Assets MUST be Mudra-owned or otherwise licensed for the project's use; third-party protected
  material MUST NOT be committed to the repository.
- **Editor and segmentation** (Milestone 2, added in v1.7.0): the visual effect editor is a
  **presentation-layer authoring surface** over the domain model already defined — it constructs
  and edits `EffectDefinition`/`Timeline` data and reads `ActionRegistry` parameter metadata to
  drive its inspector; it MUST NOT introduce a parallel effect-execution or rendering path, and
  editor-only state (open project, selection, unsaved edits) is application/presentation state,
  never domain state. When Person Segmentation is enabled it is accessed behind the same
  replaceable detection-interface discipline already required for hand-landmark detection, using
  the MediaPipe Tasks Vision family.
- **Capture Mode and editor undo/redo** (Milestone 3, added in v1.8.0): Capture Mode's own entry
  point is emitted only when its build flag is set; its own controller constructs no matcher, no
  effect runtime, and no pose-event emitter, so it cannot become a second recognition system; its
  own repository and storage location sit inside the one directory already permitted to touch
  persistence, as a database separate from the editor's own; and its own schema serializer is
  verified against Engine-generated golden fixtures, reusing the existing normalization
  implementation rather than re-deriving it.
- **Editor chrome state** (Milestone 2 refinement, added in v1.9.0): panel docking arrangement,
  tab-group membership, Inspector-lock state, and panel/section collapse state are editor-only
  application/presentation state — never domain state, never a project-document field — extending
  the rule the Editor and segmentation bullet above already states for open project/selection/
  unsaved-edit state.
- **Face tracking and face effects** (Milestone 4, added in v1.10.0): face landmarks are one more
  capability behind the same replaceable detection-interface discipline, using the MediaPipe Tasks
  Vision runtime already installed and a repository-level model asset with recorded provenance and
  no runtime download; face data is a framework-free domain value, transient and never persisted;
  face anchors and regions resolve through the one central anchor system, never inside an action;
  and Canvas2D remains the required renderer, so mesh deformation is out of scope until its own
  amendment. Face landmarks supply geometry only — never recognition, identity, or triggers.
- **Build tooling** (bundler, test runner, package manager) is a plan-level decision recorded in the
  application's README and its feature plan, not fixed here.

## Monorepo & Cross-Application Boundaries

Mudra is a monorepo containing multiple applications that share a data format, not a codebase.

- **Layout**: **every application lives under `apps/`** — `apps/engine/` (Python),
  `apps/capture/` (Flutter), `apps/studio/` (Python, authorized in v1.5.0), and `apps/web/`
  (TypeScript, authorized in v1.6.0) — each with its
  own toolchain, dependencies, and README. Concerns
  that belong to the repository rather than to one application (`tests/`, `datasets/`,
  `assets/`, `scripts/`, `specs/`, `pyproject.toml`) stay at the root. No application
  occupies the root.
- **The ONLY contract between independent applications is the versioned pose-sample JSON
  schema** (`schema_version`, currently 1), documented in the owning feature's `contracts/`.
  An application MUST NOT import, vendor, or reach into another application's source. Datasets
  produced by any application MUST be consumable by the engine with zero manual processing.
  The single exception is the Engine shared-platform-library rule immediately below; it does
  not generalize.
- **Engine is the repository's shared platform library** (added in v1.5.0). `apps/engine/` is
  not merely a peer application: it owns the domain models, the dataset repository and
  serializer, the landmark topology, and the configuration models that define what Mudra data
  *is*. Applications under `apps/` written in the same language MAY import Engine's documented
  public interfaces rather than reimplementing them. This relationship is governed by four
  rules, all MUST:
  - **One direction only.** Engine MUST NOT import from, know about, or be configured by any
    application. The dependency arrow points at Engine and never away from it.
  - **Consume, never touch.** A consuming application MUST NOT modify, extend, vendor, or copy
    Engine source. If Engine genuinely needs a new capability, that is a separate, separately
    authorized change to Engine itself, reviewed on its own merits — never a convenience edit
    made from a consumer's feature branch.
  - **Declare the surface.** Each consuming feature MUST record the exact set of Engine symbols
    it depends on in a contract document under its `specs/<feature>/contracts/`. The list is
    binding in both directions: the consumer uses nothing outside it, and Engine cannot break
    what is on it without updating the consumer.
  - **Engine only.** This exemption names Engine and nothing else. Application-to-application
    source imports remain forbidden; two applications that both consume Engine still exchange
    data with each other only through the versioned JSON schema.

  **Rationale**: reimplementing the dataset parser in a second language-compatible application
  would put two definitions of the same schema in one repository — the precise drift the
  schema contract exists to prevent. Naming Engine a library makes the real architecture
  explicit and keeps the parser singular, while the one-way and no-edit rules stop "shared
  library" from decaying into "everything may reach into everything".
- **Shared binary assets are shared, not vendored** (added in v1.6.0). Repository-level assets under
  `assets/` — notably the MediaPipe `hand_landmarker.task` model — are shared infrastructure and MAY
  be consumed directly by any application, in **any** language. An application MUST NOT copy such an
  asset into its own tree, and MUST NOT commit a second, divergent copy of a model that already
  exists at the repository level. **Rationale**: three applications already run the same MediaPipe
  Tasks model; a per-application copy would let them drift silently onto different model versions and
  produce landmarks that no longer mean the same thing across the monorepo — the same class of
  failure the single-parser rule exists to prevent. An asset is data, not source, so sharing one
  creates none of the source coupling the boundary rules forbid.
- **Cross-language ports MUST be verified against golden fixtures** (added in v1.6.0). Where an
  application cannot import Engine — because it is written in a language Engine cannot serve — and
  must therefore independently implement an algorithm Engine already owns (normalization,
  distance/similarity matching, and the schema mapping are the current cases), the port MUST be
  verified against fixtures generated from Engine's own implementation, committed to the consuming
  application's test suite, and regenerated whenever Engine's implementation changes; a resulting
  diff is a cross-application event to be handled deliberately, not a file to re-baseline. A port
  that cannot be checked against Engine's output is not authorized. **Rationale**: `apps/capture/`
  already established this pattern (`scripts/export_capture_fixtures.py`), and it is the only thing
  that makes the duplication the boundary rules *force* on non-Python applications safe rather than
  merely unavoidable. Duplication is tolerated; unverified duplication is drift waiting to happen.
- **Schema changes are cross-application events**: altering the persisted schema is at minimum
  a MINOR constitution event, MUST bump `schema_version` when incompatible, MUST preserve the
  ability to read prior append-only samples, and MUST be reflected in every application that
  reads or writes it before merge.
- **No premature shared packages**: duplication of a small value object across applications is
  preferred over a shared library introduced speculatively. A shared package is justified only
  when the same logic has independently appeared in two applications and drifted. This rule
  governs the extraction of *new* shared packages; it is not a reason to extract a package out
  of Engine, which is already the shared library by the rule above.
- **Application independence**: no application may depend on another being installed, running,
  or reachable. Exchange happens through exported dataset artifacts on disk.

## Development Workflow & Scope Governance

- **Phase gating**: work proceeds through the four foundation phases in order. A phase is
  "done" only when it is runnable, tested where Principle IV requires, and documented.
- **Design review**: any change that introduces or alters a module boundary, an interface, or
  the persisted JSON schema MUST be reviewed against Principles I–III before merge, because
  these are the hardest things to change later. Adding a new application to `apps/` is such a
  change and requires the same review.
- **Data-format changes are versioned**: the JSON schema for poses and sequences carries a
  schema version field; changing it is at minimum a MINOR event and MUST preserve the
  ability to read prior append-only samples.
- **Definition of done** for any unit of work: type hints present, public API documented,
  no hardcoded config or magic numbers, no new global state, tests green, and no
  out-of-milestone feature surface introduced.

## Governance

This constitution supersedes ad-hoc practice. All contributions, reviews, and generated
plans/specs/tasks MUST verify compliance with the principles above; a change that violates a
principle is not merged until either the change is corrected or the constitution is amended
to permit it.

**Amendment procedure**: Amendments are proposed as a change to this file with a written
rationale, reviewed for downstream impact on `.specify/templates/*` and project docs, and
recorded in the Sync Impact Report at the top of this file.

**Versioning policy** (semantic versioning of governance):
- **MAJOR**: removal or backward-incompatible redefinition of a principle or governance rule.
- **MINOR**: a new principle/section, or materially expanded mandatory guidance (including
  persisted-schema version bumps).
- **PATCH**: clarifications, wording, and non-semantic refinements.

**Compliance review**: The Constitution Check gate in the planning workflow MUST be evaluated
against this document. Any justified deviation MUST be recorded in the plan's Complexity
Tracking with the simpler alternative that was rejected and why. Unjustified complexity is
grounds for rejection.

**Version**: 1.10.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-09-21
