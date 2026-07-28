/// Visual coordinate-pipeline diagnostics — a **temporary** investigation
/// tool, not a permanent feature, added to determine (by eye, on a real
/// device) which of mirror / rotation / scaling / translation /
/// aspect-ratio cropping / width-height swap explains why the debug
/// overlay's landmarks do not land on the hand shown by the live preview.
///
/// Draws, all in **display space** (the same `CustomPaint` box the preview
/// `Texture` and [HandLandmarkPainter] already share):
///
/// - **Canvas bounds** (yellow): the actual paintable rectangle — always
///   `(0,0)` to `(size.width, size.height)`, drawn so a mismatch against the
///   preview's visible bounds (e.g. from letterbox bands) is obvious.
/// - **"Image rect"** (cyan): the unit square `(0,0)`–`(1,1)` of **analysis**
///   space, mapped through [DisplayOrientation.mapPoint] corner by corner and
///   labeled `TL`/`TR`/`BR`/`BL`. Under the current transform this always
///   coincides exactly with the canvas bounds — rotation and mirroring alone
///   can only permute which analysis corner lands where, never shrink or
///   offset the square (proof: each case in `mapPoint` returns values built
///   from `x`, `y`, `1-x`, `1-y` only). If a future fix adds a scale/crop
///   term, this rectangle is what would visibly separate from the canvas
///   bounds — the tool is future-proofed, not just for today's hypothesis.
/// - **Axes** (red = analysis +X, green = analysis +Y): short arrows from the
///   mapped analysis origin toward mapped `(0.1, 0)` and `(0, 0.1)`, so it is
///   visible at a glance which screen direction each analysis axis currently
///   maps to.
/// - **Landmarks #0 (wrist), #5 (index MCP), #17 (pinky MCP)**: drawn larger
///   than the ordinary skeleton points, in distinct colors, labeled — chosen
///   because they are far enough apart on a real hand that a rotation,
///   mirror, or scale error is visually unambiguous between them, unlike
///   points clustered at a fingertip.
library;

import 'package:capture/domain/canonical/display_orientation.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:flutter/rendering.dart';

/// Landmark indices highlighted by this painter — spread across the palm
/// rather than clustered on one finger, so a rotation/mirror/scale error is
/// unambiguous between them.
const List<(int, String)> coordinateDebugLandmarks = [
  (0, 'L0 wrist'),
  (5, 'L5 index-MCP'),
  (17, 'L17 pinky-MCP'),
];

/// Paints the coordinate diagnostics described in this library's doc comment.
class CoordinateDebugPainter extends CustomPainter {
  /// Creates the painter for [frame] (may be `null` before the first frame),
  /// using [orientation] — the same transform [PreviewStage] and
  /// [HandLandmarkPainter] use.
  const CoordinateDebugPainter({required this.frame, required this.orientation});

  /// The most recently received **raw** frame, or `null`.
  final LandmarkFrame? frame;

  /// The analysis-space → display-space transform in effect.
  final DisplayOrientation orientation;

  @override
  void paint(Canvas canvas, Size size) {
    _paintCanvasBounds(canvas, size);
    _paintImageRect(canvas, size);
    _paintAxes(canvas, size);
    _paintKeyLandmarks(canvas, size);
  }

  void _paintCanvasBounds(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFFFEB3B) // yellow
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRect(Offset.zero & size, paint);
    _label(canvas, 'canvas bounds', const Offset(4, 4), const Color(0xFFFFEB3B));
  }

  void _paintImageRect(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF00E5FF) // cyan
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final corners = <String, Offset>{
      'TL': _px(0, 0, size),
      'TR': _px(1, 0, size),
      'BR': _px(1, 1, size),
      'BL': _px(0, 1, size),
    };
    final path = Path()
      ..moveTo(corners['TL']!.dx, corners['TL']!.dy)
      ..lineTo(corners['TR']!.dx, corners['TR']!.dy)
      ..lineTo(corners['BR']!.dx, corners['BR']!.dy)
      ..lineTo(corners['BL']!.dx, corners['BL']!.dy)
      ..close();
    canvas.drawPath(path, paint);
    for (final entry in corners.entries) {
      canvas.drawCircle(entry.value, 5, Paint()..color = const Color(0xFF00E5FF));
      _label(canvas, entry.key, entry.value + const Offset(6, 6), const Color(0xFF00E5FF));
    }
  }

  void _paintAxes(Canvas canvas, Size size) {
    final origin = _px(0, 0, size);
    final xEnd = _px(0.1, 0, size);
    final yEnd = _px(0, 0.1, size);

    _arrow(canvas, origin, xEnd, const Color(0xFFFF5252)); // red: analysis +X
    _label(canvas, '+X (analysis)', xEnd, const Color(0xFFFF5252));

    _arrow(canvas, origin, yEnd, const Color(0xFF69F0AE)); // green: analysis +Y
    _label(canvas, '+Y (analysis)', yEnd, const Color(0xFF69F0AE));
  }

  void _paintKeyLandmarks(Canvas canvas, Size size) {
    final currentFrame = frame;
    if (currentFrame == null) return;
    for (final hand in currentFrame.hands) {
      for (final (index, label) in coordinateDebugLandmarks) {
        final point = hand.landmarks.points[index];
        final (dx, dy) = orientation.mapPoint(point.x, point.y);
        final at = Offset(dx * size.width, dy * size.height);
        canvas.drawCircle(at, 9, Paint()..color = const Color(0xFFFF00FF));
        canvas.drawCircle(
          at,
          9,
          Paint()
            ..color = const Color(0xFF000000)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5,
        );
        _label(canvas, '${hand.handedness.wireValue[0].toUpperCase()} $label', at + const Offset(10, -10), const Color(0xFFFF00FF));
      }
    }
  }

  Offset _px(double x, double y, Size size) {
    final (dx, dy) = orientation.mapPoint(x, y);
    return Offset(dx * size.width, dy * size.height);
  }

  void _arrow(Canvas canvas, Offset from, Offset to, Color color) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    canvas.drawLine(from, to, paint);
    canvas.drawCircle(to, 3, Paint()..color = color);
  }

  void _label(Canvas canvas, String text, Offset at, Color color) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
          shadows: const [Shadow(color: Color(0xFF000000), blurRadius: 3)],
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(canvas, at);
  }

  @override
  bool shouldRepaint(covariant CoordinateDebugPainter oldDelegate) =>
      !identical(oldDelegate.frame, frame) || oldDelegate.orientation != orientation;
}
