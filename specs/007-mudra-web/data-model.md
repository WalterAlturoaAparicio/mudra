# Phase 1 — Data Model: Mudra Web

**Feature**: `007-mudra-web` | **Date**: 2026-08-20

Every type below is an immutable value object with typed fields (constitution Principle IV, web
standards subsection). Types in §1–§5 live in `domain/` and import nothing from the browser.

---

## 1. Landmark layer

### `Handedness`
`'left' | 'right' | 'unknown'`. Names the user's **physical** hand. Correct without adjustment because
the detector receives an already-mirrored image (research D1).

### `Landmark`
| Field | Type | Notes |
|---|---|---|
| `x`, `y` | `number` | Normalized to `[0,1]` in mirrored frame space |
| `z` | `number` | Relative depth; participates in distance, never in drawing |

### `HandLandmarks`
| Field | Type | Validation |
|---|---|---|
| `points` | `readonly Landmark[]` | **Exactly 21**; rejected at construction otherwise |

### `HandObservation`
`handedness`, `confidence` (`[0,1]`, the handedness classification score), `landmarks`.

### `LandmarkFrame`
| Field | Type | Notes |
|---|---|---|
| `hands` | `readonly HandObservation[]` | 0–2. **Emitted even when empty** (FR-015) |
| `timestampMs` | `number` | Monotonic |
| `width`, `height` | `number` | Source surface size, for anchor resolution |

**Topology constants**: `HAND_LANDMARK_COUNT = 21`, `WRIST = 0`, `MIDDLE_FINGER_MCP = 9`,
`FINGERTIPS = [4, 8, 12, 16, 20]`, `HAND_CONNECTIONS` (21 edges, used verbatim for debug drawing).

---

## 2. Normalization

Pure function `normalize(hand) → HandLandmarks`:

```
origin = points[WRIST]
span   = |points[MIDDLE_FINGER_MCP] − origin|      (3-D Euclidean)
if span < 1e-9: span = 1                            (degenerate hand: translate only)
result[i] = (points[i] − origin) / span
```

The wrist lands exactly on `(0,0,0)`. Verified against Engine at `1e-9` (research D5).

---

## 3. Recognition

### `Exemplar`
| Field | Type | Why it exists |
|---|---|---|
| `poseId` | `string` | Which pose this references |
| `sampleId` | `string` | **Required** to keep a two-handed pair from the same original take |
| `handedness` | `Handedness` | Like-for-like pairing in two-handed matching |
| `landmarks` | `HandLandmarks` | Normalized; never recomputed in the browser |

### `LandmarkWeights`
21 values. Default: **wrist `0.5`**, **fingertips `2.0`**, **all others `1.0`**. The wrist is the
normalization origin and therefore carries the least shape information; fingertips carry the most.

### `PoseEntry`
`poseId`, `displayName`, `requiredHands` (1 or 2), `exemplarCount`. Derived from the dataset (D10).

### `Candidate`
`poseId`, `distance` (raw weighted), `confidence` (filled one layer up, once every candidate's
distance is known — softmax cannot normalize one at a time).

### Matching rules

- **Eligibility**: pose is in the active set **and** `frame.hands.length >= requiredHands`.
- **One-handed** — hand-agnostic: any live hand against any exemplar of that pose; lowest distance wins.
- **Two-handed** — like-for-like: live left vs exemplar left, live right vs exemplar right, and only
  against exemplars sharing a `sampleId`. Requires both hands present.
- **Combination**: the **mean** of the two hands' distances, never the sum, so a two-handed match sits
  on the same confidence scale as a one-handed one.
- **Distance**: `Σᵢ wᵢ · ((Δxᵢ)² + (Δyᵢ)² + (Δzᵢ)²)` — squared, not rooted (monotonic, so ranking is
  identical and the square root is wasted work).

### `RecognitionOutcome`
Discriminated union — the consumer cannot observe an undefined state:

| Variant | Meaning | Feeds stability? |
|---|---|---|
| `NoHandDetected` | Frame had zero hands | No — resets |
| `Unrecognized` | Top confidence `< 0.5` | No — resets |
| `Ambiguous` | Top-to-second gap `< 0.12` | No — resets |
| `Recognized` | Both gates passed | **Yes** |

All variants carry `topCandidates` (≤3, ranked), `latencyMs`, `frameTimestamp`.

### Confidence
`softmax(−distance / temperature)` across **eligible** candidates, max-subtracted for numerical
stability.

> **Property, not a modification** (research D11): softmax normalizes across the candidate set, so a
> confidence value is meaningful **only relative to the active set that produced it**. The formula,
> thresholds, and weights are unchanged; the debug overlay must display the active set alongside any
> confidence (FR-024c).

---

## 4. Events

### `HoldState`
`poseId | null`, `heldSince | null`, `confirmedAt | null`.

**The rule that governs this type**: any outcome other than `Recognized` *of the same pose* resets it.
Confirmation is therefore always relative to one continuous, uninterrupted hold.

- `progress(now, target) → [0,1]` — drives the visible build-up (FR-035/FR-088)
- `readyToConfirm` — held ≥ target **and** `confirmedAt === null`

### `PoseEvent`
| Field | Type |
|---|---|
| `kind` | `'entered' \| 'held' \| 'confirmed' \| 'exited'` |
| `poseId` | `string` |
| `confidence` | `number` |
| `atMs` | `number` |
| `progress` | `number` — `[0,1]` |

### Transitions

