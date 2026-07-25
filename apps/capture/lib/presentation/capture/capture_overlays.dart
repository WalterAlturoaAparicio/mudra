/// Capture overlays: countdown and result summary.
///
/// Widgets only — every value here comes from [CaptureSessionState]. The
/// countdown deliberately shows the live preview, the counter, **and** the pose
/// reference together (FR-012), because the moment a user needs the reference
/// most is while they are shaping their hands.
library;

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/capture/capture_state.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// The countdown shown over the live preview.
class CountdownOverlay extends StatelessWidget {
  /// Creates a countdown overlay.
  const CountdownOverlay({
    required this.state,
    required this.pose,
    super.key,
  });

  /// Current countdown state.
  final CountdownState state;

  /// The pose being collected, for the reference thumbnail.
  final PoseDefinition pose;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // Dim the preview enough for the digit to read, never enough to hide
        // the user's own hands.
        const Positioned.fill(child: ColoredBox(color: Colors.black38)),
        Positioned.fill(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text(
                'Get ready',
                style: TextStyle(fontSize: 20, color: Colors.white70),
              ),
              const SizedBox(height: Spacing.sm),
              Text(
                '${state.displayValue}',
                key: const Key('countdown-digit'),
                style: const TextStyle(
                  fontSize: 140,
                  height: 1,
                  fontWeight: FontWeight.w800,
                  color: Palette.countdown,
                ),
              ),
              const SizedBox(height: Spacing.md),
              RequiredHandsBadge(requiredHands: pose.requiredHands),
            ],
          ),
        ),
        // FR-012: the reference stays on screen through the countdown.
        Positioned(
          right: Spacing.md,
          top: Spacing.md,
          child: SizedBox(
            key: const Key('countdown-reference'),
            width: 96,
            height: 96,
            child: PoseReferenceImage(
              assetPath: pose.referenceImage,
              displayName: pose.displayName,
              compact: true,
            ),
          ),
        ),
      ],
    );
  }
}

/// Live accepted/discarded tallies during the capture window.
class CapturingOverlay extends StatelessWidget {
  /// Creates a capturing overlay.
  const CapturingOverlay({required this.state, super.key});

  /// Current capturing state.
  final CapturingState state;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: Palette.discarded, width: 6),
            ),
          ),
        ),
        Positioned(
          left: Spacing.md,
          top: Spacing.md,
          child: Row(
            children: [
              const Icon(Icons.circle, color: Palette.discarded, size: 14),
              const SizedBox(width: Spacing.sm),
              Text(
                'Recording  ${state.accepted}',
                key: const Key('capturing-count'),
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: LinearProgressIndicator(
            value: state.progress,
            minHeight: 6,
            backgroundColor: Colors.transparent,
            valueColor: const AlwaysStoppedAnimation<Color>(Palette.discarded),
          ),
        ),
      ],
    );
  }
}

/// The result of a finished session: accepted, discarded, and why.
class CaptureSummaryCard extends StatelessWidget {
  /// Creates a summary card.
  const CaptureSummaryCard({
    required this.result,
    required this.onDismiss,
    super.key,
  });

  /// What the session produced.
  final CaptureResult result;

  /// Called when the user acknowledges the summary.
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Palette.elevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Captured',
              style: TextStyle(fontSize: 16, color: Colors.white70),
            ),
            const SizedBox(height: Spacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  '${result.accepted}',
                  key: const Key('summary-accepted'),
                  style: const TextStyle(
                    fontSize: 56,
                    fontWeight: FontWeight.w800,
                    color: Palette.accepted,
                  ),
                ),
                const SizedBox(width: Spacing.sm),
                const Text(
                  'valid samples',
                  style: TextStyle(fontSize: 18, color: Colors.white70),
                ),
              ],
            ),
            const SizedBox(height: Spacing.xs),
            Text(
              '${result.discarded} discarded',
              key: const Key('summary-discarded'),
              style: TextStyle(
                fontSize: 16,
                color: result.discarded == 0 ? Colors.white54 : Palette.discarded,
              ),
            ),
            if (_hint != null) ...[
              const SizedBox(height: Spacing.md),
              Text(
                _hint!,
                key: const Key('summary-hint'),
                style: const TextStyle(fontSize: 15, color: Colors.white70),
              ),
            ],
            const SizedBox(height: Spacing.lg),
            FilledButton(onPressed: onDismiss, child: const Text('Continue')),
          ],
        ),
      ),
    );
  }

  /// A plain-language explanation of the dominant problem, so the user can fix
  /// their next take rather than just seeing that this one was poor.
  String? get _hint {
    if (result.hitLimit) {
      return 'Reached the ${result.accepted}-sample limit for one recording, '
          'so the take finished early. Everything captured was saved.';
    }
    if (result.accepted == 0 && result.discarded == 0) {
      return 'No frames arrived from the camera. Try again.';
    }
    if (result.discarded == 0) return null;

    switch (result.dominantRejection) {
      case RejectionReason.noHands:
        return 'Most frames had no hand in view — keep your hands inside the '
            'frame for the whole second.';
      case RejectionReason.insufficientHands:
        return 'This pose needs both hands in view. Keep them both visible '
            'until the recording finishes.';
      case RejectionReason.wrongLandmarkCount:
      case RejectionReason.nonFiniteCoordinates:
        return 'Some frames were tracked poorly — try better lighting or move '
            'slightly further from the camera.';
      case null:
        return null;
    }
  }
}
