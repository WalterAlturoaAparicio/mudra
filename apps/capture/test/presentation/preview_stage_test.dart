/// Preview fidelity (FR-097–FR-101, SC-022).
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

  Future<Size> renderAt(
    WidgetTester tester,
    Size surface,
    CameraSessionInfo sessionInfo, {
    List<Widget> overlays = const [],
  }) async {
    tester.view.physicalSize = surface;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PreviewStage(info: sessionInfo, overlays: overlays),
        ),
      ),
    );

    return tester.getSize(find.byKey(const Key('camera-preview-texture')));
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
        final rendered = await renderAt(tester, surface, sessionInfo);

        expect(
          rendered.width / rendered.height,
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
      final rendered = await renderAt(tester, surface, info());

      expect(rendered.width, closeTo(400, 0.5), reason: 'width is filled');
      expect(
        rendered.height,
        lessThan(1200),
        reason: 'the image must not stretch to fill the extra height',
      );
    });

    testWidgets('a surface wider than the camera pillarboxes', (tester) async {
      const surface = Size(1200, 600);
      final rendered = await renderAt(tester, surface, info());

      expect(rendered.height, closeTo(600, 0.5), reason: 'height is filled');
      expect(
        rendered.width,
        lessThan(1200),
        reason: 'the image must not stretch to fill the extra width',
      );
    });

    testWidgets('the image is centered in its area', (tester) async {
      const surface = Size(1200, 600);
      await renderAt(tester, surface, info());

      final rect = tester.getRect(
        find.byKey(const Key('camera-preview-texture')),
      );
      expect(rect.center.dx, closeTo(600, 1.0));
      expect(rect.center.dy, closeTo(300, 1.0));
    });
  });

  group('the ratio comes from the camera, not a constant (FR-099)', () {
    testWidgets('a landscape sensor produces a landscape preview',
        (tester) async {
      final sessionInfo = info(previewWidth: 1280, previewHeight: 720);
      final rendered = await renderAt(tester, const Size(800, 800), sessionInfo);

      expect(rendered.width / rendered.height, closeTo(1280 / 720, 0.02));
      expect(rendered.width, greaterThan(rendered.height));
    });

    testWidgets('an unusual reported size is honoured, not normalized',
        (tester) async {
      final sessionInfo = info(previewWidth: 1000, previewHeight: 1333);
      final rendered = await renderAt(tester, const Size(900, 900), sessionInfo);

      expect(rendered.width / rendered.height, closeTo(1000 / 1333, 0.02));
    });

    testWidgets('a degenerate reported size falls back rather than dividing by zero',
        (tester) async {
      final sessionInfo = info(previewWidth: 0, previewHeight: 0);
      final rendered = await renderAt(tester, const Size(800, 800), sessionInfo);

      expect(rendered.width, greaterThan(0));
      expect(rendered.height, greaterThan(0));
      expect(sessionInfo.previewAspect, closeTo(3 / 4, 1e-9));
    });
  });

  group('overlays align to the image, not the bands (FR-101)', () {
    testWidgets('an overlay matches the texture rect exactly', (tester) async {
      await renderAt(
        tester,
        const Size(1200, 600),
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

      final texture = tester.getRect(
        find.byKey(const Key('camera-preview-texture')),
      );
      final overlay = tester.getRect(find.byKey(const Key('test-overlay')));

      expect(overlay, texture, reason: 'FR-101: overlays must not spill onto '
          'the padded bands, which is structural here rather than computed');
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
