/// A stored sample's normalized landmark vector, used as a comparison
/// reference — and the per-landmark weighting the matcher compares it with.
///
/// Nothing here imports Flutter, a plugin, or `dart:io` — the matcher this
/// feeds is pure Dart and fully testable on the host (research D1).
library;

import 'package:capture/domain/landmarks/landmarks.dart';

/// One stored sample's normalized landmark vector, read for comparison only.
///
/// Never constructed from anything other than an already-persisted sample —
/// this feature has no code path that produces a [PoseSample] of its own
/// (FR-004).
class Exemplar {
  /// Creates an exemplar.
  const Exemplar({
    required this.poseId,
    required this.sampleId,
    required this.handedness,
    required this.landmarks,
  });

  /// Which catalog pose this came from.
  final String poseId;

  /// The original sample's identity (`sample_uuid`).
  ///
  /// Two-handed matching needs to know which live-recorded pair of hands
  /// belonged to the *same* take, so a left-hand exemplar and a right-hand
  /// exemplar can be recombined into one candidate's combined distance
  /// (research D2) — without this, two different samples' hands could be
  /// mixed together into a distance that never actually occurred.
  final String sampleId;

  /// Resolved physical hand. Specification 003's canonical convention already
  /// guarantees this names the correct hand regardless of which lens recorded
  /// it.
  final Handedness handedness;

  /// The persisted `normalized` vector — never recomputed here (research D6).
  final HandLandmarks landmarks;

  @override
  bool operator ==(Object other) =>
      other is Exemplar &&
      other.poseId == poseId &&
      other.sampleId == sampleId &&
      other.handedness == handedness &&
      other.landmarks == landmarks;

  @override
  int get hashCode => Object.hash(poseId, sampleId, handedness, landmarks);
}

/// The per-landmark weighting the distance function applies (research D1).
///
/// Fingertip landmarks carry a higher weight than palm/wrist landmarks,
/// because fingertip position is what differentiates most hand poses from
/// each other.
class LandmarkWeights {
  /// Creates a weighting from exactly [handLandmarkCount] values.
  ///
  /// Throws [ArgumentError] otherwise — the same "assert the invariant once,
  /// at the boundary" pattern [HandLandmarks] itself uses.
  LandmarkWeights(List<double> values) : values = List.unmodifiable(values) {
    if (values.length != handLandmarkCount) {
      throw ArgumentError.value(
        values.length,
        'values',
        'LandmarkWeights requires exactly $handLandmarkCount entries',
      );
    }
  }

  /// One weight per landmark index, in MediaPipe's canonical order.
  final List<double> values;

  /// Fingertip indices (thumb, index, middle, ring, pinky tips).
  static const List<int> fingertipIndices = [4, 8, 12, 16, 20];

  /// The default weighting: fingertips weighted higher than palm/wrist
  /// landmarks, and the wrist itself weighted lower still — it is the
  /// normalization origin, so it carries the least shape information of any
  /// point.
  static LandmarkWeights get defaultWeights => LandmarkWeights([
    for (var i = 0; i < handLandmarkCount; i++)
      if (i == wristLandmarkIndex)
        0.5
      else if (fingertipIndices.contains(i))
        2.0
      else
        1.0,
  ]);

  @override
  bool operator ==(Object other) {
    if (other is! LandmarkWeights) return false;
    for (var i = 0; i < handLandmarkCount; i++) {
      if (other.values[i] != values[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hashAll(values);
}
