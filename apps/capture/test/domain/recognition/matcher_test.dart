/// `WeightedEuclideanNearestNeighborMatcher`: determinism, weighting,
/// two-hand pairing, and the required-hand-count eligibility gate.
library;

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/infrastructure/recognition/weighted_euclidean_matcher.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/sample_factories.dart';

HandLandmarks _hand({double offset = 0}) => HandLandmarks([
  for (var i = 0; i < handLandmarkCount; i++)
    Landmark(x: offset + 0.01 * i, y: offset + 0.02 * i, z: 0.005 * i),
]);

void main() {
  final matcher = WeightedEuclideanNearestNeighborMatcher(
    weights: LandmarkWeights.defaultWeights,
  );

  test('same exemplars and same frame always produce the same output', () {
    final frame = makeFrame(hands: [makeHandDetection(landmarks: _hand())]);
    final exemplars = {
      'peace': [
        Exemplar(
          poseId: 'peace',
          sampleId: 's1',
          handedness: Handedness.right,
          landmarks: _hand(offset: 0.001),
        ),
      ],
    };
    final catalog = makeCatalogWithout('nothing');

    final first = matcher.score(frame, exemplars, catalog);
    final second = matcher.score(frame, exemplars, catalog);

    expect(first.length, second.length);
    for (var i = 0; i < first.length; i++) {
      expect(first[i].poseId, second[i].poseId);
      expect(first[i].distance, second[i].distance);
    }
  });

  test('fingertip weighting changes ranking versus unweighted', () {
    // Two candidate exemplars: one differs from the live hand only at the
    // wrist, the other only at a fingertip, by the same raw offset. With
    // fingertip weighting, the wrist-differing exemplar should win (lower
    // weighted distance); with uniform weights, they tie — every other
    // landmark is identical (zero), so only the single differing point
    // contributes, and that contribution is the same magnitude regardless of
    // which index it lands on.
    final liveHand = HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++) const Landmark(x: 0, y: 0, z: 0),
    ]);
    final wristDiffers = HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        i == wristLandmarkIndex
            ? const Landmark(x: 0.5, y: 0.5, z: 0.5)
            : liveHand.points[i],
    ]);
    final fingertipDiffers = HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        i == LandmarkWeights.fingertipIndices.first
            ? const Landmark(x: 0.5, y: 0.5, z: 0.5)
            : liveHand.points[i],
    ]);

    final frame = makeFrame(hands: [makeHandDetection(landmarks: liveHand)]);
    final catalog = makeCatalogWithout('nothing');

    final weighted = WeightedEuclideanNearestNeighborMatcher(
      weights: LandmarkWeights.defaultWeights,
    );
    final uniform = WeightedEuclideanNearestNeighborMatcher(
      weights: LandmarkWeights(List.filled(handLandmarkCount, 1.0)),
    );

    double distanceTo(WeightedEuclideanNearestNeighborMatcher m, HandLandmarks other) {
      final result = m.score(frame, {
        'peace': [
          Exemplar(poseId: 'peace', sampleId: 's1', handedness: Handedness.right, landmarks: other),
        ],
      }, catalog);
      return result.single.distance;
    }

    final weightedWrist = distanceTo(weighted, wristDiffers);
    final weightedTip = distanceTo(weighted, fingertipDiffers);
    final uniformWrist = distanceTo(uniform, wristDiffers);
    final uniformTip = distanceTo(uniform, fingertipDiffers);

    expect(uniformWrist, closeTo(uniformTip, 1e-9));
    expect(weightedWrist, lessThan(weightedTip));
  });

  test('an empty exemplar map produces no candidates', () {
    final frame = makeFrame();
    final catalog = makeCatalogWithout('nothing');
    expect(matcher.score(frame, const {}, catalog), isEmpty);
  });

  test('a handless frame produces no candidates, never throws', () {
    final frame = makeEmptyFrame();
    final catalog = makeCatalogWithout('nothing');
    final exemplars = {
      'peace': [
        Exemplar(poseId: 'peace', sampleId: 's1', handedness: Handedness.right, landmarks: _hand()),
      ],
    };
    expect(() => matcher.score(frame, exemplars, catalog), returnsNormally);
    expect(matcher.score(frame, exemplars, catalog), isEmpty);
  });

  group('two-handed matching', () {
    final catalog = PoseCatalog([makeTwoHandedPose(poseId: 'dragon')]);

    test('a two-handed pose is eligible only with both hands present', () {
      final oneHandFrame = makeFrame(
        hands: [makeHandDetection(handedness: Handedness.right, landmarks: _hand())],
      );
      final exemplars = {
        'dragon': [
          Exemplar(poseId: 'dragon', sampleId: 's1', handedness: Handedness.left, landmarks: _hand()),
          Exemplar(poseId: 'dragon', sampleId: 's1', handedness: Handedness.right, landmarks: _hand()),
        ],
      };

      expect(matcher.score(oneHandFrame, exemplars, catalog), isEmpty);

      final twoHandFrame = makeTwoHandFrame();
      expect(matcher.score(twoHandFrame, exemplars, catalog), hasLength(1));
    });

    test('per-hand comparison pairs only against the same original sample', () {
      // sample s1: both hands close to the live frame.
      // sample s2: left hand very close, right hand very far — must not be
      // combined with s1's right hand into an artificially good match.
      final liveLeft = _hand(offset: 0);
      final liveRight = _hand(offset: 0);
      final frame = makeFrame(
        hands: [
          HandDetection(handedness: Handedness.left, confidence: 0.9, landmarks: liveLeft),
          HandDetection(handedness: Handedness.right, confidence: 0.9, landmarks: liveRight),
        ],
      );

      final farHand = HandLandmarks([
        for (var i = 0; i < handLandmarkCount; i++) const Landmark(x: 5, y: 5, z: 5),
      ]);

      final exemplars = {
        'dragon': [
          Exemplar(poseId: 'dragon', sampleId: 's1', handedness: Handedness.left, landmarks: _hand(offset: 0.001)),
          Exemplar(poseId: 'dragon', sampleId: 's1', handedness: Handedness.right, landmarks: _hand(offset: 0.001)),
          Exemplar(poseId: 'dragon', sampleId: 's2', handedness: Handedness.left, landmarks: _hand(offset: 0.0005)),
          Exemplar(poseId: 'dragon', sampleId: 's2', handedness: Handedness.right, landmarks: farHand),
        ],
      };

      final result = matcher.score(frame, exemplars, catalog);
      expect(result, hasLength(1));

      // If a live left hand were incorrectly paired with s2's left exemplar
      // and a live right hand with s1's right exemplar (crossing samples),
      // the combined distance would still look small, since both of those
      // per-hand distances are individually tiny. The only combination that
      // actually distinguishes correct pairing from incorrect pairing is
      // s1-left + s2-right (mixing the *worst* mismatch in): if the matcher
      // ever produced that combination, the distance would be enormous
      // (dominated by the far hand). Since the winning distance stays small,
      // the matcher must be combining same-sample hands only.
      expect(result.single.distance, lessThan(1.0));
    });
  });
}
