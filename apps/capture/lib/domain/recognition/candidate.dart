/// One pose considered for the current frame.
library;

/// A candidate pose and how well it matched the current frame.
class Candidate {
  /// Creates a candidate.
  const Candidate({
    required this.poseId,
    required this.distance,
    required this.confidence,
  });

  /// Which catalog pose this candidate is.
  final String poseId;

  /// Raw weighted distance to the nearest eligible exemplar (research D1/D2).
  final double distance;

  /// `softmax(-distance)` across every eligible candidate this frame
  /// (research D3); in `[0, 1]`.
  final double confidence;

  /// Returns a copy with [confidence] replaced.
  ///
  /// The matcher computes [distance] only; confidence is derived one layer up
  /// once every eligible candidate's distance is known (data-model.md's
  /// pipeline diagram) — this is what lets softmax normalize across the whole
  /// candidate set rather than one at a time.
  Candidate withConfidence(double confidence) => Candidate(
    poseId: poseId,
    distance: distance,
    confidence: confidence,
  );

  @override
  bool operator ==(Object other) =>
      other is Candidate &&
      other.poseId == poseId &&
      other.distance == distance &&
      other.confidence == confidence;

  @override
  int get hashCode => Object.hash(poseId, distance, confidence);

  @override
  String toString() =>
      'Candidate($poseId, distance: $distance, confidence: $confidence)';
}
