/// The four capture-session controls (FR-072/FR-078/FR-105, FR-064/FR-069).
///
/// These were originally scheduled with the layout work, which put a P3 task in
/// front of a P1 and a P2 story: FR-078 belongs to the capture loop and US7's
/// own independent test requires turning the countdown on in Operator Capture.
/// They are built here, with the stories that need them.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/presentation/capture/capture_control_bar.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const config = CaptureConfig();

  CaptureSettings settingsFor(CaptureMode mode) =>
      CaptureSettings.fromProfile(mode, config.profileFor(mode));

  Future<void> pumpBar(
    WidgetTester tester, {
    required CaptureSettings settings,
    Set<LensPosition> lenses = const {LensPosition.front, LensPosition.rear},
    bool enabled = true,
    ValueChanged<CaptureMode>? onModeChanged,
    VoidCallback? onLensToggled,
    ValueChanged<bool>? onCountdownChanged,
    ValueChanged<bool>? onConfirmTakesChanged,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CaptureControlBar(
            settings: settings,
            availableLenses: lenses,
            enabled: enabled,
            onModeChanged: onModeChanged ?? (_) {},
            onLensToggled: onLensToggled ?? () {},
            onCountdownChanged: onCountdownChanged ?? (_) {},
            onConfirmTakesChanged: onConfirmTakesChanged ?? (_) {},
          ),
        ),
      ),
    );
  }

  group('all four controls are on the capture screen (FR-105)', () {
    testWidgets('mode, lens, countdown, and confirmation are all present',
        (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.selfCapture));

      expect(find.byKey(const Key('capture-mode-selector')), findsOneWidget);
      expect(find.byKey(const Key('lens-switch-button')), findsOneWidget);
      expect(find.byKey(const Key('countdown-toggle')), findsOneWidget);
      expect(find.byKey(const Key('confirm-takes-toggle')), findsOneWidget);
    });
  });

  group('the countdown toggle (FR-072)', () {
    testWidgets('reports the countdown length when on', (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.selfCapture));
      expect(find.text('Countdown 3s'), findsOneWidget);
    });

    testWidgets('reports plainly when off', (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.operatorCapture));
      expect(find.text('No countdown'), findsOneWidget);
    });

    testWidgets('turning it on in Operator Capture requests the change',
        (tester) async {
      bool? requested;
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.operatorCapture),
        onCountdownChanged: (value) => requested = value,
      );

      await tester.tap(find.byKey(const Key('countdown-toggle')));

      // US7's independent test depends on exactly this being reachable.
      expect(requested, isTrue);
    });

    testWidgets('turning it off in Self Capture requests the change',
        (tester) async {
      bool? requested;
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        onCountdownChanged: (value) => requested = value,
      );

      await tester.tap(find.byKey(const Key('countdown-toggle')));

      expect(requested, isFalse);
    });
  });

  group('the take-confirmation toggle (FR-078)', () {
    testWidgets('starts on and reads as reviewing takes', (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.selfCapture));
      expect(find.text('Review takes'), findsOneWidget);
    });

    testWidgets('turning it off requests the change', (tester) async {
      bool? requested;
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        onConfirmTakesChanged: (value) => requested = value,
      );

      await tester.tap(find.byKey(const Key('confirm-takes-toggle')));

      expect(requested, isFalse);
    });

    testWidgets('reads as skipping review when off', (tester) async {
      await pumpBar(
        tester,
        settings:
            settingsFor(CaptureMode.selfCapture).copyWith(confirmTakes: false),
      );
      expect(find.text('Skip review'), findsOneWidget);
    });
  });

  group('the lens switch (FR-065/FR-069)', () {
    testWidgets('switching is offered when the device has two lenses',
        (tester) async {
      var switched = false;
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        onLensToggled: () => switched = true,
      );

      await tester.tap(find.byKey(const Key('lens-switch-button')));

      expect(switched, isTrue);
    });

    testWidgets('is unavailable with a stated reason on a one-lens device',
        (tester) async {
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        lenses: {LensPosition.front},
      );

      final button = tester.widget<IconButton>(
        find.byKey(const Key('lens-switch-button')),
      );
      expect(
        button.onPressed,
        isNull,
        reason: 'FR-069: unavailable rather than failing on tap',
      );

      final tooltip = tester.widget<Tooltip>(
        find.ancestor(
          of: find.byKey(const Key('lens-switch-button')),
          matching: find.byType(Tooltip),
        ),
      );
      expect(tooltip.message, contains('only one camera'));
    });

    testWidgets('the icon follows the active lens', (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.selfCapture));
      expect(find.byIcon(Icons.camera_front), findsOneWidget);

      await pumpBar(tester, settings: settingsFor(CaptureMode.operatorCapture));
      expect(find.byIcon(Icons.camera_rear), findsOneWidget);
    });
  });

  group('unavailable modes say why (FR-064)', () {
    testWidgets('a device without a rear camera explains Operator Capture',
        (tester) async {
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        lenses: {LensPosition.front},
      );

      expect(
        find.textContaining('Operator Capture needs a rear camera'),
        findsOneWidget,
      );
    });

    testWidgets('a device without a front camera explains Self Capture',
        (tester) async {
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.operatorCapture),
        lenses: {LensPosition.rear},
      );

      expect(
        find.textContaining('Self Capture needs a front camera'),
        findsOneWidget,
      );
    });

    testWidgets('both modes are offered when both lenses exist', (tester) async {
      await pumpBar(tester, settings: settingsFor(CaptureMode.selfCapture));

      expect(find.textContaining('needs a'), findsNothing);
      expect(find.text('Self Capture'), findsOneWidget);
      expect(find.text('Operator Capture'), findsOneWidget);
    });
  });

  group('controls are inert while a take is running', () {
    testWidgets('every control is disabled', (tester) async {
      await pumpBar(
        tester,
        settings: settingsFor(CaptureMode.selfCapture),
        enabled: false,
      );

      expect(
        tester
            .widget<IconButton>(find.byKey(const Key('lens-switch-button')))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<OutlinedButton>(find.byKey(const Key('countdown-toggle')))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const Key('confirm-takes-toggle')),
            )
            .onPressed,
        isNull,
      );
    });
  });
}
