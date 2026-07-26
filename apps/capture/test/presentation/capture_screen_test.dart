/// The capture screen as a **loop** and as a **layout** (FR-076–FR-080,
/// FR-102–FR-106, SC-027).
///
/// The single most consequential R1 behaviour change lives here: finishing a
/// take used to leave the screen, which meant tearing the camera down and
/// reacquiring it once per take. Now it returns to ready with the camera still
/// held, and leaving is something the user chooses.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/presentation/capture/capture_control_bar.dart';
import 'package:capture/presentation/capture/capture_screen.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

void main() {
  late FakeCameraSource source;

  setUp(() => source = FakeCameraSource());

  Future<void> pumpScreen(
    WidgetTester tester, {
    Size surface = const Size(400, 800),
    PoseDefinition? pose,
    bool show = true,
  }) async {
    tester.view.physicalSize = surface;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          cameraSourceProvider.overrideWithValue(source),
          configProvider.overrideWithValue(
            // Orientation locking touches platform channels; the scope of the
            // lock is covered by its own test.
            const CaptureConfig(lockOrientationOnCaptureScreen: false),
          ),
          applicationVersionProvider.overrideWith(
            (ref) async => 'mudra-capture/0.1.0',
          ),
        ],
        child: MaterialApp(
          home: show
              ? CaptureScreen(pose: pose ?? makePose())
              : const SizedBox.shrink(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Advances the camera state machine and the widget tree.
  ///
  /// `pumpAndSettle` cannot be used here: [PreviewPlaceholder] shows a genuine
  /// indefinite progress indicator while the camera is starting, so settling
  /// would never terminate. Stepped pumps advance the fake clock (which drives
  /// the fake camera's open latency) and flush microtasks between frames.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  group('all five required elements are visible at once (FR-102)', () {
    testWidgets('reference, progress, preview, Record, and Sync', (tester) async {
      await pumpScreen(tester);

      expect(find.byKey(const Key('capture-reference-image')), findsOneWidget);
      expect(find.byKey(const Key('capture-progress')), findsOneWidget);
      expect(find.byKey(const Key('record-button')), findsOneWidget);
      expect(find.byKey(const Key('sync-button')), findsOneWidget);
      // The preview area is present whether or not a camera is live yet.
      expect(
        find.byType(PreviewStage).evaluate().isNotEmpty ||
            find.byType(PreviewPlaceholder).evaluate().isNotEmpty,
        isTrue,
      );
    });

    testWidgets('nothing scrolls — the screen is not a list', (tester) async {
      await pumpScreen(tester);
      expect(find.byType(Scrollable), findsNothing);
    });

    testWidgets('the settings controls are reachable without leaving (FR-105)',
        (tester) async {
      await pumpScreen(tester);
      expect(find.byType(CaptureControlBar), findsOneWidget);
    });
  });

  group('the smallest supported screen (FR-106, SC-027)', () {
    // A compact phone in portrait, per the specification's assumption.
    const smallest = Size(320, 640);

    testWidgets('everything stays visible and nothing overflows',
        (tester) async {
      await pumpScreen(tester, surface: smallest);

      expect(tester.takeException(), isNull, reason: 'no overflow');
      expect(find.byKey(const Key('capture-reference-image')), findsOneWidget);
      expect(find.byKey(const Key('capture-progress')), findsOneWidget);
      expect(find.byKey(const Key('record-button')), findsOneWidget);
      expect(find.byKey(const Key('sync-button')), findsOneWidget);
      expect(find.byType(CaptureControlBar), findsOneWidget);
    });

    testWidgets('the preview yields space first, not the controls',
        (tester) async {
      await pumpScreen(tester, surface: const Size(400, 900));
      final tallPreview =
          tester.getSize(find.byKey(const Key('preview-area'))).height;
      final tallRecord =
          tester.getSize(find.byKey(const Key('record-button'))).height;

      await pumpScreen(tester, surface: smallest);
      final shortPreview =
          tester.getSize(find.byKey(const Key('preview-area'))).height;
      final shortRecord =
          tester.getSize(find.byKey(const Key('record-button'))).height;

      expect(
        shortPreview,
        lessThan(tallPreview),
        reason: 'FR-106: the preview is the flexible element',
      );
      expect(
        shortRecord,
        tallRecord,
        reason: 'the Record control must not shrink to make room',
      );
    });
  });

  group('the reference and progress persist through every state (FR-104)', () {
    testWidgets('they are outside the preview stage, so overlays cannot hide them',
        (tester) async {
      await pumpScreen(tester);

      // If the reference were inside the preview, a full-bleed countdown or
      // summary overlay could cover it. It is a sibling instead.
      expect(
        find.descendant(
          of: find.byType(PreviewStage),
          matching: find.byKey(const Key('capture-reference-image')),
        ),
        findsNothing,
      );
      expect(find.byKey(const Key('capture-reference-image')), findsOneWidget);
    });
  });

  group('the camera is requested on entry and released on exit', () {
    testWidgets('entering the screen opens exactly one session', (tester) async {
      await pumpScreen(tester);
      await settle(tester);

      expect(source.openCount, 1);
      expect(source.liveCount, 1);
    });

    testWidgets('leaving the screen releases it (FR-086)', (tester) async {
      await pumpScreen(tester);
      await settle(tester);
      expect(source.liveCount, 1);

      // Navigate away: the same provider scope, without the screen. Swapping
      // the whole ProviderScope would also swap the overrides, which muddies
      // what is being measured.
      //
      // The release is asynchronous and the widget-test zone's fake clock does
      // not drive it, so the teardown runs on the real event loop.
      await tester.runAsync(() async {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              cameraSourceProvider.overrideWithValue(source),
              configProvider.overrideWithValue(
                const CaptureConfig(lockOrientationOnCaptureScreen: false),
              ),
              applicationVersionProvider.overrideWith(
                (ref) async => 'mudra-capture/0.1.0',
              ),
            ],
            child: const MaterialApp(home: SizedBox.shrink()),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      expect(
        source.liveCount,
        0,
        reason: 'FR-086/FR-087: no camera resource may remain open once the '
            'capture screen is no longer displayed',
      );
    });

    testWidgets('Record is disabled until the camera is live', (tester) async {
      source.openDelay = const Duration(milliseconds: 100);
      await pumpScreen(tester);

      final button = tester.widget<FilledButton>(
        find.byKey(const Key('record-button')),
      );
      expect(button.onPressed, isNull);

      await settle(tester);

      final live = tester.widget<FilledButton>(
        find.byKey(const Key('record-button')),
      );
      expect(live.onPressed, isNotNull);
    });
  });

  group('camera failures show a route out, never a spinner (SC-029)', () {
    testWidgets('a busy camera offers a retry', (tester) async {
      source.failNextOpen = CameraFailure.busy();
      await pumpScreen(tester);
      await settle(tester);

      expect(find.byKey(const Key('retry-camera-button')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('a missing lens offers the other camera', (tester) async {
      source.lenses = {LensPosition.rear};
      await pumpScreen(tester);
      await settle(tester);

      expect(find.byKey(const Key('use-other-lens-button')), findsOneWidget);
    });
  });
}
