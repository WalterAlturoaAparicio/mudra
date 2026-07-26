/// The canonical viewing convention (FR-053–FR-058).
///
/// Every stored sample uses **one** mirroring convention — the mirrored
/// front-camera view every sample collected before revision R1 already uses —
/// regardless of which lens produced it. Captures from a lens whose image does
/// not match it are converted here, at the camera seam, before any consumer sees
/// a frame.
///
/// Three things make this correct, and all three are load-bearing:
///
/// 1. **Handedness must flip with the geometry.** MediaPipe derives the
///    handedness label assuming a mirrored, selfie-view input image. Flipping the
///    image without relabelling produces a sample whose label names the wrong
///    physical hand — the silent corruption FR-044 exists to prevent, invisible
///    in the data afterwards.
/// 2. **Normalization cannot absorb it.** `translation_scale` is a translation
///    followed by a uniform scale; a reflection is neither, so mirrored and
///    unmirrored captures of the same hand do *not* converge under
///    normalization. That is why FR-055 requires conversion on every persisted
///    landmark set, before normalization runs.
/// 3. **Hands are converted in place, never reordered.** Each entry keeps its
///    own landmarks with its own relabelled handedness (FR-054). The list may no
///    longer read left-then-right, but no entry ever acquires another hand's
///    geometry.
///
/// Conversion never touches camera metadata (FR-058): a converted sample still
/// reports the lens and mirroring actually used, which is what makes the
/// transform auditable rather than invisible.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/landmarks/landmarks.dart';

/// Converts landmark frames into the canonical viewing convention.
abstract interface class CanonicalViewConverter {
  /// Returns [frame] expressed in [ViewConvention.canonical].
  ///
  /// Pure, deterministic, and never mutates its input. A frame already in the
  /// canonical convention is returned unchanged, which makes the operation
  /// involutive: `toCanonical(toCanonical(f)) == toCanonical(f)`.
  LandmarkFrame toCanonical(LandmarkFrame frame);
}

/// Mirrors non-canonical frames about the vertical axis and relabels handedness.
class MirrorCanonicalViewConverter implements CanonicalViewConverter {
  /// Creates a converter.
  const MirrorCanonicalViewConverter();

  @override
  LandmarkFrame toCanonical(LandmarkFrame frame) {
    if (frame.isCanonical) return frame;

    return frame.withHands(
      [for (final hand in frame.hands) _convertHand(hand)],
      convention: ViewConvention.canonical,
    );
  }

  /// Converts one hand, preserving its identity (FR-054).
  HandDetection _convertHand(HandDetection hand) => HandDetection(
    handedness: hand.handedness.flipped,
    confidence: hand.confidence,
    landmarks: _mirrorLandmarks(hand.landmarks),
  );

  /// Reflects about the vertical axis.
  ///
  /// Only `x` changes: mirroring is a horizontal reflection, so `y`, `z`, and
  /// `visibility` are untouched. `x` is normalized to `[0, 1]` against the
  /// analysis frame, so the reflection is `1 - x` — and points slightly outside
  /// the frame stay slightly outside it, symmetrically.
  HandLandmarks _mirrorLandmarks(HandLandmarks landmarks) => HandLandmarks([
    for (final point in landmarks.points)
      Landmark(
        x: 1.0 - point.x,
        y: point.y,
        z: point.z,
        visibility: point.visibility,
      ),
  ]);
}
