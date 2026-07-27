# Contract: Recognition Domain Interfaces

**Feature**: 005-live-recognition-preview | **Date**: 2026-07-26

This feature adds no network API and no new platform channel — it reuses specification 003's
camera seam exactly (research D9). Its own contracts are the **domain-owned ports** that keep
matching, exemplar loading, and effect resolution replaceable and host-testable, following the
same pattern specification 003's `contracts/interfaces.md` already established. All ports live in
`lib/domain/ports/`; implementations live in `lib/infrastructure/` and are injected at the
composition root.

---

## `PoseMatcher` — the recognition strategy, pluggable (Principle III)

```dart
abstract interface class PoseMatcher {
  /// Scores [frame]'s hands against [exemplars], returning one Candidate per
  /// eligible pose, unsorted.
  ///
  /// A pose is eligible only when [frame] carries at least the hand count that
  /// pose's declaration in the catalog requires (FR-009). Pure and
  /// deterministic: the same frame and the same exemplar set always produce
  /// the same candidates.
  List<Candidate> score(LandmarkFrame frame, List<Exemplar> exemplars);
}
```

**Contract**: never mutates `frame` or `exemplars`; never allocates state that persists across
calls (no running average, no memory of previous frames — that is `StabilityState`'s job, one
layer up). Raises nothing for an empty exemplar list or a handless frame; both simply produce an
empty candidate list, which the caller turns into `RecognitionResult.NoHandDetected` or
`Unrecognized`.

**Implementation**: `WeightedEuclideanNearestNeighborMatcher` (research D1/D2) — the Phase 2.75
strategy. A different deterministic strategy (a small-k vote, a different distance measure) is a
new implementation of this same interface, with no change to anything that calls it; this is the
concrete realization of Principle III's "similarity matching... as a pluggable strategy behind a
stable interface."

---

## `ExemplarSource` — read-only access to the existing dataset

```dart
abstract interface class ExemplarSource {
  /// Reads every currently-stored sample and returns one [Exemplar] per
  /// sample, grouped by pose, alongside a per-pose sample count for
  /// [CatalogReadiness] (research D10) — one full read, not two.
  Future<ExemplarLoadResult> load();
}

class ExemplarLoadResult {
  const ExemplarLoadResult({required this.exemplars, required this.readiness});
  final Map<String, List<Exemplar>> exemplars;   // keyed by pose_id
  final CatalogReadiness readiness;
}
```

**Contract**: read-only — `ExemplarSource` MUST NOT write, delete, or modify any sample or
session record (FR-004). Called once per screen entry (research D6); the recognition screen holds
the result for its own lifetime rather than calling this per frame.

**Implementation**: `FileExemplarSource`, reading through the same `FileSampleRepository` /
dataset root specification 003 already owns. No new storage location, no new file format.

---

## `EffectCatalogSource` — data-driven effect definitions

```dart
abstract interface class EffectCatalogSource {
  /// Returns the effect for [poseId], or the generic fallback if none is
  /// authored (FR-020) — never null, so callers never branch on absence.
  EffectDefinition effectFor(String poseId);
}
```

**Contract**: loads and validates `assets/config/effect_catalog.json` once at construction,
mirroring `PoseCatalogSource`'s validate-once-at-the-boundary contract exactly (specification 003,
`contracts/interfaces.md`). A malformed file fails loudly at startup, naming the offending entry —
the same "a config error is a developer error, not a runtime condition to paper over" rule.

**Implementation**: `AssetEffectCatalogSource` — see
[effect-catalog.md](./effect-catalog.md) for the file format.

---

## `RecognitionSessionController` — application-layer owner, not a port

Not injected as a domain port; the only thing permitted to run the frame-processing pipeline
(data-model.md's diagram) end to end, exactly as `CameraSessionController` is the only thing
permitted to open or close a camera.

```dart
class RecognitionSessionController {
  RecognitionSessionController({
    required PoseMatcher matcher,
    required PoseCatalog catalog,
    required Clock clock,
    required RecognitionConfig config,
  });

  /// The exemplars this session is matching against; set once per screen
  /// entry via [ExemplarSource.load] before frames start arriving.
  void loadExemplars(ExemplarLoadResult loaded);

  /// Processes one canonical frame: scores it, applies the confidence floor
  /// and ambiguity margin, updates stability, and returns both the frame's
  /// [RecognitionResult] and a [ConfirmationEvent] when this frame is the one
  /// that reaches the stability duration.
  (RecognitionResult, ConfirmationEvent?) process(LandmarkFrame frame);

  /// Current stability state, for the continuously-updating indicator
  /// (FR-015) — read between frames, not only at confirmation.
  StabilityState get stability;
}
```

**Contract**: `process` is synchronous and pure with respect to its inputs plus the controller's
own held `StabilityState` — no I/O, no camera access, no dataset access. It is called once per
frame the camera seam delivers, on the same frame stream `CameraSessionController.frames` already
exposes (research D9) — this feature adds no second camera subscription.

---

## Error types

| Failure | Raised when | Handled by |
|---|---|---|
| `ExemplarLoadFailure` | The dataset cannot be read (storage error) | Screen shows a plain-language message with retry; consistent with specification 003's `RepositoryFailure` handling |
| `EffectCatalogFailure` | `effect_catalog.json` is malformed | Startup error naming the offending entry, mirroring `CatalogFailure` |

No new `CameraFailure` variants — camera errors on this screen are handled exactly as they are on
the capture screen (specification 003, `contracts/camera-channel.md`), because the camera seam is
reused unchanged (research D9).
