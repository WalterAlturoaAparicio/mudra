/// Owns the capture session's settings — mode, lens, countdown, confirmation.
///
/// **One rule governs this whole class**: a setting changes when the *user*
/// changes it, or when the *mode* changes (which re-initializes all of them from
/// the new profile). Nothing else does — not a lens switch (FR-074), not
/// backgrounding, not screen lock, not screen recreation, not a completed take,
/// and not re-entering the capture screen with the same mode (FR-071).
///
/// That is why this is scoped to the **application run** rather than to the
/// capture screen widget: a screen the operating system recreates must not
/// silently reset a user's countdown, and FR-063's "remember the most recent
/// mode" then needs no extra mechanism. Nothing is persisted across application
/// runs (FR-075).
///
/// SC-032 is the test of exactly this rule: across mode initialization, lens
/// switches, backgrounding, and screen lock, **zero** unrequested changes.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Holds the live [CaptureSettings] for the current capture session.
class CaptureSettingsNotifier extends Notifier<CaptureSettings> {
  /// Creates the notifier.
  CaptureSettingsNotifier(this._config);

  final CaptureConfig _config;

  @override
  CaptureSettings build() => _initial(CaptureMode.selfCapture);

  CaptureSettings _initial(CaptureMode mode) => CaptureSettings.fromProfile(
    mode,
    _config.profileFor(mode),
    confirmTakes: _config.defaultConfirmTakes,
  );

  /// Changes the capture mode, re-initializing every setting from its profile.
  ///
  /// The **only** operation that resets anything the user chose. Selecting the
  /// mode already in effect is a no-op, so tapping the active mode cannot be
  /// used to reset settings by accident.
  void selectMode(CaptureMode mode) {
    if (mode == state.mode) return;
    state = _initial(mode);
  }

  /// Switches to [lens] (FR-065).
  ///
  /// Mirroring follows the lens because it is derived, not stored (FR-067), and
  /// the countdown is deliberately untouched (FR-074).
  void selectLens(LensPosition lens) {
    if (lens == state.lens) return;
    state = state.copyWith(lens: lens);
  }

  /// Switches to the other lens.
  void toggleLens() => selectLens(state.lens.opposite);

  /// Turns the countdown on or off for the current capture session (FR-072).
  void setCountdownEnabled({required bool enabled}) {
    if (enabled == state.countdownEnabled) return;
    state = state.copyWith(countdownEnabled: enabled);
  }

  /// Turns the per-take confirmation on or off (FR-078).
  void setConfirmTakes({required bool enabled}) {
    if (enabled == state.confirmTakes) return;
    state = state.copyWith(confirmTakes: enabled);
  }

  /// Builds the camera request the current settings imply.
  CameraRequest get cameraRequest => CameraRequest(
    lens: state.lens,
    analysisWidth: _config.analysisWidth,
    analysisHeight: _config.analysisHeight,
  );
}
