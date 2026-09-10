# Phase 0 — Research: Mudra Web

**Feature**: `007-mudra-web` | **Date**: 2026-08-20

Fourteen decisions. Each records what was chosen, why, and what was rejected. Every
NEEDS CLARIFICATION from the Technical Context is resolved here.

---

## D1 — Mirroring: one surface, mirrored once

**Decision**: Draw the camera frame into a single canvas with a horizontal flip, and use **that canvas
as both the detector's input and the displayed image**. Landmarks are therefore already in the space
the user sees. No landmark coordinate is ever flipped, and no handedness label is ever swapped.

**Rationale**: This is the spec's highest-risk correctness requirement (FR-009–FR-013) because a
mirror bug degrades recognition *silently* — no exception, no error, just worse matches. Every
alternative keeps two representations that must be manually kept in agreement; this one makes
disagreement unrepresentable, because presentation and recognition are the same pixels. It also
matches the recorded dataset's convention exactly: MediaPipe assumes a mirrored selfie image, which is
why the stored handedness names the user's physical hand.

The cost is one canvas draw per frame, which the compositor is doing anyway to show the video.

**Alternatives considered**:

- *CSS-mirror the video element, feed the raw stream to the detector.* Rejected: the detector then
  works in the opposite convention from the dataset, so handedness is inverted and every two-handed
  pose matches against the wrong exemplar hand. This is the exact silent failure FR-012 exists to
  catch, and it would be invisible in one-handed testing.
- *Feed raw frames, then flip landmark x → 1−x and swap handedness afterwards.* Rejected: cheapest at
  runtime, but it puts a correctness-critical transform in a place with no natural test, and it must
  be applied consistently in normalization, anchors, and debug drawing. Three chances to forget.
- *Mirror at the getUserMedia constraint level.* Rejected: not a supported constraint; browsers do not
  offer it.

---

## D2 — Landmark detection: MediaPipe Tasks Vision, VIDEO mode

**Decision**: `@mediapipe/tasks-vision`'s `HandLandmarker` in `VIDEO` running mode, `numHands: 2`,
consuming the repository's existing `assets/hand_landmarker.task`, behind a `HandDetector` interface
that exposes only `detect(surface, timestampMs) → LandmarkFrame`.

**Rationale**: The model file is the *identical artifact* Engine (Python Tasks API) and Capture
(Android `tasks-vision:0.10.14`) already run, so the browser produces landmarks that mean the same
thing as the recorded dataset — the precondition for matching against it at all. Constitution v1.6.0's
shared-binary-asset rule was written for exactly this and forbids copying it into `apps/web/`. VIDEO
mode (not IMAGE) is correct because it enables MediaPipe's internal tracking between frames, which is
both faster and more temporally stable — and stability is what the hold gate depends on.

The interface matters as much as the choice: Engine wraps its detector the same way and for the same
stated reason, so the backend stays replaceable.

**Alternatives considered**:

- *TensorFlow.js handpose.* Rejected: a large additional dependency, a different model, and therefore
  landmarks not guaranteed comparable to the dataset.
- *IMAGE running mode.* Rejected: discards inter-frame tracking, producing jitter that the stability
  gate would have to absorb.
- *WASM SIMD/GPU delegate selection exposed as a user setting.* Rejected as premature; the default
  delegate is chosen automatically and FR-097 forbids architecture changes before measurement.

**Serving the shared model without copying it**: Vite's dev server is configured to allow reading the
repository-level `assets/` directory, and the production build copies the model into `dist/` as a
build artifact. A build output is not a committed second copy, so the constitutional rule holds.

---

## D3 — Frame scheduling

**Decision**: `HTMLVideoElement.requestVideoFrameCallback` where available, falling back to
`requestAnimationFrame`. Every frame carries the elapsed time; nothing in the pipeline counts frames.

**Rationale**: `requestVideoFrameCallback` fires once per *decoded camera frame*, so the pipeline
processes each frame exactly once — no duplicate detections when the display refreshes faster than the
camera, no missed frames when it refreshes slower. FR-096 asks for precisely this. The fallback keeps
Firefox working, where support has been inconsistent.

Driving everything by elapsed time rather than frame count is what makes FR-036 and FR-049 true: a
1.0 s hold is one second on a 15 fps laptop and on a 60 fps desktop, and effects play at the right
speed when frames are dropped.

**Alternatives considered**:

