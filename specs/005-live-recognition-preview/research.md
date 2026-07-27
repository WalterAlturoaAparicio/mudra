# Phase 0 Research: Phase 2.75 — Live Recognition Preview

**Feature**: 005-live-recognition-preview | **Date**: 2026-07-26

Ten decisions, each with the alternatives rejected. The recurring constraint behind nearly all of
them: the milestone's own instruction to "choose the simplest architecture that works well with
our normalized landmark representation" — not the most sophisticated one, and never a learned
one, per the constitution's Phase 2.75 exception (v1.4.0).

---

## D1 — Matching algorithm: weighted Euclidean, 1-nearest-neighbor

**Decision**: for a live hand's normalized landmark vector, compute a per-landmark-weighted
squared Euclidean distance to every eligible exemplar of the same handedness; the single closest
exemplar's pose is the prediction (1-NN). Fingertip landmarks (indices 4, 8, 12, 16, 20) carry a
higher weight than palm/wrist landmarks.

**Rationale**: the milestone named four candidate families — KNN, Weighted Euclidean Distance,
Cosine Similarity, Procrustes Alignment — and asked for the simplest one that works well against
`translation_scale`-normalized landmarks. Those landmarks are already translation- and
scale-invariant (that is what the normalizer does); what is left to handle is *shape* difference,
which a per-point spatial distance measures directly and interpretably. Weighting fingertips more
heavily reflects that fingertip position is what differentiates most hand poses from each other,
while palm/wrist points (already close to the normalization origin) vary less and would otherwise
dilute the distance with noise.

1-NN over a small-k vote: the simplest version of "simplest that works" is a single comparison,
not an aggregation rule. The dataset's own recorded variety (many samples per pose, per FR-006's
minimum count) is what gives one nearest neighbor enough robustness — a k-NN vote is one line
away behind the same `PoseMatcher` interface (research D none needed — it is a parameter of the
same strategy) if 1-NN proves noisy once real data is available; nothing about the domain
boundary changes if that substitution happens.

**Alternatives considered**:

- *Procrustes alignment* — solves for the optimal rotation (and sometimes scale) before measuring
  distance. Rejected on both fit and cost: `translation_scale` already removes translation and
  scale, so only rotation alignment would be added, and MediaPipe hand landmarks are 3-D, making a
  per-comparison rotation solve (effectively a small SVD) meaningfully more expensive than a
  vector subtraction — at up to 5,000 exemplars compared per frame under a 200ms budget (SC-002,
  SC-007), that cost adds up in exactly the wrong place. It is also more than the dataset likely
  needs: normal in-plane wrist rotation across many recorded takes is already represented by
  *different exemplars*, not by a single exemplar needing to be rotated to match.
- *Cosine similarity over the flattened vector* — treats the 63 (21 × 3) coordinates as one
  undifferentiated high-dimensional point. It has no natural per-landmark weighting scheme (angle
  between two 63-D vectors does not decompose cleanly per landmark the way a spatial distance
  does), and is less interpretable for landmark data, where "how far apart are these two
  fingertips" is a meaningful, debuggable quantity and "what is the cosine of these two 63-D
  vectors" is not.
- *k-NN majority vote (k > 1)* — a reasonable middle ground, deferred rather than rejected: it
  adds one parameter (k) and a voting rule for a robustness benefit that is unproven without real
  collected data. Recorded as the first fallback to try if 1-NN turns out unstable in practice,
  requiring no interface change.

---

## D2 — Two-handed poses: per-hand comparison, not one flattened vector

**Decision**: compare a live left hand only against exemplar entries whose stored handedness is
left, and a live right hand only against entries whose stored handedness is right. A two-handed
pose's combined distance is the sum of its two hands' distances to the same sample's corresponding
hand entries. A two-handed pose is eligible as a candidate only when both hands are present in the
live frame (mirroring `required_hands`, specification 003 FR-002/FR-019a). A one-handed pose is
matched **hand-agnostically**: either live hand may be compared against its exemplars.

**Rationale**: specification 003's canonical conversion (R1, FR-053/FR-054) already guarantees
every stored hand's handedness label names the correct physical hand, regardless of which lens
recorded it. That resolved identity is exactly what makes per-hand comparison meaningful instead
of arbitrary — comparing "this live left hand" against "that exemplar's left-hand entry" is a
like-for-like comparison the dataset itself already makes possible. Concatenating both hands into
one vector before comparing would conflate hand identity with the distance measure, and would
break for a live frame with only one hand present (which a concatenated vector has no way to
represent without inventing missing data).

**Alternatives considered**: *flattening both hands into a single vector per sample* — rejected
above; also fails the moment the pose's real-world recording had zero, one, or two hands sampled
inconsistently across takes, which the per-hand approach handles for free by simply requiring the
declared count to be present.

