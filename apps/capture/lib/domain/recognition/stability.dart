/// Pose stability and confirmation (FR-015–FR-018).
///
/// Driven by wall-clock time via the injected `Clock`, never by frame count
/// (research D7) — "3 seconds" means the same 3 seconds on every device.
library;

/// How long the *same* prediction has remained the stable top prediction.
///
/// **The one rule that governs this type**: any result other than
/// `Recognized` of the *same* pose resets [heldSince] and [confirmedAt] to a
/// fresh idle state (FR-016). Confirmation is therefore always relative to
/// one continuous, uninterrupted hold.
class StabilityState {
  /// Creates a stability state.
  const StabilityState({this.predictedPoseId, this.heldSince, this.confirmedAt});

  /// Nothing held; the initial and post-reset state.
  static const StabilityState idle = StabilityState();

  /// The pose currently being held stable, or `null` if nothing qualifies.
  final String? predictedPoseId;

  /// When the current hold began, from the injected `Clock`.
  final DateTime? heldSince;

  /// Set once this specific hold has already raised its [ConfirmationEvent];
  /// prevents a second one until the hold breaks and restarts (FR-018).
  final DateTime? confirmedAt;

  /// How long the current hold has lasted as of [now]; zero when not holding.
  Duration heldDuration(DateTime now) {
    final since = heldSince;
    if (since == null) return Duration.zero;
    return now.difference(since);
  }

  /// Fraction of [target] elapsed, clamped to `[0, 1]` — what the
  /// continuously-updating stability indicator renders (FR-015).
  double progress(DateTime now, Duration target) {
    if (target <= Duration.zero) return 1;
    final ratio =
        heldDuration(now).inMicroseconds / target.inMicroseconds;
    return ratio.clamp(0.0, 1.0);
  }

  /// Whether this hold has lasted at least [target] and has not already
  /// raised its confirmation.
  bool readyToConfirm(DateTime now, Duration target) =>
      predictedPoseId != null &&
      confirmedAt == null &&
      heldDuration(now) >= target;

  @override
  bool operator ==(Object other) =>
      other is StabilityState &&
      other.predictedPoseId == predictedPoseId &&
      other.heldSince == heldSince &&
      other.confirmedAt == confirmedAt;

  @override
  int get hashCode => Object.hash(predictedPoseId, heldSince, confirmedAt);
}

/// Raised exactly once per qualifying hold (FR-018).
class ConfirmationEvent {
  /// Creates a confirmation event.
  const ConfirmationEvent({required this.poseId, required this.confirmedAt});

  /// Which pose was confirmed.
  final String poseId;

  /// When, from the same `Clock` driving [StabilityState].
  final DateTime confirmedAt;

  @override
  bool operator ==(Object other) =>
      other is ConfirmationEvent &&
      other.poseId == poseId &&
      other.confirmedAt == confirmedAt;

  @override
  int get hashCode => Object.hash(poseId, confirmedAt);
}