- *`requestAnimationFrame` only.* Rejected: decouples processing from camera cadence, wasting work at
  high refresh rates and risking double-processing the same frame.
- *`setInterval` at 33 ms.* Rejected: drifts, and is throttled unpredictably in background tabs.

---

## D4 — Exemplar bundle: binary payload + JSON manifest

**Decision**: A build-time export producing two files — a JSON manifest (provenance, version, per-pose
metadata, offsets) and a **`Float32Array` binary payload** of normalized landmark coordinates in a
fixed layout.

**Rationale**: Three requirements pull in the same direction. Size: ~2,333 exemplar hands × 21
landmarks × 3 coordinates × 4 bytes ≈ **574 KB**, comfortably inside SC-009's 2 MB and far below the
16 MB of raw dataset JSON. Determinism (FR-081): a fixed binary layout has no formatting ambiguity,
whereas JSON floats depend on the writer's repr/rounding behaviour — a real source of non-reproducible
output across Python versions. Load cost: the payload becomes a typed array with no parsing, which
matters because it is read once at startup on the main thread.

**Alternatives considered**:

- *JSON with rounded decimals.* Estimated ≈ 1.2 MB at 4 decimals — within budget, and human-readable.
  Rejected on determinism: guaranteeing byte-identical float formatting across environments is harder
  than guaranteeing a byte-identical binary layout, and FR-081 makes determinism a requirement rather
  than a nicety. The manifest stays JSON, so the bundle remains inspectable where inspection helps.
- *Ship raw `datasets/poses/` and normalize in the browser.* Rejected outright by FR-079 — 16 MB and
  1,378 file reads.
- *Cluster or subsample exemplars to shrink further.* Rejected as premature optimization that would
  change recognition behaviour; 574 KB needs no shrinking.

**Consequence to carry forward**: exemplars are stored at `float32` precision while the live hand is
computed at `float64`. Distances therefore differ from a pure-`float64` reference in the seventh
significant figure. This is accounted for in D5 rather than ignored.

---

## D5 — Golden fixtures: two suites, two tolerances

**Decision**: Generate fixtures from Engine via a new `scripts/export_web_fixtures.py`, in two suites:

| Suite | Compares | Tolerance |
|---|---|---|
| Normalization | TypeScript normalizer vs Engine's `TranslationScaleNormalizer` | `1e-9` absolute |
| Matching | TypeScript matcher vs a Python reference over **float32-quantized** exemplars | `1e-5` relative |

**Rationale**: Constitution v1.6.0 requires cross-language ports to be fixture-verified, and the
existing `scripts/export_capture_fixtures.py` established both the pattern and the placement. Two
tolerances rather than one because the two stages have genuinely different error budgets: JavaScript
numbers *are* IEEE-754 doubles, so normalization should agree with Python to near machine precision
and a loose tolerance there would hide real bugs. Matching, by contrast, legitimately loses precision
to the float32 bundle (D4), so its reference must be computed over the same quantized values — the
comparison is against what the browser actually holds, not an idealized version of it.

The matching suite covers, as distinct cases: one-handed hand-agnostic matching, two-handed
like-for-like pairing, the same-sample constraint, mean-not-sum combination, softmax confidence, the
confidence floor, and the ambiguity margin.

**Alternatives considered**:

- *One tolerance for both.* Rejected: any single value is either too loose for normalization or too
  tight for matching.
- *Hand-written expected values.* Rejected: they encode the author's belief rather than Engine's
  behaviour, which is the entire point of the rule.

---

## D6 — Runtime output: render commands plus audio cues

**Decision**: Each frame the effect runtime returns a `FrameOutput` containing an ordered list of
**render commands** and a list of **audio cues**. It calls no drawing API and no audio API.

**Rationale**: Constitution v1.6.0 requires that the runtime not draw. Audio forced the shape: sound
is not drawing, so it cannot be a render command, but letting the runtime call `play()` directly would
break the same rule for the same reason — it would put an irreversible side effect inside a pure
scheduler and make headless testing impossible. Returning *both* as declarative values keeps the
runtime a pure function of (state, elapsed time) and lets one test assert the complete per-frame
output as data.

This is also what makes the renderer replaceable (FR-068): the vocabulary describes *what should
appear*, never *how to paint it*.

**Alternatives considered**:

- *Runtime holds a canvas context.* Rejected outright — constitutional violation.
- *Runtime emits events that a subscriber turns into drawing.* Rejected: equivalent in power but
  harder to assert, since the frame's complete output is never a single value.
