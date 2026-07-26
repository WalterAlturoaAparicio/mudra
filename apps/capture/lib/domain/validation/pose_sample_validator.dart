/// Frame validation — the quality gate before storage.
///
/// Enforces the engine's own rules (at least one hand, exactly 21 landmarks per
/// hand, finite coordinates) **plus** the pose's required hand count. Being
/// strictly stricter than the engine guarantees every sample this application
/// writes also passes the engine's validation (SC-004).
///
/// It never judges whether the user performed the *correct* pose — that is the
/// engine's job, and this application does no recognition at all (FR-022).
library;

import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';

/// Validates captured frames against the engine's rules and the pose's needs.
class PoseSampleValidator implements SampleValidator {
  /// Creates a validator.
  const PoseSampleValidator();

  @override
  ValidationOutcome validate(LandmarkFrame frame, PoseDefinition pose) {
    if (frame.handCount == 0) {
      return const ValidationOutcome.rejected(RejectionReason.noHands);
    }
    if (frame.handCount < pose.requiredHands) {
      return const ValidationOutcome.rejected(RejectionReason.insufficientHands);
    }
    for (final hand in frame.hands) {
      if (hand.landmarks.points.length != handLandmarkCount) {
        return const ValidationOutcome.rejected(
          RejectionReason.wrongLandmarkCount,
        );
      }
      if (!hand.landmarks.allFinite) {
        return const ValidationOutcome.rejected(
          RejectionReason.nonFiniteCoordinates,
        );
      }
    }
    return const ValidationOutcome.accepted();
  }
}
