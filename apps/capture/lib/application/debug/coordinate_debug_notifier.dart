/// Runtime on/off flag for the coordinate-pipeline diagnostic overlay — a
/// **temporary investigation tool** (see `CoordinateDebugPainter`'s doc
/// comment), kept separate from [DebugOverlayNotifier] so the skeleton view
/// and the coordinate diagnostics can be toggled independently.
///
/// Same lifetime and persistence rules as [DebugOverlayNotifier]: scoped to
/// the application run, off by default, never persisted.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Holds whether the coordinate-pipeline diagnostic overlay is visible.
class CoordinateDebugNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  /// Flips the diagnostics on or off.
  void toggle() => state = !state;
}