- *Audio as a render command with a null visual.* Rejected as dishonest typing; a command list that
  contains non-drawing entries stops being a drawing vocabulary.

---

## D7 — Render command vocabulary: minimal and closed for this milestone

**Decision**: Five commands cover every shipped action — `clear`, `drawCamera`, `fillScreen`,
`drawCircles`, `drawPolyline`. Each carries only geometry, colour, alpha, and blend mode.

**Rationale**: The vocabulary should be as small as the actions require, because every command is a
commitment a future renderer must honour. Screen flash and background wash are both `fillScreen` with
different colour, alpha, and duration curves — which is itself evidence the vocabulary is at the right
level of abstraction. Particles are `drawCircles` (batched, one command for the whole burst, so a
60-particle effect is one command rather than sixty). Trails are `drawPolyline`.

**Alternatives considered**:

- *A general "draw arbitrary path" command.* Rejected: it would let actions smuggle rendering logic
  into data and make an alternative renderer's job unbounded.
- *One command per action type.* Rejected: couples the vocabulary to the action set, so adding an
  action would force a renderer change — exactly what FR-073 forbids.

---

## D8 — Action registry with declared parameter metadata

**Decision**: Action types register a descriptor carrying an identifier, a behaviour class
(instantaneous / duration-based / continuous), a typed parameter schema with defaults, and an
`update(context) → commands` function. The scheduler and renderer know nothing about specific types.

**Rationale**: FR-071–FR-073 require extension without a central switch, and FR-072 requires enough
metadata for a future editor to generate controls. Declaring the parameter schema alongside the
behaviour is what makes both true at once and costs nothing now — the same schema validates the
catalog at load (FR-045), which is work that had to happen regardless. This is the single decision
that keeps the future editor reachable, and it earns its place today by doing validation.

**Alternatives considered**:

- *Switch on action type in the runtime.* Rejected: prohibited by FR-071 and by the constitution's
  data-not-code-paths rule.
- *Registry without parameter metadata.* Rejected: the editor would then need hardcoded per-action
  knowledge, which is precisely the rewrite FR-072 exists to prevent.
- *A full schema library (Zod, etc.).* Rejected as an unjustified dependency; the schema needs
  primitives, colours, enums, and asset references, and hand-rolled validation of that is small.

---

## D9 — Anchors resolved centrally, never by actions

**Decision**: Anchors are data (`screen` | `handCentroid` | `landmark`), resolved once per frame by a
shared resolver against the current `LandmarkFrame`, and handed to actions already resolved.

**Rationale**: FR-060 forbids an action from containing its own code to find a hand. Resolving
centrally also means a new anchor kind benefits every existing action with no change to any of them,
and it gives one place to define the documented behaviour when an anchor cannot be resolved (FR-061)
— rather than each action inventing its own fallback.

**Unresolvable anchor behaviour**: the action holds its last resolved position; if it never resolved
one, the action is skipped for that frame and the condition is reported in debug mode.

---

## D10 — Pose metadata derived from the dataset, not from Capture's catalog

**Decision**: The exemplar export derives `pose_id`, `display_name`, and `required_hands` **from the
pose-sample JSON itself**. `required_hands` is the per-pose hand count observed across its samples.
Web never reads `apps/capture/assets/config/pose_catalog.json`.

**Rationale**: This began as a boundary problem. The browser needs each pose's hand requirement to
apply the eligibility rule, but that field exists only in Capture's configuration — and reaching into
another application's tree is forbidden. Rather than weaken the boundary, the design derives the fact
from the sanctioned contract: the dataset JSON carries `display_name` on every sample and the hand
count is directly observable.

