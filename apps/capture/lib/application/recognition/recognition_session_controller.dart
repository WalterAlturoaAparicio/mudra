/// Runs the frame-processing pipeline: score → confidence → gate → stability
/// → confirmation. The only thing permitted to advance recognition state,
/// exactly as `CameraSessionController` is the only thing permitted to open or
/// close a camera.
///
/// Pure Dart, synchronous, and side-effect-free with respect to anything but
/// its own held [StabilityState] — no I/O, no camera access, no dataset
/// access. Fully testable on the host with a `FakeClock` and a scripted
/// [PoseMatcher]/exemplar set.
library;

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/domain/recognition/softmax.dart';
import 'package:capture/domain/recognition/stability.dart';
import 'package:capture/shared/config/recognition_config.dart';

/// Owns the recognition pipeline for one recognition-screen visit.
class RecognitionSessionController {
  /// Creates a controller over [matcher], scoring against [catalog].
  RecognitionSessionController({
    required PoseMatcher matcher,
    required PoseCatalog catalog,
    required Clock clock,
    required RecognitionConfig config,
  })  : _matcher = matcher,
        _catalog = catalog,
        _clock = clock,
        _config = config;

  final PoseMatcher _matcher;
  final PoseCatalog _catalog;
  final Clock _clock;
  final RecognitionConfig _config;

  Map<String, List<Exemplar>> _exemplarsByPose = const {};
  StabilityState _stability = StabilityState.idle;

  /// Current stability state, for the continuously-updating indicator
  /// (FR-015) — read between frames, not only at confirmation.
  StabilityState get stability => _stability;

  /// The exemplars this session is matching against; set once per screen
  /// entry via `ExemplarSource.load()`, before frames start arriving.
  void loadExemplars(ExemplarLoadResult loaded) {
    _exemplarsByPose = loaded.exemplarsByPose;
  }

  /// Resets stability without discarding the loaded exemplars — used when the
  /// caller wants a clean slate (e.g. after reloading exemplars) without a
  /// full controller replacement.
  void resetStability() => _stability = StabilityState.idle;

  /// Processes one canonical frame end to end.
  ///
  /// Returns the frame's [RecognitionResult] and a [ConfirmationEvent] when
  /// this is the frame that reaches the stability duration — `null`
  /// otherwise.
  (RecognitionResult, ConfirmationEvent?) process(LandmarkFrame frame) {
    final result = _classify(frame);
    final confirmation = _advanceStability(result);
    return (result, confirmation);
  }

  RecognitionResult _classify(LandmarkFrame frame) {
    final began = _clock.nowUtc();
    Duration latency() => _clock.nowUtc().difference(began);

    if (frame.hands.isEmpty) {
      return NoHandDetected(
        latency: latency(),
        frameTimestamp: frame.timestampMicros,
      );
    }

    final raw = _matcher.score(frame, _exemplarsByPose, _catalog);
    if (raw.isEmpty) {
      return Unrecognized(
        topCandidates: const [],
        latency: latency(),
        frameTimestamp: frame.timestampMicros,
      );
    }

    final distances = [for (final c in raw) c.distance];
    final confidences = softmaxConfidence(
      distances,
      temperature: _config.softmaxTemperature,
    );
    final scored = <Candidate>[
      for (var i = 0; i < raw.length; i++) raw[i].withConfidence(confidences[i]),
    ]..sort((a, b) => b.confidence.compareTo(a.confidence));
    final top3 = scored.length > 3 ? scored.sublist(0, 3) : scored;

    if (top3.first.confidence < _config.confidenceFloor) {
      return Unrecognized(
        topCandidates: top3,
        latency: latency(),
        frameTimestamp: frame.timestampMicros,
      );
    }
    if (top3.length > 1 &&
        (top3[0].confidence - top3[1].confidence) < _config.ambiguityMargin) {
      return Ambiguous(
        topCandidates: top3,
        latency: latency(),
        frameTimestamp: frame.timestampMicros,
      );
    }
    return Recognized(
      topCandidates: top3,
      latency: latency(),
      frameTimestamp: frame.timestampMicros,
    );
  }

  /// Applies data-model.md's stability transition rule: any result other than
  /// `Recognized` of the *same* pose resets immediately (FR-016); reaching
  /// the configured duration confirms exactly once per continuous hold
  /// (FR-017/FR-018).
  ConfirmationEvent? _advanceStability(RecognitionResult result) {
    if (result is! Recognized) {
      _stability = StabilityState.idle;
      return null;
    }

    final poseId = result.predictedPoseId;
    if (_stability.predictedPoseId != poseId) {
      _stability = StabilityState(predictedPoseId: poseId, heldSince: _clock.nowUtc());
      return null;
    }

    if (_stability.confirmedAt != null) {
      // Already confirmed this hold; no repeat until it breaks and restarts.
      return null;
    }

    final now = _clock.nowUtc();
    if (_stability.heldDuration(now) >= _config.stabilityDuration) {
      _stability = StabilityState(
        predictedPoseId: poseId,
        heldSince: _stability.heldSince,
        confirmedAt: now,
      );
      return ConfirmationEvent(poseId: poseId, confirmedAt: now);
    }
    return null;
  }
}
