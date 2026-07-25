/// The camera contract (FR-044).
///
/// A rear-facing or unmirrored capture produces handedness labels that are
/// wrong in a way neither this app nor the engine can detect afterwards, so the
/// Dart side verifies what the platform reports instead of trusting it.
library;

import 'dart:typed_data';

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/infrastructure/landmarks/method_channel_hand_landmark_source.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(landmarkMethodChannelName);
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  final calls = <String>[];

  void mockStart(Map<String, Object?> reply) {
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      if (call.method == 'start') return reply;
      return null;
    });
  }

  Map<String, Object?> validReply({int lensFacing = 1, bool mirrored = true}) => {
    'textureId': 7,
    'previewWidth': 1080,
    'previewHeight': 1920,
    'analysisWidth': 640,
    'analysisHeight': 480,
    'lensFacing': lensFacing,
    'mirrored': mirrored,
    'mediapipeVersion': '0.10.14',
  };

  setUp(calls.clear);

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('a mirrored front camera is accepted and reported', () async {
    mockStart(validReply());
    final source = MethodChannelHandLandmarkSource();

    final session = await source.start();

    expect(session.lensFacing, frontLensFacing);
    expect(session.mirrored, isTrue);
    expect(session.textureId, 7);
    expect(session.analysisWidth, 640);
    expect(session.analysisHeight, 480);
    expect(session.mediapipeVersion, '0.10.14');
  });

  test('a rear camera is refused (FR-044)', () async {
    mockStart(validReply(lensFacing: 0));
    final source = MethodChannelHandLandmarkSource();

    await expectLater(
      source.start(),
      throwsA(
        isA<CameraFailure>().having(
          (f) => f.code,
          'code',
          'camera_configuration_unsupported',
        ),
      ),
    );
    expect(
      calls,
      contains('stop'),
      reason: 'the camera must be released when the configuration is refused',
    );
  });

  test('an unmirrored preview is refused', () async {
    mockStart(validReply(mirrored: false));
    final source = MethodChannelHandLandmarkSource();

    await expectLater(
      source.start(),
      throwsA(isA<CameraFailure>()),
    );
  });

  test('a missing mirrored flag is treated as unmirrored, not assumed true', () async {
    final reply = validReply()..remove('mirrored');
    mockStart(reply);

    await expectLater(
      MethodChannelHandLandmarkSource().start(),
      throwsA(isA<CameraFailure>()),
    );
  });

  test('platform error codes map to user-facing failures', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'start') {
        throw PlatformException(code: 'camera_permission_denied');
      }
      return null;
    });

    await expectLater(
      MethodChannelHandLandmarkSource().start(),
      throwsA(
        isA<CameraFailure>()
            .having((f) => f.code, 'code', 'camera_permission_denied')
            .having((f) => f.message, 'message', contains('camera')),
      ),
    );
  });

  group('frame decoding', () {
    late MethodChannelHandLandmarkSource source;

    setUp(() {
      source = MethodChannelHandLandmarkSource();
    });

    Float32List landmarksPayload() =>
        Float32List.fromList([
          for (var i = 0; i < handLandmarkCount; i++) ...[
            0.01 * i,
            0.02 * i,
            0.005 * i,
          ],
        ]);

    test('decodes a two-hand frame', () {
      final frame = source.decodeForTest({
        't': 123456,
        'w': 640,
        'h': 480,
        'hands': [
          {'handedness': 'Left', 'score': 0.94, 'lm': landmarksPayload()},
          {'handedness': 'Right', 'score': 0.98, 'lm': landmarksPayload()},
        ],
      });

      expect(frame, isNotNull);
      expect(frame!.handCount, 2);
      expect(frame.frameWidth, 640);
      expect(frame.timestampMicros, 123456);
      expect(frame.hands.first.handedness, Handedness.left);
      expect(frame.hands.first.confidence, closeTo(0.94, 1e-6));
      expect(frame.hands.first.landmarks.points, hasLength(handLandmarkCount));
    });

    test('a frame with no hands is still delivered', () {
      // Silence must never encode "no hands" — the session counts empty frames
      // as discarded, which is how the user learns the take was bad.
      final frame = source.decodeForTest({
        't': 1,
        'w': 640,
        'h': 480,
        'hands': <Object?>[],
      });

      expect(frame, isNotNull);
      expect(frame!.handCount, 0);
    });

    test('a hand with the wrong landmark count is dropped, not crashed on', () {
      final frame = source.decodeForTest({
        't': 1,
        'w': 640,
        'h': 480,
        'hands': [
          {'handedness': 'Left', 'score': 0.9, 'lm': Float32List(30)},
        ],
      });

      expect(frame, isNotNull);
      expect(frame!.handCount, 0);
    });

    test('a malformed payload yields no frame instead of throwing', () {
      expect(source.decodeForTest('nonsense'), isNull);
      expect(source.decodeForTest({'t': 'not-an-int'}), isNull);
    });
  });
}
