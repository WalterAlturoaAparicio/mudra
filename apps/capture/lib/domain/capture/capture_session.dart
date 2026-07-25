/// Capture-session domain: identity, lifecycle states, and results.
///
/// The state names deliberately mirror the Mudra engine's recording lifecycle so
/// both applications describe the same flow with the same words.
library;

/// Why a capture session ended.
enum SessionEndReason {
  /// The capture window elapsed normally.
  completed('completed'),

  /// The user cancelled during countdown or capture — nothing is written.
  cancelled('cancelled'),

  /// The configured per-session sample cap was reached (FR-051); everything
  /// already accepted is kept and the session finalizes normally.
  limitReached('limit_reached'),

  /// Orientation changed mid-session (FR-050) — nothing is written.
  orientationChanged('orientation_changed'),

  /// Camera or storage failure — nothing partial is written.
  failed('failed');

  const SessionEndReason(this.wireValue);

  /// Value used in the export manifest.
  final String wireValue;

  /// Whether a session ending this way is allowed to have persisted samples.
  bool get persistsSamples =>
      this == SessionEndReason.completed || this == SessionEndReason.limitReached;
}

/// Why a frame was discarded during capture.
enum RejectionReason {
  /// No hand was detected at all.
  noHands('no_hands'),

  /// Fewer hands than the pose requires (FR-019a).
  insufficientHands('insufficient_hands'),

  /// A hand did not carry exactly 21 landmarks.
  wrongLandmarkCount('wrong_landmark_count'),

  /// A coordinate was NaN or infinite.
  nonFiniteCoordinates('non_finite_coordinates');

  const RejectionReason(this.wireValue);

  /// Stable value for logs and diagnostics.
  final String wireValue;
}

/// Identity and summary of one capture session (FR-045/FR-046).
///
/// Sessions that write no samples are never recorded, so no orphan
/// `session_uuid` can reach the dataset.
class CaptureSession {
  /// Creates a session record.
  const CaptureSession({
    required this.sessionUuid,
    required this.poseId,
    required this.startedAt,
    required this.endReason,
    this.finishedAt,
    this.totalSamples = 0,
    this.discardedSamples = 0,
  });

  /// UUID v4 minted when Record was pressed.
  final String sessionUuid;

  /// The pose being collected.
  final String poseId;

  /// UTC instant the session started.
  final DateTime startedAt;

  /// UTC instant the session reached a terminal state.
  final DateTime? finishedAt;

  /// Samples accepted and persisted.
  final int totalSamples;

  /// Frames rejected by validation.
  final int discardedSamples;

  /// How the session ended.
  final SessionEndReason endReason;

  /// Whether this session should appear in the export manifest.
  bool get isRecordable => endReason.persistsSamples && totalSamples > 0;

  @override
  bool operator ==(Object other) =>
      other is CaptureSession &&
      other.sessionUuid == sessionUuid &&
      other.poseId == poseId &&
      other.startedAt == startedAt &&
      other.finishedAt == finishedAt &&
      other.totalSamples == totalSamples &&
      other.discardedSamples == discardedSamples &&
      other.endReason == endReason;

  @override
  int get hashCode => Object.hash(
    sessionUuid,
    poseId,
    startedAt,
    finishedAt,
    totalSamples,
    discardedSamples,
    endReason,
  );
}