| Previous | Current outcome | Events emitted |
|---|---|---|
| idle | `Recognized(P)` | `entered(P)` |
| holding P | `Recognized(P)`, not yet confirmed | `held(P)` |
| holding P | `Recognized(P)`, reached **1.0 s** | `confirmed(P)` — **exactly once** |
| holding P (confirmed) | `Recognized(P)` still | `held(P)` only — never a second `confirmed` |
| holding P | `Recognized(Q)`, Q ≠ P | `exited(P)`, `entered(Q)` |
| holding P | anything else | `exited(P)` |

Timing is **elapsed wall-clock**, never frame count (FR-036). The clock is injected, so tests are
deterministic.

---

## 5. Effects

### `EffectDefinition`
`id`, `name`, `trigger`, `timeline`.

### `Trigger`
`on` (a `PoseEvent.kind`), `poseId`, `conditions: readonly Condition[]`.

### `Condition`
| Type | Parameters |
|---|---|
| `confidenceAtLeast` | `value` |
| `cooldown` | `ms` — since this effect last started |

Unknown condition types are rejected at load, never ignored (FR-045).

### `Timeline`
`durationMs`, `entries: readonly TimelineEntry[]`.

### `TimelineEntry`
| Field | Type | Notes |
|---|---|---|
| `atMs` | `number` | **Absolute** offset from effect start |
| `durationMs` | `number?` | Absent ⇒ instantaneous |
| `action` | `Action` | |

> `atMs` is absolute by requirement (FR-046/FR-047). A chain of relative delays would make moving one
> action silently reposition every later one — the operation a timeline editor performs constantly.

### `Action`
`type` (registry key), `params` (validated against the registered schema).

### `ActionBehaviour`
`'instantaneous' | 'duration' | 'continuous'`.

### `ActionDescriptor` — the registration record
| Field | Purpose |
|---|---|
| `type` | Registry key |
| `behaviour` | Scheduling class |
| `params` | Typed schema: name, kind (`number`/`color`/`enum`/`asset`/`anchor`), default, range |
| `requiresCapability` | Optional capability identifier |
| `update(ctx) → RenderCommand[]` | Produces commands; **never draws** |

`params` serves two purposes at once: it validates the catalog at load, and it is the metadata a
future editor reads to generate controls without knowing the action (FR-072).

### `Anchor`
`{ kind: 'screen', x, y }` | `{ kind: 'handCentroid', hand }` | `{ kind: 'landmark', hand, index }`.
Resolved centrally per frame; actions receive a resolved point (FR-060).

### `AssetReference`
A logical identifier, `@audio/…` or `@image/…`, resolved through a manifest. Physical locations may
change with no effect definition changing (FR-062/FR-063).

### `ActivePoseSet`
`readonly string[]` in session configuration. A **candidate-set filter only** — it touches no
threshold, weight, or formula (FR-024b). Nothing groups it with effects; that abstraction is out of
scope (FR-024d).

---

## 6. Runtime output

### `RenderCommand` — the complete vocabulary
| Command | Payload |
|---|---|
| `clear` | — |
| `drawCamera` | `opacity` |
| `fillScreen` | `color`, `alpha`, `blend` |
| `drawCircles` | `points[]`, `radius[]`, `color`, `alpha` — one command per burst, not per particle |
| `drawPolyline` | `points[]`, `width`, `color`, `alpha` |

### `AudioCue`
`asset`, `volume`. Declarative — the runtime never calls `play()` (research D6).

### `FrameOutput`
`commands`, `audioCues`, `diagnostics` (skipped actions with reasons, unresolved anchors, active
playback count).

`diagnostics` is what makes FR-077 and FR-061 observable rather than aspirational.

---

## 7. Exemplar bundle

### `BundleManifest` (JSON)
`formatVersion`, `datasetFingerprint`, `generatedAt`, `normalization` (`{strategy, version}`),
`minSamples: 20`, `totalHands`, `poses[]` (`poseId`, `displayName`, `requiredHands`, `sampleCount`,
`handOffset`, `handCount`, `hands[]` → `{sampleId, handedness}`), and `excluded[]`
(`poseId`, `sampleCount`, `reason`).

`excluded[]` is mandatory: FR-023a forbids a pose disappearing silently. It currently carries exactly
one entry — `domain_expansion`, 1 sample, below the minimum of 20.

### Payload (binary)
`Float32Array`, `totalHands × 21 × 3`, `[x,y,z]` per landmark, hands in manifest order.
≈ **574 KB** for 17 poses.

### Populations
| Population | Count | Determined by |
|---|---|---|
| Catalog poses | **18** | Pose identities in the project |
| Eligible poses | **17** | ≥ 20 samples |
| Active poses | **4** by default | Runtime configuration |

Verified against the repository on 2026-08-20.

---

## 8. Validation summary

| Rule | Where enforced | Requirement |
|---|---|---|
| Exactly 21 landmarks | `HandLandmarks` construction | FR-014 |
| Confidence in `[0,1]` | Observation construction | FR-014 |
| Two-handed pair shares `sampleId` | Matcher | FR-022 |
| Mean, not sum | Matcher | FR-023 |
| Thresholds unmodified | Configuration + fixtures | FR-028 |
| One `confirmed` per hold | `HoldState.confirmedAt` | FR-034 |
| `atMs` absolute | `TimelineEntry` | FR-046 |
| Unknown action/condition rejected at load | Catalog validation | FR-045 |
| Unavailable capability → inert **and reported** | Registry + `diagnostics` | FR-077 |
| Pose excluded → reported with reason | `BundleManifest.excluded` | FR-023a, FR-085 |
| Bundle byte-identical from same dataset | Export script | FR-081 |
