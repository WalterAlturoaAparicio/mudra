/// The camera platform contract, verified rather than assumed.
///
/// The pre-revision version of this file asserted `lensFacing == 1 && mirrored
/// == true` on every start, because the front camera was the only permitted
/// configuration. Revision R1 permits both lenses and preserves the same
/// anti-corruption guarantee by converting rear-lens captures into the canonical
/// convention before storage. What must still be verified is narrower but just
/// as important: **the lens the platform binds is the lens that was requested**,
/// and the mirroring it reports is consistent with that lens.
///
/// A silent substitution here would mislabel every hand in the dataset in a way
/// neither this application nor the engine could detect afterwards (FR-044).
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/infrastructure/camera/method_channel_camera_source.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(cameraMethodChannelName);
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  const request = CameraRequest(
    lens: LensPosition.front,
    analysisWidth: 640,
    analysisHeight: 480,
  );

  Map<String, Object?> reply({
    String lens = 'front',
    bool mirrored = true,
    int platformLensId = 1,
    int previewWidth = 720,
    int previewHeight = 1280,
  }) => {
    'textureId': 7,
    'previewWidth': previewWidth,
    'previewHeight': previewHeight,
    'analysisWidth': 640,
    'analysisHeight': 480,
    'lens': lens,
    'mirrored': mirrored,
    'platformLensId': platformLensId,
    'rotationDegrees': 90,
    'detectorVersion': '0.10.14',
  };

  void handle(Future<Object?> Function(MethodCall call) handler) {
    messenger.setMockMethodCallHandler(channel, handler);
  }

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  group('lens selection is explicit and verified (FR-044)', () {
    test('a session opens when the platform binds the requested lens', () async {
      handle((call) async => call.method == 'open' ? reply() : null);

      final session = await MethodChannelCameraSource().open(request);

      expect(session.info.lens, LensPosition.front);
      expect(session.info.convention, ViewConvention.canonical);
      expect(session.info.mirroredPreview, isTrue);
      expect(session.info.platformLensId, 1);
      expect(session.info.detectorVersion, '0.10.14');
    });

    test('the rear lens opens too, in the unmirrored convention', () async {
      handle(
        (call) async => call.method == 'open'
            ? reply(lens: 'rear', mirrored: false, platformLensId: 0)
            : null,
      );

      final session = await MethodChannelCameraSource().open(
        const CameraRequest(
          lens: LensPosition.rear,
          analysisWidth: 640,
          analysisHeight: 480,
        ),
      );

      // R1 permits this: the guarantee is preserved by converting before
      // storage, not by refusing the lens.
      expect(session.info.lens, LensPosition.rear);
      expect(session.info.convention, ViewConvention.unmirrored);
      expect(session.info.mirroredPreview, isFalse);
    });

    test('a substituted lens is refused, not silently accepted', () async {
      // The platform was asked for the front lens and bound the rear one.
      handle(
        (call) async => call.method == 'open'
            ? reply(lens: 'rear', mirrored: false, platformLensId: 0)
            : null,
      );

      await expectLater(
        MethodChannelCameraSource().open(request),
        throwsA(isA<CameraFailure>()),
      );
    });

    test('mirroring inconsistent with the lens is refused', () async {
      handle(
        (call) async => call.method == 'open' ? reply(mirrored: false) : null,
      );

      await expectLater(
        MethodChannelCameraSource().open(request),
        throwsA(isA<CameraFailure>()),
      );
    });
  });

  group('preview dimensions come from the platform (FR-099)', () {
    test('the aspect ratio uses the reported size, not a constant', () async {
      handle(
        (call) async => call.method == 'open'
            ? reply(previewWidth: 1080, previewHeight: 1440)
            : null,
      );

      final session = await MethodChannelCameraSource().open(request);

      expect(session.info.previewAspect, closeTo(1080 / 1440, 1e-9));
      expect(session.info.rotationDegrees, 90);
    });
  });

  group('lens enumeration (FR-064/FR-069)', () {
    test('reports what the device actually has', () async {
      handle(
        (call) async =>
            call.method == 'availableLenses' ? <String>['front'] : null,
      );

      final lenses = await MethodChannelCameraSource().availableLenses();

      expect(lenses, {LensPosition.front});
    });

    test('a platform that cannot answer reports no lenses, not a crash',
        () async {
      handle((call) async => throw PlatformException(code: 'boom'));

      expect(await MethodChannelCameraSource().availableLenses(), isEmpty);
    });
  });

  group('failure taxonomy: every code has a distinct route out (SC-029)', () {
    final cases = <String, CameraRecovery>{
      'camera_permission_denied': CameraRecovery.requestPermission,
      'camera_permission_permanently_denied': CameraRecovery.openSettings,
      'camera_busy': CameraRecovery.retry,
      'lens_unavailable': CameraRecovery.useOtherLens,
      'model_unavailable': CameraRecovery.retry,
      'camera_start_failed': CameraRecovery.retry,
      'something_unexpected': CameraRecovery.retry,
    };

    cases.forEach((code, recovery) {
      test('$code maps to ${recovery.name}', () async {
        handle((call) async => throw PlatformException(code: code));

        await expectLater(
          MethodChannelCameraSource().open(request),
          throwsA(
            isA<CameraFailure>()
                .having((f) => f.recovery, 'recovery', recovery)
                .having((f) => f.message, 'message', isNotEmpty),
          ),
        );
      });
    });
  });

  group('close is total and idempotent (FR-086/FR-095)', () {
    test('closing twice invokes the platform once and never throws', () async {
      var closes = 0;
      handle((call) async {
        if (call.method == 'open') return reply();
        if (call.method == 'close') closes += 1;
        return null;
      });

      final session = await MethodChannelCameraSource().open(request);
      await session.close();
      await session.close();

      expect(closes, 1);
    });

    test('close completes even when the platform fails', () async {
      handle((call) async {
        if (call.method == 'open') return reply();
        throw PlatformException(code: 'close_failed');
      });

      final session = await MethodChannelCameraSource().open(request);

      // Must not throw: a failure here would leave the caller believing the
      // camera is still held (FR-095).
      await expectLater(session.close(), completes);
    });
  });
}
