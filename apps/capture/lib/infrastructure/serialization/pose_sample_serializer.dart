/// Pose sample serialization.
///
/// Owns the on-disk JSON format — the shared contract with the Mudra engine
/// (`schema_version` 1). Field names, nesting, and order match the engine's
/// `PoseSerializer` exactly; see
/// `specs/003-mobile-pose-capture/contracts/sample-json.md`.
///
/// Five values this application adds are **additive, optional, and inside blocks
/// the engine already reads**, so a reader that ignores them still reads every
/// sample (FR-052):
///
/// | Field | Block | Requirement |
/// |---|---|---|
/// | `session_uuid` | `metadata.capture` | FR-045 |
/// | `countdown_enabled` | `metadata.capture` | FR-083 |
/// | `position` | `metadata.camera` | FR-081 |
/// | `mirrored_preview` | `metadata.camera` | FR-082 |
/// | `lens_facing` | `metadata.camera` | FR-084 |
///
/// The engine reconstructs these blocks by explicit key lookup on plain frozen
/// dataclasses — no strict-shape validation — so unknown keys are ignored rather
/// than rejected, and it loads these samples today unmodified.
///
/// **Name/key divergence, on purpose**: the Dart field is `canonicalRaw` and the
/// emitted key is `raw` (FR-056/FR-057). Renaming the key would be a schema
/// change; renaming only the field is a terminology correction. A test pins
/// this so nobody "fixes" it later.
library;

import 'dart:convert';

import 'package:capture/domain/camera/camera.dart';
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
      // Additive camera record (FR-081/FR-082/FR-084). `lens_facing` duplicates
      // `index` by construction: `index` is an engine-owned field Capture fills
      // with a lens constant by local convention, while FR-084 asks for the
      // platform's identifier independently of that convention. A test asserts
      // the two agree, so the redundancy cannot drift into a contradiction.
      if (metadata.camera != null) ...{
        'position': metadata.camera!.position.wireValue,
        'mirrored_preview': metadata.camera!.mirroredPreview,
        'lens_facing': metadata.camera!.platformLensId,
      },
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
      // Additive fields: engine readers ignore them, Capture readers use them.
      'countdown_enabled': capture.countdownEnabled,
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
      // Absent on pre-R1 samples: infer from the recorded length rather than
      // guessing `false`, so an old sample with a 3-second countdown still
      // reads as having had one (FR-052).
      countdownEnabled: (data['countdown_enabled'] as bool?) ??
          (_asDouble(data['countdown_seconds'] ?? 0) > 0),
      sessionUuid: data['session_uuid'] as String?,
    );
  }

  /// Rebuilds the additive camera record.
  ///
  /// Returns `null` for samples recorded before revision R1, so the new fields
  /// are **absent rather than wrong** (FR-052, SC-026).
  CameraMetadata? _cameraFromMap(
    Map<String, Object?> camera,
    CaptureTiming? capture,
  ) {
    final position = camera['position'] as String?;
    if (position == null) return null;
    return CameraMetadata(
      position: LensPosition.fromWire(position),
      mirroredPreview: (camera['mirrored_preview'] as bool?) ?? false,
      platformLensId: (camera['lens_facing'] as int?) ?? camera['index']! as int,
      countdownEnabled: capture?.countdownEnabled ?? false,
    );
  }

  SampleMetadata _metadataFromMap(Map<String, Object?> data) {
    final camera = _asMap(data['camera'], 'metadata.camera');
    final versions = _asMap(data['versions'], 'metadata.versions');
    final capture = _captureFromMap(data['capture']);
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
      capture: capture,
      camera: _cameraFromMap(camera, capture),
    );
  }

  Map<String, Object?> _handToMap(HandSample hand) => {
    'handedness': hand.handedness.wireValue,
    'confidence': hand.confidence,
    // The wire key stays `raw` while the Dart field is `canonicalRaw`
    // (FR-057). Renaming the key would be a schema change; this is not.
    'raw': _landmarksToList(hand.canonicalRaw),
    'normalized': _landmarksToList(hand.normalized),
  };

  HandSample _handFromMap(Map<String, Object?> data) => HandSample(
    handedness: Handedness.fromLabel(data['handedness'] as String?),
    confidence: _asDouble(data['confidence']),
    canonicalRaw: _landmarksFromList(_asList(data['raw'], 'hands[].raw')),
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
