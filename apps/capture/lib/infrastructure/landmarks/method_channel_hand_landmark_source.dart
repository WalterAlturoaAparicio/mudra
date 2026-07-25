/// The platform seam: MediaPipe hand landmarks over method/event channels.
///
/// This is the only Dart file that knows a platform exists. An iOS
/// implementation satisfies the same contract with Swift + AVFoundation and
/// requires no change anywhere else.
///
/// It also **enforces** the camera contract (FR-044): if the native side ever
/// reports anything but a mirrored front camera, recording is refused rather
/// than done against a configuration whose handedness labels cannot be trusted.
/// That mistake would be invisible in the data afterwards.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/services.dart';

/// Control channel name, shared with the Kotlin plugin.
const String landmarkMethodChannelName = 'mudra.capture/landmarks';

/// Frame stream channel name, shared with the Kotlin plugin.
const String landmarkEventChannelName = 'mudra.capture/landmarks/frames';

/// Lens-facing constant for the front camera (Android `CameraSelector`).
const int frontLensFacing = 1;

/// Floats per hand in the wire payload: 21 landmarks × (x, y, z).
const int floatsPerHand = handLandmarkCount * 3;

/// Reads hand landmarks from the native detector.
class MethodChannelHandLandmarkSource implements HandLandmarkSource {
  /// Creates a source over the shared channel names.
  MethodChannelHandLandmarkSource({
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
  })  : _methods = methodChannel ?? const MethodChannel(landmarkMethodChannelName),
        _events = eventChannel ?? const EventChannel(landmarkEventChannelName);

  final MethodChannel _methods;
  final EventChannel _events;

  Stream<LandmarkFrame>? _frames;

  @override
  Future<LandmarkSourceSession> start() async {
    final Map<Object?, Object?>? reply;
    try {
      reply = await _methods.invokeMapMethod<Object?, Object?>('start');
    } on PlatformException catch (error) {
      throw _mapPlatformException(error);
    }

    if (reply == null) {
      throw const CameraFailure(
        'The camera could not be started.',
        code: 'camera_unavailable',
      );
    }

    final data = reply.cast<String, Object?>();
    final session = LandmarkSourceSession(
      textureId: data['textureId']! as int,
      previewWidth: (data['previewWidth'] as int?) ?? 0,
      previewHeight: (data['previewHeight'] as int?) ?? 0,
      analysisWidth: data['analysisWidth']! as int,
      analysisHeight: data['analysisHeight']! as int,
      lensFacing: data['lensFacing']! as int,
      mirrored: (data['mirrored'] as bool?) ?? false,
      mediapipeVersion: data['mediapipeVersion'] as String?,
    );

    // FR-044: verified, not assumed. A rear-facing or unmirrored capture would
    // mislabel every hand in the dataset, undetectably.
    if (session.lensFacing != frontLensFacing || !session.mirrored) {
      await stop();
      throw CameraFailure.unsupportedConfiguration(
        'lensFacing=${session.lensFacing}, mirrored=${session.mirrored}',
      );
    }

    return session;
  }

  @override
  Stream<LandmarkFrame> get frames =>
      _frames ??= _events.receiveBroadcastStream().transform(
        StreamTransformer<dynamic, LandmarkFrame>.fromHandlers(
          handleData: (event, sink) {
            final frame = _decodeFrame(event);
            if (frame != null) sink.add(frame);
          },
          handleError: (error, stackTrace, sink) {
            sink.addError(
              error is PlatformException
                  ? _mapPlatformException(error)
                  : CameraFailure(
                      'The camera stopped unexpectedly.',
                      debugDetail: error,
                    ),
              stackTrace,
            );
          },
        ),
      );

  @override
  Future<void> stop() async {
    try {
      await _methods.invokeMethod<void>('stop');
    } on PlatformException {
      // Stopping is best-effort: a failure here must not mask the reason the
      // caller was stopping in the first place.
    }
  }

  @override
  Future<void> dispose() async {
    _frames = null;
    try {
      await _methods.invokeMethod<void>('dispose');
    } on PlatformException {
      // Same reasoning as stop().
    }
  }

  /// Decodes one event payload, for tests that exercise the wire format
  /// without a platform channel.
  @visibleForTesting
  LandmarkFrame? decodeForTest(Object? event) => _decodeFrame(event);

  /// Decodes one event payload; returns `null` for anything malformed rather
  /// than throwing into the capture session.
  LandmarkFrame? _decodeFrame(Object? event) {
    if (event is! Map) return null;
    final data = event.cast<Object?, Object?>();

    final timestamp = data['t'];
    final width = data['w'];
    final height = data['h'];
    if (timestamp is! int || width is! int || height is! int) return null;

    final hands = <HandDetection>[];
    final rawHands = data['hands'];
    if (rawHands is List) {
      for (final entry in rawHands) {
        final hand = _decodeHand(entry);
        if (hand != null) hands.add(hand);
      }
    }

    return LandmarkFrame(
      hands: hands,
      frameWidth: width,
      frameHeight: height,
      timestampMicros: timestamp,
    );
  }

  HandDetection? _decodeHand(Object? entry) {
    if (entry is! Map) return null;
    final data = entry.cast<Object?, Object?>();

    final points = data['lm'];
    if (points is! Float32List || points.length != floatsPerHand) return null;

    final landmarks = <Landmark>[];
    for (var i = 0; i < floatsPerHand; i += 3) {
      landmarks.add(
        Landmark(x: points[i], y: points[i + 1], z: points[i + 2]),
      );
    }

    final score = data['score'];
    return HandDetection(
      handedness: Handedness.fromLabel(data['handedness'] as String?),
      confidence: score is num ? score.toDouble() : 0,
      landmarks: HandLandmarks(landmarks),
    );
  }

  CameraFailure _mapPlatformException(PlatformException error) {
    switch (error.code) {
      case 'camera_permission_denied':
        return CameraFailure.permissionDenied();
      case 'camera_configuration_unsupported':
        return CameraFailure.unsupportedConfiguration(error.message ?? '');
      case 'model_unavailable':
        return CameraFailure(
          'The hand detection model could not be loaded.',
          code: error.code,
          debugDetail: error.message,
        );
      case 'orientation_changed':
        return CameraFailure(
          'The screen rotated during recording.',
          code: error.code,
          debugDetail: error.message,
        );
      default:
        return CameraFailure(
          'The camera is unavailable. Close other apps using it and try again.',
          code: error.code,
          debugDetail: error.message,
        );
    }
  }
}
