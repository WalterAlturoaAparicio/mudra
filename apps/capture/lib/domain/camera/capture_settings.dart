/// The live, user-owned state of a **capture session** (one visit to the
/// capture screen).
///
/// **The single rule that governs this type**: values change when the user
/// changes them, or when the mode changes (which re-initializes all of them from
/// the new profile). Nothing else — not a lens switch (FR-074), not
/// backgrounding, not screen lock, not screen recreation, not a completed take,
/// and not re-entering the capture screen with the same mode — alters them.
/// SC-032 is the test of exactly that rule.
library;

import 'package:capture/domain/camera/camera.dart';

/// Mode, lens, countdown, and take-confirmation for the current capture session.
class CaptureSettings {
  /// Creates capture settings.
  const CaptureSettings({
    required this.mode,
    required this.lens,
    required this.countdownEnabled,
    required this.countdownSeconds,
    required this.confirmTakes,
  });

  /// Builds the initial settings a [mode] establishes (FR-060/FR-061/FR-071).
  ///
  /// Called exactly twice in a capture session's life: when the capture screen
  /// is first entered, and whenever the mode changes.
  factory CaptureSettings.fromProfile(
    CaptureMode mode,
    CaptureProfile profile, {
    bool confirmTakes = true,
  }) => CaptureSettings(
    mode: mode,
    lens: profile.defaultLens,
    countdownEnabled: profile.countdownEnabled,
    countdownSeconds: profile.countdownSeconds,
    confirmTakes: confirmTakes,
  );

  /// The active capture mode.
  final CaptureMode mode;

  /// The active lens. Changed by the user only (FR-065).
  final LensPosition lens;

  /// Whether a countdown precedes a take (FR-072).
  final bool countdownEnabled;

  /// Countdown length in seconds when enabled.
  final double countdownSeconds;

  /// Whether each completed take pauses for review (FR-077/FR-078).
  final bool confirmTakes;

  /// Whether the preview is mirrored.
  ///
  /// **Derived, never stored**: mirroring follows the active lens (FR-067), and
  /// a stored copy could disagree with the lens — which FR-067 says it never
  /// may.
  bool get mirrored => lens.defaultConvention.isMirrored;

  /// The countdown as a [Duration]; [Duration.zero] when disabled.
  Duration get countdown => countdownEnabled
      ? Duration(microseconds: (countdownSeconds * 1000000).round())
      : Duration.zero;

  /// The countdown length written into sample metadata.
  ///
  /// `0.0` when disabled — a zero-length countdown, which is what the engine's
  /// own default already means. No field becomes newly nullable.
  double get recordedCountdownSeconds => countdownEnabled ? countdownSeconds : 0;

  /// Returns a copy with the given fields replaced.
  CaptureSettings copyWith({
    CaptureMode? mode,
    LensPosition? lens,
    bool? countdownEnabled,
    double? countdownSeconds,
    bool? confirmTakes,
  }) => CaptureSettings(
    mode: mode ?? this.mode,
    lens: lens ?? this.lens,
    countdownEnabled: countdownEnabled ?? this.countdownEnabled,
    countdownSeconds: countdownSeconds ?? this.countdownSeconds,
    confirmTakes: confirmTakes ?? this.confirmTakes,
  );

  @override
  bool operator ==(Object other) =>
      other is CaptureSettings &&
      other.mode == mode &&
      other.lens == lens &&
      other.countdownEnabled == countdownEnabled &&
      other.countdownSeconds == countdownSeconds &&
      other.confirmTakes == confirmTakes;

  @override
  int get hashCode =>
      Object.hash(mode, lens, countdownEnabled, countdownSeconds, confirmTakes);

  @override
  String toString() =>
      'CaptureSettings(${mode.wireValue}, ${lens.wireValue}, '
      'countdown: $countdownEnabled@$countdownSeconds, confirm: $confirmTakes)';
}
