/// Catalog-wide recognition readiness — a byproduct of exemplar loading
/// (research D10), not a second dataset scan (FR-024).
library;

/// Whether one catalog pose currently has enough recorded samples to be
/// matched at all.
class PoseReadiness {
  /// Creates a readiness entry.
  const PoseReadiness({
    required this.poseId,
    required this.exemplarCount,
    required this.minRequired,
  });

  /// Which catalog pose this describes.
  final String poseId;

  /// How many samples currently qualify as exemplars for this pose.
  final int exemplarCount;

  /// The minimum required for this pose to be matched (research D5).
  final int minRequired;

  /// Whether this pose currently has enough samples to be matched.
  bool get isReady => exemplarCount >= minRequired;

  @override
  bool operator ==(Object other) =>
      other is PoseReadiness &&
      other.poseId == poseId &&
      other.exemplarCount == exemplarCount &&
      other.minRequired == minRequired;

  @override
  int get hashCode => Object.hash(poseId, exemplarCount, minRequired);
}

/// One entry per catalog pose, produced once per exemplar load.
class CatalogReadiness {
  /// Creates a readiness summary.
  CatalogReadiness(List<PoseReadiness> entries)
      : entries = List.unmodifiable(entries);

  /// Every catalog pose's readiness, in catalog order.
  final List<PoseReadiness> entries;

  /// Looks a pose's readiness up by identifier, or `null` when absent.
  PoseReadiness? forPose(String poseId) {
    for (final entry in entries) {
      if (entry.poseId == poseId) return entry;
    }
    return null;
  }

  /// How many catalog poses are currently ready to be matched.
  int get readyCount => entries.where((e) => e.isReady).length;
}
