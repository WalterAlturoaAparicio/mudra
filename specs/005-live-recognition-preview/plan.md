# Implementation Plan: Phase 2.75 — Live Recognition Preview

**Branch**: `005-live-recognition-preview` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-live-recognition-preview/spec.md`

## Summary

A new screen in the existing `apps/capture` Flutter app: point the camera at a hand, and see a
continuously updating prediction of which catalog pose it matches, using **only the samples
already recorded on the device** — no model, no training, no network. A pose that stays the
stable top prediction for a configurable duration is "confirmed" and plays a themed visual
effect. The screen exists to answer one question the dataset-collection app cannot answer on its
own: *is what was recorded actually good enough to recognize the pose it claims to represent?*
An unstable or wrong prediction on a correctly-performed pose is a direct signal that pose needs
more or better samples.

Technically: the screen reuses the R1 camera pipeline verbatim (`CameraSessionController` →
canonical conversion → `translation_scale` normalization) and adds exactly one new stage —
a **deterministic pose matcher**. Every catalog pose's stored samples are read once per screen
visit and turned into **exemplars** (their already-persisted normalized landmark vectors). Each
live frame is compared against every eligible exemplar with a **per-landmark-weighted Euclidean
distance**, converted to a bounded confidence via softmax, and the nearest exemplar's pose wins.
A lightweight stability tracker (driven by the injected `Clock`, not by frame count) decides when
a prediction has been held long enough to confirm. Confirmation looks up a **data-driven effect
definition** (mirroring how the pose catalog itself is data) and renders it as a `CustomPainter`
overlay positioned from live hand-landmark coordinates.

Nothing here writes to the dataset. The feature is a read-only consumer of specification 003's
samples, camera abstraction, and canonical convention, added as a **narrow, explicitly-bounded
exception** to Principle VI (Scope Discipline) recorded in constitution v1.4.0.

## Technical Context

**Language/Version**: Dart 3.9 / Flutter 3.35 (stable) — the same application, same toolchain as
specification 003. No new Flutter/Dart version requirement.

**Primary Dependencies**: none new. Weighted Euclidean distance, softmax, and the stability
timer are all a few dozen lines of plain Dart — pulling in a stats/ML package for this would
violate the constitution's dependency-footprint discipline (Engine section, restated for Capture)
for no benefit. Effect rendering uses Flutter's own `CustomPainter`, already available.

**Storage**: none new. Reads specification 003's existing `FileSampleRepository` output
(`<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json`) to build exemplars; writes
nothing. A new bundled asset, `assets/config/effect_catalog.json`, is read-only configuration
data, not user data.

**Testing**: `flutter test`. The matcher is pure Dart and deterministic — golden-style tests
assert that a fixed exemplar set plus a fixed live vector always produce the same ranked
candidates and confidence values, byte-for-byte. Stability logic is tested with a `FakeClock`
exactly as specification 003's countdown logic is tested with `ManualSessionTicker`. Widget tests
cover the new screen's states; the Kotlin camera path is unchanged and needs no new native tests.

**Target Platform**: Android phones, same `minSdk`/`targetSdk` as specification 003. No new
platform surface — the recognition preview uses the same `CameraSource`/`CameraSession` contract
R1 already implements; it adds no new platform channel.

**Project Type**: Mobile application, same monorepo location (`apps/capture/`). A new *screen*
inside the existing app, not a new application.

**Performance Goals**: recognition latency (frame captured → prediction displayed) **under
200ms** for at least 95% of frames (SC-002); camera/detection throughput reuses R1's existing
≥20 fps assumption; screen remains responsive with **at least 5,000 samples** across the catalog
(SC-007), matching specification 003's own SC-011 benchmark exactly rather than introducing a
second number to track.

**Constraints**: fully offline, no exceptions (constitution Phase 2.75 exception explicitly
forbids network access here); deterministic and reproducible — the same stored dataset MUST
always produce the same ranked candidates for the same input, no randomness anywhere in the
matcher; read-only with respect to the dataset (FR-004); no machine learning, model training, or
neural-network inference of any kind (FR-008).

**Scale/Scope**: 18 catalog poses (existing, unchanged), up to 5,000 total samples as the
scale target, one new screen plus its supporting domain/application/infrastructure code, and one
new small configuration asset (effect definitions). No new screens beyond the one recognition
preview and a lightweight catalog-readiness view reachable from it.

## Constitution Check

*GATE: evaluated against constitution **v1.4.0** before Phase 0, re-evaluated after Phase 1
design. This is the first feature to exercise the Phase 2.75 exception to Principle VI, so its
bounds are checked explicitly rather than assumed.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Architecture-First & Modular Boundaries** | Every capability behind an interface; no widget business logic | **PASS** — matching sits behind a `PoseMatcher` interface (`domain/recognition/`); effects are data (`EffectDefinition`) resolved by an `EffectCatalogSource` port, not a per-pose `switch` in a widget. Presentation only renders `RecognitionState`/`StabilityState` it did not compute. |
| **II. Coordinates, Never Images** | No pixel data persisted; camera frames leave memory as landmarks only | **PASS** — the matcher operates exclusively on the normalized landmark vectors specification 003 already persists (FR-005). Nothing new is written to the dataset (FR-004). Visual effects are computed overlays positioned from landmark coordinates at render time; nothing about an effect is captured, screenshotted, or persisted. |
| **III. Extensibility by Design** | Recognition interfaces MUST be designed so multiple strategies (similarity matching, DTW, HMM, neural) can be pluggable | **PASS — this is the principle's first realization.** `PoseMatcher` is exactly the anticipated interface boundary; the concrete `WeightedEuclideanNearestNeighborMatcher` is one pluggable strategy. Swapping in a different deterministic strategy (or, on a future, separately-authorized milestone, a learned one) requires no change outside `infrastructure/recognition/`. |
| **IV. Typed, Modeled, Clean** | Typed immutable models; tests on data + logic | **PASS** — `Exemplar`, `Candidate`, `RecognitionResult`, `StabilityState`, `EffectDefinition` are immutable Dart value classes with equality, matching the existing domain style. The matcher's determinism is exactly what constitution Principle IV's testing mandate is for. |
| **V. Centralized Config & Observability** | No hardcoded tunables; structured logging | **PASS** — landmark weights, the confidence floor, the ambiguity margin, the minimum-exemplar threshold, and the stability duration are all `RecognitionConfig` data (Principle V, restated for Flutter in the capture standards). Confirmation events are logged as structured records at info, mirroring the camera lifecycle's `camera_acquired`/`camera_released` pattern; per-frame recognition results stay at debug. |
| **VI. Scope Discipline** | Recognition/effects MUST NOT be implemented until explicitly authorized | **PASS — this feature is that authorization, exercised at its stated bounds.** Constitution v1.4.0's Phase 2.75 exception permits exactly deterministic matching and demo-quality effects and nothing else; this plan introduces no ML, no training, no neural network, no cloud, no backend, and no gameplay/"attacks" mechanics beyond the confirmed-pose effect. Specification 003's FR-040/FR-041 are unchanged — this plan touches no file 003 governs. |
| **Monorepo & Cross-Application Boundaries** | No cross-app imports; no schema change; no premature shared packages | **PASS** — no new application is added; this lives entirely inside `apps/capture/`. The feature is a **read-only** consumer of the existing pose-sample schema (`schema_version` stays `1`, untouched) — it introduces no new persisted field and is not a schema event. No code is imported from `apps/engine/`. |

**Post-Phase-1 re-evaluation**: unchanged — all gates still PASS. The design added no
persistence, no network dependency, no new application, and no feature surface beyond what the
Phase 2.75 exception authorizes. **Complexity Tracking is empty: there are no justified
violations.**

## Project Structure

### Documentation (this feature)

```text
specs/005-live-recognition-preview/
├── plan.md                     # This file
├── spec.md                     # Feature specification (clarified)
├── research.md                 # Phase 0 output — D1..D10 + risks
├── data-model.md               # Phase 1 output — entities, matching rules, state machine
├── quickstart.md               # Phase 1 output — how to run and validate
├── contracts/
│   ├── recognition-interfaces.md  # PoseMatcher, ExemplarSource, StabilityTracker (domain-owned)
│   └── effect-catalog.md          # assets/config/effect_catalog.json format (FR-019)
├── checklists/
│   └── requirements.md         # Spec quality checklist
└── tasks.md                    # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

