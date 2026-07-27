/// The `genericConfirm` effect: a simple expanding ring, the fallback for
/// any pose with no themed effect declared (FR-020).
library;

import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:flutter/rendering.dart';

/// Paints [EffectPainter]'s generic-confirm fallback variant.
class GenericConfirmPainter extends EffectPainter {
  /// Creates a generic-confirm painter.
  GenericConfirmPainter({
    required super.anchor,
    required super.progress,
    required super.color,
    required super.intensity,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = anchorPx(size);
    final t = progress.value;
    final maxRadius = 30 + 50 * intensity;

    final ringPaint = Paint()
      ..color = color.withValues(alpha: (1 - t).clamp(0.0, 1.0))
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4;
    canvas.drawCircle(center, maxRadius * t, ringPaint);

    final dotPaint = Paint()..color = color.withValues(alpha: (1 - t * 1.2).clamp(0.0, 1.0));
    canvas.drawCircle(center, 10, dotPaint);
  }
}
