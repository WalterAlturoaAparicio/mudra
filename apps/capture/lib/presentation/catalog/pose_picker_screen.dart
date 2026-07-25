/// Pose picker: work through the catalog, see progress at a glance.
library;

import 'package:capture/application/catalog/pose_progress_notifier.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Lets the contributor choose which pose to collect next.
class PosePickerScreen extends ConsumerWidget {
  /// Creates the pose picker.
  const PosePickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(catalogProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Choose a pose')),
      body: catalog.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('$error')),
        data: (state) => _list(context, ref, state),
      ),
    );
  }

  Widget _list(BuildContext context, WidgetRef ref, CatalogState state) {
    final entries = state.all;
    return ListView.separated(
      padding: Spacing.screen,
      itemCount: entries.length,
      separatorBuilder: (_, _) => const SizedBox(height: Spacing.sm),
      itemBuilder: (context, index) {
        final progress = entries[index];
        final pose = progress.pose;
        final isSelected = pose.poseId == state.selectedPoseId;

        return Card(
          color: isSelected ? Palette.primary.withValues(alpha: 0.18) : Palette.elevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: isSelected
                ? const BorderSide(color: Palette.primary, width: 2)
                : BorderSide.none,
          ),
          child: ListTile(
            key: Key('pose-${pose.poseId}'),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: Spacing.md,
              vertical: Spacing.sm,
            ),
            leading: SizedBox(
              width: 56,
              height: 56,
              child: PoseReferenceImage(
                assetPath: pose.referenceImage,
                displayName: pose.displayName,
                compact: true,
              ),
            ),
            title: Text(
              pose.displayName,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: Spacing.sm),
              child: ProgressBar(
                fraction: progress.fraction,
                collected: progress.collected,
                target: pose.targetSampleCount,
                isComplete: progress.isComplete,
              ),
            ),
            trailing: progress.isComplete
                ? const Icon(Icons.check_circle, color: Palette.accepted)
                : null,
            onTap: () {
              ref.read(catalogProvider.notifier).select(pose.poseId);
              Navigator.of(context).pop();
            },
          ),
        );
      },
    );
  }
}