---

## D3 — Confidence: softmax over negative distances

**Decision**: `confidence[pose] = softmax(−distance[pose])` across every eligible candidate for
the current frame; the top confidence is the prediction, the next two are the remaining top-3.

**Rationale**: raw distances are not comparable across poses of different intrinsic shape
complexity — a pose whose exemplars are naturally more spread out would always report "worse"
raw distances than a tight one, even when both are being matched equally well. Softmax turns
distances into a bounded, normalized distribution that sums to 1 across candidates, which is what
makes "confidence" mean the same thing everywhere in the UI (FR-010) and what makes a top-3 list
meaningful (it is a ranked slice of one real distribution, not three unrelated numbers). A single
temperature constant (how sharply softmax separates close distances) is the only new parameter
this introduces, and it is `RecognitionConfig` data (Principle V), tuned once against recorded
data rather than fixed here.

**Alternatives considered**: *`confidence = 1 / (1 + distance)`* — simpler, but produces values
that are not comparable across frames with different candidate sets (a frame with three
candidates and a frame with twelve would not report confidences on the same footing), which
undermines FR-010's requirement that confidence mean the same thing for every pose in the catalog.

---

## D4 — The confidence floor and the ambiguity margin are two separate gates

**Decision**: a prediction counts as real only when (a) the top confidence clears a configured
floor, **and** (b) the gap between the top and second-place confidence clears a configured
margin. Failing either produces "not confident" or "ambiguous" (FR-013) instead of a shaky top-1,
and neither state contributes to stability (FR-016).

**Rationale**: these are different failure modes and collapsing them into one threshold would
hide which one is happening, which matters for the dataset-debugging purpose (User Story 3): a
low top confidence usually means the pose itself is under-represented or the shape is genuinely
far from anything recorded, while a small top-vs-second margin usually means two *specific* poses
are being confused with each other — a much more actionable signal for deciding what to record
more of.

**Alternatives considered**: *a single confidence threshold* — simpler, but conflates "nothing
matches well" with "two things match almost equally well," which are different problems with
different fixes.

---

## D5 — Minimum exemplar threshold: 20 samples per pose, reusing an existing benchmark

**Decision**: a pose with fewer than `RecognitionConfig.minExemplarsPerPose` (default **20**)
stored samples is excluded from matching entirely and reported as not yet recognizable (FR-006).

**Rationale**: rather than picking an arbitrary number, this reuses specification 003's own
SC-002 — "a single Record press yields at least 20 stored samples" — as the floor. Below that
volume, a pose has not even received the benefit of one full press's worth of natural variation
(hand micro-movement, slightly different framing), which is the reasoning basis 1-NN's simplicity
depends on (D1). The number is configuration, not a literal at a call site, and can be revised once
real recognition-stability data exists.

**Alternatives considered**: *a fixed absolute number unrelated to existing benchmarks* (e.g. 5,
50) — either number is defensible in isolation, but reusing SC-002 keeps one fewer arbitrary
constant in the project and ties this threshold to a number the team has already reasoned about
and validated in practice.

---

## D6 — Exemplars are read fresh every screen entry, never cached across restarts

**Decision**: `FileExemplarSource` scans the dataset via the existing `FileSampleRepository`
exactly once per screen visit and builds `Exemplar`s from what it finds; nothing is persisted or
cached between app runs.

**Rationale**: the dataset changes whenever the contributor uses Capture's Record flow, and the
whole point of this feature is validating *the current state* of that dataset. A cache would risk
showing recognition behavior for a dataset that no longer exists, which is actively harmful for a
debugging tool. Re-scanning is cheap: reading and parsing a few thousand small JSON files once at
screen entry is well within the responsiveness budget (SC-007), unlike doing it per frame, which
D1 avoids by building the exemplar set once and reusing it for the whole recognition session.

**Alternatives considered**: *a persisted exemplar index, invalidated on dataset change* — adds a
second source of truth and an invalidation problem for a read that is already cheap to redo from
scratch; rejected as unneeded complexity, the same reasoning specification 003 itself used to
reject a SQLite sample index (research D6 there).

---

## D7 — Stability is driven by the clock, not by frame count

**Decision**: `StabilityState` measures how long the *same* prediction has remained confident and
unambiguous using the injected `Clock` port (the same one `RunRecordingSession` already depends
on), not by counting consecutive frames.

**Rationale**: frame rate varies by device and by how busy the matcher is at a given moment;
measuring by wall-clock duration is what makes "stable for 3 seconds" mean the same 3 seconds on
every phone, and what makes the stability logic testable with a `FakeClock` exactly the way
countdown logic already is (specification 003, `FakeClock` / `ManualSessionTicker`). A changed
prediction, a confidence-floor or margin failure, or the loss of a detected hand resets the held
duration to zero immediately (FR-016) — there is no partial credit and no decay curve to tune.

