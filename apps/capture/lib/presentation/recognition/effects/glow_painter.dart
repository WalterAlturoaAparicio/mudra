/// The `glow` effect: a soft colored ring pulsing outward from the anchor.
library;

import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:flutter/rendering.dart';

/// Paints [EffectPainter]'s glow variant.
class GlowPainter extends EffectPainter {
  /// Creates a glow painter.
  GlowPainter({
    required super.anchor,
    required super.progress,
    required super.color,
    required super.intensity,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = anchorPx(size);
    final baseRadius = 40 + 60 * intensity;
    final t = progress.value;

    // A soft radial glow that expands and fades, plus a brighter core —
    // demo-quality, vector only (FR-021).
    final glowRadius = baseRadius * (0.6 + 0.6 * t);
    final glowPaint = Paint()
      ..shader = RadialGradient(
        colors: [color.withValues(alpha: 0.55 * (1 - t)), color.withValues(alpha: 0)],
      ).createShader(Rect.fromCircle(center: center, radius: glowRadius))
      ..style = PaintingStyle.fill;
    canvas.drawCircle(center, glowRadius, glowPaint);

    final corePaint = Paint()
      ..color = color.withValues(alpha: 0.8 * (1 - t * 0.5))
      ..style = PaintingStyle.fill;
    canvas.drawCircle(center, baseRadius * 0.25, corePaint);
  }
}
