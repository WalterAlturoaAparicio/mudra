/// Centralized, typed configuration for Phase 2.75 — Live Recognition Preview.
///
/// Every tunable this feature introduces lives here, alongside [CaptureConfig]
/// (constitution Principle V; no magic numbers at call sites).
library;

import 'package:capture/domain/recognition/exemplar.dart';

/// All tunable values for the recognition preview.
class RecognitionConfig {
  /// Creates a configuration, using the documented defaults for anything
  /// unset.
  RecognitionConfig({
    LandmarkWeights? landmarkWeights,
    this.minExemplarsPerPose = 20,
    this.confidenceFloor = 0.5,
    this.ambiguityMargin = 0.12,
    this.softmaxTemperature = 1.0,
    this.stabilityDurationSeconds = 3.0,
    this.targetLatencyMillis = 200,
  }) : landmarkWeights = landmarkWeights ?? LandmarkWeights.defaultWeights;

  /// The distance function's per-point weighting (research D1).
  final LandmarkWeights landmarkWeights;

  /// Below this many stored samples, a pose is excluded from matching
  /// entirely and reported not-ready (research D5). Reuses specification
  /// 003's own SC-002 ("at least 20 samples per press") rather than an
  /// arbitrary number.
  final int minExemplarsPerPose;

  /// Minimum top confidence to count as a real prediction (research D4).
  ///
  /// Tuned against real recorded data at implementation time (T066), not
  /// fixed by the specification.
  final double confidenceFloor;

  /// Minimum top-vs-second confidence gap to avoid "ambiguous" (research D4).
  ///
  /// Tuned against real recorded data at implementation time (T066).
  final double ambiguityMargin;

  /// How sharply softmax separates close distances (research D3).
  ///
  /// Tuned against real recorded data at implementation time (T066).
  final double softmaxTemperature;

  /// How long a prediction must hold before confirming, in seconds (FR-017).
  /// Defaults to the fast end of the milestone's named 3–5 s range.
  final double stabilityDurationSeconds;

  /// The latency budget FR-012/SC-002 hold the pipeline to, in milliseconds.
  final int targetLatencyMillis;

  /// [stabilityDurationSeconds] as a [Duration].
  Duration get stabilityDuration =>
      Duration(microseconds: (stabilityDurationSeconds * 1000000).round());

  /// [targetLatencyMillis] as a [Duration].
  Duration get targetLatency => Duration(milliseconds: targetLatencyMillis);
}
