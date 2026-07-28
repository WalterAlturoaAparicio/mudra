/// [DisplayOrientation]: the single analysis-space → display-space transform,
/// introduced to fix a rendering bug where the debug overlay (and the
/// recognition effect anchor) drew landmarks mirrored and/or rotated
/// relative to the live preview.
///
/// Two independent root causes, tested independently here:
/// 1. Rotation was never applied to landmark coordinates at all, while the
///    preview box was sized by a different, screen-rotation-only guess
///    (`mapPoint`/`mapSize` for each of the four quarter turns).
/// 2. Mirroring must come from `CameraSessionInfo.mirroredPreview`
///    (`mirrored == lens == front`), never from dataset canonicalization —
///    `CanonicalViewConverter`'s tests already cover that this class does
///    NOT replicate that transform.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/display_orientation.dart';
import 'package:flutter_test/flutter_test.dart';

CameraSessionInfo _info({
  int rotationDegrees = 0,
  LensPosition lens = LensPosition.front,
}) => CameraSessionInfo(
  textureId: 1,
  previewWidth: 640,
  previewHeight: 480,
  analysisWidth: 640,
  analysisHeight: 480,
  lens: lens,
  convention: lens.defaultConvention,
  platformLensId: lens == LensPosition.front ? 1 : 0,
  rotationDegrees: rotationDegrees,
);

void main() {
  group('fromSession', () {
    test('maps 0/90/180/270 to 0/1/2/3 quarter turns', () {
      expect(DisplayOrientation.fromSession(_info(rotationDegrees: 0)).quarterTurns, 0);
      expect(DisplayOrientation.fromSession(_info(rotationDegrees: 90)).quarterTurns, 1);
      expect(DisplayOrientation.fromSession(_info(rotationDegrees: 180)).quarterTurns, 2);
      expect(DisplayOrientation.fromSession(_info(rotationDegrees: 270)).quarterTurns, 3);
    });

    test('mirrored follows CameraSessionInfo.mirroredPreview, never a lens '
        'check performed independently', () {
      expect(
        DisplayOrientation.fromSession(_info(lens: LensPosition.front)).mirrored,
        isTrue,
      );
      expect(
        DisplayOrientation.fromSession(_info(lens: LensPosition.rear)).mirrored,
        isFalse,
      );
    });

    test('an unrecognized rotation is a contract violation, not a value to '
        'silently coerce', () {
      expect(
        () => DisplayOrientation.fromSession(_info(rotationDegrees: 45)),
        throwsArgumentError,
      );
    });
  });

  group('mapPoint — rotation (unmirrored)', () {
    const point = (0.2, 0.7);

    test('0°: identity', () {
      const orientation = DisplayOrientation(quarterTurns: 0, mirrored: false);
      expect(orientation.mapPoint(point.$1, point.$2), point);
    });

    test('90° clockwise: (x, y) -> (1-y, x)', () {
      const orientation = DisplayOrientation(quarterTurns: 1, mirrored: false);
      final (x, y) = orientation.mapPoint(point.$1, point.$2);
      expect(x, closeTo(1 - point.$2, 1e-12));
      expect(y, closeTo(point.$1, 1e-12));
    });

    test('180°: (x, y) -> (1-x, 1-y)', () {
      const orientation = DisplayOrientation(quarterTurns: 2, mirrored: false);
      final (x, y) = orientation.mapPoint(point.$1, point.$2);
      expect(x, closeTo(1 - point.$1, 1e-12));
      expect(y, closeTo(1 - point.$2, 1e-12));
    });

    test('270° clockwise: (x, y) -> (y, 1-x)', () {
      const orientation = DisplayOrientation(quarterTurns: 3, mirrored: false);
      final (x, y) = orientation.mapPoint(point.$1, point.$2);
      expect(x, closeTo(point.$2, 1e-12));
      expect(y, closeTo(1 - point.$1, 1e-12));
    });

    test('applying 90° four times returns to the origin point (a full turn)', () {
      const orientation = DisplayOrientation(quarterTurns: 1, mirrored: false);
      var (x, y) = point;
      for (var i = 0; i < 4; i++) {
        (x, y) = orientation.mapPoint(x, y);
      }
      expect(x, closeTo(point.$1, 1e-12));
      expect(y, closeTo(point.$2, 1e-12));
    });

    test('a corner near the analysis frame\'s edge stays a corner in display '
        'space — rotation never moves a point off the unit square', () {
      for (final turns in [0, 1, 2, 3]) {
        final orientation = DisplayOrientation(quarterTurns: turns, mirrored: false);
        final (x, y) = orientation.mapPoint(0.0, 0.0);
        expect(x, anyOf(closeTo(0, 1e-12), closeTo(1, 1e-12)));
        expect(y, anyOf(closeTo(0, 1e-12), closeTo(1, 1e-12)));
      }
    });
  });

  group('mapPoint — mirroring is applied after rotation', () {
    test('0° + mirrored: only x flips', () {
      const orientation = DisplayOrientation(quarterTurns: 0, mirrored: true);
      final (x, y) = orientation.mapPoint(0.2, 0.7);
      expect(x, closeTo(0.8, 1e-12));
      expect(y, closeTo(0.7, 1e-12));
    });

    test('90° + mirrored: rotates first, then flips the rotated x', () {
      const orientation = DisplayOrientation(quarterTurns: 1, mirrored: true);
      final (x, y) = orientation.mapPoint(0.2, 0.7);
      // Unmirrored 90°: (1-0.7, 0.2) = (0.3, 0.2). Mirror flips x: 1-0.3=0.7.
      expect(x, closeTo(0.7, 1e-12));
      expect(y, closeTo(0.2, 1e-12));
    });

    test('a point at the vertical center is unaffected by mirroring alone', () {
      const orientation = DisplayOrientation(quarterTurns: 0, mirrored: true);
      final (x, y) = orientation.mapPoint(0.5, 0.3);
      expect(x, closeTo(0.5, 1e-12));
      expect(y, closeTo(0.3, 1e-12));
    });
  });

  group('mapSize', () {
    test('even quarter turns keep the shape', () {
      const orientation0 = DisplayOrientation(quarterTurns: 0, mirrored: false);
      const orientation2 = DisplayOrientation(quarterTurns: 2, mirrored: false);
      expect(orientation0.mapSize(640, 480), (640, 480));
      expect(orientation2.mapSize(640, 480), (640, 480));
    });

    test('odd quarter turns swap width and height', () {
      const orientation1 = DisplayOrientation(quarterTurns: 1, mirrored: false);
      const orientation3 = DisplayOrientation(quarterTurns: 3, mirrored: false);
      expect(orientation1.mapSize(640, 480), (480, 640));
      expect(orientation3.mapSize(640, 480), (480, 640));
    });

    test('mirroring never affects size, only pixel content', () {
      const orientation = DisplayOrientation(quarterTurns: 1, mirrored: true);
      expect(orientation.mapSize(640, 480), (480, 640));
    });
  });

  group('value equality', () {
    test('same quarterTurns and mirrored compare equal', () {
      expect(
        const DisplayOrientation(quarterTurns: 1, mirrored: true),
        const DisplayOrientation(quarterTurns: 1, mirrored: true),
      );
    });

    test('a different quarterTurns or mirrored compares unequal', () {
      expect(
        const DisplayOrientation(quarterTurns: 1, mirrored: true),
        isNot(const DisplayOrientation(quarterTurns: 2, mirrored: true)),
      );
      expect(
        const DisplayOrientation(quarterTurns: 1, mirrored: true),
        isNot(const DisplayOrientation(quarterTurns: 1, mirrored: false)),
      );
    });
  });
}