Extends the existing `apps/capture/` tree from specification 003 / Revision R1. **New paths are
marked `+`**; everything else is reused unmodified.

```text
apps/capture/
├── lib/
│   ├── domain/
│   │   ├── recognition/          + # Exemplar, Candidate, RecognitionResult, StabilityState,
│   │   │                         + #   ConfirmationEvent, PoseMatcher (interface)
│   │   ├── effects/              + # EffectDefinition, EffectKind (the small, shared set of
│   │   │                         + #   parameterized effect kinds — see research D8)
│   │   ├── camera/                 # reused: LensPosition, CameraSessionInfo, CaptureMode, …
│   │   ├── canonical/              # reused: CanonicalViewConverter
│   │   ├── landmarks/              # reused: Landmark, HandLandmarks, LandmarkFrame
│   │   ├── poses/                  # reused: PoseDefinition, PoseCatalog
│   │   ├── samples/                # reused: PoseSample, HandSample (read, never written, here)
│   │   └── ports/                  # + ExemplarSource, EffectCatalogSource (new ports, alongside
│   │                               #   the existing CameraSource/SampleRepository/etc.)
│   ├── application/
│   │   ├── recognition/          + # RecognitionSessionController (per-frame matcher execution,
│   │   │                         + #   stability tracking, confirmation), LoadExemplars use case
│   │   └── camera/                 # reused: CameraSessionController, CaptureSettingsNotifier
│   │                               #   (this screen uses the controller directly; it does not
│   │                               #   need capture-mode/countdown/take-confirmation settings)
│   ├── infrastructure/
│   │   ├── recognition/          + # WeightedEuclideanNearestNeighborMatcher, FileExemplarSource
│   │   │                         + #   (reads PoseSample files into Exemplar objects)
│   │   ├── effects/              + # AssetEffectCatalogSource (mirrors AssetPoseCatalogSource)
│   │   ├── camera/                 # reused: MethodChannelCameraSource/Session — no changes
│   │   └── storage/                # reused: FileSampleRepository (read path only)
│   ├── presentation/
│   │   ├── recognition/          + # RecognitionPreviewScreen, PredictionHud (top-3/confidence/
│   │   │                         + #   latency/stability), EffectOverlay (CustomPainter),
│   │   │                         + #   CatalogReadinessSheet
│   │   ├── home/                   # ~ one new secondary entry-point affordance (FR-026); no
│   │   │                           #   change to the two primary actions
│   │   ├── capture/                # reused: PreviewStage (the same aspect-correct preview
│   │   │                           #   widget renders the recognition screen's camera view)
│   │   └── design/                 # reused: Spacing, Palette, theme
│   └── shared/
│       └── config/                 # ~ CaptureConfig gains a nested RecognitionConfig section
├── assets/
│   └── config/
│       └── effect_catalog.json   + # pose_id → effect kind + parameters (FR-019); poses with no
│                                  + #   entry use the generic fallback effect (FR-020)
├── test/
│   ├── domain/recognition/       + # Matcher determinism, weighting, softmax confidence, ambiguity
│   ├── application/recognition/  + # Stability transitions with FakeClock, confirmation timing
│   ├── infrastructure/recognition/ + # FileExemplarSource against fixture samples, effect catalog
│   │                                #   loading (incl. missing-entry fallback)
│   └── presentation/recognition/ + # Screen states, HUD content, effect overlay positioning
├── android/                        # unchanged — no new platform channel
├── analysis_options.yaml           # unchanged
├── pubspec.yaml                    # unchanged (no new dependency)
└── README.md                       # ~ documents the recognition preview alongside Sync/Record
```

