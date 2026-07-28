/// `CameraCalibrationScreen`: a **permanent** Developer Tool (persistent
/// per-device calibration system). Reuses whatever camera session is
/// already live — never calls `request()` itself — renders through the
/// exact same `PreviewStage`/`HandLandmarkPainter` production uses, and
/// every control edits the current lens's persisted calibration live.
library;

import 'dart:async';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/debug/camera_calibration_screen.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';

const _front = CameraRequest(lens: LensPosition.front, analysisWidth: 480, analysisHeight: 640);

/// Everything one test needs, built **fresh per test** rather than via
/// `setUp`/`late` fields — a container built in `setUp` produced a
/// `CameraSessionController` that silently stayed `CameraClosed` forever
/// despite the exact same request-then-pump sequence that resolves on the
/// very first pump when the container is built directly inside the test
/// body. Building fresh per test, with no `setUp` involved, is the version
/// observed to actually work, so every test here uses it.
class _Harness {
  factory _Harness() {
    final source = FakeCameraSource();
    final store = InMemoryCalibrationStore();
    final container = ProviderContainer(
      overrides: [
        cameraSourceProvider.overrideWithValue(source),
        calibrationStoreProvider.overrideWithValue(store),
      ],
    );
    // Keeps the autoDispose controller alive for the whole test, exactly as
    // a real parent screen (`CaptureScreen`/`RecognitionPreviewScreen`)
    // would — this screen only ever reuses an already-live session.
    container.listen(cameraSessionControllerProvider, (_, __) {});
    return _Harness._(source, store, container);
  }

  _Harness._(this.source, this.store, this.container);

  final FakeCameraSource source;
  final InMemoryCalibrationStore store;
  final ProviderContainer container;

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: CameraCalibrationScreen()),
      ),
    );
    await tester.pump();
  }

  /// Simulates "a previous screen already requested the camera" — the only
  /// way this screen ever sees a live session — by firing the request and
  /// letting the test's stepped pumps resolve it, the same
  /// `unawaited(...)` + pump-cycle pattern `capture_screen_test.dart` uses
  /// for the exact same fake camera. A direct `await ...request(...)`
  /// outside a pump cycle never resolves under `testWidgets`'s fake-async
  /// zone and hangs the test.
  Future<void> acquireCamera(WidgetTester tester) async {
    unawaited(container.read(cameraSessionControllerProvider).request(_front));
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
    // Lets `cameraCalibrationProvider`'s (fast, in-memory) load resolve too.
    await tester.pump();
  }

  CameraCalibration frontCalibration() =>
      container.read(cameraCalibrationProvider).requireValue.forLens(LensPosition.front);
}

