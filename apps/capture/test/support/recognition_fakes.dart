/// Test doubles for the recognition ports, so the recognition pipeline is
/// exercisable on the host with no stored dataset and no real matcher.
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/exemplar.dart';

/// An exemplar source whose result is fixed by the test.
class FakeExemplarSource implements ExemplarSource {
  /// Creates a fake source that always returns [result].
  FakeExemplarSource(this.result);

  /// The result [load] returns.
  ExemplarLoadResult result;

  /// How many times [load] has been called.
  int loadCount = 0;

  /// Raised by the next [load] call, if set.
  Object? failNextLoad;

  @override
  Future<ExemplarLoadResult> load() async {
    loadCount += 1;
    final failure = failNextLoad;
    if (failure != null) {
      failNextLoad = null;
      throw failure;
    }
    return result;
  }
}

/// A matcher whose candidates are scripted by the test, so the controller and
/// screen layers can be tested without a real distance computation.
class FakePoseMatcher implements PoseMatcher {
  /// Candidates to return from the next [score] call; consumed one at a time
  /// when [scriptedResults] is non-empty, otherwise [fixedResult] repeats.
  final List<List<Candidate>> scriptedResults = [];

  /// Returned by every call once [scriptedResults] is exhausted.
  List<Candidate> fixedResult = const [];

  /// Every frame this matcher has been asked to score, in order.
  final List<LandmarkFrame> callsSeen = [];

  @override
  List<Candidate> score(
    LandmarkFrame frame,
    Map<String, List<Exemplar>> exemplarsByPose,
    PoseCatalog catalog,
  ) {
    callsSeen.add(frame);
    if (scriptedResults.isNotEmpty) return scriptedResults.removeAt(0);
    return fixedResult;
  }
}

/// An effect catalog whose entries are fixed by the test.
class FakeEffectCatalogSource implements EffectCatalogSource {
  /// Creates a fake catalog with [byPoseId] and a [fallback].
  FakeEffectCatalogSource({
    Map<String, EffectDefinition> byPoseId = const {},
    EffectDefinition? fallback,
  }) : _byPoseId = byPoseId,
       _fallback = fallback ?? EffectDefinition(kind: EffectKind.genericConfirm);

  final Map<String, EffectDefinition> _byPoseId;
  final EffectDefinition _fallback;

  @override
  EffectDefinition effectFor(String poseId) => _byPoseId[poseId] ?? _fallback;
}

/// Builds an [Exemplar] with sensible defaults.
Exemplar makeExemplar({
  String poseId = 'peace',
  String sampleId = 'sample-1',
  Handedness handedness = Handedness.right,
  HandLandmarks? landmarks,
}) => Exemplar(
  poseId: poseId,
  sampleId: sampleId,
  handedness: handedness,
  landmarks: landmarks ?? _defaultLandmarks(),
);

HandLandmarks _defaultLandmarks() => HandLandmarks([
  for (var i = 0; i < handLandmarkCount; i++)
    Landmark(x: 0.01 * i, y: 0.02 * i, z: 0.005 * i),
]);

/// Builds an [ExemplarLoadResult] from ready poses' exemplar counts, all
/// gated against [minRequired].
ExemplarLoadResult makeExemplarLoadResult(
  Map<String, int> exemplarCountByPose, {
  int minRequired = 20,
}) {
  final byPose = <String, List<Exemplar>>{};
  final readinessEntries = <PoseReadiness>[];
  exemplarCountByPose.forEach((poseId, count) {
    readinessEntries.add(
      PoseReadiness(poseId: poseId, exemplarCount: count, minRequired: minRequired),
    );
    if (count >= minRequired) {
      byPose[poseId] = [
        for (var i = 0; i < count; i++)
          makeExemplar(poseId: poseId, sampleId: 'sample-$i'),
      ];
    }
  });
  return ExemplarLoadResult(
    exemplarsByPose: byPose,
    readiness: CatalogReadiness(readinessEntries),
  );
}
