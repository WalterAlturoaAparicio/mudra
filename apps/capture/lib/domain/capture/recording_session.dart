/// Recording-session domain: identity, end reasons, and rejection reasons.
///
/// A **recording session** is one press of Record — a *take*. It is one of three
/// distinct scopes the specification names, and they are never interchangeable:
///
/// | Term | What it is | Scope |
/// |---|---|---|
/// | **Recording session** | One press of Record. Identified by `session_uuid`. | Seconds |
/// | **Capture session** | One visit to the capture screen; owns settings and the orientation lock. | Minutes |
/// | **Camera session** | One live acquisition of the camera device. | At most one at a time |
///
/// This type was named `CaptureSession` before revision R1.1, which collided
/// with the screen-level scope. The persisted key is still `session_uuid` — the
/// rename is a naming correction, not a schema change.
///
/// The state names deliberately mirror the Mudra engine's recording lifecycle so
/// both applications describe the same flow with the same words.
library;

/// Why a recording session ended.
enum SessionEndReason {
  /// The capture window elapsed normally.
  completed('completed'),

  /// The user cancelled during countdown or capture — nothing is written.
  cancelled('cancelled'),

  /// The configured per-take sample cap was reached (FR-051); everything
  /// already accepted is kept and the take finalizes normally.
  limitReached('limit_reached'),

  /// Orientation changed despite the lock (FR-050) — nothing is written.
  orientationChanged('orientation_changed'),

  /// The camera was released while the take was in flight — the user left,
  /// backgrounded the app, switched lenses, or changed mode (FR-068/FR-094).
  /// Nothing is written; already-saved samples are untouched.
  cameraReleased('camera_released'),

  /// Camera or storage failure — nothing partial is written.
  failed('failed');

  const SessionEndReason(this.wireValue);

  /// Value used in the export manifest.
  final String wireValue;

  /// Whether a take ending this way is allowed to have persisted samples.
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

/// Identity and summary of one recording session (FR-045/FR-046).
///
/// Takes that write no samples are never recorded, so no orphan `session_uuid`
/// can reach the dataset.
class RecordingSession {
  /// Creates a recording-session record.
  const RecordingSession({
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

  /// UTC instant the take started.
  final DateTime startedAt;

  /// UTC instant the take reached a terminal state.
  final DateTime? finishedAt;

  /// Samples accepted and persisted.
  final int totalSamples;

  /// Frames rejected by validation.
  final int discardedSamples;

  /// How the take ended.
  final SessionEndReason endReason;

  /// Whether this take should appear in the export manifest.
  bool get isRecordable => endReason.persistsSamples && totalSamples > 0;

  @override
  bool operator ==(Object other) =>
      other is RecordingSession &&
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
