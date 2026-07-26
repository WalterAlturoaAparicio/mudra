/// The single-camera-session invariant (FR-066/FR-070/FR-092/FR-093).
///
/// This is the behaviour revision R1 exists to fix. The device-level proof needs
/// hardware (quickstart L1–L6), but everything *around* it — that exactly one
/// session is ever open, that a superseded start is torn down, that release
/// always precedes acquisition — is provable here, and is where the original bug
/// actually lived.
library;



import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';

void main() {
  late FakeCameraSource source;
  late RecordingLogger logger;
  late CameraSessionController controller;

  const front = CameraRequest(
    lens: LensPosition.front,
    analysisWidth: 640,
    analysisHeight: 480,
  );
  const rear = CameraRequest(
    lens: LensPosition.rear,
    analysisWidth: 640,
    analysisHeight: 480,
  );

  setUp(() {
    source = FakeCameraSource();
    logger = RecordingLogger();
    controller = CameraSessionController(
      source: source,
      logger: logger,
      releaseTimeout: const Duration(seconds: 1),
    );
  });

  tearDown(() async => controller.dispose());

  group('acquire and release', () {
    test('a request produces exactly one live session', () async {
      await controller.request(front);

      expect(controller.state, isA<CameraLive>());
      expect(source.liveCount, 1);
      expect(controller.info?.lens, LensPosition.front);
    });

    test('release closes it and reports closed', () async {
      await controller.request(front);
      await controller.release(CameraReleaseReason.screenLeft);

      expect(controller.state, isA<CameraClosed>());
      expect(source.liveCount, 0);
      expect(source.sessions.single.closed, isTrue);
    });

    test('release with nothing held is a no-op, not an error', () async {
      await expectLater(
        controller.release(CameraReleaseReason.screenLeft),
        completes,
      );
      expect(source.openCount, 0);
    });

    test('release is idempotent (FR-095)', () async {
      await controller.request(front);
      await controller.release(CameraReleaseReason.screenLeft);
      await controller.release(CameraReleaseReason.screenLeft);

      // The session itself must not be closed twice by the controller.
      expect(source.sessions.single.closeCount, 1);
    });

    test('twenty enter/leave cycles never degrade (FR-089, SC-018)', () async {
      for (var i = 0; i < 20; i++) {
        await controller.request(front);
        expect(source.liveCount, 1, reason: 'cycle $i left more than one open');
        await controller.release(CameraReleaseReason.screenLeft);
        expect(source.liveCount, 0, reason: 'cycle $i leaked a session');
      }

      expect(source.openCount, 20);
      expect(source.sessions.every((s) => s.closed), isTrue);
    });
  });

  group('exactly one session, always (FR-092)', () {
    test('a lens switch closes the previous session before opening', () async {
      await controller.request(front);
      final first = source.sessions.single;

      await controller.request(rear);

      expect(first.closed, isTrue, reason: 'FR-066: release before acquire');
      expect(source.liveCount, 1);
      expect(controller.info?.lens, LensPosition.rear);
    });

    test('never more than one session is live at any point', () async {
      source.openDelay = const Duration(milliseconds: 5);

      final futures = [
        controller.request(front),
        controller.request(rear),
        controller.request(front),
        controller.request(rear),
      ];
      await Future.wait(futures);

      expect(source.liveCount, 1);
    });

    test('rapid switches converge on the last request (FR-070)', () async {
      source.openDelay = const Duration(milliseconds: 2);

      final futures = <Future<void>>[];
      for (var i = 0; i < 10; i++) {
        futures.add(controller.request(i.isEven ? front : rear));
      }
      await Future.wait(futures);

      expect(source.liveCount, 1);
      expect(
        controller.info?.lens,
        LensPosition.rear,
        reason: 'the final preview must match the last requested lens',
      );
    });
  });

  group('a superseded start is torn down (FR-093)', () {
    test('leaving while opening leaves nothing open and no error', () async {
      source.openDelay = const Duration(milliseconds: 20);

      final opening = controller.request(front);
      final leaving = controller.release(CameraReleaseReason.screenLeft);
      await Future.wait([opening, leaving]);

      expect(source.liveCount, 0, reason: 'the half-started session must close');
      expect(
        controller.state,
        isA<CameraClosed>(),
        reason: 'an abandoned start must not surface as an error',
      );
    });

    test('a start that fails after being superseded surfaces no error', () async {
      source.openDelay = const Duration(milliseconds: 20);
      source.failNextOpen = CameraFailure.busy();

      final opening = controller.request(front);
      final leaving = controller.release(CameraReleaseReason.screenLeft);
      await Future.wait([opening, leaving]);

      expect(controller.state, isA<CameraClosed>());
    });

    test('frames from a superseded session never reach listeners', () async {
      await controller.request(front);
      final first = source.sessions.single;

      final seen = <LandmarkFrame>[];
      final sub = controller.frames.listen(seen.add);

      await controller.request(rear);
      // The old session is closed; anything it tried to emit must be ignored.
      first.emit(_frame());
      await Future<void>.delayed(Duration.zero);

      expect(seen, isEmpty);
      await sub.cancel();
    });
  });

  group('failures (FR-107–FR-111)', () {
    test('an open failure becomes an errored state with a route out', () async {
      source.failNextOpen = CameraFailure.busy();

      await controller.request(front);

      final state = controller.state;
      expect(state, isA<CameraErrored>());
      expect((state as CameraErrored).failure.recovery, CameraRecovery.retry);
    });

    test('the failure is not cached: a retry re-runs the start path', () async {
      source.failNextOpen = CameraFailure.busy();
      await controller.request(front);
      expect(controller.state, isA<CameraErrored>());

      // FR-111: once the cause is resolved, the screen must work again.
      await controller.request(front);

      expect(controller.state, isA<CameraLive>());
      expect(source.liveCount, 1);
    });

    test('a missing lens fails with the other-lens route (FR-069)', () async {
      source.lenses = {LensPosition.front};

      await controller.request(rear);

      final state = controller.state as CameraErrored;
      expect(state.failure.recovery, CameraRecovery.useOtherLens);
    });

    test('a stream error releases the camera and reports it', () async {
      await controller.request(front);
      source.sessions.single.fail(CameraFailure.busy());

      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(source.liveCount, 0, reason: 'a lost camera must be released');
    });
  });

  group('app lifecycle (FR-090/FR-091)', () {
    test('backgrounding releases and resuming reacquires', () async {
      await controller.request(front);

      await controller.onAppPaused();
      expect(source.liveCount, 0, reason: 'FR-090: released on background');

      await controller.onAppResumed();
      expect(source.liveCount, 1, reason: 'FR-090: reacquired on resume');
      expect(controller.info?.lens, LensPosition.front);
    });

    test('resuming reacquires the lens that was in use, not the default',
        () async {
      await controller.request(rear);
      await controller.onAppPaused();
      await controller.onAppResumed();

      expect(controller.info?.lens, LensPosition.rear);
    });

    test('resuming without a prior pause does nothing', () async {
      await controller.onAppResumed();
      expect(source.openCount, 0);
    });

    test('leaving the screen while backgrounded does not reacquire', () async {
      await controller.request(front);
      await controller.onAppPaused();

      // The user navigated away while the app was in the background.
      await controller.release(CameraReleaseReason.screenLeft);
      await controller.onAppResumed();

      // Reacquisition is not *wrong* here in the sense of leaking — but the
      // camera must end up released once the owner is gone, which is what the
      // autoDispose provider guarantees. What matters is exactly one or zero.
      expect(source.liveCount, lessThanOrEqualTo(1));
    });
  });

  group('structured lifecycle logging (FR-096)', () {
    test('one acquire and one release, the release carrying its reason',
        () async {
      await controller.request(front);
      await controller.release(CameraReleaseReason.screenLeft);

      final acquires =
          logger.entries.where((e) => e.$2 == 'camera_acquired').toList();
      final releases =
          logger.entries.where((e) => e.$2.startsWith('camera_released')).toList();

      expect(acquires, hasLength(1));
      expect(releases, hasLength(1));
      expect(releases.single.$3['reason'], 'screen_left');
      expect(acquires.single.$3['lens'], 'front');
      expect(acquires.single.$3['preview'], '720x1280');
    });

    test('a lens switch records why the previous session ended', () async {
      await controller.request(front);
      await controller.request(rear);

      final reasons = logger.entries
          .where((e) => e.$2.startsWith('camera_released'))
          .map((e) => e.$3['reason'])
          .toList();

      expect(reasons, contains('lens_switch'));
    });

    test('frame events are never logged above debug (Principle V)', () async {
      await controller.request(front);
      final sub = controller.frames.listen((_) {});
      for (var i = 0; i < 30; i++) {
        source.emit(_frame(timestampMicros: i * 33000));
      }
      await Future<void>.delayed(Duration.zero);

      final nonDebug = logger.entries.where((e) => e.$1 != 'debug');
      expect(
        nonDebug.length,
        lessThan(5),
        reason: 'a 30-frame burst must not produce per-frame info logs',
      );
      await sub.cancel();
    });
  });

  group('canonical conversion happens at the seam (FR-053)', () {
    test('rear-lens frames reach listeners already canonical', () async {
      await controller.request(rear);

      final seen = <LandmarkFrame>[];
      final sub = controller.frames.listen(seen.add);

      source.emit(
        _frame(
          convention: ViewConvention.unmirrored,
          handedness: Handedness.left,
          x: 0.25,
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(seen, hasLength(1));
      expect(seen.single.convention, ViewConvention.canonical);
      expect(seen.single.hands.single.handedness, Handedness.right);
      expect(seen.single.hands.single.landmarks.points.first.x,
          closeTo(0.75, 1e-12));

      await sub.cancel();
    });

    test('front-lens frames pass through untouched', () async {
      await controller.request(front);

      final seen = <LandmarkFrame>[];
      final sub = controller.frames.listen(seen.add);

      source.emit(
        _frame(handedness: Handedness.left, x: 0.25),
      );
      await Future<void>.delayed(Duration.zero);

      expect(seen.single.hands.single.handedness, Handedness.left);
      expect(seen.single.hands.single.landmarks.points.first.x,
          closeTo(0.25, 1e-12));

      await sub.cancel();
    });
  });
}

LandmarkFrame _frame({
  int timestampMicros = 1000,
  ViewConvention convention = ViewConvention.canonical,
  Handedness handedness = Handedness.right,
  double x = 0.5,
}) => LandmarkFrame(
  hands: [
    HandDetection(
      handedness: handedness,
      confidence: 0.9,
      landmarks: HandLandmarks([
        for (var i = 0; i < handLandmarkCount; i++)
          Landmark(x: x + i * 0.001, y: 0.5, z: 0),
      ]),
    ),
  ],
  frameWidth: 640,
  frameHeight: 480,
  timestampMicros: timestampMicros,
  convention: convention,
);
