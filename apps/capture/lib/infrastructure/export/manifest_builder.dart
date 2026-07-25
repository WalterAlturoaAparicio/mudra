/// Builds and serializes the export manifest (FR-047).
///
/// Totals are derived from the files actually present, never from a running
/// counter that could have drifted — the manifest must describe the archive, not
/// what the app believes it recorded.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/export/manifest.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/time/iso_timestamp.dart';
import 'package:crypto/crypto.dart';

/// Assembles a [DatasetManifest] from a dataset directory.
class ManifestBuilder implements DatasetManifestBuilder {
  /// Creates a manifest builder.
  ManifestBuilder({
    required CaptureConfig config,
    required Clock clock,
    required SessionStore sessionStore,
    required this.captureVersion,
    required this.platform,
    required this.device,
    this.normalization = const NormalizationInfo(
      strategy: 'translation_scale',
      version: '1.0',
    ),
  })  : _config = config,
        _clock = clock,
        _sessions = sessionStore;

  /// Producing application, e.g. `mudra-capture/0.1.0`.
  final String captureVersion;

  /// `android` or `ios`.
  final String platform;

  /// Device class information.
  final DeviceInfo device;

  /// Normalization applied across the dataset.
  final NormalizationInfo normalization;

  final CaptureConfig _config;
  final Clock _clock;
  final SessionStore _sessions;

  @override
  Future<DatasetManifest> build(
    String datasetRootPath,
    IntegrityReport report,
  ) async {
    final posesRoot = Directory(
      '$datasetRootPath${Platform.pathSeparator}${_config.posesDirname}',
    );

    final poseCounts = <String, int>{};
    final checksums = <String, String>{};
    var total = 0;

    if (await posesRoot.exists()) {
      final directories = await posesRoot
          .list(followLinks: false)
          .where((e) => e is Directory)
          .cast<Directory>()
          .toList();
      directories.sort((a, b) => a.path.compareTo(b.path));

      for (final dir in directories) {
        final poseId = _lastSegment(dir.path);
        final files = await dir
            .list(followLinks: false)
            .where((e) => e is File && e.path.endsWith('.json'))
            .cast<File>()
            .toList();
        files.sort((a, b) => a.path.compareTo(b.path));

        if (files.isEmpty) continue;
        poseCounts[poseId] = files.length;
        total += files.length;

        if (_config.computeChecksums) {
          checksums[poseId] = await _digest(files);
        }
      }
    }

    final sessions = await _sessions.all();
    final represented = sessions
        .where((s) => poseCounts.containsKey(s.poseId))
        .toList(growable: false);

    return DatasetManifest(
      captureVersion: captureVersion,
      exportTimestamp: formatEngineTimestamp(_clock.nowUtc()),
      platform: platform,
      device: device,
      normalization: normalization,
      totalSamples: total,
      poseCounts: poseCounts,
      sessions: represented,
      integrity: report,
      checksumAlgorithm: _config.computeChecksums ? 'sha256' : null,
      checksums: checksums,
    );
  }

  /// sha256 over a collection's files in ascending sample-number order, so any
  /// importer can recompute it without trusting the producer.
  ///
  /// Hashed incrementally: a large collection must never be held in memory in
  /// one piece just to be digested.
  Future<String> _digest(List<File> files) async {
    final sink = _DigestSink();
    final converter = sha256.startChunkedConversion(sink);
    for (final file in files) {
      converter.add(await file.readAsBytes());
    }
    converter.close();
    return sink.value.toString();
  }

  String _lastSegment(String path) {
    final parts = path.split(RegExp(r'[\\/]'));
    return parts.lastWhere((p) => p.isNotEmpty, orElse: () => path);
  }
}

/// Collects the single digest produced by a chunked sha256 conversion.
class _DigestSink implements Sink<Digest> {
  late Digest value;

  @override
  void add(Digest data) => value = data;

  @override
  void close() {}
}

/// Serializes a [DatasetManifest] to the documented JSON shape.
class ManifestSerializer {
  /// Creates a manifest serializer.
  const ManifestSerializer();

  /// Converts [manifest] to its JSON map.
  Map<String, Object?> toMap(DatasetManifest manifest) => {
    'manifest_version': manifest.manifestFormatVersion,
    'schema_version': manifest.schemaVersion,
    'capture_version': manifest.captureVersion,
    'export_timestamp': manifest.exportTimestamp,
    'platform': manifest.platform,
    'device': {
      'manufacturer': manifest.device.manufacturer,
      'model': manifest.device.model,
      'os_version': manifest.device.osVersion,
    },
    'normalization': {
      'strategy': manifest.normalization.strategy,
      'version': manifest.normalization.version,
    },
    'total_samples': manifest.totalSamples,
    'pose_counts': manifest.poseCounts,
    'sessions': [
      for (final session in manifest.sessions) _sessionToMap(session),
    ],
    if (manifest.checksumAlgorithm != null)
      'checksums': {
        'algorithm': manifest.checksumAlgorithm,
        'collections': manifest.checksums,
      },
    'integrity': {
      'checked_samples': manifest.integrity.checkedSamples,
      'passed': manifest.integrity.passed,
      'critical_failures': [
        for (final f in manifest.integrity.criticalFailures) _findingToMap(f),
      ],
      'warnings': [
        for (final f in manifest.integrity.warnings) _findingToMap(f),
      ],
    },
  };

  /// Converts [manifest] to indented JSON text.
  String toJson(DatasetManifest manifest, {int indent = 2}) =>
      JsonEncoder.withIndent(' ' * indent).convert(toMap(manifest));

  Map<String, Object?> _sessionToMap(CaptureSession session) => {
    'session_uuid': session.sessionUuid,
    'pose_id': session.poseId,
    'started_at': formatEngineTimestamp(session.startedAt),
    'finished_at': session.finishedAt == null
        ? null
        : formatEngineTimestamp(session.finishedAt!),
    'total_samples': session.totalSamples,
    'discarded_samples': session.discardedSamples,
    'end_reason': session.endReason.wireValue,
  };

  Map<String, Object?> _findingToMap(IntegrityFinding finding) => {
    'check': finding.check,
    'message': finding.message,
    if (finding.path != null) 'path': finding.path,
  };
}
