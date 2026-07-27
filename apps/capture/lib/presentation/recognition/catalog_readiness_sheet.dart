/// Catalog-wide readiness view (FR-024): every catalog pose, ready or not,
/// with its exemplar count — reachable without a second dataset scan, since
/// it renders the [CatalogReadiness] `LoadExemplars` already produced.
library;

import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Shows every catalog pose's sample-readiness at a glance.
class CatalogReadinessSheet extends StatelessWidget {
  /// Creates the readiness sheet.
  const CatalogReadinessSheet({
    required this.catalog,
    required this.readiness,
    super.key,
  });

  /// The full pose catalog, for display names and required-hand counts.
  final PoseCatalog catalog;

  /// Readiness for every catalog pose, produced once by `LoadExemplars`.
  final CatalogReadiness readiness;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: Spacing.screen,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Dataset readiness',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  '${readiness.readyCount} / ${catalog.size} ready',
                  key: const Key('readiness-summary'),
                  style: const TextStyle(color: Colors.white70),
                ),
              ],
            ),
            const SizedBox(height: Spacing.md),
            Flexible(
              child: ListView.separated(
                key: const Key('readiness-list'),
                shrinkWrap: true,
                itemCount: catalog.poses.length,
                separatorBuilder: (_, __) => const SizedBox(height: Spacing.sm),
                itemBuilder: (context, index) {
                  final pose = catalog.poses[index];
                  final entry = readiness.forPose(pose.poseId);
                  final ready = entry?.isReady ?? false;
                  final count = entry?.exemplarCount ?? 0;
                  final required = entry?.minRequired ?? 0;
                  return Container(
                    key: Key('readiness-row-${pose.poseId}'),
                    padding: const EdgeInsets.symmetric(
                      horizontal: Spacing.md,
                      vertical: Spacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: Palette.elevated,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          ready ? Icons.check_circle : Icons.error_outline,
                          color: ready ? Palette.accepted : Colors.white38,
                          size: 20,
                        ),
                        const SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            pose.displayName,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                        Text(
                          '$count / $required',
                          style: TextStyle(
                            color: ready ? Palette.accepted : Colors.white60,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
