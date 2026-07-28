/// Draws the 21 landmarks and the standard MediaPipe hand skeleton for every
/// detected hand in a [LandmarkFrame] (spec 003 Revision R2, FR-118/FR-119).
library;

import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/rendering.dart';

/// The MediaPipe `HAND_CONNECTIONS` topology: palm, then each finger,
/// expressed as landmark-index pairs. Fixed by the detector's own point
/// order, never derived at runtime.
const List<(int, int)> handConnections = [
  // Palm
  (0, 1), (0, 5), (5, 9), (9, 13), (13, 17), (0, 17),
  // Thumb
  (1, 2), (2, 3), (3, 4),
  // Index
  (5, 6), (6, 7), (7, 8),
  // Middle
  (9, 10), (10, 11), (11, 12),
  // Ring
  (13, 14), (14, 15), (15, 16),
  // Pinky
  (17, 18), (18, 19), (19, 20),
];

/// One hand's stroke/fill pair, built once and reused across frames rather
/// than allocated per paint call.
class _HandStyle {
  _HandStyle(Color color)
    : line = Paint()
        ..color = color
        ..strokeWidth = 3
        ..style = PaintingStyle.stroke,
      point = Paint()
        ..color = color
        ..style = PaintingStyle.fill;

  final Paint line;
  final Paint point;
}

final Map<Handedness, _HandStyle> _styles = {
  Handedness.left: _HandStyle(Palette.leftHand),
  Handedness.right: _HandStyle(Palette.rightHand),
  Handedness.unknown: _HandStyle(Palette.unknownHand),
};

/// Paints [frame]'s hands over whatever `Size` the enclosing `CustomPaint`
/// resolves to.
///
/// [frame] MUST be a **raw** (uncanonicalized) frame — from
/// `CameraSessionController.rawFrames`, never `.frames` — because
/// [calibration]'s overlay transform is tuned against the raw, un-mirrored-
/// for-storage stream. Applying it on top of the dataset-canonicalized
/// stream would double-mirror a rear-lens frame and never correct a
/// front-lens one; see [CameraCalibration]'s doc for the full explanation of
/// why this is a persisted, per-lens, per-device value rather than something
/// derived automatically.
class HandLandmarkPainter extends CustomPainter {
  /// Creates a painter for [frame]; `null` paints nothing.
  const HandLandmarkPainter({required this.frame, required this.calibration});

  /// The most recently received **raw** frame, or `null` before the first one.
  final LandmarkFrame? frame;

  /// This lens's persisted overlay calibration — the analysis-space →
  /// display-space transform for the live session.
  final CameraCalibration calibration;

  @override
  void paint(Canvas canvas, Size size) {
    final currentFrame = frame;
    if (currentFrame == null) return;

    for (final hand in currentFrame.hands) {
      final style = _styles[hand.handedness]!;
      final points = hand.landmarks.points;

      for (final (a, b) in handConnections) {
        canvas.drawLine(_toPx(points[a], size), _toPx(points[b], size), style.line);
      }
      for (final point in points) {
        canvas.drawCircle(_toPx(point, size), 4, style.point);
      }
    }
  }

  Offset _toPx(Landmark point, Size size) {
    final (x, y) = calibration.mapOverlayPoint(point.x, point.y);
    return Offset(x * size.width, y * size.height);
  }

  @override
  bool shouldRepaint(covariant HandLandmarkPainter oldDelegate) =>
      !identical(oldDelegate.frame, frame) || oldDelegate.calibration != calibration;
}
