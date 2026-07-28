/// Runtime on/off flag for the developer-only hand landmark debug overlay
/// (spec 003 Revision R2, FR-117/FR-123).
///
/// Scoped to the application run, like [CaptureSettingsNotifier] — this is
/// developer state, never persisted (FR-075's "no persisted preferences" rule
/// applies here too, even though this notifier is not a capture setting).
/// Its toggle control is only ever reachable in a non-release build
/// (FR-125); this notifier itself has no opinion about build mode, so it
/// stays trivially testable.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Holds whether the hand landmark debug overlay is currently visible.
class DebugOverlayNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  /// Flips the overlay on or off.
  void toggle() => state = !state;

  /// Sets the overlay's visibility explicitly.
  void setEnabled({required bool enabled}) => state = enabled;
}
