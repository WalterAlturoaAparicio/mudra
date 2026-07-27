/// The outcome for one processed frame.
///
/// Sealed so the UI and the stability tracker cannot observe a state this
/// feature does not define. Only [Recognized] contributes to stability
/// (FR-016); every other variant resets it.
library;

import 'package:capture/domain/recognition/candidate.dart';

/// The result of matching one live frame against the current exemplar set.
sealed class RecognitionResult {
  /// Base constructor.
  const RecognitionResult({required this.latency, required this.frameTimestamp});

  /// Time from frame capture to this result being produced (FR-012).
  final Duration latency;

  /// The frame's monotonic timestamp, for ordering.
  final int frameTimestamp;
}

/// No hand was detected in the frame at all.
class NoHandDetected extends RecognitionResult {
  /// Creates a no-hand result.
  const NoHandDetected({required super.latency, required super.frameTimestamp});
}

/// Every candidate failed the confidence floor.
class Unrecognized extends RecognitionResult {
  /// Creates an unrecognized result.
  const Unrecognized({
    required this.topCandidates,
    required super.latency,
    required super.frameTimestamp,
  });

  /// Whatever candidates were eligible, none confident enough (may be empty).
  final List<Candidate> topCandidates;
}

/// The confidence floor passed but the top-vs-second margin did not.
class Ambiguous extends RecognitionResult {
  /// Creates an ambiguous result.
  const Ambiguous({
    required this.topCandidates,
    required super.latency,
    required super.frameTimestamp,
  });

  /// At least two candidates, too close to call.
  final List<Candidate> topCandidates;
}

/// Both gates passed; [topCandidates] is ranked, `.first` is the prediction.
class Recognized extends RecognitionResult {
  /// Creates a recognized result.
  const Recognized({
    required this.topCandidates,
    required super.latency,
    required super.frameTimestamp,
  });

  /// 1–3 ranked candidates; `.first` is the prediction (FR-012).
  final List<Candidate> topCandidates;

  /// The predicted pose.
  String get predictedPoseId => topCandidates.first.poseId;
}
