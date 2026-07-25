/// Translation + scale normalization.
///
/// A port of the Mudra engine's `translation_scale` strategy, version 1.0,
/// performed operation-for-operation so both applications produce bit-identical
/// output for the same input (research D4). Parity is pinned by golden fixtures
/// generated from the Python implementation — not by re-deriving the maths.
///
/// Re-origins each hand at the wrist and scales uniformly by the wrist-to-middle
/// -finger-MCP distance, removing where the hand is in frame and how far it is
/// from the camera while preserving orientation. Rotation is deliberately kept.
library;

import 'dart:math' as math;

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';

/// Spans below this are treated as degenerate and fall back to scale 1.0.
const double degenerateSpanThreshold = 1e-9;

/// Wrist-origin translation + uniform hand-span scale normalizer.
class TranslationScaleNormalizer implements LandmarkNormalizer {
  /// Creates a normalizer using the engine's default landmark indices.
  const TranslationScaleNormalizer({
    this.originIndex = wristLandmarkIndex,
    this.scaleIndex = middleFingerMcpLandmarkIndex,
  });

  /// Landmark used as the translation origin (the wrist).
  final int originIndex;

  /// Landmark whose distance from the origin sets the scale.
  final int scaleIndex;

  @override
  String get strategy => 'translation_scale';

  @override
  String get version => '1.0';

  @override
  HandLandmarks normalize(HandLandmarks hand) {
    final origin = hand.points[originIndex];
    final reference = hand.points[scaleIndex];

    final dx = reference.x - origin.x;
    final dy = reference.y - origin.y;
    final dz = reference.z - origin.z;
    var span = math.sqrt(dx * dx + dy * dy + dz * dz);

    // A collapsed hand would divide by ~zero; translate only rather than
    // producing infinities that would poison the dataset.
    if (span < degenerateSpanThreshold) {
      span = 1.0;
    }

    return HandLandmarks([
      for (final p in hand.points)
        Landmark(
          x: (p.x - origin.x) / span,
          y: (p.y - origin.y) / span,
          z: (p.z - origin.z) / span,
          visibility: p.visibility,
        ),
    ]);
  }
}
