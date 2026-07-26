/// Settings ownership (FR-071–FR-075, FR-079, SC-032).
///
/// One rule, stated five times in the specification: **a setting changes when
/// the user changes it, or when the mode changes. Nothing else.** SC-032 makes
/// it measurable — across mode initialization, lens switches, backgrounding, and
/// screen lock, *zero* unrequested changes.
///
/// These tests are written as "do a pile of things that are not user intent, and
/// assert nothing moved", because that is the actual failure mode: a setting
/// that quietly resets is not a crash, it is a dataset recorded under conditions
/// the contributor did not choose.
library;

import 'package:capture/application/camera/capture_settings_notifier.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const config = CaptureConfig();

  late ProviderContainer container;
  late NotifierProvider<CaptureSettingsNotifier, CaptureSettings> provider;

  setUp(() {
    provider = NotifierProvider<CaptureSettingsNotifier, CaptureSettings>(
      () => CaptureSettingsNotifier(config),
    );
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  CaptureSettings read() => container.read(provider);
  CaptureSettingsNotifier notifier() => container.read(provider.notifier);

  group('mode profiles (FR-060/FR-061)', () {
    test('Self Capture initializes front, mirrored, countdown on at 3s', () {
      expect(read().mode, CaptureMode.selfCapture);
      expect(read().lens, LensPosition.front);
      expect(read().mirrored, isTrue);
      expect(read().countdownEnabled, isTrue);
      expect(read().countdownSeconds, 3.0);
    });

    test('Operator Capture initializes rear, unmirrored, countdown off', () {
      notifier().selectMode(CaptureMode.operatorCapture);

      expect(read().lens, LensPosition.rear);
      expect(read().mirrored, isFalse);
      expect(read().countdownEnabled, isFalse);
    });

    test('take confirmation starts enabled in both modes (FR-077)', () {
      expect(read().confirmTakes, isTrue);
      notifier().selectMode(CaptureMode.operatorCapture);
      expect(read().confirmTakes, isTrue);
    });
  });

  group('the user owns the settings after initialization (FR-072/FR-078)', () {
    test('the countdown can be turned off when initialized on', () {
      notifier().setCountdownEnabled(enabled: false);

      expect(read().countdownEnabled, isFalse);
      expect(read().countdown, Duration.zero);
      expect(read().recordedCountdownSeconds, 0.0);
    });

    test('the countdown can be turned on when initialized off', () {
      notifier().selectMode(CaptureMode.operatorCapture);
      notifier().setCountdownEnabled(enabled: true);

      expect(read().countdownEnabled, isTrue);
      expect(read().countdown, const Duration(seconds: 3));
    });

    test('take confirmation can be turned off', () {
      notifier().setConfirmTakes(enabled: false);
      expect(read().confirmTakes, isFalse);
    });
  });

  group('a mode change re-initializes — and is the only thing that does', () {
    test('changing mode resets the user\'s countdown to the new default', () {
      notifier().setCountdownEnabled(enabled: false);
      expect(read().countdownEnabled, isFalse);

      notifier().selectMode(CaptureMode.operatorCapture);
      notifier().setCountdownEnabled(enabled: true);
      notifier().selectMode(CaptureMode.selfCapture);

      expect(read().countdownEnabled, isTrue, reason: 'Self Capture default');
    });

    test('selecting the mode already active changes nothing', () {
      notifier()
        ..setCountdownEnabled(enabled: false)
        ..setConfirmTakes(enabled: false);
      final before = read();

      notifier().selectMode(CaptureMode.selfCapture);

      expect(read(), before, reason: 'a no-op must not reset user choices');
    });
  });

  group('a lens switch never touches the countdown (FR-074, SC-032)', () {
    test('switching lenses leaves the countdown on when the user set it on', () {
      notifier().selectMode(CaptureMode.operatorCapture);
      notifier().setCountdownEnabled(enabled: true);

      notifier().toggleLens();
      notifier().toggleLens();
      notifier().toggleLens();

      expect(read().countdownEnabled, isTrue);
      expect(read().countdownSeconds, 3.0);
    });

    test('switching lenses leaves the countdown off when the user set it off',
        () {
      notifier().setCountdownEnabled(enabled: false);

      notifier().selectLens(LensPosition.rear);
      notifier().selectLens(LensPosition.front);

      expect(
        read().countdownEnabled,
        isFalse,
        reason: 'the front lens must not re-apply the Self Capture default',
      );
    });

    test('mirroring follows the lens, in both directions (FR-067)', () {
      expect(read().lens, LensPosition.front);
      expect(read().mirrored, isTrue);

      notifier().toggleLens();
      expect(read().lens, LensPosition.rear);
      expect(read().mirrored, isFalse);

      notifier().toggleLens();
      expect(read().mirrored, isTrue);
    });

    test('a lens switch does not touch take confirmation either (FR-079)', () {
      notifier().setConfirmTakes(enabled: false);
      notifier().toggleLens();

      expect(read().confirmTakes, isFalse);
    });
  });

  group('SC-032: zero unrequested changes across a whole session', () {
    test('nothing but the user moves a setting', () {
      // The user's deliberate choices.
      notifier().selectMode(CaptureMode.operatorCapture);
      notifier().setCountdownEnabled(enabled: true);
      notifier().setConfirmTakes(enabled: false);
      final chosen = read();

      // Everything else that happens during a real collection session. None of
      // it is user intent, so none of it may change a value.
      notifier().toggleLens(); // lens switch
      notifier().toggleLens(); // and back
      notifier().selectMode(CaptureMode.operatorCapture); // mode re-selected
      // Backgrounding, screen lock, screen recreation, and completed takes do
      // not reach this notifier at all — it is scoped to the application run,
      // which is the structural reason they cannot reset anything.
      container.read(provider); // a rebuild, as a recreated screen would cause

      expect(
        read(),
        chosen,
        reason: 'SC-032: zero unrequested changes',
      );
    });

    test('the camera request follows the lens and the configured analysis size',
        () {
      notifier().selectLens(LensPosition.rear);
      final request = notifier().cameraRequest;

      expect(request.lens, LensPosition.rear);
      expect(request.analysisWidth, config.analysisWidth);
      expect(request.analysisHeight, config.analysisHeight);
    });
  });

  group('nothing is persisted across application runs (FR-075)', () {
    test('a fresh container starts from the mode defaults', () {
      notifier().setCountdownEnabled(enabled: false);
      expect(read().countdownEnabled, isFalse);

      final fresh = ProviderContainer();
      addTearDown(fresh.dispose);

      expect(fresh.read(provider).countdownEnabled, isTrue);
    });
  });
}
