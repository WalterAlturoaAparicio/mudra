/// Frame validation rules.
///
/// Rules 1, 3 and 4 mirror the engine's `validate_capture` exactly; rule 2
/// (required hands) is Capture-specific and strictly stricter, which is what
/// guarantees every stored sample also passes the engine's own validation
/// (SC-004) while keeping one-handed takes out of two-handed poses (SC-012).
library;

import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/validation/pose_sample_validator.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/sample_factories.dart';

void main() {
  const validator = PoseSampleValidator();

  test('a valid one-handed frame is accepted', () {
    final outcome = validator.validate(makeFrame(), makePose());
    expect(outcome.isAccepted, isTrue);
    expect(outcome.reason, isNull);
  });

  test('a frame with no hands is rejected as noHands', () {
    final outcome = validator.validate(makeEmptyFrame(), makePose());
    expect(outcome.isAccepted, isFalse);
    expect(outcome.reason, RejectionReason.noHands);
  });

  test('one hand for a two-handed pose is rejected (FR-019a)', () {
    final outcome = validator.validate(makeFrame(), makeTwoHandedPose());
    expect(outcome.reason, RejectionReason.insufficientHands);
  });

  test('two hands satisfy a two-handed pose', () {
    final outcome = validator.validate(makeTwoHandFrame(), makeTwoHandedPose());
    expect(outcome.isAccepted, isTrue);
  });

  test('extra hands are allowed — the app never judges the pose (FR-022)', () {
    final outcome = validator.validate(makeTwoHandFrame(), makePose());
    expect(
      outcome.isAccepted,
      isTrue,
      reason: 'requiredHands is a minimum, not an exact match',
    );
  });

  test('non-finite coordinates are rejected', () {
    final frame = makeFrame(
      hands: [makeHandDetection(landmarks: makeNonFiniteHandLandmarks())],
    );
    expect(
      validator.validate(frame, makePose()).reason,
      RejectionReason.nonFiniteCoordinates,
    );
  });

  test('a second hand with bad coordinates still rejects the frame', () {
    final frame = makeFrame(
      hands: [
        makeHandDetection(),
        makeHandDetection(landmarks: makeNonFiniteHandLandmarks()),
      ],
    );
    expect(
      validator.validate(frame, makePose()).reason,
      RejectionReason.nonFiniteCoordinates,
    );
  });

  test('no-hands is reported before insufficient-hands', () {
    // Rule order matters: an empty frame during a two-handed pose should read
    // as "no hands", which is the more actionable message for the user.
    final outcome = validator.validate(makeEmptyFrame(), makeTwoHandedPose());
    expect(outcome.reason, RejectionReason.noHands);
  });

  test('the 21-landmark invariant is enforced at construction', () {
    expect(
      () => HandLandmarks([
        for (var i = 0; i < 20; i++) const Landmark(x: 0, y: 0, z: 0),
      ]),
      throwsArgumentError,
      reason: 'a malformed hand can never reach the validator',
    );
  });
}
