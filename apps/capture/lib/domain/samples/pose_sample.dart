/// Pose-sample domain value objects.
///
/// These mirror the Mudra engine's persisted schema v1 exactly — see
/// `specs/003-mobile-pose-capture/contracts/sample-json.md`. They hold no JSON
/// knowledge: the wire format lives in the serializer, never here.
library;

import 'package:capture/domain/landmarks/landmarks.dart';

/// Current on-disk schema version. Shared contract with the engine; changing it
/// is a cross-application event, not a local decision.
const int sampleSchemaVersion = 1;

/// Identity of a reusable pose, as written into a sample.
class Pose {
  /// Creates a pose identity.
  const Pose({required this.poseId, this.displayName, this.description});

  /// The permanent internal key, matching `^[a-z0-9_]+$`.
  final String poseId;

  /// Optional human-facing label; never used as an identifier.
  final String? displayName;

  /// Optional free text describing the pose.
  final String? description;

  @override
  bool operator ==(Object other) =>
      other is Pose &&
      other.poseId == poseId &&
      other.displayName == displayName &&
      other.description == description;

  @override
  int get hashCode => Object.hash(poseId, displayName, description);
}

/// Per-hand summary carried in a sample's metadata block.
class HandMeta {
  /// Creates a per-hand metadata entry.
  const HandMeta({required this.handedness, required this.confidence});

  /// Which physical hand.
  final Handedness handedness;

  /// Handedness classification confidence.
  final double confidence;

  @override
  bool operator ==(Object other) =>
      other is HandMeta &&
      other.handedness == handedness &&
      other.confidence == confidence;

  @override
  int get hashCode => Object.hash(handedness, confidence);
}

/// One detected hand with both its raw and normalized landmark sets.
///
/// Persisting raw landmarks lets the normalization strategy change later
/// without re-recording anything.
class HandSample {
  /// Creates a hand sample.
  const HandSample({
    required this.handedness,
    required this.confidence,
    required this.raw,
    required this.normalized,
  });

  /// Which physical hand.
  final Handedness handedness;

  /// Handedness classification confidence.
  final double confidence;

  /// Exact detector output.
  final HandLandmarks raw;

  /// Normalizer output.
  final HandLandmarks normalized;

  @override
  bool operator ==(Object other) =>
      other is HandSample &&
      other.handedness == handedness &&
      other.confidence == confidence &&
      other.raw == raw &&
      other.normalized == normalized;

  @override
  int get hashCode => Object.hash(handedness, confidence, raw, normalized);
}

/// How a sample was normalized, recorded independently of the implementation.
class NormalizationInfo {
  /// Creates a normalization descriptor.
  const NormalizationInfo({required this.strategy, required this.version});

  /// Strategy name, e.g. `translation_scale`.
  final String strategy;

  /// Strategy version, e.g. `1.0`.
  final String version;

  @override
  bool operator ==(Object other) =>
      other is NormalizationInfo &&
      other.strategy == strategy &&
      other.version == version;

  @override
  int get hashCode => Object.hash(strategy, version);
}

/// When a capture was armed and when it actually fired.
///
/// [sessionUuid] is the additive field this application contributes to schema
/// v1: optional, inside the existing `capture` block, tolerated when absent, so
/// a reader that ignores it still reads every sample (FR-045/FR-052).
class CaptureTiming {
  /// Creates a capture-timing block.
  const CaptureTiming({
    required this.captureTime,
    this.countdownStartTime,
    this.countdownSeconds = 0.0,
    this.sessionUuid,
  });

  /// UTC ISO-8601 instant this frame was captured.
  final String captureTime;

  /// UTC ISO-8601 instant the countdown was armed, if there was one.
  final String? countdownStartTime;

  /// Configured countdown length in seconds.
  final double countdownSeconds;

  /// The capture session that produced this sample.
  final String? sessionUuid;

  @override
  bool operator ==(Object other) =>
      other is CaptureTiming &&
      other.captureTime == captureTime &&
      other.countdownStartTime == countdownStartTime &&
      other.countdownSeconds == countdownSeconds &&
      other.sessionUuid == sessionUuid;

  @override
  int get hashCode =>
      Object.hash(captureTime, countdownStartTime, countdownSeconds, sessionUuid);
}

/// Reproducibility context for a sample.
class SampleMetadata {
  /// Creates a metadata block.
  SampleMetadata({
    required this.timestamp,
    required this.cameraIndex,
    required this.cameraWidth,
    required this.cameraHeight,
    required this.applicationVersion,
    required this.numHands,
    required List<HandMeta> hands,
    this.mediapipeVersion,
    this.capture,
  }) : hands = List.unmodifiable(hands);