**Structure Decision**: extends the existing single Flutter application per constitution v1.4.0's
Phase 2.75 exception — a new screen, not a new app, reusing every existing layer's dependency
direction unchanged. Feature-first grouping continues: `recognition/` and `effects/` become new
sibling feature directories inside `domain/`, `application/`, `infrastructure/`, and
`presentation/`, exactly the pattern already used for `camera/` and `canonical/` in R1.

## Revision R1 pattern, reapplied

Three design decisions carry over from R1 by direct analogy, because the same problems recur at
smaller scale:

1. **A pure, testable core behind one interface.** `PoseMatcher` is to recognition what
   `CanonicalViewConverter` was to lens conversion: a domain-owned, side-effect-free function
   that is exhaustively unit-testable without a device.
2. **Config, not constants.** Every tunable (weights, thresholds, durations) lives in
   `RecognitionConfig`, the same discipline `CaptureConfig` already enforces — this is what makes
   the matcher's behavior something a test can pin down exactly rather than something a phone
   happens to produce.
3. **Data-driven catalogs, not code branches.** `assets/config/effect_catalog.json` mirrors
   `assets/config/pose_catalog.json` exactly: authoring or changing an effect is an asset edit,
   never a Dart change, and a missing entry degrades to a documented fallback rather than an
   error (FR-020) — the same placeholder-safety pattern FR-005 already established for reference
   images.