**Verified**: derivation matches Capture's catalog for **17 of 17** eligible poses, and the observed
hand count is perfectly uniform within every pose (no sample disagrees with its pose's requirement).
The derived value is therefore not a heuristic that usually works — it is the same fact, read from the
source that actually governs matching.

**Alternatives considered**:

- *Read Capture's catalog.* Rejected: constitutional violation, and it would make Web fail whenever
  Capture reorganized its assets.
- *Duplicate a catalog inside `apps/web/`.* Rejected: a second hand-maintained definition of hand
  requirements is exactly the drift the schema contract exists to prevent.

**Note for the user, not acted upon**: the working tree contains an uncommitted change to
`domain_expansion.required_hands` (2 → 1) whose description still reads "Both hands forming a wide
circle". `domain_expansion` is excluded from Web regardless (1 sample), so this has no effect here,
but it looks like an inconsistency worth checking in Capture.

---

## D11 — Active pose set: a runtime input, nothing more

**Decision**: The active pose set is a list of pose identifiers in session configuration, applied as a
filter on candidate eligibility. Default: **`hi`, `peace`, `tp`** (one-handed) and **`dragon`**
(two-handed).

**Rationale**: FR-024a–FR-024d. Restricting candidates is the only sanctioned way to make the 0.5
confidence floor achievable without touching it, and FR-028 forbids touching it. The default set was
chosen for mutual visual distinctness — an open palm, two raised fingers, a distinct one-handed sign,
and one interlocked two-handed pose. Choosing a *single* two-handed pose deliberately avoids the
near-identical interlocks (`ram`, `rat`, `ox`, `tiger`) competing with one another, which is the
scenario that would keep the ambiguity margin permanently tripped.

Deliberately **not** built: any grouping type, any "experience" concept, any per-set effect ownership.
FR-024d places that out of scope, and a list of strings in configuration forecloses nothing.

**Consequence that must be documented, not hidden**: softmax normalizes across the candidate set, so
**a confidence value is only meaningful relative to the active set that produced it**. 0.7 with four
active poses is not the same claim as 0.7 with seventeen. The algorithm is unchanged — this is a
property of softmax, not a modification of it — but the debug overlay must show the active set
alongside any confidence (FR-024c), or a reader will draw a false conclusion from a number.

---

## D12 — Capability gating for `person_visibility`

**Decision**: A capability registry maps capability identifiers to availability. `person_visibility`
is declared and **unavailable**. An action requiring an unavailable capability produces no commands,
is recorded as skipped-with-reason, and is surfaced in the debug overlay.

**Rationale**: FR-075–FR-078. The purpose is to make the *gap* explicit rather than the feature
present: a reserved action that silently no-ops is worse than no action at all, because it looks like
a bug in the effect rather than a known absence. Introducing a segmentation dependency to support the
placeholder is explicitly forbidden and would be exactly backwards.

---

## D13 — Testing without a browser

**Decision**: Domain tests run under `vitest --environment node`. An architecture test suite asserts
the boundaries: `domain/` imports no browser global, no MediaPipe symbol, and no canvas API;
`presentation/` is the only place a drawing call appears; no pose identifier or effect name appears as
a literal in runtime source.

**Rationale**: This mirrors what Studio already does — its densest rules are asserted by plain pytest
with no display and no event loop, and the same split is why they are cheap to assert. Making the
architectural claims *executable* is what stops them from decaying: "the runtime does not draw" is a
sentence in a document until a test fails when it stops being true.

The literal-scan test is the direct enforcement of the constitution's data-not-code-paths rule and of
User Story 2's acceptance scenario 4.

---

## D14 — Enforcing "no persistence"

**Decision**: An automated test asserts application source references none of `localStorage`,
`sessionStorage`, `indexedDB`, `caches`, `showSaveFilePicker`, `toDataURL`, `toBlob`,
`captureStream`, `MediaRecorder`, or any upload path. The quickstart adds a manual verification of
storage and network activity.

**Rationale**: SC-010 and Principle II. A camera application is exactly where a "save your clip"
button appears later by accident, and a prose prohibition does not survive a future contributor. The
test names the specific APIs because that is what makes it enforceable rather than aspirational.

`toDataURL`/`toBlob`/`captureStream` are on the list even though they are canvas APIs rather than
storage APIs: they are the readback path by which imagery escapes, and the constitution's prohibition
is about imagery leaving memory, not about which API carries it.

---

## Resolved unknowns

| Technical Context field | Resolution |
|---|---|
| Language/Version | TypeScript 5.x, ES2022, `strict` — D13 |
| Primary Dependencies | `@mediapipe/tasks-vision` only — D2 |
| Storage | None; enforced by test — D14 |
| Testing | Vitest, node environment for the domain — D13 |
| Target Platform | Evergreen desktop browsers; `requestVideoFrameCallback` with fallback — D3 |
| Performance Goals | ~30 fps, ≤200 ms latency, measured not assumed — D3 |
| Constraints | Bundle ≤ 2 MB (574 KB actual) — D4; no source imports — D10 |
| Scale/Scope | 18 catalog / 17 eligible / 4 active by default — D11 |
