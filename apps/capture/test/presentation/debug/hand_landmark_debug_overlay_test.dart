/// The hand landmark debug overlay (spec 003 Revision R2): renders 0/1/2
/// hands without throwing, ignores pointer events, and owns its subscription
/// to whatever stream it is given — subscribing on mount and cancelling on
/// unmount, never leaking a listener onto a broadcast stream (FR-121,
/// FR-122, FR-126). Also covers the temporary coordinate-pipeline
/// diagnostics (research D24): off by default, and only rendered when
/// [HandLandmarkDebugOverlay.showCoordinateDebug] is explicitly on.
library;

import 'dart:async';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/debug/hand_landmark_debug_overlay.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final _identityInfo = CameraSessionInfo(
  textureId: 1,
  previewWidth: 480,
  previewHeight: 640,
  analysisWidth: 480,
  analysisHeight: 640,
  lens: LensPosition.rear,
  convention: LensPosition.rear.defaultConvention,
  platformLensId: 0,
);

HandDetection _hand(Handedness handedness, {double confidence = 0.9}) {
  final points = List.generate(
    handLandmarkCount,
    (i) => Landmark(x: 0.1 * (i % 10), y: 0.1 * (i % 10), z: 0),
  );
  return HandDetection(
    handedness: handedness,
    confidence: confidence,
    landmarks: HandLandmarks(points),
  );
}

LandmarkFrame _frame(List<HandDetection> hands) => LandmarkFrame(
  hands: hands,
  frameWidth: 480,
  frameHeight: 640,
  timestampMicros: 0,
);

Future<void> _pumpOverlay(
  WidgetTester tester,
  Stream<LandmarkFrame> frames, {
  CameraSessionInfo? info,
  CameraCalibration calibration = const CameraCalibration(),
  bool showCoordinateDebug = false,
}) => tester.pumpWidget(
  MaterialApp(
    home: SizedBox(
      width: 300,
      height: 400,
      child: HandLandmarkDebugOverlay(
        frames: frames,
        info: info ?? _identityInfo,
        calibration: calibration,
        showCoordinateDebug: showCoordinateDebug,
      ),
    ),
  ),
);

void main() {
  testWidgets('renders with no frame yet, no hands, one hand, and two hands',
      (tester) async {
    final controller = StreamController<LandmarkFrame>.broadcast();
    addTearDown(controller.close);

    await _pumpOverlay(tester, controller.stream);
    expect(tester.takeException(), isNull);
    expect(find.text('Hands: 0'), findsOneWidget);

    controller.add(_frame(const []));
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Hands: 0'), findsOneWidget);

    controller.add(_frame([_hand(Handedness.left)]));
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Hands: 1'), findsOneWidget);
    expect(find.textContaining('left'), findsOneWidget);

    controller.add(_frame([_hand(Handedness.left), _hand(Handedness.right)]));
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Hands: 2'), findsOneWidget);
    expect(find.textContaining('left'), findsOneWidget);
    expect(find.textContaining('right'), findsOneWidget);
  });

  testWidgets('never intercepts pointer events', (tester) async {
    final controller = StreamController<LandmarkFrame>.broadcast();
    addTearDown(controller.close);
    await _pumpOverlay(tester, controller.stream);

    final ignorePointer = tester.widget<IgnorePointer>(
      find
          .ancestor(
            of: find.byKey(const Key('debug-overlay-paint')),
            matching: find.byType(IgnorePointer),
          )
          .first,
    );
    expect(ignorePointer.ignoring, isTrue);
  });

  testWidgets('subscribes on mount and cancels on unmount', (tester) async {
    final controller = StreamController<LandmarkFrame>.broadcast();
    addTearDown(controller.close);

    await _pumpOverlay(tester, controller.stream);
    expect(controller.hasListener, isTrue);

    await tester.pumpWidget(const SizedBox());
    expect(controller.hasListener, isFalse);
  });

  testWidgets('confidence is shown to two decimal places', (tester) async {
    final controller = StreamController<LandmarkFrame>.broadcast();
    addTearDown(controller.close);
    await _pumpOverlay(tester, controller.stream);

    controller.add(_frame([_hand(Handedness.right, confidence: 0.876)]));
    await tester.pump();
    await tester.pump();

    expect(find.text('right 0.88'), findsOneWidget);
  });

  group('coordinate-pipeline diagnostics (research D24, temporary tooling)', () {
    testWidgets('off by default', (tester) async {
      final controller = StreamController<LandmarkFrame>.broadcast();
      addTearDown(controller.close);
      await _pumpOverlay(tester, controller.stream);

      expect(find.byKey(const Key('coordinate-debug-paint')), findsNothing);
    });

    testWidgets('renders when explicitly enabled, with and without a frame',
        (tester) async {
      final controller = StreamController<LandmarkFrame>.broadcast();
      addTearDown(controller.close);
      await _pumpOverlay(tester, controller.stream, showCoordinateDebug: true);

      expect(find.byKey(const Key('coordinate-debug-paint')), findsOneWidget);
      expect(tester.takeException(), isNull);

      controller.add(_frame([_hand(Handedness.left)]));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('coordinate-debug-paint')), findsOneWidget);
    });
  });
}
