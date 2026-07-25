/// Design tokens and shared widgets.
///
/// The brief asks for something closer to a learning app than a developer tool:
/// large targets, minimal text, one obvious action. These tokens keep that
/// consistent without every widget inventing its own spacing.
library;

import 'package:flutter/material.dart';

/// Spacing scale, in logical pixels.
class Spacing {
  /// Tight spacing.
  static const double xs = 4;

  /// Small spacing.
  static const double sm = 8;

  /// Default spacing.
  static const double md = 16;

  /// Generous spacing.
  static const double lg = 24;

  /// Section spacing.
  static const double xl = 32;

  /// Screen padding.
  static const EdgeInsets screen = EdgeInsets.all(md);
}

/// Palette.
class Palette {
  /// Primary brand colour.
  static const Color primary = Color(0xFF4C6FFF);

  /// Positive/accepted colour.
  static const Color accepted = Color(0xFF2BB673);

  /// Negative/discarded colour.
  static const Color discarded = Color(0xFFE2574C);

  /// Countdown accent.
  static const Color countdown = Color(0xFFFFC24B);

  /// Surface behind cards.
  static const Color surface = Color(0xFF14161C);

  /// Elevated surface.
  static const Color elevated = Color(0xFF1E212A);
}

/// The application theme.
ThemeData buildCaptureTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: Palette.surface,
    colorScheme: base.colorScheme.copyWith(
      primary: Palette.primary,
      secondary: Palette.countdown,
      surface: Palette.surface,
    ),
    textTheme: base.textTheme.apply(fontSizeFactor: 1.05),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(72),
        textStyle: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    ),
  );
}

/// A thick, readable progress bar with its numbers beside it.
class ProgressBar extends StatelessWidget {
  /// Creates a progress bar.
  const ProgressBar({
    required this.fraction,
    required this.collected,
    required this.target,
    this.isComplete = false,
    super.key,
  });

  /// Completion in `[0, 1]`.
  final double fraction;

  /// Samples collected so far.
  final int collected;

  /// Target for this pose.
  final int target;

  /// Whether the target has been reached.
  final bool isComplete;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '$collected / $target',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            if (isComplete)
              const Row(
                children: [
                  Icon(Icons.check_circle, color: Palette.accepted, size: 20),
                  SizedBox(width: Spacing.xs),
                  Text(
                    'Complete',
                    style: TextStyle(
                      color: Palette.accepted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
          ],
        ),
        const SizedBox(height: Spacing.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 14,
            backgroundColor: Palette.elevated,
            valueColor: AlwaysStoppedAnimation<Color>(
              isComplete ? Palette.accepted : Palette.primary,
            ),
          ),
        ),
      ],
    );
  }
}

/// The pose reference image, or a neutral placeholder when the asset is absent.
///
/// A missing image must never break the screen or block collection (FR-005):
/// artwork can be dropped in later with no code change.
class PoseReferenceImage extends StatelessWidget {
  /// Creates a reference image.
  const PoseReferenceImage({
    required this.assetPath,
    required this.displayName,
    this.description = '',
    this.compact = false,
    super.key,
  });

  /// Asset path, which may not exist yet.
  final String? assetPath;

  /// Pose name, shown in the placeholder.
  final String displayName;

  /// Pose description, shown in the placeholder when there is room.
  final String description;

  /// Whether to render the small variant used during a countdown.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final path = assetPath;
    return ClipRRect(
      borderRadius: BorderRadius.circular(compact ? 12 : 20),
      child: ColoredBox(
        color: Palette.elevated,
        child: path == null
            ? _placeholder(context)
            : Image.asset(
                path,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stack) => _placeholder(context),
              ),
      ),
    );
  }

  Widget _placeholder(BuildContext context) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(compact ? Spacing.sm : Spacing.lg),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.back_hand_outlined,
              size: compact ? 28 : 56,
              color: Colors.white24,
            ),
            SizedBox(height: compact ? Spacing.xs : Spacing.md),
            Text(
              displayName,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: compact ? 14 : 22,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (!compact && description.isNotEmpty) ...[
              const SizedBox(height: Spacing.sm),
              Text(
                description,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60, fontSize: 14),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A short label describing how many hands a pose needs (FR-019b).
class RequiredHandsBadge extends StatelessWidget {
  /// Creates the badge.
  const RequiredHandsBadge({required this.requiredHands, super.key});

  /// How many hands the pose requires.
  final int requiredHands;

  @override
  Widget build(BuildContext context) {
    final label = requiredHands == 2 ? 'Both hands' : 'One hand';
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.sm,
        vertical: Spacing.xs,
      ),
      decoration: BoxDecoration(
        color: Palette.elevated,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            requiredHands == 2 ? Icons.sign_language : Icons.back_hand,
            size: 16,
            color: Colors.white70,
          ),
          const SizedBox(width: Spacing.xs),
          Text(
            label,
            style: const TextStyle(fontSize: 13, color: Colors.white70),
          ),
        ],
      ),
    );
  }
}
