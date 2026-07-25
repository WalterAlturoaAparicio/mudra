/// Dataset integrity validation (FR-048).
///
/// Runs before packaging and is strictly read-only: it never repairs, deletes,
/// or rewrites anything, because a validator that mutates data cannot be trusted
/// to report on it. A critical finding aborts the export — a suspect dataset is
/// never handed to the engine.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/export/manifest.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/config/capture_config.dart';

/// Check identifiers, so findings are machine-readable as well as legible.
class IntegrityChecks {
  /// A sample file did not parse as JSON.
  static const String parseableJson = 'parseable_json';

  /// A sample violated the schema.
  static const String schemaCompliance = 'schema_compliance';

  /// A file sat outside the expected layout.
  static const String folderStructure = 'folder_structure';

  /// A `sample_uuid` or sample number appeared twice.
  static const String duplicateDetection = 'duplicate_detection';

  /// A `pose_id` was not a valid identifier, or disagreed with its folder.
  static const String validPoseIds = 'valid_pose_ids';

  /// A `pose_id` is absent from the current catalog (warning only).
  static const String catalogCoverage = 'catalog_coverage';
}

/// Validates a dataset directory against the export contract.
class DatasetIntegrityChecker implements DatasetIntegrityValidator {
  /// Creates a checker.
  DatasetIntegrityChecker({
    required CaptureConfig config,
    PoseCatalog? catalog,
  })  : _config = config,
        _catalog = catalog;

  final CaptureConfig _config;
  final PoseCatalog? _catalog;

  @override
  Future<IntegrityReport> validate(String datasetRootPath) async {
    final findings = <IntegrityFinding>[];
    final posesRoot = Directory(
      '$datasetRootPath${Platform.pathSeparator}${_config.posesDirname}',
    );

    if (!await posesRoot.exists()) {
      return IntegrityReport(checkedSamples: 0, findings: findings);
    }

    final seenUuids = <String, String>{};
    final filePattern = RegExp(
      '^${RegExp.escape(_config.filenamePrefix)}\\d+\\.json\$',
    );
    var checked = 0;

    await for (final entity in posesRoot.list(followLinks: false)) {
      if (entity is! Directory) {
        findings.add(
          IntegrityFinding(
            check: IntegrityChecks.folderStructure,
            message: 'Unexpected file beside the pose collections.',
            severity: IntegritySeverity.critical,
            path: entity.path,
          ),
        );
        continue;
      }

      final poseId = _lastSegment(entity.path);
      if (!poseIdPattern.hasMatch(poseId)) {
        findings.add(
          IntegrityFinding(
            check: IntegrityChecks.validPoseIds,
            message: 'Folder name "$poseId" is not a valid pose id.',
            severity: IntegritySeverity.critical,
            path: entity.path,
          ),
        );
        continue;
      }

      if (_catalog != null && _catalog.byId(poseId) == null) {
        findings.add(
          IntegrityFinding(
            check: IntegrityChecks.catalogCoverage,
            message: 'pose_id "$poseId" is not in the current catalog.',
            severity: IntegritySeverity.warning,
            path: entity.path,
          ),
        );
      }

      final seenNumbers = <String>{};
      await for (final file in entity.list(followLinks: false)) {
        if (file is! File) continue;
        final name = _lastSegment(file.path);

        if (!filePattern.hasMatch(name)) {
          findings.add(
            IntegrityFinding(
              check: IntegrityChecks.folderStructure,
              message: 'File "$name" does not match ${_config.filenamePrefix}NNNNNN.json.',
              severity: IntegritySeverity.critical,
              path: file.path,
            ),
          );
          continue;
        }

        checked += 1;
        final Map<String, Object?> document;
        try {
          final decoded = jsonDecode(await file.readAsString());
          if (decoded is! Map) throw const FormatException('not an object');
          document = decoded.cast<String, Object?>();
        } on Object {
          findings.add(
            IntegrityFinding(
              check: IntegrityChecks.parseableJson,
              message: 'Sample "$name" is not valid JSON.',
              severity: IntegritySeverity.critical,
              path: file.path,
            ),
          );
          continue;
        }

        findings.addAll(_checkSchema(document, file.path, name, poseId));

        final uuid = document['sample_uuid'];
        if (uuid is String) {
          final previous = seenUuids[uuid];
          if (previous != null) {
            findings.add(
              IntegrityFinding(
                check: IntegrityChecks.duplicateDetection,
                message: 'sample_uuid "$uuid" also appears in $previous.',
                severity: IntegritySeverity.critical,
                path: file.path,
              ),
            );
          } else {
            seenUuids[uuid] = file.path;
          }
        }

        if (!seenNumbers.add(name)) {
          findings.add(
            IntegrityFinding(
              check: IntegrityChecks.duplicateDetection,
              message: 'Sample number "$name" appears twice in "$poseId".',
              severity: IntegritySeverity.critical,
              path: file.path,
            ),
          );
        }
      }
    }

    return IntegrityReport(checkedSamples: checked, findings: findings);
  }

  List<IntegrityFinding> _checkSchema(
    Map<String, Object?> document,
    String path,
    String name,
    String folderPoseId,
  ) {
    final findings = <IntegrityFinding>[];

    void critical(String check, String message) => findings.add(
      IntegrityFinding(
        check: check,
        message: message,
        severity: IntegritySeverity.critical,
        path: path,
      ),
    );

    if (document['schema_version'] != sampleSchemaVersion) {
      critical(
        IntegrityChecks.schemaCompliance,
        'Sample "$name" has schema_version ${document['schema_version']}, '
        'expected $sampleSchemaVersion.',
      );
    }

    final poseId = document['pose_id'];
    if (poseId is! String || !poseIdPattern.hasMatch(poseId)) {
      critical(
        IntegrityChecks.validPoseIds,
        'Sample "$name" has an invalid pose_id.',
      );
    } else if (poseId != folderPoseId) {
      critical(
        IntegrityChecks.validPoseIds,
        'Sample "$name" declares pose_id "$poseId" but sits in "$folderPoseId".',
      );
    }

    for (final field in ['sample_uuid', 'timestamp', 'normalization', 'metadata']) {
      if (document[field] == null) {
        critical(
          IntegrityChecks.schemaCompliance,
          'Sample "$name" is missing "$field".',
        );
      }
    }

    final hands = document['hands'];
    if (hands is! List || hands.isEmpty) {
      critical(
        IntegrityChecks.schemaCompliance,
        'Sample "$name" has no hands.',
      );
      return findings;
    }

    for (final hand in hands) {
      if (hand is! Map) {
        critical(
          IntegrityChecks.schemaCompliance,
          'Sample "$name" has a malformed hand entry.',
        );
        continue;
      }
      for (final key in ['raw', 'normalized']) {
        final points = hand[key];
        if (points is! List || points.length != handLandmarkCount) {
          critical(
            IntegrityChecks.schemaCompliance,
            'Sample "$name" has ${points is List ? points.length : 0} '
            '"$key" landmarks, expected $handLandmarkCount.',
          );
        }
      }
    }

    final metadata = document['metadata'];
    if (metadata is Map) {
      final numHands = metadata['num_hands'];
      if (numHands is int && numHands != hands.length) {
        critical(
          IntegrityChecks.schemaCompliance,
          'Sample "$name" reports num_hands $numHands but carries '
          '${hands.length} hands.',
        );
      }
    }

    return findings;
  }

  String _lastSegment(String path) {
    final parts = path.split(RegExp(r'[\\/]'));
    return parts.lastWhere((p) => p.isNotEmpty, orElse: () => path);
  }
}
