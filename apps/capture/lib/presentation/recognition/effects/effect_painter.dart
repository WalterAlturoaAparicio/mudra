/// Shared base for every confirmed-pose effect painter (research D8).
///
/// Positioned from [anchor] — a normalized `[0, 1]` point in the same
/// coordinate space `HandLandmarks` already use, mapped to pixels only here,
/// at paint time — so every painter shares one anchoring rule instead of each
/// reinventing it.
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:flutter/material.dart' show Animation, Color;
import 'package:flutter/rendering.dart';

/// Converts a domain [EffectColor] into a Flutter [Color].
Color effectColorToUi(EffectColor color) =>
    Color.fromARGB(255, color.red, color.green, color.blue);

/// Base class every effect [CustomPainter] extends.
///
/// Repaints on every animation tick ([progress] is the playback
/// `AnimationController`'s value), never on anything else — an effect's
/// frames are entirely determined by its own playback position.
abstract class EffectPainter extends CustomPainter {
  /// Creates a painter anchored at [anchor], driven by [progress].
  EffectPainter({
    required this.anchor,
    required this.progress,
    required this.color,
    required this.intensity,
  }) : super(repaint: progress);

  /// Normalized `[0, 1]` anchor point, in the same space as hand landmarks.
  final Offset anchor;

  /// `0` at playback start, `1` at playback end.
  final Animation<double> progress;

  /// Effect color; painters supply their own default when absent upstream.
  final Color color;

  /// `[0, 1]`; scales size/duration-derived visuals.
  final double intensity;

  /// [anchor] mapped into [size]'s pixel space.
  Offset anchorPx(Size size) => Offset(anchor.dx * size.width, anchor.dy * size.height);

  // The `repaint` listenable above already triggers a repaint on every
  // animation tick, reading `progress.value` fresh each time — always true
  // here just means a changed anchor/color/intensity between confirmations
  // is never missed either.
  @override
  bool shouldRepaint(covariant EffectPainter oldDelegate) => true;
}
