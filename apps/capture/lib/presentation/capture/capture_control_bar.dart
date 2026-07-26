/// The capture screen's four settings controls: mode, lens, countdown, and
/// take confirmation.
///
/// All four are reachable without leaving the capture screen (FR-105). They live
/// in one widget because they are one idea — the settings the user owns for this
/// capture session — and because FR-071's guarantee is easiest to keep when every
/// mutation goes through the same notifier from the same place.
///
/// A control whose precondition is missing is **disabled with a stated reason**
/// rather than allowed to fail on tap (FR-064/FR-069): telling someone why
/// something is unavailable is the difference between a limitation and a bug.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Renders the settings controls for the current capture session.
class CaptureControlBar extends StatelessWidget {
  /// Creates a control bar.
  const CaptureControlBar({
    required this.settings,
    required this.availableLenses,
    required this.onModeChanged,
    required this.onLensToggled,
    required this.onCountdownChanged,
    required this.onConfirmTakesChanged,
    this.enabled = true,
    super.key,
  });

  /// The live settings.
  final CaptureSettings settings;

  /// Which lenses this device actually has (FR-064/FR-069).
  final Set<LensPosition> availableLenses;

  /// Called when the user picks a different capture mode.
  final ValueChanged<CaptureMode> onModeChanged;

  /// Called when the user switches lens.
  final VoidCallback onLensToggled;

  /// Called when the user turns the countdown on or off.
  final ValueChanged<bool> onCountdownChanged;

  /// Called when the user turns the per-take confirmation on or off.
  final ValueChanged<bool> onConfirmTakesChanged;

  /// Whether the controls accept input; false while a take is in flight.
  final bool enabled;

  /// Whether a mode's default lens exists on this device.
  bool _modeAvailable(CaptureMode mode) => switch (mode) {
    CaptureMode.selfCapture => availableLenses.contains(LensPosition.front),
    CaptureMode.operatorCapture => availableLenses.contains(LensPosition.rear),
  };

  @override
  Widget build(BuildContext context) {
    final canSwitchLens = availableLenses.length > 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _modeSelector(context),
        const SizedBox(height: Spacing.sm),
        Row(
          children: [
            Expanded(
              child: _toggle(
                key: const Key('countdown-toggle'),
                icon: Icons.timer_outlined,
                label: settings.countdownEnabled
                    ? 'Countdown ${settings.countdownSeconds.toStringAsFixed(0)}s'
                    : 'No countdown',
                value: settings.countdownEnabled,
                onChanged: enabled
                    ? (value) => onCountdownChanged(value)
                    : null,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: _toggle(
                key: const Key('confirm-takes-toggle'),
                icon: Icons.fact_check_outlined,
                label: settings.confirmTakes ? 'Review takes' : 'Skip review',
                value: settings.confirmTakes,
                onChanged: enabled
                    ? (value) => onConfirmTakesChanged(value)
                    : null,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Tooltip(
              message: canSwitchLens
                  ? 'Switch camera'
                  : 'This device has only one camera',
              child: IconButton.filledTonal(
                key: const Key('lens-switch-button'),
                onPressed: enabled && canSwitchLens ? onLensToggled : null,
                icon: Icon(
                  settings.lens == LensPosition.front
                      ? Icons.camera_front
                      : Icons.camera_rear,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _modeSelector(BuildContext context) {
    final unavailable = CaptureMode.values.where((m) => !_modeAvailable(m));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<CaptureMode>(
          key: const Key('capture-mode-selector'),
          segments: [
            for (final mode in CaptureMode.values)
              ButtonSegment<CaptureMode>(
                value: mode,
                label: Text(mode.displayName),
                enabled: enabled && _modeAvailable(mode),
              ),
          ],
          selected: {settings.mode},
          showSelectedIcon: false,
          onSelectionChanged: enabled
              ? (selection) => onModeChanged(selection.first)
              : null,
        ),
        // FR-064: say *why* a mode is unavailable, here and now, rather than
        // failing when the user reaches for it.
        for (final mode in unavailable)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.xs),
            child: Text(
              '${mode.displayName} needs a '
              '${mode == CaptureMode.selfCapture ? 'front' : 'rear'} camera, '
              'which this device does not have.',
              style: const TextStyle(fontSize: 12, color: Colors.white60),
            ),
          ),
      ],
    );
  }

  Widget _toggle({
    required Key key,
    required IconData icon,
    required String label,
    required bool value,
    required ValueChanged<bool>? onChanged,
  }) {
    return OutlinedButton.icon(
      key: key,
      onPressed: onChanged == null ? null : () => onChanged(!value),
      icon: Icon(icon, size: 18),
      label: Text(label, overflow: TextOverflow.ellipsis),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(44),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        foregroundColor: value ? Palette.primary : Colors.white60,
        side: BorderSide(
          color: value ? Palette.primary : Colors.white24,
        ),
      ),
    );
  }
}