## Design decisions

Full rationale and rejected alternatives are in [research.md](./research.md) as **D1–D10**; this
section states what is being built.

### 1. The matcher: weighted Euclidean nearest-neighbor (D1–D3)

```text
distance(live, exemplar) = Σ_i  weight[i] × ‖live.points[i] − exemplar.points[i]‖₂²   (per hand)
confidence[pose]         = softmax(−distance)  over every eligible candidate pose
prediction                = argmax(confidence)
```

`weight[i]` is higher for fingertip landmarks (4, 8, 12, 16, 20) than for palm/wrist landmarks,
because fingertip position carries most of a hand shape's distinguishing information — this is
the "weighted" half of the "Weighted Euclidean Distance" option the milestone named, and it is
strictly simpler than Procrustes alignment (no per-comparison rotation solve, which would cost an
SVD per exemplar and threaten the 200ms budget at 5,000 exemplars) or unweighted cosine similarity
over the flattened vector (no natural weighting scheme, less interpretable for spatial data than
a per-point spatial distance). **1-nearest-neighbor** (the single closest exemplar wins) is the
default rather than a k-NN vote: it is the simplest version of "the simplest architecture that
works well," and the dataset's own natural variation across many recorded samples is what gives
a single nearest neighbor enough robustness — see research D1 for the rejected alternatives and
exactly when a small-k vote would be substituted instead, behind the same `PoseMatcher` interface.

**Determinism**: the same exemplar set and the same live vector always produce the same ranked
candidates — no randomness, no floating-point-order-dependent reduction beyond what IEEE-754
double summation already guarantees deterministic in a fixed iteration order.

### 2. Two-handed poses (D2)

A stored sample already carries resolved handedness (specification 003's canonical conversion,
FR-053/FR-054). Matching compares like-for-like: a live left hand is compared only against
left-hand exemplar entries, a live right hand only against right-hand entries. A two-handed
pose's combined distance is the sum of both hands' distances to the same candidate sample's
corresponding hands; it is eligible as a candidate **only** when both hands are present in the
live frame, mirroring `required_hands` exactly as specification 003 already enforces at capture
time. A one-handed pose is matched hand-agnostically — either live hand may be compared against
that pose's exemplars, since a one-handed pose's own recorded samples may have been made with
either hand.

### 3. Confidence, the floor, and ambiguity (D3–D4)

Softmax over negative distances produces one bounded, comparable confidence value per eligible
candidate, summing to 1 across all of them — this is what makes "confidence" mean the same thing
for every pose regardless of its intrinsic shape complexity. A frame counts as a real prediction
only when the top confidence clears a configured floor **and** the gap to the second-place
confidence clears a configured margin; failing either produces "not confident" / "ambiguous"
rather than a shaky top-1 (FR-013). Both thresholds are `RecognitionConfig` data, tuned during
implementation against real recorded data rather than fixed in the specification (spec
Assumptions) — this is a deliberate, bounded planning-phase decision, not an open product
question.