void main() {
  testWidgets('shows a waiting message when no camera is live yet, never '
      'requests one itself', (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);

    expect(h.source.openCount, 0, reason: 'this screen must never call request()');
    expect(find.textContaining('Waiting for the camera'), findsOneWidget);
  });

  testWidgets('renders the preview and every control once a session is live',
      (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    expect(find.byKey(const Key('camera-preview-texture')), findsOneWidget);
    expect(find.byKey(const Key('calibration-overlay-paint')), findsOneWidget);
    expect(find.byKey(const Key('calibration-values-banner')), findsOneWidget);

    // Preview controls.
    expect(find.byKey(const Key('preview-rotation-segmented')), findsOneWidget);
    expect(find.byKey(const Key('preview-mirror-switch')), findsOneWidget);
    expect(find.byKey(const Key('preview-fit-segmented')), findsOneWidget);

    // Overlay controls.
    expect(find.byKey(const Key('overlay-rotation-segmented')), findsOneWidget);
    expect(find.byKey(const Key('overlay-mirror-switch')), findsOneWidget);
    expect(find.byKey(const Key('overlay-swap-xy-switch')), findsOneWidget);
    expect(find.byKey(const Key('overlay-scale-slider')), findsOneWidget);
    expect(find.byKey(const Key('overlay-offset-x-slider')), findsOneWidget);
    expect(find.byKey(const Key('overlay-offset-y-slider')), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('the panel starts from this device\'s calibration — the '
      'shipped defaults when nothing was ever saved', (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    expect(h.frontCalibration(), CameraCalibrationSet.defaults.front);
  });

  testWidgets('toggling the preview mirror switch updates only preview '
      'calibration, live, with no rebuild of the app required, and persists '
      'it immediately', (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    expect(h.frontCalibration().previewMirror, isFalse);

    await tester.tap(find.byKey(const Key('preview-mirror-switch')));
    await tester.pump();

    expect(h.frontCalibration().previewMirror, isTrue);
    expect(
      h.frontCalibration().overlayRotation,
      CameraCalibrationSet.defaults.front.overlayRotation,
      reason: 'preview and overlay controls must be independent',
    );
    expect((await h.store.load())!.front.previewMirror, isTrue,
        reason: 'every change saves immediately, no explicit save action');
  });

  testWidgets('the overlay scale slider updates only overlay calibration',
      (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    await h.container
        .read(cameraCalibrationProvider.notifier)
        .setOverlayScale(LensPosition.front, 1.4);
    await tester.pump();

    expect(h.frontCalibration().overlayScale, 1.4);
    expect(h.frontCalibration().previewRotation, 0,
        reason: 'preview and overlay controls must be independent');
    expect(tester.takeException(), isNull);
  });

  testWidgets('landmarks render through the overlay calibration without '
      'throwing, across a rotation change', (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    await h.container
        .read(cameraCalibrationProvider.notifier)
        .setOverlayRotation(LensPosition.front, 90);
    h.source.emit(_frameWithOneHand());
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('calibration-overlay-paint')), findsOneWidget);
  });

  testWidgets('the reset button returns this lens to its shipped default, '
      'leaving the other lens untouched', (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    final notifier = h.container.read(cameraCalibrationProvider.notifier);
    await notifier.setPreviewRotation(LensPosition.front, 180);
    await notifier.setOverlayScale(LensPosition.front, 1.7);
    await notifier.setOverlayScale(LensPosition.rear, 1.3);
    await tester.pump();

    await tester.tap(find.byKey(const Key('calibration-reset')));
    await tester.pump();

    expect(h.frontCalibration(), CameraCalibrationSet.defaults.front);
    expect(
      h.container.read(cameraCalibrationProvider).requireValue.rear.overlayScale,
      1.3,
      reason: 'resetting one lens must not touch the other',
    );
  });

  testWidgets('the export dialog shows the whole set as selectable JSON',
      (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    await tester.tap(find.byKey(const Key('calibration-export')));
    await tester.pump();

    expect(find.byKey(const Key('calibration-export-text')), findsOneWidget);
    final text = tester.widget<SelectableText>(
      find.byKey(const Key('calibration-export-text')),
    );
    expect(text.data, contains('"front"'));
    expect(text.data, contains('"rear"'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('importing a valid exported document replaces the whole set',
      (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    final imported = CameraCalibrationSet.defaults
        .withLens(
          LensPosition.front,
          CameraCalibrationSet.defaults.front.copyWith(overlayScale: 1.6),
        )
        .withLens(
          LensPosition.rear,
          CameraCalibrationSet.defaults.rear.copyWith(overlayScale: 1.1),
        );

    await tester.tap(find.byKey(const Key('calibration-import')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('calibration-import-field')),
      jsonEncodeSet(imported),
    );
    await tester.tap(find.byKey(const Key('calibration-import-submit')));
    await tester.pump();

    expect(h.frontCalibration().overlayScale, 1.6);
    expect(
      h.container.read(cameraCalibrationProvider).requireValue.rear.overlayScale,
      1.1,
    );
    expect(find.byKey(const Key('calibration-import-field')), findsNothing,
        reason: 'a successful import closes the dialog');
  });

  testWidgets('importing malformed JSON shows an error and keeps the dialog open',
      (tester) async {
    final h = _Harness();
    addTearDown(h.container.dispose);
    await h.pumpScreen(tester);
    await h.acquireCamera(tester);

    final before = h.frontCalibration();

    await tester.tap(find.byKey(const Key('calibration-import')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('calibration-import-field')),
      'not json',
    );
    await tester.tap(find.byKey(const Key('calibration-import-submit')));
    await tester.pump();

    expect(find.byKey(const Key('calibration-import-error')), findsOneWidget);
    expect(find.byKey(const Key('calibration-import-field')), findsOneWidget,
        reason: 'a failed import keeps the dialog open for another attempt');
    expect(h.frontCalibration(), before);
  });
}

LandmarkFrame _frameWithOneHand() {
  final points = List.generate(
    handLandmarkCount,
    (i) => Landmark(x: 0.05 * i, y: 0.03 * i, z: 0),
  );
  return LandmarkFrame(
    hands: [
      HandDetection(
        handedness: Handedness.left,
        confidence: 0.9,
        landmarks: HandLandmarks(points),
      ),
    ],
    frameWidth: 480,
    frameHeight: 640,
    timestampMicros: 0,
  );
}

/// Minimal, dependency-free JSON encoding for one [CameraCalibrationSet] —
/// avoids pulling `dart:convert` into this file for a single test fixture.
String jsonEncodeSet(CameraCalibrationSet set) {
  String encodeCalibration(CameraCalibration c) => '{'
      '"previewRotation":${c.previewRotation},'
      '"previewMirror":${c.previewMirror},'
      '"previewFit":"${c.previewFit.wireValue}",'
      '"overlayRotation":${c.overlayRotation},'
      '"overlayMirror":${c.overlayMirror},'
      '"overlaySwapXY":${c.overlaySwapXY},'
      '"overlayScale":${c.overlayScale},'
      '"overlayOffsetX":${c.overlayOffsetX},'
      '"overlayOffsetY":${c.overlayOffsetY}'
      '}';
  return '{"front":${encodeCalibration(set.front)},"rear":${encodeCalibration(set.rear)}}';
}
