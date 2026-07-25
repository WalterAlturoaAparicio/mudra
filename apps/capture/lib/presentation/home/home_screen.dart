/// The home screen: current pose, reference, progress, Record, and Sync.
///
/// Exactly two primary actions and nothing else (FR-007) — no recognition, no
/// statistics, no review tools. Widgets here hold no business logic; they read
/// state and dispatch intent.
library;

import 'package:capture/application/catalog/pose_progress_notifier.dart';
import 'package:capture/application/export/export_dataset.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/presentation/capture/capture_screen.dart';
import 'package:capture/presentation/catalog/pose_picker_screen.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The application's landing screen.
class HomeScreen extends ConsumerStatefulWidget {
  /// Creates the home screen.
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  ExportState _exportState = const ExportIdle();

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(catalogProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mudra Capture'),
        centerTitle: false,
        backgroundColor: Palette.surface,
      ),
      body: SafeArea(
        child: catalog.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => _CatalogError(message: '$error'),
          data: _buildBody,
        ),
      ),
    );
  }

  Widget _buildBody(CatalogState state) {
    final progress = state.selectedProgress;
    final pose = progress.pose;

    return Padding(
      padding: Spacing.screen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PoseHeader(pose: pose, onTap: _openPicker),
          const SizedBox(height: Spacing.md),
          Expanded(
            child: PoseReferenceImage(
              key: const Key('home-reference'),
              assetPath: pose.referenceImage,
              displayName: pose.displayName,
              description: pose.description,
            ),
          ),
          const SizedBox(height: Spacing.lg),
          ProgressBar(
            key: const Key('home-progress'),
            fraction: progress.fraction,
            collected: progress.collected,
            target: pose.targetSampleCount,
            isComplete: progress.isComplete,
          ),
          const SizedBox(height: Spacing.lg),
          FilledButton.icon(
            key: const Key('record-button'),
            onPressed: () => _record(pose),
            icon: const Icon(Icons.fiber_manual_record, size: 28),
            label: const Text('Record'),
          ),
          const SizedBox(height: Spacing.sm),
          OutlinedButton.icon(
            key: const Key('sync-button'),
            onPressed: _exportState is ExportValidating ||
                    _exportState is ExportPackaging
                ? null
                : _sync,
            icon: const Icon(Icons.ios_share),
            label: Text(_syncLabel),
          ),
          _SyncStatus(state: _exportState),
        ],
      ),
    );
  }

  String get _syncLabel => switch (_exportState) {
    ExportValidating() => 'Checking dataset…',
    ExportPackaging() => 'Packaging…',
    _ => 'Sync',
  };

  Future<void> _openPicker() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PosePickerScreen()),
    );
  }

  Future<void> _record(PoseDefinition pose) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => CaptureScreen(pose: pose)),
    );
    if (!mounted) return;
    // Counts come from disk, never from what the UI believes it recorded.
    await ref.read(catalogProvider.notifier).refreshCounts();
  }

  Future<void> _sync() async {
    final useCase = ref.read(exportDatasetProvider);
    await for (final state in useCase.run()) {
      if (!mounted) return;
      setState(() => _exportState = state);
    }
  }
}

class _PoseHeader extends StatelessWidget {
  const _PoseHeader({required this.pose, required this.onTap});

  final PoseDefinition pose;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pose.displayName,
                    key: const Key('home-pose-name'),
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: Spacing.xs),
                  RequiredHandsBadge(requiredHands: pose.requiredHands),
                ],
              ),
            ),
            const Icon(Icons.swap_horiz, size: 28, color: Colors.white70),
          ],
        ),
      ),
    );
  }
}

class _SyncStatus extends StatelessWidget {
  const _SyncStatus({required this.state});

  final ExportState state;

  @override
  Widget build(BuildContext context) {
    final (message, color) = switch (state) {
      ExportSucceeded(:final result) => (
        'Exported ${result.totalSamples} samples '
            'from ${result.poseCount} poses.',
        Palette.accepted,
      ),
      ExportEmpty() => (
        'Nothing to export yet — record a pose first.',
        Colors.white70,
      ),
      ExportFailed(:final failure) => (failure.message, Palette.discarded),
      _ => (null, Colors.white70),
    };

    if (message == null) return const SizedBox(height: Spacing.md);
    return Padding(
      padding: const EdgeInsets.only(top: Spacing.sm),
      child: Text(
        message,
        key: const Key('sync-status'),
        textAlign: TextAlign.center,
        style: TextStyle(color: color, fontSize: 14),
      ),
    );
  }
}

class _CatalogError extends StatelessWidget {
  const _CatalogError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Spacing.screen,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: Palette.discarded),
          const SizedBox(height: Spacing.md),
          const Text(
            'The pose catalog could not be loaded.',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: Spacing.sm),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white60),
          ),
        ],
      ),
    );
  }
}
