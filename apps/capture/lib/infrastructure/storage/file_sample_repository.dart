/// Filesystem implementation of [SampleRepository].
///
/// Writes one human-readable JSON file per sample under
/// `<root>/datasets/poses/<pose_id>/sample_NNNNNN.json` — the engine's layout,
/// so an export unzips straight into its dataset. Numbering is
/// `max(existing) + 1` and an existing file is never overwritten
/// (FR-018/FR-026/FR-029).
///
/// Only `.json` files are ever written here: no image, frame, or pixel data
/// (Principle II).
library;

import 'dart:io';

import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/infrastructure/serialization/pose_sample_serializer.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';

/// Append-only pose storage backed by indented JSON files on disk.
class FileSampleRepository implements SampleRepository {
  /// Creates a repository rooted at [rootPath] (the app's documents directory).
  FileSampleRepository({
    required this.rootPath,
    required CaptureConfig config,
    PoseSampleSerializer serializer = const PoseSampleSerializer(),
  })  : _config = config,
        _serializer = serializer;

  /// Directory containing the `datasets/` tree.
  final String rootPath;

  final CaptureConfig _config;
  final PoseSampleSerializer _serializer;

  /// Cached next number per pose, seeded by a directory scan. Avoids re-reading
  /// a directory of thousands of files for every sample in a session.
  final Map<String, int> _nextNumber = {};

  late final RegExp _numberPattern = RegExp(
    '^${RegExp.escape(_config.filenamePrefix)}(\\d+)\\.json\$',
  );

  Directory get _posesRoot => Directory(
    '$rootPath${Platform.pathSeparator}${_config.datasetRoot}'
    '${Platform.pathSeparator}${_config.posesDirname}',
  );

  Directory _poseDir(String poseId) =>
      Directory('${_posesRoot.path}${Platform.pathSeparator}$poseId');

  @override
  Future<String> datasetRootPath() async =>
      '$rootPath${Platform.pathSeparator}${_config.datasetRoot}';

  @override
  Future<SampleRef> save(PoseSample sample) async {
    final refs = await saveAll([sample]);
    return refs.single;
  }

  @override
  Future<List<SampleRef>> saveAll(List<PoseSample> samples) async {
    if (samples.isEmpty) return const [];

    final refs = <SampleRef>[];
    for (final sample in samples) {
      refs.add(await _writeOne(sample));
    }
    return refs;
  }

  Future<SampleRef> _writeOne(PoseSample sample) async {
    final poseId = sample.pose.poseId;
    final dir = _poseDir(poseId);
    try {
      await dir.create(recursive: true);
    } on FileSystemException catch (error) {
      throw RepositoryFailure(
        'Could not create the folder for "$poseId". Check available storage.',
        debugDetail: error,
      );
    }

    var number = await _reserveNumber(poseId);
    while (true) {
      final stem = _config.sampleStem(number);
      final file = File('${dir.path}${Platform.pathSeparator}$stem.json');

      // Never overwrite: if the name is taken, advance and retry.
      if (await file.exists()) {
        number += 1;
        _nextNumber[poseId] = number;
        continue;
      }

      final stored = sample.withSampleNumber(stem);
      try {
        await file.writeAsString(
          _serializer.toJson(stored, indent: _config.jsonIndent),
          flush: true,
        );
      } on FileSystemException catch (error) {
        throw RepositoryFailure(
          'Could not save a sample for "$poseId". Check available storage.',
          debugDetail: error,
        );
      }

      _nextNumber[poseId] = number + 1;
      return SampleRef(
        poseId: poseId,
        sampleUuid: stored.sampleUuid,
        sampleNumber: stem,
        location: file.absolute.path,
      );
    }
  }

  Future<int> _reserveNumber(String poseId) async {
    final cached = _nextNumber[poseId];
    if (cached != null) return cached;
    final numbers = await _existingNumbers(poseId);
    final next = numbers.isEmpty ? 1 : numbers.last + 1;
    _nextNumber[poseId] = next;
    return next;
  }

  Future<List<int>> _existingNumbers(String poseId) async {
    final dir = _poseDir(poseId);
    if (!await dir.exists()) return const [];

    final numbers = <int>[];
    await for (final entity in dir.list(followLinks: false)) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      final match = _numberPattern.firstMatch(name);
      if (match != null) {
        numbers.add(int.parse(match.group(1)!));
      }
    }
    numbers.sort();
    return numbers;
  }

  @override
  Future<int> count(String poseId) async =>
      (await _existingNumbers(poseId)).length;

  @override
  Future<List<PoseSample>> readAll(String poseId) async {
    final dir = _poseDir(poseId);
    if (!await dir.exists()) return const [];

    final files = <File>[];
    await for (final entity in dir.list(followLinks: false)) {
      if (entity is File && entity.path.endsWith('.json')) files.add(entity);
    }
    // Filename order is numeric order (fixed-width, zero-padded stems), so a
    // plain string sort already yields sample order without re-parsing.
    files.sort((a, b) => a.path.compareTo(b.path));

    final samples = <PoseSample>[];
    for (final file in files) {
      final String text;
      try {
        text = await file.readAsString();
      } on FileSystemException catch (error) {
        throw RepositoryFailure(
          'Could not read a stored sample for "$poseId".',
          debugDetail: error,
        );
      }
      samples.add(_serializer.fromJson(text));
    }
    return samples;
  }

  @override
  Future<Map<String, int>> countAll() async {
    final root = _posesRoot;
    if (!await root.exists()) return {};

    final counts = <String, int>{};
    await for (final entity in root.list(followLinks: false)) {
      if (entity is! Directory) continue;
      final poseId = entity.uri.pathSegments
          .where((s) => s.isNotEmpty)
          .last;
      counts[poseId] = await count(poseId);
    }
    return counts;
  }
}
