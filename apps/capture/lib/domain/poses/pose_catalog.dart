/// Pose catalog domain.
///
/// The catalog is configuration, not code (FR-001): these types are what the
/// asset file validates into, and the rest of the app may assume every
/// [PoseDefinition] it receives is already valid.
library;

/// Identifier rule shared with the Mudra engine — keeps a `pose_id` safe to use
/// as a directory name on every platform.
final RegExp poseIdPattern = RegExp(r'^[a-z0-9_]+$');

/// Maximum length of a `pose_id`.
const int poseIdMaxLength = 64;

/// One pose the user is asked to perform.
class PoseDefinition {
  /// Creates a validated pose definition.
  ///
  /// Throws [ArgumentError] when any field violates the catalog contract, so an
  /// invalid entry can never reach a screen or a sample.
  PoseDefinition({
    required this.poseId,
    required this.displayName,
    required this.targetSampleCount,
    required this.requiredHands,
    this.description = '',
    this.referenceImage,
  }) {
    if (!poseIdPattern.hasMatch(poseId)) {
      throw ArgumentError.value(
        poseId,
        'poseId',
        'must match ${poseIdPattern.pattern}',
      );
    }
    if (poseId.length > poseIdMaxLength) {
      throw ArgumentError.value(
        poseId,
        'poseId',
        'exceeds $poseIdMaxLength characters',
      );
    }
    if (displayName.trim().isEmpty) {
      throw ArgumentError.value(displayName, 'displayName', 'must not be empty');
    }
    if (targetSampleCount <= 0) {
      throw ArgumentError.value(
        targetSampleCount,
        'targetSampleCount',
        'must be greater than zero',
      );
    }
    if (requiredHands < 1 || requiredHands > 2) {
      throw ArgumentError.value(
        requiredHands,
        'requiredHands',
        'must be 1 or 2',
      );
    }
  }

  /// Permanent identifier; the only thing datasets reference.
  final String poseId;

  /// Human-facing label, never used as an identifier.
  final String displayName;

  /// Optional guidance text shown under the reference image.
  final String description;

  /// Asset path of the reference image; may point at a file that does not
  /// exist, in which case the UI shows a placeholder (FR-005).
  final String? referenceImage;

  /// How many samples this pose is aiming for.
  final int targetSampleCount;

  /// How many hands a valid sample of this pose must contain (FR-019a).
  final int requiredHands;

  /// Whether this pose needs both hands.
  bool get isTwoHanded => requiredHands == 2;

  @override
  bool operator ==(Object other) =>
      other is PoseDefinition &&
      other.poseId == poseId &&
      other.displayName == displayName &&
      other.description == description &&
      other.referenceImage == referenceImage &&
      other.targetSampleCount == targetSampleCount &&
      other.requiredHands == requiredHands;

  @override
  int get hashCode => Object.hash(
    poseId,
    displayName,
    description,
    referenceImage,
    targetSampleCount,
    requiredHands,
  );
}

/// The ordered, validated set of poses the application collects.
class PoseCatalog {
  /// Creates a catalog, rejecting an empty list or duplicate identifiers.
  PoseCatalog(List<PoseDefinition> poses) : poses = List.unmodifiable(poses) {
    if (poses.isEmpty) {
      throw ArgumentError.value(poses, 'poses', 'catalog must not be empty');
    }
    final seen = <String>{};
    for (final pose in poses) {
      if (!seen.add(pose.poseId)) {
        throw ArgumentError.value(
          pose.poseId,
          'poseId',
          'duplicate pose_id in catalog',
        );
      }
    }
  }

  /// Poses in catalog order.
  final List<PoseDefinition> poses;

  /// Number of poses in the catalog.
  int get size => poses.length;

  /// The first pose, used as the initial selection.
  PoseDefinition get first => poses.first;

  /// Looks a pose up by identifier, or returns `null` when absent.
  PoseDefinition? byId(String poseId) {
    for (final pose in poses) {
      if (pose.poseId == poseId) return pose;
    }
    return null;
  }
}

/// How far a pose is toward its target.
class PoseProgress {
  /// Creates a progress view for [pose] with [collected] stored samples.
  const PoseProgress({required this.pose, required this.collected});

  /// The pose being tracked.
  final PoseDefinition pose;

  /// Samples currently stored for this pose.
  final int collected;

  /// Completion in `[0, 1]`, clamped so an over-collected pose stays at 1.
  double get fraction {
    if (pose.targetSampleCount <= 0) return 1;
    final value = collected / pose.targetSampleCount;
    return value.clamp(0.0, 1.0);
  }

  /// Whether the pose has reached its target (FR-024).
  bool get isComplete => collected >= pose.targetSampleCount;

  /// How many samples remain, never negative.
  int get remaining {
    final left = pose.targetSampleCount - collected;
    return left < 0 ? 0 : left;
  }

  /// Returns a copy with an updated [collected] count.
  PoseProgress withCollected(int value) =>
      PoseProgress(pose: pose, collected: value);

  @override
  bool operator ==(Object other) =>
      other is PoseProgress && other.pose == pose && other.collected == collected;

  @override
  int get hashCode => Object.hash(pose, collected);
}