  /// UTC ISO-8601 capture instant (mirrors the sample's top-level timestamp).
  final String timestamp;

  /// Platform lens-facing constant: `0` back, `1` front (FR-044).
  final int cameraIndex;

  /// Analysis frame width the landmarks were computed from.
  final int cameraWidth;

  /// Analysis frame height the landmarks were computed from.
  final int cameraHeight;

  /// Detector version, e.g. `0.10.14`.
  final String? mediapipeVersion;

  /// Producing application, e.g. `mudra-capture/0.1.0`.
  final String applicationVersion;

  /// Number of hands in [hands].
  final int numHands;

  /// Per-hand summaries.
  final List<HandMeta> hands;

  /// Optional capture-timing block.
  final CaptureTiming? capture;

  @override
  bool operator ==(Object other) {
    if (other is! SampleMetadata) return false;
    if (other.hands.length != hands.length) return false;
    for (var i = 0; i < hands.length; i++) {
      if (other.hands[i] != hands[i]) return false;
    }
    return other.timestamp == timestamp &&
        other.cameraIndex == cameraIndex &&
        other.cameraWidth == cameraWidth &&
        other.cameraHeight == cameraHeight &&
        other.mediapipeVersion == mediapipeVersion &&
        other.applicationVersion == applicationVersion &&
        other.numHands == numHands &&
        other.capture == capture;
  }

  @override
  int get hashCode => Object.hash(
    timestamp,
    cameraIndex,
    cameraWidth,
    cameraHeight,
    mediapipeVersion,
    applicationVersion,
    numHands,
    Object.hashAll(hands),
    capture,
  );
}

/// The atomic dataset unit and the object the repository persists.
class PoseSample {
  /// Creates a pose sample.
  PoseSample({
    required this.pose,
    required this.sampleUuid,
    required this.timestamp,
    required this.normalization,
    required this.metadata,
    required List<HandSample> hands,
    this.schemaVersion = sampleSchemaVersion,
    this.sampleNumber = '',
  }) : hands = List.unmodifiable(hands);

  /// On-disk schema version.
  final int schemaVersion;

  /// The pose this sample is an example of.
  final Pose pose;

  /// Immutable global identity, minted at capture.
  final String sampleUuid;

  /// Zero-padded stem assigned by the repository, e.g. `sample_000023`.
  final String sampleNumber;

  /// UTC ISO-8601 capture instant.
  final String timestamp;

  /// How this sample was normalized.
  final NormalizationInfo normalization;

  /// Reproducibility metadata.
  final SampleMetadata metadata;

  /// One entry per detected hand, with raw and normalized landmarks.
  final List<HandSample> hands;

  /// Returns a copy carrying [sampleNumber], used when the repository assigns it.
  PoseSample withSampleNumber(String number) => PoseSample(
    pose: pose,
    sampleUuid: sampleUuid,
    timestamp: timestamp,
    normalization: normalization,
    metadata: metadata,
    hands: hands,
    schemaVersion: schemaVersion,
    sampleNumber: number,
  );

  @override
  bool operator ==(Object other) {
    if (other is! PoseSample) return false;
    if (other.hands.length != hands.length) return false;
    for (var i = 0; i < hands.length; i++) {
      if (other.hands[i] != hands[i]) return false;
    }
    return other.schemaVersion == schemaVersion &&
        other.pose == pose &&
        other.sampleUuid == sampleUuid &&
        other.sampleNumber == sampleNumber &&
        other.timestamp == timestamp &&
        other.normalization == normalization &&
        other.metadata == metadata;
  }

  @override
  int get hashCode => Object.hash(
    schemaVersion,
    pose,
    sampleUuid,
    sampleNumber,
    timestamp,
    normalization,
    metadata,
    Object.hashAll(hands),
  );
}

/// A lightweight handle to a persisted sample.
class SampleRef {
  /// Creates a sample reference.
  const SampleRef({
    required this.poseId,
    required this.sampleUuid,
    required this.sampleNumber,
    required this.location,
  });

  /// Owning pose.
  final String poseId;

  /// The sample's immutable identity.
  final String sampleUuid;

  /// Zero-padded stem, e.g. `sample_000023`.
  final String sampleNumber;

  /// Absolute path of the written file.
  final String location;

  @override
  bool operator ==(Object other) =>
      other is SampleRef &&
      other.poseId == poseId &&
      other.sampleUuid == sampleUuid &&
      other.sampleNumber == sampleNumber &&
      other.location == location;

  @override
  int get hashCode => Object.hash(poseId, sampleUuid, sampleNumber, location);
}
