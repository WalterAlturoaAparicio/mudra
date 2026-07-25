/// Domain value-object invariants.
library;

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/sample_factories.dart';

void main() {
  group('Handedness', () {
    test('maps detector labels case-insensitively', () {
      expect(Handedness.fromLabel('Left'), Handedness.left);
      expect(Handedness.fromLabel('RIGHT'), Handedness.right);
      expect(Handedness.fromLabel(' left '), Handedness.left);
    });

    test('never throws on an unusable label', () {
      expect(Handedness.fromLabel(null), Handedness.unknown);
      expect(Handedness.fromLabel(''), Handedness.unknown);
      expect(Handedness.fromLabel('sideways'), Handedness.unknown);
    });

    test('wire values are the lowercase names the schema uses', () {
      expect(Handedness.left.wireValue, 'left');
      expect(Handedness.right.wireValue, 'right');
      expect(Handedness.unknown.wireValue, 'unknown');
    });
  });

  group('HandLandmarks', () {
    test('requires exactly 21 points', () {
      expect(() => HandLandmarks(const []), throwsArgumentError);
      expect(
        () => HandLandmarks([
          for (var i = 0; i < 22; i++) const Landmark(x: 0, y: 0, z: 0),
        ]),
        throwsArgumentError,
      );
      expect(makeHandLandmarks().points, hasLength(21));
    });

    test('detects non-finite coordinates', () {
      expect(makeHandLandmarks().allFinite, isTrue);
      expect(makeNonFiniteHandLandmarks().allFinite, isFalse);
    });

    test('compares by value', () {
      expect(makeHandLandmarks(), equals(makeHandLandmarks()));
      expect(makeHandLandmarks(), isNot(equals(makeHandLandmarks(offset: 1))));
    });
  });

  group('LandmarkFrame', () {
    test('reports its hand count, zero included', () {
      expect(makeEmptyFrame().handCount, 0);
      expect(makeFrame().handCount, 1);
      expect(makeTwoHandFrame().handCount, 2);
    });
  });

  group('PoseDefinition', () {
    test('rejects identifiers the engine could not use as a folder name', () {
      for (final bad in ['Peace', 'two words', 'kebab-case', '../escape', '']) {
        expect(
          () => makePose(poseId: bad),
          throwsArgumentError,
          reason: 'pose_id "$bad" must be rejected',
        );
      }
    });

    test('rejects an empty display name and non-positive target', () {
      expect(() => makePose(displayName: '  '), throwsArgumentError);
      expect(() => makePose(targetSampleCount: 0), throwsArgumentError);
    });

    test('rejects a hand count outside 1..2', () {
      expect(() => makePose(requiredHands: 0), throwsArgumentError);
      expect(() => makePose(requiredHands: 3), throwsArgumentError);
    });
  });

  group('PoseCatalog', () {
    test('rejects an empty catalog and duplicate ids', () {
      expect(() => PoseCatalog(const []), throwsArgumentError);
      expect(
        () => PoseCatalog([makePose(), makePose()]),
        throwsArgumentError,
      );
    });

    test('looks poses up by id', () {
      final catalog = PoseCatalog([makePose(), makeTwoHandedPose()]);
      expect(catalog.byId('dragon')!.displayName, 'Dragon');
      expect(catalog.byId('missing'), isNull);
      expect(catalog.first.poseId, 'peace');
      expect(catalog.size, 2);
    });
  });

  group('PoseProgress', () {
    test('reports a clamped fraction', () {
      final pose = makePose(targetSampleCount: 500);
      expect(PoseProgress(pose: pose, collected: 0).fraction, 0);
      expect(PoseProgress(pose: pose, collected: 125).fraction, 0.25);
      expect(PoseProgress(pose: pose, collected: 500).fraction, 1);
      expect(
        PoseProgress(pose: pose, collected: 900).fraction,
        1,
        reason: 'over-collecting must not overflow the bar',
      );
    });

    test('marks completion at the target, and remaining never goes negative', () {
      final pose = makePose(targetSampleCount: 10);
      expect(PoseProgress(pose: pose, collected: 9).isComplete, isFalse);
      expect(PoseProgress(pose: pose, collected: 10).isComplete, isTrue);
      expect(PoseProgress(pose: pose, collected: 25).remaining, 0);
      expect(PoseProgress(pose: pose, collected: 4).remaining, 6);
    });
  });

  group('CaptureSession', () {
    test('is recordable only when it produced samples', () {
      expect(makeSession().isRecordable, isTrue);
      expect(makeSession(totalSamples: 0).isRecordable, isFalse);
      expect(
        makeSession(endReason: SessionEndReason.cancelled).isRecordable,
        isFalse,
        reason: 'a cancelled session must never leave an orphan session_uuid',
      );
      expect(
        makeSession(endReason: SessionEndReason.orientationChanged).isRecordable,
        isFalse,
      );
      expect(
        makeSession(endReason: SessionEndReason.limitReached).isRecordable,
        isTrue,
        reason: 'hitting the cap still finalizes normally and keeps its samples',
      );
    });
  });
}
