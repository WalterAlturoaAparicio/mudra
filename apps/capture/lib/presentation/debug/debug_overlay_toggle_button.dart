/// The debug overlay's runtime toggle (spec 003 Revision R2, FR-123/FR-125).
///
/// Callers must gate this behind `!kReleaseMode` — the widget itself has no
/// opinion about build mode, so it stays trivially testable, but nothing in
/// this application composes it into a release build's widget tree.
library;

import 'package:capture/presentation/design/design.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Turns the hand landmark debug overlay on or off.
class DebugOverlayToggleButton extends ConsumerWidget {
  /// Creates the toggle button.
  const DebugOverlayToggleButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(debugOverlayEnabledProvider);
    return IconButton(
      key: const Key('debug-overlay-toggle'),
      tooltip: enabled
          ? 'Hide hand landmark debug overlay'
          : 'Show hand landmark debug overlay',
      icon: Icon(
        Icons.bug_report,
        color: enabled ? Palette.primary : Colors.white70,
      ),
      onPressed: () => ref.read(debugOverlayEnabledProvider.notifier).toggle(),
    );
  }
}