**Alternatives considered**: *counting consecutive qualifying frames* — simpler to implement
naively, but ties "3 seconds" to a frame rate that varies by device and by matcher load, which
would make the stability duration mean something different on different phones — directly
undermining SC-004's "confirmation never fires before the configured duration has elapsed"
guarantee as a cross-device promise.

---

## D8 — Effects: a small set of parameterized kinds, described by data

**Decision**: a fixed, small set of `EffectKind`s (a glow, a sprite pair anchored near the hand
landmarks, a particle burst, a fade-with-lines) are implemented once as parameterized
`CustomPainter`s. `assets/config/effect_catalog.json` maps each `pose_id` to one `EffectKind` plus
parameters (color, sprite asset path, intensity), mirroring `assets/config/pose_catalog.json`
exactly. A pose absent from the file plays `EffectKind.genericConfirm`.

**Rationale**: eighteen catalog poses do not need eighteen bespoke painters. The milestone's own
examples cluster into a handful of visual families (ear/feature overlays: horse, dog, bird; a
color treatment: snake, dragon; a transition: tp) — a handful of parameterized kinds covers all of
them and any future pose without new code, exactly the same "configuration, not code" discipline
specification 003 already applies to reference images (FR-005) and this plan applies to the pose
catalog itself. Positioning from live, canonical hand-landmark coordinates — mapped through the
same screen-space transform `PreviewStage` already uses for the camera texture — means an effect
is anchored to the same geometry the contributor is watching, with no second coordinate system to
keep in sync.

**Alternatives considered**: *one bespoke widget per pose* — more expressive per effect, but
eighteen (and growing) hand-authored widgets is exactly the kind of per-item code branching
Principle I and the pose-catalog precedent both argue against; it would also make "add a themed
effect" a Dart change instead of a JSON edit, contradicting FR-019 directly.

---

## D9 — The camera seam is reused exactly, not re-abstracted

**Decision**: the recognition preview acquires its camera through the same
`cameraSessionControllerProvider` (`Provider.autoDispose`) the capture screen already uses,
defaulting to the front lens, mirrored — the same shape as the Self Capture profile, without
needing Self Capture's countdown or take-confirmation settings, which are meaningless on a screen
that never records a take.

**Rationale**: R1 already solved camera lifecycle correctness once (the single-session invariant,
the request-token queue, `autoDispose` scoping via `ref.listenManual`); introducing a second
camera abstraction for this screen would either duplicate that work or risk two screens
disagreeing about who owns the camera. Defaulting to front/mirrored matches how a contributor
naturally uses a live-recognition demo — pointed at themselves, like a mirror — without
implying this screen needs Operator Capture's asymmetric lens/mirroring semantics, which exist to
solve a recording problem this screen does not have.

**Alternatives considered**: *a dedicated, simplified camera port for this screen* — would still
have to solve the exact same release-timing and single-session problems R1 already solved;
rejected as needless duplication of a boundary that already exists and already works.

---

## D10 — Catalog readiness is a byproduct of the exemplar load, not a second pass

**Decision**: `LoadExemplars` already counts, per pose, how many qualifying samples it found while
building exemplars; `CatalogReadiness` is simply that count compared against
`minExemplarsPerPose`, surfaced as a ready/not-ready list (FR-024).

**Rationale**: the data needed for "which poses are recognition-ready" is a strict subset of the
data already read to build exemplars in the first place — computing it separately would mean
scanning the dataset twice for information the first scan already has.

**Alternatives considered**: none seriously considered; this is a direct simplification once D6
established that exemplars are read fresh via one full scan per screen entry.

---

## Open risks

| Risk | Impact | Mitigation |
|---|---|---|
| 1-NN proves noisy against real (not yet collected) recognition-stability data | Prediction flickers between similar poses even when performed correctly | D1's fallback (small-k weighted vote) is a parameter change behind the same `PoseMatcher` interface, not a redesign |
| Fingertip-weighting values are unvalidated until tested against the real dataset | Distance measure may under- or over-emphasize certain landmarks | Weights are `RecognitionConfig` data (Principle V); tuned during implementation against recorded samples, not fixed by this plan |
| Comparing against up to 5,000 exemplars per frame may not hold the 200ms budget on low-end hardware | SC-002/SC-007 miss their targets | The per-comparison cost is a handful of subtractions and squares (no allocation, no rotation solve, per D1); if needed, comparison can be parallelized across an isolate or the exemplar set pre-filtered by hand count before scoring, without changing the matcher's interface |
| The six milestone-named poses' effects are authored first; the other twelve rely on the generic fallback | The demo looks less complete for unthemed poses at first | Explicitly scoped in spec Assumptions; authoring more is a JSON edit (D8), not a plan change |
