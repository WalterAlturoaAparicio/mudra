/// The `fadeWithLines` effect: radiating lines while the anchor fades out —
/// a lightweight stand-in for "teleportation" (`tp`).
library;

import 'dart:math' as math;

import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:flutter/rendering.dart';

/// Paints [EffectPainter]'s fade-with-lines variant.
class FadeWithLinesPainter extends EffectPainter {
  /// Creates a fade-with-lines painter.
  FadeWithLinesPainter({
    required super.anchor,
    required super.progress,
    required super.color,
    required super.intensity,
  });

  static const int _lineCount = 10;

  @override
  void paint(Canvas canvas, Size size) {
    final center = anchorPx(size);
    final t = progress.value;
    final maxLength = 30 + 90 * intensity;
    final fadeOpacity = (1 - t).clamp(0.0, 1.0);

    final linePaint = Paint()
      ..color = color.withValues(alpha: fadeOpacity)
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round;

    for (var i = 0; i < _lineCount; i++) {
      final angle = (2 * math.pi * i) / _lineCount;
      final length = maxLength * (0.4 + 0.6 * t);
      final start = center + Offset(math.cos(angle), math.sin(angle)) * (length * 0.3);
      final end = center + Offset(math.cos(angle), math.sin(angle)) * length;
      canvas.drawLine(start, end, linePaint);
    }

    final corePaint = Paint()..color = color.withValues(alpha: fadeOpacity * 0.6);
    canvas.drawCircle(center, 18 * (1 - t), corePaint);
  }
}
