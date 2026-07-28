/// [CameraCalibration]/[CameraCalibrationSet]: the persisted transform every
/// display consumer (`PreviewStage`, `HandLandmarkPainter`, the recognition
/// effect anchor) now reads from, and the JSON contract Developer UX's
/// export/import depends on.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('CameraCalibration.mapOverlayPoint', () {
    test('identity: nothing changes', () {
      const c = CameraCalibration();
      expect(c.mapOverlayPoint(0.3, 0.7), (0.3, 0.7));
    });

    test('rotation alone matches the standard quarter-turn permutations', () {
      const point = (0.2, 0.7);
      expect(
        const CameraCalibration(overlayRotation: 0).mapOverlayPoint(point.$1, point.$2),
        point,
      );

      final r90 =
          const CameraCalibration(overlayRotation: 90).mapOverlayPoint(point.$1, point.$2);
      expect(r90.$1, closeTo(1 - point.$2, 1e-12));
      expect(r90.$2, closeTo(point.$1, 1e-12));

      final r180 =
          const CameraCalibration(overlayRotation: 180).mapOverlayPoint(point.$1, point.$2);
      expect(r180.$1, closeTo(1 - point.$1, 1e-12));
      expect(r180.$2, closeTo(1 - point.$2, 1e-12));

      final r270 =
          const CameraCalibration(overlayRotation: 270).mapOverlayPoint(point.$1, point.$2);
      expect(r270.$1, closeTo(point.$2, 1e-12));
      expect(r270.$2, closeTo(1 - point.$1, 1e-12));
    });

    test('mirror alone flips only x', () {
      const c = CameraCalibration(overlayMirror: true);
      final (x, y) = c.mapOverlayPoint(0.2, 0.7);
      expect(x, closeTo(0.8, 1e-12));
      expect(y, closeTo(0.7, 1e-12));
    });

    test('swapXY alone exchanges x and y before any rotation', () {
      const c = CameraCalibration(overlaySwapXY: true);
      expect(c.mapOverlayPoint(0.2, 0.7), (0.7, 0.2));
    });

    test('scale is applied about the (0.5, 0.5) center', () {
      const c = CameraCalibration(overlayScale: 2.0);
      expect(c.mapOverlayPoint(0.5, 0.5), (0.5, 0.5));
      final (x, y) = c.mapOverlayPoint(0.75, 0.25);
      expect(x, closeTo(1.0, 1e-12));
      expect(y, closeTo(0.0, 1e-12));
    });

    test('offset is a pure translation, applied last', () {
      const c = CameraCalibration(overlayOffsetX: 0.1, overlayOffsetY: -0.2);
      final (x, y) = c.mapOverlayPoint(0.3, 0.3);
      expect(x, closeTo(0.4, 1e-12));
      expect(y, closeTo(0.1, 1e-12));
    });

    test('order is fixed: swap, then rotate, then mirror, then scale, then '
        'translate — verified by a combination that would differ under any '
        'other order', () {
      const c = CameraCalibration(
        overlaySwapXY: true,
        overlayRotation: 90,
        overlayMirror: true,
        overlayScale: 2.0,
        overlayOffsetX: 0.1,
      );
      // swap -> (0.6, 0.2); rotate 90cw -> (0.8, 0.6); mirror x -> (0.2, 0.6);
      // scale about 0.5 by 2 -> (-0.1, 0.7); translate +0.1/+0 -> (0.0, 0.7)
      final (x, y) = c.mapOverlayPoint(0.2, 0.6);
      expect(x, closeTo(0.0, 1e-12));
      expect(y, closeTo(0.7, 1e-12));
    });

    test('preview and overlay rotation are independent of one another', () {
      const c = CameraCalibration(previewRotation: 90, overlayRotation: 270);
      expect(c.previewQuarterTurns, 1);
      expect(c.overlayQuarterTurns, 3);
    });
  });

  group('JSON round-trip', () {
    test('a calibration survives toJson/fromJson exactly', () {
      const c = CameraCalibration(
        previewRotation: 90,
        previewMirror: true,
        previewFit: PreviewFit.cover,
        overlayRotation: 270,
        overlayMirror: true,
        overlaySwapXY: true,
        overlayScale: 0.75,
        overlayOffsetX: 0.1,
        overlayOffsetY: -0.05,
      );

      expect(CameraCalibration.fromJson(c.toJson()), c);
    });

    test('missing fields fall back to identity, not a throw', () {
      final parsed = CameraCalibration.fromJson(const {'previewRotation': 180});
      expect(parsed.previewRotation, 180);
      expect(parsed.previewMirror, isFalse);
      expect(parsed.previewFit, PreviewFit.contain);
      expect(parsed.overlayScale, 1.0);
    });

    test('an unrecognized fit name falls back to contain rather than throwing', () {
      final parsed = CameraCalibration.fromJson(const {'previewFit': 'zoom'});
      expect(parsed.previewFit, PreviewFit.contain);
    });

    test('a calibration set survives toJson/fromJson exactly', () {
      const set = CameraCalibrationSet.defaults;
      final restored = CameraCalibrationSet.fromJson(set.toJson());
      expect(restored, set);
    });

    test('a set missing one lens falls back to that lens\'s default', () {
      final restored = CameraCalibrationSet.fromJson({
        'front': CameraCalibrationSet.defaults.front.copyWith(previewRotation: 90).toJson(),
      });
      expect(restored.front.previewRotation, 90);
      expect(restored.rear, CameraCalibrationSet.defaults.rear);
    });
  });

  group('CameraCalibrationSet', () {
    test('the shipped defaults use the working values found for this device', () {
      const set = CameraCalibrationSet.defaults;

      expect(set.front.previewRotation, 0);
      expect(set.front.previewMirror, isFalse);
      expect(set.front.overlayRotation, 270);
      expect(set.front.overlayMirror, isTrue);
      expect(set.front.overlayScale, 0.75);

      expect(set.rear.previewRotation, 0);
      expect(set.rear.overlayRotation, 90);
      expect(set.rear.overlayMirror, isTrue);
      expect(set.rear.overlayScale, 0.75);
    });

    test('forLens/withLens select and replace independently per lens', () {
      const set = CameraCalibrationSet.defaults;
      expect(set.forLens(LensPosition.front), set.front);
      expect(set.forLens(LensPosition.rear), set.rear);

      final updated = set.withLens(
        LensPosition.front,
        set.front.copyWith(overlayScale: 1.5),
      );
      expect(updated.front.overlayScale, 1.5);
      expect(updated.rear, set.rear, reason: 'the other lens must be untouched');
    });
  });
}
