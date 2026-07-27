/// Recognition domain value objects: invariants, equality, derived getters.
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/domain/recognition/stability.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LandmarkWeights', () {
    test('requires exactly 21 entries', () {
      expect(() => LandmarkWeights(List.filled(20, 1.0)), throwsArgumentError);
      expect(() => LandmarkWeights(List.filled(21, 1.0)), returnsNormally);
    });

    test('the default weighting weighs fingertips higher than the wrist', () {
      final weights = LandmarkWeights.defaultWeights;
      for (final tip in LandmarkWeights.fingertipIndices) {
        expect(weights.values[tip], greaterThan(weights.values[wristLandmarkIndex]));
      }
    });

    test('equality compares values', () {
      final a = LandmarkWeights(List.filled(21, 1.0));
      final b = LandmarkWeights(List.filled(21, 1.0));
      final c = LandmarkWeights(List.filled(21, 2.0));
      expect(a, equals(b));
      expect(a, isNot(equals(c)));
    });
  });

  group('Candidate', () {
    test('withConfidence replaces only confidence', () {
      const candidate = Candidate(poseId: 'peace', distance: 1.5, confidence: 0);
      final updated = candidate.withConfidence(0.9);
      expect(updated.poseId, 'peace');
      expect(updated.distance, 1.5);
      expect(updated.confidence, 0.9);
    });

    test('equality compares every field', () {
      const a = Candidate(poseId: 'peace', distance: 1.0, confidence: 0.5);
      const b = Candidate(poseId: 'peace', distance: 1.0, confidence: 0.5);
      const c = Candidate(poseId: 'ok', distance: 1.0, confidence: 0.5);
      expect(a, equals(b));
      expect(a, isNot(equals(c)));
    });
  });

  group('StabilityState', () {
    final start = DateTime.utc(2026, 1, 1, 12, 0, 0);

    test('idle holds nothing', () {
      expect(StabilityState.idle.predictedPoseId, isNull);
      expect(StabilityState.idle.heldDuration(start), Duration.zero);
    });

    test('heldDuration measures from heldSince to now', () {
      final state = StabilityState(predictedPoseId: 'peace', heldSince: start);
      final later = start.add(const Duration(seconds: 2));
      expect(state.heldDuration(later), const Duration(seconds: 2));
    });

    test('progress clamps to [0, 1]', () {
      final state = StabilityState(predictedPoseId: 'peace', heldSince: start);
      const target = Duration(seconds: 3);
      expect(state.progress(start, target), 0.0);
      expect(
        state.progress(start.add(const Duration(seconds: 1, milliseconds: 500)), target),
        closeTo(0.5, 0.01),
      );
      expect(state.progress(start.add(const Duration(seconds: 10)), target), 1.0);
    });

    test('readyToConfirm requires an unconfirmed hold past the target', () {
      final state = StabilityState(predictedPoseId: 'peace', heldSince: start);
      const target = Duration(seconds: 3);
      expect(state.readyToConfirm(start.add(const Duration(seconds: 1)), target), isFalse);
      expect(state.readyToConfirm(start.add(const Duration(seconds: 3)), target), isTrue);

      final confirmed = StabilityState(
        predictedPoseId: 'peace',
        heldSince: start,
        confirmedAt: start.add(const Duration(seconds: 3)),
      );
      expect(confirmed.readyToConfirm(start.add(const Duration(seconds: 10)), target), isFalse);
    });
  });

  group('EffectDefinition', () {
    test('rejects intensity outside [0, 1]', () {
      expect(
        () => EffectDefinition(kind: EffectKind.glow, intensity: 1.5),
        throwsArgumentError,
      );
      expect(
        () => EffectDefinition(kind: EffectKind.glow, intensity: -0.1),
        throwsArgumentError,
      );
    });

    test('EffectColor round-trips channel values', () {
      const color = EffectColor(red: 10, green: 20, blue: 30);
      expect(color.red, 10);
      expect(color.toString(), '#0a141e');
    });
  });

  group('CatalogReadiness', () {
    test('isReady compares against the minimum required', () {
      const ready = PoseReadiness(poseId: 'peace', exemplarCount: 25, minRequired: 20);
      const notReady = PoseReadiness(poseId: 'tp', exemplarCount: 5, minRequired: 20);
      expect(ready.isReady, isTrue);
      expect(notReady.isReady, isFalse);
    });

    test('forPose looks up by id; readyCount counts ready poses', () {
      final readiness = CatalogReadiness(const [
        PoseReadiness(poseId: 'peace', exemplarCount: 25, minRequired: 20),
        PoseReadiness(poseId: 'tp', exemplarCount: 5, minRequired: 20),
      ]);
      expect(readiness.forPose('peace')!.isReady, isTrue);
      expect(readiness.forPose('missing'), isNull);
      expect(readiness.readyCount, 1);
    });
  });
}
