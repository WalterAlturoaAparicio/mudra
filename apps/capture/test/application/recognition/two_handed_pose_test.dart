/// End-to-end proof that a two-handed pose goes through the exact same
/// pipeline as a one-handed one — no special-casing anywhere in the call
/// path (T054/T055, research D2).
library;

import 'package:capture/application/recognition/recognition_session_controller.dart';
import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/infrastructure/recognition/weighted_euclidean_matcher.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';
import '../../support/recognition_fakes.dart';
import '../../support/sample_factories.dart';

HandLandmarks _hand({double offset = 0}) => HandLandmarks([
  for (var i = 0; i < handLandmarkCount; i++)
    Landmark(x: offset + 0.01 * i, y: offset + 0.02 * i, z: 0.005 * i),
]);

/// Builds a two-handed `ExemplarLoadResult` with [count] matching left/right
/// pairs for [poseId], each pair sharing a `sampleId` (research D2's
/// same-sample pairing rule).
ExemplarLoadResult _twoHandedExemplars({
  required String poseId,
  required int count,
  required HandLandmarks landmarks,
}) {
  final exemplars = <Exemplar>[
    for (var i = 0; i < count; i++) ...[
      Exemplar(
        poseId: poseId,
        sampleId: 'sample-$i',
        handedness: Handedness.left,
        landmarks: landmarks,
      ),
      Exemplar(
        poseId: poseId,
        sampleId: 'sample-$i',
        handedness: Handedness.right,
        landmarks: landmarks,
      ),
    ],
  ];
  return ExemplarLoadResult(
    exemplarsByPose: {poseId: exemplars},
    readiness: CatalogReadiness([
      PoseReadiness(poseId: poseId, exemplarCount: count, minRequired: 20),
    ]),
  );
}

void main() {
  late FakeClock clock;
  late RecognitionSessionController controller;
  late PoseCatalog catalog;

  setUp(() {
    clock = FakeClock();
    catalog = PoseCatalog([makeTwoHandedPose(poseId: 'dragon')]);
    controller = RecognitionSessionController(
      matcher: WeightedEuclideanNearestNeighborMatcher(
        weights: LandmarkWeights.defaultWeights,
      ),
      catalog: catalog,
      clock: clock,
      config: RecognitionConfig(confidenceFloor: 0.5, ambiguityMargin: 0.1),
    );
    // Fixture two-hand samples: several takes of the same pose, each with a
    // matching left/right pair under one sample id — exactly what
    // `FileExemplarSource` would have produced from stored samples.
    controller.loadExemplars(
      _twoHandedExemplars(
        poseId: 'dragon',
        count: 25,
        landmarks: _hand(offset: 0.001),
      ),
    );
  });

  test(
    'the full pipeline (score → confidence → Recognized → stability → '
    'ConfirmationEvent → effect lookup) works for a two-handed pose exactly '
    'like a one-handed one (T054)',
    () {
      final frame = makeFrame(
        hands: [
          HandDetection(handedness: Handedness.left, confidence: 0.95, landmarks: _hand()),
          HandDetection(handedness: Handedness.right, confidence: 0.95, landmarks: _hand()),
        ],
      );

      final (first, noConfirmationYet) = controller.process(frame);
      expect(first, isA<Recognized>());
      expect((first as Recognized).predictedPoseId, 'dragon');
      expect(noConfirmationYet, isNull);

      clock.advance(const Duration(seconds: 3));
      final (second, confirmation) = controller.process(frame);
      expect(second, isA<Recognized>());
      expect(confirmation, isNotNull);
      expect(confirmation!.poseId, 'dragon');

      // Effect lookup closes the pipeline exactly as `RecognitionPreviewScreen`
      // does — no special two-handed case here either (FR-019).
      final effects = FakeEffectCatalogSource(
        byPoseId: {'dragon': EffectDefinition(kind: EffectKind.particleBurst)},
      );
      final effect = effects.effectFor(confirmation.poseId);
      expect(effect.kind, EffectKind.particleBurst);
    },
  );

  test(
    'a two-handed pose with only one hand visible never reaches Recognized, '
    'no matter how close that single hand is to its exemplars (T055)',
    () {
      final oneHandFrame = makeFrame(
        hands: [HandDetection(handedness: Handedness.right, confidence: 0.95, landmarks: _hand())],
      );

      final (result, confirmation) = controller.process(oneHandFrame);
      expect(result, isNot(isA<Recognized>()));
      expect(confirmation, isNull);

      // Holding the single-handed attempt indefinitely must never accumulate
      // toward confirmation either — there is nothing to hold.
      for (var i = 0; i < 5; i++) {
        clock.advance(const Duration(seconds: 1));
        final (r, c) = controller.process(oneHandFrame);
        expect(r, isNot(isA<Recognized>()));
        expect(c, isNull);
      }
    },
  );
}
