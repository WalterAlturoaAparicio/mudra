/// Export manifest and integrity domain.
///
/// The manifest is the official entry point for importers (FR-047); the
/// integrity report is the gate that decides whether an archive is produced at
/// all (FR-048). Neither touches the pose-sample schema.
library;

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/samples/pose_sample.dart';

/// Version of the manifest format itself, independent of the sample schema.
const int manifestVersion = 1;

/// Device class information — never a user or hardware identifier.
class DeviceInfo {
  /// Creates device information.
  const DeviceInfo({
    required this.manufacturer,
    required this.model,
    required this.osVersion,
  });

  /// Device manufacturer, e.g. `Google`.
  final String manufacturer;

  /// Device model, e.g. `Pixel 7`.
  final String model;

  /// OS version string, e.g. `Android 14 (API 34)`.
  final String osVersion;

  @override
  bool operator ==(Object other) =>
      other is DeviceInfo &&
      other.manufacturer == manufacturer &&
      other.model == model &&
      other.osVersion == osVersion;

  @override
  int get hashCode => Object.hash(manufacturer, model, osVersion);
}

/// Severity of an integrity finding.
enum IntegritySeverity {
  /// Blocks the export entirely.
  critical,

  /// Recorded in the manifest but does not block.
  warning,
}

/// One thing the integrity validator noticed.
class IntegrityFinding {
  /// Creates an integrity finding.
  const IntegrityFinding({
    required this.check,
    required this.message,
    required this.severity,
    this.path,
  });

  /// Which check produced this, e.g. `duplicate_detection`.
  final String check;

  /// Human-readable explanation.
  final String message;

  /// Whether this blocks the export.
  final IntegritySeverity severity;

  /// The offending file or directory, when there is one.
  final String? path;

  @override
  String toString() => '[$check] $message${path == null ? '' : ' ($path)'}';
}

/// The result of validating a dataset before export.
class IntegrityReport {
  /// Creates an integrity report.
  IntegrityReport({
    required this.checkedSamples,
    List<IntegrityFinding> findings = const [],
  }) : findings = List.unmodifiable(findings);

  /// How many sample files were inspected.
  final int checkedSamples;

  /// Everything the validator noticed.
  final List<IntegrityFinding> findings;

  /// Findings that block the export.
  List<IntegrityFinding> get criticalFailures => findings
      .where((f) => f.severity == IntegritySeverity.critical)
      .toList(growable: false);

  /// Findings recorded in the manifest that do not block.
  List<IntegrityFinding> get warnings => findings
      .where((f) => f.severity == IntegritySeverity.warning)
      .toList(growable: false);

  /// Whether the dataset may be exported.
  bool get passed => criticalFailures.isEmpty;
}

/// The descriptive record placed at the root of every export.
class DatasetManifest {
  /// Creates a manifest.
  DatasetManifest({
    required this.captureVersion,
    required this.exportTimestamp,
    required this.platform,
    required this.device,
    required this.normalization,
    required this.totalSamples,
    required Map<String, int> poseCounts,
    required List<CaptureSession> sessions,
    required this.integrity,
    this.schemaVersion = sampleSchemaVersion,
    this.manifestFormatVersion = manifestVersion,
    this.checksumAlgorithm,
    Map<String, String> checksums = const {},
  })  : poseCounts = Map.unmodifiable(poseCounts),
        sessions = List.unmodifiable(sessions),
        checksums = Map.unmodifiable(checksums);

  /// Version of the manifest format.
  final int manifestFormatVersion;

  /// Sample schema version the archive's samples conform to.
  final int schemaVersion;

  /// Producing application, e.g. `mudra-capture/0.1.0`.
  final String captureVersion;

  /// UTC ISO-8601 instant the export was produced.
  final String exportTimestamp;

  /// `android` or `ios`.
  final String platform;

  /// Device class information.
  final DeviceInfo device;

  /// Normalization applied across the dataset.
  final NormalizationInfo normalization;

  /// Total samples in the archive; must match the real file count.
  final int totalSamples;

  /// `pose_id` to sample count; must sum to [totalSamples].
  final Map<String, int> poseCounts;

  /// Session records linking `session_uuid` to the samples it produced.
  final List<CaptureSession> sessions;

  /// Digest algorithm used for [checksums], when computed.
  final String? checksumAlgorithm;

  /// Per-pose-collection digests.
  final Map<String, String> checksums;

  /// What was validated before packaging.
  final IntegrityReport integrity;
}
