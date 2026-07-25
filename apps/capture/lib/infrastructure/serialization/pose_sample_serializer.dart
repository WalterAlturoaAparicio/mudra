/// Pose sample serialization.
///
/// Owns the on-disk JSON format — the shared contract with the Mudra engine
/// (`schema_version` 1). Field names, nesting, and order match the engine's
/// `PoseSerializer` exactly; see
/// `specs/003-mobile-pose-capture/contracts/sample-json.md`.
///
/// The one addition this application makes is `metadata.capture.session_uuid`:
/// additive, optional, inside an existing block, tolerated when absent, so a
/// reader that ignores it still reads every sample (FR-045/FR-052).
library;

import 'dart:convert';

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/samples/pose_sample.dart';

/// Raised when a document is malformed or carries an incompatible version.
class PoseSchemaException implements Exception {
  /// Creates a schema exception.
  const PoseSchemaException(this.message);

  /// What was wrong with the document.
  final String message;

  @override
  String toString() => 'PoseSchemaException: $message';
}

/// Maps [PoseSample] to and from the engine's schema-v1 JSON.
class PoseSampleSerializer {
  /// Creates a serializer.
  const PoseSampleSerializer();

  /// Serializes [sample] to an ordered, schema-versioned map.
  Map<String, Object?> toMap(PoseSample sample) => {
    'schema_version': sampleSchemaVersion,
    'pose_id': sample.pose.poseId,
    'display_name': sample.pose.displayName,
    'description': sample.pose.description,
    'sample_uuid': sample.sampleUuid,
    'sample_number': sample.sampleNumber,
    'timestamp': sample.timestamp,
    'normalization': {
      'strategy': sample.normalization.strategy,
      'version': sample.normalization.version,
    },
    'metadata': _metadataToMap(sample.metadata),
    'hands': [for (final hand in sample.hands) _handToMap(hand)],
  };

  /// Serializes [sample] to indented, human-readable JSON text.
  String toJson(PoseSample sample, {int indent = 2}) =>
      JsonEncoder.withIndent(' ' * indent).convert(toMap(sample));

  /// Reconstructs a sample, validating the schema version and shape.
  PoseSample fromMap(Map<String, Object?> data) {
    final version = data['schema_version'];
    if (version != sampleSchemaVersion) {
      throw PoseSchemaException(
        'Unsupported schema_version $version (expected $sampleSchemaVersion).',
      );
    }
    try {
      final normalization = _asMap(data['normalization'], 'normalization');
      final hands = _asList(data['hands'], 'hands');
      return PoseSample(
        pose: Pose(
          poseId: data['pose_id']! as String,
          displayName: data['display_name'] as String?,
          description: data['description'] as String?,
        ),
        sampleUuid: data['sample_uuid']! as String,
        sampleNumber: (data['sample_number'] as String?) ?? '',
        timestamp: data['timestamp']! as String,
        normalization: NormalizationInfo(
          strategy: normalization['strategy']! as String,
          version: normalization['version']! as String,
        ),
        metadata: _metadataFromMap(_asMap(data['metadata'], 'metadata')),
        hands: [
          for (final hand in hands) _handFromMap(_asMap(hand, 'hands[]')),
        ],
      );
    } on PoseSchemaException {
      rethrow;
    } on Object catch (error) {
      throw PoseSchemaException('Malformed pose sample document: $error');
    }
  }

  /// Reconstructs a sample from JSON text.
  PoseSample fromJson(String text) {
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException catch (error) {
      throw PoseSchemaException('Invalid JSON: ${error.message}');
    }
    return fromMap(_asMap(decoded, 'document'));
  }

  // -- helpers ---------------------------------------------------------------

  Map<String, Object?> _metadataToMap(SampleMetadata metadata) => {
    'timestamp': metadata.timestamp,
    'camera': {
      'index': metadata.cameraIndex,
      'width': metadata.cameraWidth,
      'height': metadata.cameraHeight,
    },
    'versions': {
      'application': metadata.applicationVersion,
      'mediapipe': metadata.mediapipeVersion,
    },
    'num_hands': metadata.numHands,
    'hands': [
      for (final hand in metadata.hands)
        {'handedness': hand.handedness.wireValue, 'confidence': hand.confidence},
    ],
    'capture': _captureToMap(metadata.capture),
  };

