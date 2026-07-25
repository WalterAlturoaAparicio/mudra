/// Catalog and progress state.
///
/// Progress always reflects what is **stored on disk**, not what the app
/// believes it recorded — a count that drifts from the dataset would quietly
/// mislead the contributor about how much work is left (FR-009).
library;

import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The catalog plus per-pose progress and the current selection.
class CatalogState {
  /// Creates a catalog state.
  const CatalogState({
    required this.catalog,
    required this.counts,
    required this.selectedPoseId,
  });

  /// Every pose available for collection.
  final PoseCatalog catalog;

  /// Stored sample counts by `pose_id`.
  final Map<String, int> counts;

  /// The pose currently being collected.
  final String selectedPoseId;

  /// The selected pose definition.
  PoseDefinition get selected =>
      catalog.byId(selectedPoseId) ?? catalog.first;

  /// Progress for the selected pose.
  PoseProgress get selectedProgress => progressFor(selected);

  /// Progress for any pose.
  PoseProgress progressFor(PoseDefinition pose) =>
      PoseProgress(pose: pose, collected: counts[pose.poseId] ?? 0);

  /// Progress for every pose, in catalog order.
  List<PoseProgress> get all => [
    for (final pose in catalog.poses) progressFor(pose),
  ];

  /// Total samples stored across every pose.
  int get totalCollected =>
      counts.values.fold(0, (sum, value) => sum + value);

  /// Returns a copy with a different selection.
  CatalogState select(String poseId) => CatalogState(
    catalog: catalog,
    counts: counts,
    selectedPoseId: poseId,
  );

  /// Returns a copy with refreshed counts.
  CatalogState withCounts(Map<String, int> value) => CatalogState(
    catalog: catalog,
    counts: value,
    selectedPoseId: selectedPoseId,
  );
}

/// Loads the catalog, hydrates progress from storage, and tracks the selection.
///
/// Dependencies are resolved through provider descriptors rather than
/// constructor injection, because a Riverpod notifier is built by the container
/// rather than by us. The descriptors still yield **ports** — this class never
/// sees a concrete implementation or a plugin — and any test can override them.
class PoseCatalogNotifier extends AsyncNotifier<CatalogState> {
  /// Creates the notifier.
  PoseCatalogNotifier();

  PoseCatalogSource get _catalogSource => ref.read(catalogSourceProvider);

  SampleRepository get _repository => ref.read(sampleRepositoryProvider);

  @override
  Future<CatalogState> build() async {
    final catalog = await _catalogSource.load();
    final counts = await _repository.countAll();
    return CatalogState(
      catalog: catalog,
      counts: counts,
      selectedPoseId: catalog.first.poseId,
    );
  }

  /// Selects a different pose (FR-008).
  void select(String poseId) {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncData(current.select(poseId));
  }

  /// Re-reads sample counts from storage (FR-009).
  Future<void> refreshCounts() async {
    final current = state.valueOrNull;
    if (current == null) return;
    final counts = await _repository.countAll();
    state = AsyncData(current.withCounts(counts));
  }
}
