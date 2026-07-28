/// Preview fidelity, now driven entirely by [CameraCalibration] rather than
/// platform-reported rotation (research D23–D25, persistent per-device
/// calibration system).
///
/// A distorted preview does not corrupt a single stored landmark — which is
/// exactly why it is dangerous. It silently biases how people position
/// themselves, and the resulting dataset looks perfect.
///
/// These tests measure the rendered texture box at several surface shapes and
/// assert it keeps the camera's proportions, with the leftover space appearing
/// as bands rather than as stretch.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  CameraSessionInfo info({
    int previewWidth = 720,
    int previewHeight = 1280,
    LensPosition lens = LensPosition.front,
  }) => CameraSessionInfo(
    textureId: 1,
    previewWidth: previewWidth,
    previewHeight: previewHeight,
    analysisWidth: 480,
    analysisHeight: 640,
    lens: lens,
    convention: lens.defaultConvention,
    platformLensId: lens == LensPosition.front ? 1 : 0,
  );

  Future<void> pump(
    WidgetTester tester,
    Size surface,
    CameraSessionInfo sessionInfo, {
    CameraCalibration calibration = const CameraCalibration(),
    List<Widget> overlays = const [],
  }) async {
    tester.view.physicalSize = surface;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PreviewStage(info: sessionInfo, calibration: calibration, overlays: overlays),
        ),
      ),
    );
  }

  /// The texture's **on-screen** bounding box — `getRect` maps the render
  /// object's local corners through every ancestor transform, which is what
  /// makes this correct regardless of rotation, mirroring, or the
  /// [FittedBox] scale [CameraCalibration.previewFit] introduces. `getSize`
  /// would report the pre-transform local size instead, which is not what
  /// actually appears on screen.
  Future<Rect> renderedRectAt(
    WidgetTester tester,
    Size surface,
    CameraSessionInfo sessionInfo, {
    CameraCalibration calibration = const CameraCalibration(),
  }) async {
    await pump(tester, surface, sessionInfo, calibration: calibration);
    return tester.getRect(find.byKey(const Key('camera-preview-texture')));
  }

  group('the preview keeps the camera aspect ratio (FR-097)', () {
    for (final surface in const [
      Size(400, 800), // taller than the camera
      Size(800, 400), // wider than the camera
      Size(720, 1280), // exactly the camera's shape
      Size(1000, 1000), // square
      Size(300, 1200), // extremely tall
      Size(1200, 300), // extremely wide
    ]) {
      testWidgets('at ${surface.width.toInt()}x${surface.height.toInt()}',
          (tester) async {
        final sessionInfo = info();
        final rect = await renderedRectAt(tester, surface, sessionInfo);

        expect(
          rect.width / rect.height,
          closeTo(sessionInfo.previewAspect, 0.02),
          reason: 'SC-022: a square held in frame must measure square within '
              '2% at every supported screen shape',
        );
      });
    }
  });

  group('leftover space becomes bands, never stretch (FR-098)', () {
    testWidgets('a surface taller than the camera letterboxes', (tester) async {
      const surface = Size(400, 1200);
      final rect = await renderedRectAt(tester, surface, info());

      expect(rect.width, closeTo(400, 0.5), reason: 'width is filled');
      expect(
        rect.height,
        lessThan(1200),
        reason: 'the image must not stretch to fill the extra height',
      );
    });

    testWidgets('a surface wider than the camera pillarboxes', (tester) async {
      const surface = Size(1200, 600);
      final rect = await renderedRectAt(tester, surface, info());

      expect(rect.height, closeTo(600, 0.5), reason: 'height is filled');
      expect(
        rect.width,
        lessThan(1200),
        reason: 'the image must not stretch to fill the extra width',
      );
    });

    testWidgets('the image is centered in its area', (tester) async {
      const surface = Size(1200, 600);
      final rect = await renderedRectAt(tester, surface, info());

      expect(rect.center.dx, closeTo(600, 1.0));
      expect(rect.center.dy, closeTo(300, 1.0));
    });
  });

  group('the ratio comes from the camera, not a constant (FR-099)', () {
    testWidgets('a landscape sensor produces a landscape preview',
        (tester) async {
      final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
      final rect = await renderedRectAt(tester, const Size(800, 800), sessionInfo);

      expect(rect.width / rect.height, closeTo(1280 / 720, 0.02));
      expect(rect.width, greaterThan(rect.height));
    });

    testWidgets('an unusual reported size is honoured, not normalized',
        (tester) async {
      final sessionInfo = info(previewWidth: 1000, previewHeight: 1333);
      final rect = await renderedRectAt(tester, const Size(900, 900), sessionInfo);

      expect(rect.width / rect.height, closeTo(1000 / 1333, 0.02));
    });

    testWidgets('a degenerate reported size falls back rather than dividing by zero',
        (tester) async {
      final sessionInfo = info(previewWidth: 0, previewHeight: 0);
      final rect = await renderedRectAt(tester, const Size(800, 800), sessionInfo);

      expect(rect.width, greaterThan(0));
      expect(rect.height, greaterThan(0));
      expect(sessionInfo.previewAspect, closeTo(3 / 4, 1e-9));
    });
  });

  group('rotation comes from CameraCalibration, applied to the raw buffer at '
      'layout time', () {
    testWidgets(
      '90°: a landscape raw buffer renders as a portrait-shaped box on screen',
      (tester) async {
        final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
        final rect = await renderedRectAt(
          tester,
          const Size(2000, 2000),
          sessionInfo,
          calibration: const CameraCalibration(previewRotation: 90),
        );

        expect(
          rect.width / rect.height,
          closeTo(720 / 1280, 0.02),
          reason: 'a 90° calibrated rotation must swap the on-screen box to portrait',
        );
      },
    );

    testWidgets(
      '270°: the same raw buffer also renders portrait-shaped',
      (tester) async {
        final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
        final rect = await renderedRectAt(
          tester,
          const Size(2000, 2000),
          sessionInfo,
          calibration: const CameraCalibration(previewRotation: 270),
        );

        expect(rect.width / rect.height, closeTo(720 / 1280, 0.02));
      },
    );

    testWidgets(
      '180°: shape is unchanged (no axis swap), only orientation flips',
      (tester) async {
        final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
        final rect = await renderedRectAt(
          tester,
          const Size(2000, 2000),
          sessionInfo,
          calibration: const CameraCalibration(previewRotation: 180),
        );

        expect(rect.width / rect.height, closeTo(1280 / 720, 0.02));
      },
    );

    testWidgets(
      '0°: the identity calibration — the regression baseline',
      (tester) async {
        final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
        final rect = await renderedRectAt(tester, const Size(2000, 2000), sessionInfo);

        expect(rect.width / rect.height, closeTo(1280 / 720, 0.02));
      },
    );
  });

  group('mirroring never changes the on-screen box, only its pixel content', () {
    testWidgets('a mirrored and an unmirrored calibration at the same raw '
        'size occupy an identical rect', (tester) async {
      final mirroredRect = await renderedRectAt(
        tester,
        const Size(1200, 1200),
        info(),
        calibration: const CameraCalibration(previewMirror: true),
      );
      final unmirroredRect = await renderedRectAt(
        tester,
        const Size(1200, 1200),
        info(),
        calibration: const CameraCalibration(),
      );

      expect(mirroredRect.width, closeTo(unmirroredRect.width, 0.5));
      expect(mirroredRect.height, closeTo(unmirroredRect.height, 0.5));
    });

    testWidgets('a mirrored, rotated calibration still resolves to the '
        'rotated (swapped) shape — rotation and mirroring compose correctly',
        (tester) async {
      final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
      final rect = await renderedRectAt(
        tester,
        const Size(2000, 2000),
        sessionInfo,
        calibration: const CameraCalibration(previewRotation: 90, previewMirror: true),
      );

      expect(rect.width / rect.height, closeTo(720 / 1280, 0.02));
    });
  });

  group('previewFit selects how the buffer fills the pane', () {
    testWidgets('cover fills the surface completely, cropping rather than '
        'banding', (tester) async {
      const surface = Size(1200, 600);
      final rect = await renderedRectAt(
        tester,
        surface,
        info(),
        calibration: const CameraCalibration(previewFit: PreviewFit.cover),
      );

      expect(rect.height, greaterThanOrEqualTo(600 - 0.5));
      expect(rect.width, greaterThanOrEqualTo(1200 - 0.5));
    });

    testWidgets('fill stretches to the surface exactly, ignoring aspect ratio',
        (tester) async {
      const surface = Size(1200, 600);
      final rect = await renderedRectAt(
        tester,
        surface,
        info(),
        calibration: const CameraCalibration(previewFit: PreviewFit.fill),
      );

      expect(rect.width, closeTo(1200, 0.5));
      expect(rect.height, closeTo(600, 0.5));
    });
  });

  group('overlays fill the whole preview pane (persistent calibration '
      'system): a calibration found by sweeping values against a full-pane '
      'overlay must render identically in production, so overlays are no '
      'longer confined to the (possibly letterboxed) image sub-rect', () {
    testWidgets('an overlay matches the full outer pane, not the texture rect',
        (tester) async {
      const surface = Size(1200, 600);
      await pump(
        tester,
        surface,
        info(),
        overlays: [
          const Positioned.fill(
            child: ColoredBox(
              key: Key('test-overlay'),
              color: Color(0x22FFFFFF),
            ),
          ),
        ],
      );

      final overlay = tester.getRect(find.byKey(const Key('test-overlay')));
      expect(overlay, const Rect.fromLTWH(0, 0, 1200, 600));
    });
  });

  group('the placeholder never leaves the user stuck (SC-029)', () {
    testWidgets('a message with no action shows progress', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PreviewPlaceholder(message: 'Starting the camera…'),
          ),
        ),
      );

      expect(find.text('Starting the camera…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('a failure shows its route out instead of a spinner',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PreviewPlaceholder(
              message: 'Another app is using the camera.',
              action: FilledButton(
                onPressed: () {},
                child: const Text('Try again'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Try again'), findsOneWidget);
      expect(
        find.byType(CircularProgressIndicator),
        findsNothing,
        reason: 'SC-029: no failure path may end in an indefinite spinner',
      );
    });
  });
}
