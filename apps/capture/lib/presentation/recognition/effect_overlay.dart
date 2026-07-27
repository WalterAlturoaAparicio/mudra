/// Plays exactly one confirmed-pose effect (research D8), positioned via the
/// same screen-space anchoring every painter shares.
///
/// A stateful widget rather than a stream/controller-driven one on purpose:
/// playback is entirely local, one-shot, and has no bearing on recognition
/// (FR-022) — owning its own `AnimationController` keeps it that way, with no
/// path back into `RecognitionSessionController`.
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/presentation/recognition/effects/effect_painter.dart';
import 'package:capture/presentation/recognition/effects/fade_with_lines_painter.dart';
import 'package:capture/presentation/recognition/effects/generic_confirm_painter.dart';
import 'package:capture/presentation/recognition/effects/glow_painter.dart';
import 'package:capture/presentation/recognition/effects/particle_burst_painter.dart';
import 'package:capture/presentation/recognition/effects/sprite_pair_painter.dart';
import 'package:flutter/material.dart';

/// Default playback length for every effect kind (demo-quality, FR-021).
const Duration effectPlaybackDuration = Duration(milliseconds: 1400);

/// Renders one playback of [definition], anchored at [anchor], then calls
/// [onCompleted] exactly once.
class EffectOverlay extends StatefulWidget {
  /// Creates an effect overlay.
  const EffectOverlay({
    required this.definition,
    required this.anchor,
    required this.onCompleted,
    this.duration = effectPlaybackDuration,
    super.key,
  });

  /// What to render — color, kind, intensity (FR-019).
  final EffectDefinition definition;

  /// Normalized `[0, 1]` anchor point, in the same space as hand landmarks.
  final Offset anchor;

  /// Called exactly once, when this playback finishes.
  final VoidCallback onCompleted;

  /// How long the playback runs.
  final Duration duration;

  @override
  State<EffectOverlay> createState() => _EffectOverlayState();
}

class _EffectOverlayState extends State<EffectOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) widget.onCompleted();
      })
      ..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final definition = widget.definition;
    final color = definition.color != null
        ? effectColorToUi(definition.color!)
        : _defaultColorFor(definition.kind);

    return IgnorePointer(
      child: CustomPaint(
        key: const Key('effect-overlay-paint'),
        painter: _painterFor(
          kind: definition.kind,
          anchor: widget.anchor,
          progress: _controller,
          color: color,
          intensity: definition.intensity,
        ),
        size: Size.infinite,
      ),
    );
  }

  EffectPainter _painterFor({
    required EffectKind kind,
    required Offset anchor,
    required Animation<double> progress,
    required Color color,
    required double intensity,
  }) => switch (kind) {
    EffectKind.glow => GlowPainter(
      anchor: anchor,
      progress: progress,
      color: color,
      intensity: intensity,
    ),
    EffectKind.spritePair => SpritePairPainter(
      anchor: anchor,
      progress: progress,
      color: color,
      intensity: intensity,
    ),
    EffectKind.particleBurst => ParticleBurstPainter(
      anchor: anchor,
      progress: progress,
      color: color,
      intensity: intensity,
    ),
    EffectKind.fadeWithLines => FadeWithLinesPainter(
      anchor: anchor,
      progress: progress,
      color: color,
      intensity: intensity,
    ),
    EffectKind.genericConfirm => GenericConfirmPainter(
      anchor: anchor,
      progress: progress,
      color: color,
      intensity: intensity,
    ),
  };

  Color _defaultColorFor(EffectKind kind) => switch (kind) {
    EffectKind.glow => const Color(0xFF2BB673),
    EffectKind.spritePair => const Color(0xFFD9A066),
    EffectKind.particleBurst => const Color(0xFFFF7A3D),
    EffectKind.fadeWithLines => const Color(0xFF4C6FFF),
    EffectKind.genericConfirm => const Color(0xFF4C6FFF),
  };
}