  Map<String, Object?>? _captureToMap(CaptureTiming? capture) {
    if (capture == null) return null;
    return {
      'countdown_start_time': capture.countdownStartTime,
      'capture_time': capture.captureTime,
      'countdown_seconds': capture.countdownSeconds,
      // Additive field: engine readers ignore it, Capture readers use it.
      if (capture.sessionUuid != null) 'session_uuid': capture.sessionUuid,
    };
  }

  CaptureTiming? _captureFromMap(Object? raw) {
    if (raw == null) return null;
    final data = _asMap(raw, 'metadata.capture');
    return CaptureTiming(
      captureTime: data['capture_time']! as String,
      countdownStartTime: data['countdown_start_time'] as String?,
      countdownSeconds: _asDouble(data['countdown_seconds'] ?? 0),
      sessionUuid: data['session_uuid'] as String?,
    );
  }

  SampleMetadata _metadataFromMap(Map<String, Object?> data) {
    final camera = _asMap(data['camera'], 'metadata.camera');
    final versions = _asMap(data['versions'], 'metadata.versions');
    return SampleMetadata(
      timestamp: data['timestamp']! as String,
      cameraIndex: camera['index']! as int,
      cameraWidth: camera['width']! as int,
      cameraHeight: camera['height']! as int,
      mediapipeVersion: versions['mediapipe'] as String?,
      applicationVersion: versions['application']! as String,
      numHands: data['num_hands']! as int,
      hands: [
        for (final hand in _asList(data['hands'], 'metadata.hands'))
          HandMeta(
            handedness: Handedness.fromLabel(
              _asMap(hand, 'metadata.hands[]')['handedness'] as String?,
            ),
            confidence: _asDouble(_asMap(hand, 'metadata.hands[]')['confidence']),
          ),
      ],
      capture: _captureFromMap(data['capture']),
    );
  }

  Map<String, Object?> _handToMap(HandSample hand) => {
    'handedness': hand.handedness.wireValue,
    'confidence': hand.confidence,
    'raw': _landmarksToList(hand.raw),
    'normalized': _landmarksToList(hand.normalized),
  };

  HandSample _handFromMap(Map<String, Object?> data) => HandSample(
    handedness: Handedness.fromLabel(data['handedness'] as String?),
    confidence: _asDouble(data['confidence']),
    raw: _landmarksFromList(_asList(data['raw'], 'hands[].raw')),
    normalized: _landmarksFromList(
      _asList(data['normalized'], 'hands[].normalized'),
    ),
  );

  List<Map<String, Object?>> _landmarksToList(HandLandmarks hand) => [
    for (final p in hand.points) {'x': p.x, 'y': p.y, 'z': p.z},
  ];

  HandLandmarks _landmarksFromList(List<Object?> items) {
    if (items.length != handLandmarkCount) {
      throw PoseSchemaException(
        'Expected $handLandmarkCount landmarks, got ${items.length}.',
      );
    }
    return HandLandmarks([
      for (final item in items)
        Landmark(
          x: _asDouble(_asMap(item, 'landmark')['x']),
          y: _asDouble(_asMap(item, 'landmark')['y']),
          z: _asDouble(_asMap(item, 'landmark')['z']),
        ),
    ]);
  }

  Map<String, Object?> _asMap(Object? value, String field) {
    if (value is Map<String, Object?>) return value;
    if (value is Map) return value.cast<String, Object?>();
    throw PoseSchemaException('Expected an object at "$field".');
  }

  List<Object?> _asList(Object? value, String field) {
    if (value is List) return value;
    throw PoseSchemaException('Expected an array at "$field".');
  }

  double _asDouble(Object? value) {
    if (value is double) return value;
    if (value is int) return value.toDouble();
    throw PoseSchemaException('Expected a number, got $value.');
  }
}
