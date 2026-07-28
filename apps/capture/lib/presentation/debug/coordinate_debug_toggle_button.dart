/// The coordinate-pipeline diagnostics toggle — a temporary investigation
/// tool, kept separate from [DebugOverlayToggleButton] so the skeleton view
/// and the coordinate diagnostics can be shown independently.
///
/// Callers must gate this behind `!kReleaseMode`, same as
/// `DebugOverlayToggleButton` — the widget itself has no opinion about build
/// mode.
library;

import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Turns the coordinate-pipeline diagnostic overlay on or off.
class CoordinateDebugToggleButton extends ConsumerWidget {
  /// Creates the toggle button.
  const CoordinateDebugToggleButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(coordinateDebugEnabledProvider);
    return IconButton(
      key: const Key('coordinate-debug-toggle'),
      tooltip: enabled
          ? 'Hide coordinate-pipeline diagnostics'
          : 'Show coordinate-pipeline diagnostics',
      icon: Icon(
        Icons.grid_on,
        color: enabled ? Colors.cyanAccent : Colors.white70,
      ),
      onPressed: () => ref.read(coordinateDebugEnabledProvider.notifier).toggle(),
    );
  }
}
