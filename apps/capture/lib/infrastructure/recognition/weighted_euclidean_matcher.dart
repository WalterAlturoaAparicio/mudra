/// The Phase 2.75 recognition strategy: per-landmark-weighted Euclidean
/// distance, 1-nearest-neighbor (research D1/D2).
///
/// Pure Dart, deterministic, and the concrete realization of Principle III's
/// "similarity matching as a pluggable strategy behind a stable interface" —
/// a different deterministic strategy is a new implementation of
/// [PoseMatcher], with no change to anything that calls it.
library;

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/exemplar.dart';

/// Scores a live frame's hands against stored exemplars via 1-NN.
class WeightedEuclideanNearestNeighborMatcher implements PoseMatcher {
  /// Creates a matcher using [weights] for its per-landmark distance.
  const WeightedEuclideanNearestNeighborMatcher({required this.weights});

  /// The per-landmark weighting applied to every comparison.
  final LandmarkWeights weights;

  @override
  List<Candidate> score(
    LandmarkFrame frame,
    Map<String, List<Exemplar>> exemplarsByPose,
    PoseCatalog catalog,
  ) {
    if (frame.hands.isEmpty) return const [];

    final candidates = <Candidate>[];
    for (final entry in exemplarsByPose.entries) {
      final exemplars = entry.value;
      if (exemplars.isEmpty) continue;

      final pose = catalog.byId(entry.key);
      final requiredHands = pose?.requiredHands ?? 1;
      if (frame.handCount < requiredHands) continue;

      final distance = requiredHands >= 2
          ? _bestTwoHandDistance(frame, exemplars)
          : _bestOneHandDistance(frame, exemplars);
      if (distance != null) {
        candidates.add(
          Candidate(poseId: entry.key, distance: distance, confidence: 0),
        );
      }
    }
    return candidates;
  }

  /// A one-handed pose is matched **hand-agnostically** (research D2): either
  /// live hand may be compared against any of the pose's exemplars, since a
  /// one-handed pose's own recorded samples may have been made with either
  /// hand. The single best (lowest-distance) pairing wins.
  double? _bestOneHandDistance(LandmarkFrame frame, List<Exemplar> exemplars) {
    double? best;
    for (final hand in frame.hands) {
      for (final exemplar in exemplars) {
        final distance = _weightedSquaredDistance(
          hand.landmarks,
          exemplar.landmarks,
        );
        if (best == null || distance < best) best = distance;
      }
    }
    return best;
  }

  /// A two-handed pose compares like-for-like: a live left hand only against
  /// exemplar entries whose stored handedness is left, a live right hand only
  /// against right entries, and the combined distance is against the **same
  /// original sample's** two hands, never two different samples' hands mixed
  /// together (research D2). Eligible only when both hands are present in
  /// the live frame.
  ///
  /// The combined distance is the **mean**, not the sum, of both hands'
  /// distances — a perfectly matching two-handed pose should read the same
  /// confidence scale as a perfectly matching one-handed pose (research D3's
  /// comparability guarantee); summing would systematically report a
  /// two-handed pose as a worse match even when each hand matches equally
  /// well.
  double? _bestTwoHandDistance(LandmarkFrame frame, List<Exemplar> exemplars) {
    final liveLeft = frame.hands
        .where((h) => h.handedness == Handedness.left)
        .toList(growable: false);
    final liveRight = frame.hands
        .where((h) => h.handedness == Handedness.right)
        .toList(growable: false);
    if (liveLeft.isEmpty || liveRight.isEmpty) return null;

    final bySample = <String, Map<Handedness, Exemplar>>{};
    for (final exemplar in exemplars) {
      (bySample[exemplar.sampleId] ??= {})[exemplar.handedness] = exemplar;
    }

    double? best;
    for (final sample in bySample.values) {
      final left = sample[Handedness.left];
      final right = sample[Handedness.right];
      if (left == null || right == null) continue;

      final leftDistance = _bestAgainst(liveLeft, left);
      final rightDistance = _bestAgainst(liveRight, right);
      final combined = (leftDistance + rightDistance) / 2;
      if (best == null || combined < best) best = combined;
    }
    return best;
  }

  double _bestAgainst(List<HandDetection> liveHands, Exemplar exemplar) {
    var best = double.infinity;
    for (final hand in liveHands) {
      final distance = _weightedSquaredDistance(
        hand.landmarks,
        exemplar.landmarks,
      );
      if (distance < best) best = distance;
    }
    return best;
  }

  double _weightedSquaredDistance(HandLandmarks a, HandLandmarks b) {
    var sum = 0.0;
    for (var i = 0; i < handLandmarkCount; i++) {
      final pa = a.points[i];
      final pb = b.points[i];
      final dx = pa.x - pb.x;
      final dy = pa.y - pb.y;
      final dz = pa.z - pb.z;
      sum += weights.values[i] * (dx * dx + dy * dy + dz * dz);
    }
    return sum;
  }
}
