/// The `spritePair` effect: two shapes anchored above the hand (e.g. ears,
/// feathers). Sprite assets are intentionally not used (contracts/
/// effect-catalog.md's placeholder-safety rule) — every pair is a drawn
/// shape, so absence of `sprite_asset` is the normal case, not a fallback
/// path.
library;

import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:flutter/rendering.dart';

/// Paints [EffectPainter]'s sprite-pair variant as two simple drawn shapes.
class SpritePairPainter extends EffectPainter {
  /// Creates a sprite-pair painter.
  SpritePairPainter({
    required super.anchor,
    required super.progress,
    required super.color,
    required super.intensity,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = anchorPx(size);
    final t = progress.value;
    final grow = easeOutBack(t);
    final spacing = (30 + 40 * intensity) * grow;
    final shapeSize = (18 + 22 * intensity) * grow;
    final opacity = t < 0.85 ? 1.0 : (1 - t) / 0.15;

    final paint = Paint()
      ..color = color.withValues(alpha: opacity.clamp(0.0, 1.0))
      ..style = PaintingStyle.fill;

    for (final dx in [-spacing, spacing]) {
      final origin = center.translate(dx, -shapeSize * 1.5);
      final path = Path()
        ..moveTo(origin.dx, origin.dy + shapeSize)
        ..lineTo(origin.dx - shapeSize * 0.5, origin.dy - shapeSize)
        ..lineTo(origin.dx + shapeSize * 0.5, origin.dy - shapeSize)
        ..close();
      canvas.drawPath(path, paint);
    }
  }
}

/// A tiny ease-out-back curve, inlined to avoid depending on the Flutter
/// animation curve catalog for one demo-quality easing.
double easeOutBack(double t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  final shifted = t - 1;
  return 1 + c3 * shifted * shifted * shifted + c1 * shifted * shifted;
}