### 4. Exemplars: read fresh, gated by a minimum count (D5–D6)

`FileExemplarSource` scans the same dataset `FileSampleRepository` already manages, once per
screen entry, and produces one `Exemplar` per stored sample's normalized landmark vector plus its
resolved handedness. A pose whose sample count is below `RecognitionConfig.minExemplarsPerPose`
(default **20** — the same per-press throughput specification 003's own SC-002 already treats as
a meaningful volume) is excluded from matching entirely and reported through
`CatalogReadiness` as not yet recognizable (FR-006). Nothing is cached across app restarts;
re-entering the screen after recording more samples via Capture's Record flow picks them up
immediately (FR-005, edge case).

### 5. Stability: driven by the clock, not the frame (D7)

`StabilityState` tracks how long the *same* pose has been the top, confident, unambiguous
prediction, measured against the injected `Clock` — the same ambient port `RunRecordingSession`
already uses, tested with the same `FakeClock` double. A changed prediction, a drop below the
confidence floor, or the loss of a detected hand resets the held-duration to zero immediately
(FR-016). Reaching `RecognitionConfig.stabilityDuration` (default **3.0 s**, the fast end of the
milestone's named 3–5 s range, consistent with how `CaptureConfig.countdownSeconds` already
defaults to the shorter, snappier end of its own range) raises exactly one `ConfirmationEvent`;
holding the same pose afterward does not raise a second one until the prediction changes and
later re-stabilizes (FR-018).

### 6. Effects: a small set of parameterized kinds, not one class per pose (D8)

`EffectDefinition` names an `EffectKind` (a handful of shared, parameterized `CustomPainter`
overlays — a glow, a sprite pair anchored near the hand, a particle burst, a fade-with-lines) plus
per-pose parameters (color, sprite asset, intensity). Positioning comes from the same live,
canonical hand-landmark coordinates the matcher already has, mapped into screen space through the
identical transform `PreviewStage` (R1) already applies to the camera texture — so an effect never
drifts relative to what the camera shows. A pose with no entry in `effect_catalog.json` plays
`EffectKind.genericConfirm` (FR-020); this is resolved exactly like a missing reference image
(FR-005) — a placeholder, never a broken screen. The milestone's six named poses (horse, dog,
snake, dragon, bird, tp) get authored entries first; the remaining twelve use the fallback until
authored (spec Assumptions) — authoring more is a JSON edit, never a Dart change.

### 7. Reuse, not reimplementation, of the camera seam (D9)

The recognition preview acquires its camera through the exact same
`cameraSessionControllerProvider` (`Provider.autoDispose`) the capture screen uses, held alive for
exactly as long as the recognition screen is mounted via `ref.listenManual` — the identical
pattern R1 established, so the same lifecycle guarantees (release within 1 s of leaving, at most
one live session, clean reacquisition) apply here with no new code. The screen defaults to the
front lens, mirrored, matching how a contributor naturally uses it to watch their own hands
(FR-003) — the same default `CaptureProfile` shape as Self Capture, without needing Self Capture's
countdown or take-confirmation settings, which do not apply to a screen that never records.

### 8. Catalog readiness, as a byproduct of exemplar loading (D10)

`LoadExemplars` already knows, per pose, how many samples it found. `CatalogReadiness` is that
count compared against `minExemplarsPerPose`, surfaced as a simple list (ready / not-yet, with the
count) reachable from the recognition screen (FR-024) — no separate data pass, no new storage
read.

## Complexity Tracking

> No constitutional violations require justification. Table intentionally empty.
>
> The Phase 2.75 exception itself is not a "violation" recorded here — it is the constitution's
> own explicitly-authorized exception (v1.4.0, Principle VI), exercised at exactly its stated
> bounds and re-checked against them in the Constitution Check above.
