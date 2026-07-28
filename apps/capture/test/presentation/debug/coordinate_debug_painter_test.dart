/// `CoordinateDebugPainter` (research D24, temporary investigation tooling):
/// paints without throwing across every rotation/mirror combination and
/// both a present and an absent frame; `shouldRepaint` reacts to both a new
/// frame and a changed orientation.
library;

import 'dart:ui' as ui;

import 'package:capture/domain/canonical/display_orientation.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/debug/coordinate_debug_painter.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

HandDetection _hand(Handedness handedness) {
  final points = List.generate(
    handLandmarkCount,
    (i) => Landmark(x: 0.05 * i, y: 0.03 * i, z: 0),
  );
  return HandDetection(handedness: handedness, confidence: 0.9, landmarks: HandLandmarks(points));
}

LandmarkFrame _frame(List<HandDetection> hands) => LandmarkFrame(
  hands: hands,
  frameWidth: 480,
  frameHeight: 640,
  timestampMicros: 0,
);

void _paintOnce(CoordinateDebugPainter painter, {Size size = const Size(300, 400)}) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  painter.paint(canvas, size);
  recorder.endRecording().dispose();
}

void main() {
  for (final turns in [0, 1, 2, 3]) {
    for (final mirrored in [false, true]) {
      test('paints without throwing: quarterTurns=$turns mirrored=$mirrored, '
          'no frame yet', () {
        final orientation = DisplayOrientation(quarterTurns: turns, mirrored: mirrored);
        expect(
          () => _paintOnce(CoordinateDebugPainter(frame: null, orientation: orientation)),
          returnsNormally,
        );
      });

      test('paints without throwing: quarterTurns=$turns mirrored=$mirrored, '
          'two hands', () {
        final orientation = DisplayOrientation(quarterTurns: turns, mirrored: mirrored);
        final frame = _frame([_hand(Handedness.left), _hand(Handedness.right)]);
        expect(
          () => _paintOnce(
            CoordinateDebugPainter(frame: frame, orientation: orientation),
          ),
          returnsNormally,
        );
      });
    }
  }

  test('paints without throwing with zero hands in the frame', () {
    const orientation = DisplayOrientation(quarterTurns: 0, mirrored: false);
    expect(
      () => _paintOnce(CoordinateDebugPainter(frame: _frame(const []), orientation: orientation)),
      returnsNormally,
    );
  });

  group('shouldRepaint', () {
    const orientation = DisplayOrientation(quarterTurns: 0, mirrored: false);
    final frame = _frame([_hand(Handedness.left)]);

    test('a new frame instance triggers a repaint', () {
      final oldPainter = CoordinateDebugPainter(frame: frame, orientation: orientation);
      final newPainter = CoordinateDebugPainter(
        frame: _frame([_hand(Handedness.left)]),
        orientation: orientation,
      );
      expect(newPainter.shouldRepaint(oldPainter), isTrue);
    });

    test('the identical frame instance does not trigger a repaint', () {
      final oldPainter = CoordinateDebugPainter(frame: frame, orientation: orientation);
      final newPainter = CoordinateDebugPainter(frame: frame, orientation: orientation);
      expect(newPainter.shouldRepaint(oldPainter), isFalse);
    });

    test('a changed orientation triggers a repaint even with the same frame',
        () {
      final oldPainter = CoordinateDebugPainter(frame: frame, orientation: orientation);
      final newPainter = CoordinateDebugPainter(
        frame: frame,
        orientation: const DisplayOrientation(quarterTurns: 1, mirrored: false),
      );
      expect(newPainter.shouldRepaint(oldPainter), isTrue);
    });
  });
}
