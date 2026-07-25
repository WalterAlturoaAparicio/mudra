/// Export: integrity validation, manifest, and archive structure.
///
/// The acceptance test for the whole feature is that an archive unzips straight
/// into the engine's dataset (SC-005), so these tests assert the exact layout
/// and refuse to let a corrupt dataset out the door (SC-015).
library;

import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:capture/domain/export/manifest.dart';
import 'package:capture/infrastructure/export/dataset_integrity_checker.dart';
import 'package:capture/infrastructure/export/manifest_builder.dart';
import 'package:capture/infrastructure/export/zip_dataset_exporter.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

void main() {
  late Directory root;
  late Directory outputDir;
  late String datasetRoot;
  late FileSampleRepository repository;
  late InMemorySessionStore sessions;
  late RecordingLogger logger;
  const config = CaptureConfig();

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_capture_export_');
    outputDir = Directory('${root.path}/out')..createSync(recursive: true);
    datasetRoot = '${root.path}${Platform.pathSeparator}datasets';
    repository = FileSampleRepository(rootPath: root.path, config: config);
    sessions = InMemorySessionStore();
    logger = RecordingLogger();
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  DatasetIntegrityChecker checker() => DatasetIntegrityChecker(config: config);

  ManifestBuilder builder() => ManifestBuilder(
    config: config,
    clock: FakeClock(),
    sessionStore: sessions,
    captureVersion: 'mudra-capture/0.1.0',
    platform: 'android',
    device: const DeviceInfo(
      manufacturer: 'Google',
      model: 'Pixel 7',
      osVersion: 'Android 14 (API 34)',
    ),
  );

  ZipDatasetExporter exporter() => ZipDatasetExporter(
    repository: repository,
    validator: checker(),
    manifestBuilder: builder(),
    config: config,
    logger: logger,
    outputDirectoryPath: outputDir.path,
  );

  Future<void> seed({int peace = 3, int dragon = 2}) async {
    // Distinct sample_uuids: duplicates are exactly what integrity validation
    // exists to catch, so seed data must not accidentally trip it.
    await repository.saveAll([
      for (var i = 0; i < peace; i++)
        makeSample(
          poseId: 'peace',
          sessionUuid: 'session-1',
          sampleUuid: 'uuid-peace-$i',
        ),
    ]);
    await repository.saveAll([
      for (var i = 0; i < dragon; i++)
        makeSample(
          poseId: 'dragon',
          sessionUuid: 'session-2',
          sampleUuid: 'uuid-dragon-$i',
        ),
    ]);
    await sessions.record(makeSession(sessionUuid: 'session-1', totalSamples: peace));
    await sessions.record(
      makeSession(sessionUuid: 'session-2', poseId: 'dragon', totalSamples: dragon),
    );
  }

  Archive readArchive(String path) =>
      ZipDecoder().decodeBytes(File(path).readAsBytesSync());

  group('archive structure', () {
    test('preserves datasets/poses/<pose_id>/ for engine import', () async {
      await seed();
      final result = await exporter().export();

      final names = readArchive(result.archivePath).files.map((f) => f.name).toList();
      expect(names, contains('manifest.json'));
      expect(names, contains('datasets/poses/peace/sample_000001.json'));
      expect(names, contains('datasets/poses/dragon/sample_000002.json'));
      expect(
        names.where((n) => n.startsWith('datasets/')),
        hasLength(5),
        reason: 'every seeded sample must be present',
      );
    });

    test('archived samples are byte-identical to what was stored', () async {
      await seed(peace: 1, dragon: 0);
      final result = await exporter().export();

      final onDisk = File(
        '$datasetRoot${Platform.pathSeparator}poses'
        '${Platform.pathSeparator}peace${Platform.pathSeparator}sample_000001.json',
      ).readAsStringSync();

      final archived = readArchive(result.archivePath)
          .files
          .firstWhere((f) => f.name.endsWith('peace/sample_000001.json'));

      expect(utf8.decode(archived.content as List<int>), onDisk);
    });

    test('reports totals to the caller', () async {
      await seed();
      final result = await exporter().export();

      expect(result.totalSamples, 5);
      expect(result.poseCount, 2);
      expect(result.isEmpty, isFalse);
    });
  });

  group('manifest', () {
    test('describes the archive accurately (FR-047, SC-014)', () async {
      await seed();
      final result = await exporter().export();

      final entry = readArchive(result.archivePath)
          .files
          .firstWhere((f) => f.name == 'manifest.json');
      final manifest =
          jsonDecode(utf8.decode(entry.content as List<int>)) as Map<String, Object?>;

      expect(manifest['manifest_version'], 1);
      expect(manifest['schema_version'], 1);
      expect(manifest['capture_version'], 'mudra-capture/0.1.0');
      expect(manifest['platform'], 'android');
      expect(manifest['export_timestamp'], endsWith('+00:00'));
      expect(manifest['total_samples'], 5);
      expect(manifest['pose_counts'], {'dragon': 2, 'peace': 3});
      expect(manifest['device'], {
        'manufacturer': 'Google',
        'model': 'Pixel 7',
        'os_version': 'Android 14 (API 34)',
      });
      expect(manifest['normalization'], {
        'strategy': 'translation_scale',
        'version': '1.0',
      });
    });

    test('pose counts sum to the total', () async {
      await seed();
      final manifest = (await exporter().export()).manifest!;
      final sum = manifest.poseCounts.values.fold(0, (a, b) => a + b);
      expect(sum, manifest.totalSamples);
    });

    test('carries session records resolvable from samples (SC-013)', () async {
      await seed();
      final result = await exporter().export();
      final archive = readArchive(result.archivePath);

      final manifest = jsonDecode(
        utf8.decode(
          archive.files.firstWhere((f) => f.name == 'manifest.json').content
              as List<int>,
        ),
      ) as Map<String, Object?>;
      final sessionUuids = [
        for (final s in manifest['sessions']! as List<Object?>)
          (s! as Map<String, Object?>)['session_uuid'],
      ];

      final sample = jsonDecode(
        utf8.decode(
          archive.files
              .firstWhere((f) => f.name.endsWith('peace/sample_000001.json'))
              .content as List<int>,
        ),
      ) as Map<String, Object?>;
      final capture = (sample['metadata']! as Map<String, Object?>)['capture']!
          as Map<String, Object?>;

      expect(sessionUuids, contains(capture['session_uuid']));
    });

    test('includes recomputable per-collection checksums', () async {
      await seed();
      final manifest = (await exporter().export()).manifest!;

      expect(manifest.checksumAlgorithm, 'sha256');
      expect(manifest.checksums.keys, containsAll(['peace', 'dragon']));
      expect(manifest.checksums['peace'], hasLength(64));
    });

    test('records the integrity report', () async {
      await seed();
      final manifest = (await exporter().export()).manifest!;

      expect(manifest.integrity.passed, isTrue);
      expect(manifest.integrity.checkedSamples, 5);
      expect(manifest.integrity.criticalFailures, isEmpty);
    });
  });

  group('integrity validation aborts the export (FR-048, SC-015)', () {
    Future<void> expectAborted(String expectedCheck) async {
      await expectLater(
        exporter().export(),
        throwsA(
          isA<IntegrityFailure>().having((f) => f.check, 'check', expectedCheck),
        ),
      );
      expect(
        outputDir.listSync().whereType<File>(),
        isEmpty,
        reason: 'a suspect dataset must never produce an archive',
      );
    }

    test('unparseable JSON', () async {
      await seed(peace: 1, dragon: 0);
      File('$datasetRoot/poses/peace/sample_000002.json')
          .writeAsStringSync('{ truncated');
      await expectAborted(IntegrityChecks.parseableJson);
    });

    test('duplicate sample_uuid', () async {
      await seed(peace: 1, dragon: 0);
      // The same sample copied under a second number: two files claiming one
      // identity is silent dataset corruption the engine could not detect.
      final original =
          File('$datasetRoot/poses/peace/sample_000001.json').readAsStringSync();
      File('$datasetRoot/poses/peace/sample_000002.json').writeAsStringSync(original);
      await expectAborted(IntegrityChecks.duplicateDetection);
    });

    test('a sample filed under the wrong pose', () async {
      await seed(peace: 1, dragon: 0);
      final document =
          jsonDecode(File('$datasetRoot/poses/peace/sample_000001.json').readAsStringSync())
              as Map<String, Object?>;
      document['pose_id'] = 'dragon';
      File(
        '$datasetRoot/poses/peace/sample_000002.json',
      ).writeAsStringSync(jsonEncode(document));
      await expectAborted(IntegrityChecks.validPoseIds);
    });

    test('a malformed filename', () async {
      await seed(peace: 1, dragon: 0);
      File('$datasetRoot/poses/peace/notes.json').writeAsStringSync('{}');
      await expectAborted(IntegrityChecks.folderStructure);
    });

    test('a truncated landmark array', () async {
      await seed(peace: 1, dragon: 0);
      final path = '$datasetRoot/poses/peace/sample_000001.json';
      final document = jsonDecode(File(path).readAsStringSync()) as Map<String, Object?>;
      final hands = document['hands']! as List<Object?>;
      final hand = hands.first! as Map<String, Object?>;
      hand['raw'] = (hand['raw']! as List<Object?>).sublist(0, 20);
      File(path).writeAsStringSync(jsonEncode(document));
      await expectAborted(IntegrityChecks.schemaCompliance);
    });

    test('a folder name that is not a valid pose id', () async {
      await seed(peace: 1, dragon: 0);
      Directory('$datasetRoot/poses/Not Valid').createSync();
      await expectAborted(IntegrityChecks.validPoseIds);
    });
  });

  group('warnings do not block', () {
    test('a pose missing from the catalog is reported, not fatal', () async {
      await seed(peace: 1, dragon: 0);
      final validator = DatasetIntegrityChecker(
        config: config,
        catalog: makeCatalogWithout('peace'),
      );
      final report = await validator.validate(datasetRoot);

      expect(report.passed, isTrue);
      expect(report.warnings, hasLength(1));
      expect(report.warnings.single.check, IntegrityChecks.catalogCoverage);
    });
  });

  group('empty dataset', () {
    test('produces a message, not an invalid archive (FR-036)', () async {
      final result = await exporter().export();

      expect(result.isEmpty, isTrue);
      expect(result.archivePath, isEmpty);
      expect(outputDir.listSync().whereType<File>(), isEmpty);
    });
  });
}
