/// The `particleBurst` effect: a fixed ring of particles flying outward from
/// the anchor and fading as they go.
library;

import 'dart:math' as math;

import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:flutter/rendering.dart';

/// Paints [EffectPainter]'s particle-burst variant.
class ParticleBurstPainter extends EffectPainter {
  /// Creates a particle-burst painter.
  ParticleBurstPainter({
    required super.anchor,
    required super.progress,
    required super.color,
    required super.intensity,
  });

  static const int _particleCount = 14;

  @override
  void paint(Canvas canvas, Size size) {
    final center = anchorPx(size);
    final t = progress.value;
    final maxDistance = 50 + 100 * intensity;
    final particleRadius = 4 + 3 * intensity;

    for (var i = 0; i < _particleCount; i++) {
      // Deterministic pseudo-scatter: each particle gets a fixed angle and a
      // slightly different speed, derived from its index — no randomness
      // needed for a one-shot demo effect, and it stays reproducible.
      final angle = (2 * math.pi * i) / _particleCount;
      final speed = 0.7 + 0.3 * ((i * 37) % 10) / 10;
      final distance = maxDistance * t * speed;
      final position = center + Offset(math.cos(angle), math.sin(angle)) * distance;
      final opacity = (1 - t).clamp(0.0, 1.0);

      final paint = Paint()..color = color.withValues(alpha: opacity);
      canvas.drawCircle(position, particleRadius * (1 - t * 0.5), paint);
    }
  }
}
