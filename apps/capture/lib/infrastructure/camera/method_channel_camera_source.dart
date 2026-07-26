/// The platform seam: camera acquisition and MediaPipe hand landmarks over
/// method/event channels.
///
/// This is the only Dart file that knows a platform exists. An iOS
/// implementation satisfies the same contract with Swift + AVFoundation and
/// requires no change anywhere else (FR-114).
///
/// It also **verifies** the camera contract rather than assuming it: the lens
/// the platform returns must be the lens that was requested, and the reported
/// mirroring must be consistent with it. A silent substitution here would
/// mislabel every hand in the dataset in a way neither this application nor the
/// engine could detect afterwards (FR-044).
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/services.dart';

/// Control channel name, shared with the Kotlin plugin.
const String cameraMethodChannelName = 'mudra.capture/camera';

/// Frame stream channel name, shared with the Kotlin plugin.
const String cameraEventChannelName = 'mudra.capture/camera/frames';

/// Floats per hand in the wire payload: 21 landmarks × (x, y, z).
const int floatsPerHand = handLandmarkCount * 3;

/// Opens cameras through the platform channel.
class MethodChannelCameraSource implements CameraSource {
  /// Creates a source over the shared channel names.
  MethodChannelCameraSource({
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
  })  : _methods = methodChannel ?? const MethodChannel(cameraMethodChannelName),
        _events = eventChannel ?? const EventChannel(cameraEventChannelName);

  final MethodChannel _methods;
  final EventChannel _events;

  @override
  Future<Set<LensPosition>> availableLenses() async {
    try {
      final reply = await _methods.invokeListMethod<String>('availableLenses');
      if (reply == null) return const {};
      return {
        for (final value in reply)
          if (value == 'front') LensPosition.front else LensPosition.rear,
      };
    } on PlatformException {
      // Absence is data, not an error (FR-064/FR-069). A device that cannot
      // answer is treated as having no usable lens, which the capture screen
      // reports plainly rather than crashing on.
      return const {};
    }
  }

  @override
  Future<CameraSession> open(CameraRequest request) async {
    final Map<Object?, Object?>? reply;
    try {
      reply = await _methods.invokeMapMethod<Object?, Object?>('open', {
        'lens': request.lens.wireValue,
        'analysisWidth': request.analysisWidth,
        'analysisHeight': request.analysisHeight,
      });
    } on PlatformException catch (error) {
      throw mapPlatformException(error, request.lens);
    }

    if (reply == null) throw CameraFailure.startFailed('open returned null');

    final data = reply.cast<String, Object?>();
    final lens = LensPosition.fromWire(data['lens']! as String);
    final mirrored = (data['mirrored'] as bool?) ?? false;

    // FR-044: verified, not assumed.
    if (lens != request.lens) {
      await _closeQuietly();
      throw CameraFailure.startFailed(
        'Requested ${request.lens.wireValue} but the platform bound '
        '${lens.wireValue}. Recording is refused rather than done against a '
        'lens whose handedness cannot be trusted.',
      );
    }
    if (mirrored != lens.defaultConvention.isMirrored) {
      await _closeQuietly();
      throw CameraFailure.startFailed(
        'The ${lens.wireValue} lens reported mirrored=$mirrored, which does not '
        'match its viewing convention.',
      );
    }

    final info = CameraSessionInfo(
      textureId: data['textureId']! as int,
      previewWidth: (data['previewWidth'] as int?) ?? 0,
      previewHeight: (data['previewHeight'] as int?) ?? 0,
      analysisWidth: data['analysisWidth']! as int,
      analysisHeight: data['analysisHeight']! as int,
      lens: lens,
      convention:
          mirrored ? ViewConvention.canonical : ViewConvention.unmirrored,
      platformLensId: (data['platformLensId'] as int?) ?? (mirrored ? 1 : 0),
      rotationDegrees: (data['rotationDegrees'] as int?) ?? 0,
      detectorVersion: data['detectorVersion'] as String?,
    );

    return MethodChannelCameraSession(
      info: info,
      methods: _methods,
      events: _events,
      defaultConvention: info.convention,
    );
  }

  Future<void> _closeQuietly() async {
    try {
      await _methods.invokeMethod<void>('close');
    } on PlatformException {
      // Best effort: a failure here must not mask the reason we were closing.
    }
  }

  /// Maps a platform error code onto the failure taxonomy (FR-107–FR-111).
  ///
  /// Every code produces a distinct explanation **and** a distinct route out —
  /// SC-029 forbids any path that ends in an indefinite loading state.
  @visibleForTesting
  static CameraFailure mapPlatformException(
    PlatformException error,
    LensPosition lens,
  ) => switch (error.code) {
    'camera_permission_denied' => CameraFailure.permissionDenied(),
    'camera_permission_permanently_denied' =>
      CameraFailure.permissionPermanentlyDenied(),
    'camera_busy' => CameraFailure.busy(error.message),
    'lens_unavailable' => CameraFailure.lensUnavailable(
      lens.wireValue,
      error.message,
    ),
    'model_unavailable' => CameraFailure.detectorUnavailable(error.message),
    'orientation_changed' => CameraFailure(
      'The screen rotated during recording.',
      code: error.code,
      debugDetail: error.message,
    ),
    'camera_disconnected' => CameraFailure.lensUnavailable(
      lens.wireValue,
      error.message,
    ),
    _ => CameraFailure.startFailed(error.message),
  };
}

/// One live acquisition, over the platform channel.
class MethodChannelCameraSession implements CameraSession {
  /// Creates a session descriptor bound to the channels.
  MethodChannelCameraSession({
    required this.info,
    required MethodChannel methods,
    required EventChannel events,
    required ViewConvention defaultConvention,
  })  : _methods = methods,
        _events = events,
        _defaultConvention = defaultConvention;

  @override
  final CameraSessionInfo info;

  final MethodChannel _methods;
  final EventChannel _events;
  final ViewConvention _defaultConvention;

  Stream<LandmarkFrame>? _frames;
  bool _closed = false;

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
                  ? MethodChannelCameraSource.mapPlatformException(
                      error,
                      info.lens,
                    )
                  : CameraFailure.startFailed(error),
              stackTrace,
            );
          },
        ),
      );

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _frames = null;
    try {
      await _methods.invokeMethod<void>('close');
    } on PlatformException {
      // Idempotent and best-effort (FR-095): closing must complete even when
      // the preceding open failed partway through.
    }
  }

  /// Decodes one event payload, for tests that exercise the wire format
  /// without a platform channel.
  @visibleForTesting
  LandmarkFrame? decodeForTest(Object? event) => _decodeFrame(event);

  /// Decodes one event payload; returns `null` for anything malformed rather
  /// than throwing into the recording session.
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

    // The convention travels with the frame so the canonical conversion is a
    // function of the data, never of ambient state.
    final mirrored = data['mirrored'] as bool?;
    return LandmarkFrame(
      hands: hands,
      frameWidth: width,
      frameHeight: height,
      timestampMicros: timestamp,
      convention: mirrored == null
          ? _defaultConvention
          : (mirrored ? ViewConvention.canonical : ViewConvention.unmirrored),
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
}
