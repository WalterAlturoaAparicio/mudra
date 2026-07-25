/// Packages the dataset for the engine — the Sync action (FR-032/FR-033).
///
/// "Sync" is the user-facing label; the domain concept is a **dataset export**,
/// and there is no server, account, or network involved anywhere in it.
///
/// The archive is written incrementally to disk rather than assembled in memory:
/// a full dataset is on the order of a hundred megabytes, and an in-memory
/// encoder would risk an out-of-memory kill on a mid-range phone (research D7).
library;

import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/infrastructure/export/manifest_builder.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';

/// Streaming ZIP exporter producing an engine-importable archive.
class ZipDatasetExporter implements DatasetExporter {
  /// Creates an exporter.
  ZipDatasetExporter({
    required SampleRepository repository,
    required DatasetIntegrityValidator validator,
    required DatasetManifestBuilder manifestBuilder,
    required CaptureConfig config,
    required AppLogger logger,
    required String outputDirectoryPath,
    ManifestSerializer manifestSerializer = const ManifestSerializer(),
  })  : _repository = repository,
        _validator = validator,
        _manifestBuilder = manifestBuilder,
        _config = config,
        _logger = logger,
        _outputDirectoryPath = outputDirectoryPath,
        _manifestSerializer = manifestSerializer;

  final SampleRepository _repository;
  final DatasetIntegrityValidator _validator;
  final DatasetManifestBuilder _manifestBuilder;
  final CaptureConfig _config;
  final AppLogger _logger;
  final String _outputDirectoryPath;
  final ManifestSerializer _manifestSerializer;

  @override
  Future<ExportResult> export() async {
    final datasetRoot = await _repository.datasetRootPath();
    final posesRoot = Directory(
      '$datasetRoot${Platform.pathSeparator}${_config.posesDirname}',
    );

    // FR-036: nothing collected yet is a message, not a broken archive.
    if (!await posesRoot.exists()) {
      return const ExportResult(archivePath: '', totalSamples: 0, poseCount: 0);
    }

    // FR-048: validate before packaging; a critical finding aborts the export.
    final report = await _validator.validate(datasetRoot);
    if (!report.passed) {
      final first = report.criticalFailures.first;
      _logger.error('Export aborted by integrity validation.', {
        'check': first.check,
        'path': first.path,
        'critical_failures': report.criticalFailures.length,
      });
      throw IntegrityFailure(
        'The dataset could not be exported: ${first.message} '
        'Nothing was packaged.',
        check: first.check,
        debugDetail: first.path,
      );
    }

    final manifest = await _manifestBuilder.build(datasetRoot, report);
    if (manifest.totalSamples == 0) {
      return ExportResult(
        archivePath: '',
        totalSamples: 0,
        poseCount: 0,
        manifest: manifest,
      );
    }

    final archivePath =
        '$_outputDirectoryPath${Platform.pathSeparator}${_config.exportFileName}';

    try {
      await Directory(_outputDirectoryPath).create(recursive: true);
      final existing = File(archivePath);
      if (await existing.exists()) {
        await existing.delete();
      }

      final encoder = ZipFileEncoder()..create(archivePath);
      try {
        // manifest.json at the archive root — the importer's entry point.
        encoder.addArchiveFile(
          ArchiveFile.string(
            _config.manifestFileName,
            _manifestSerializer.toJson(manifest, indent: _config.jsonIndent),
          ),
        );

        // datasets/poses/<pose_id>/sample_NNNNNN.json, structure preserved so
        // the archive unzips straight into the engine's dataset root.
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

          for (final file in files) {
            await encoder.addFile(
              file,
              '${_config.datasetRoot}/${_config.posesDirname}/$poseId/'
              '${_lastSegment(file.path)}',
            );
          }
        }
      } finally {
        await encoder.close();
      }
    } on IntegrityFailure {
      rethrow;
    } on Object catch (error) {
      throw ExportFailure(
        'The dataset could not be packaged. Check available storage.',
        debugDetail: error,
      );
    }

    _logger.info('Dataset exported.', {
      'archive': archivePath,
      'total_samples': manifest.totalSamples,
      'pose_count': manifest.poseCounts.length,
      'warnings': report.warnings.length,
    });

    return ExportResult(
      archivePath: archivePath,
      totalSamples: manifest.totalSamples,
      poseCount: manifest.poseCounts.length,
      manifest: manifest,
    );
  }

  String _lastSegment(String path) {
    final parts = path.split(RegExp(r'[\\/]'));
    return parts.lastWhere((p) => p.isNotEmpty, orElse: () => path);
  }
}
