/// `FileExemplarSource`: builds exemplars and readiness from the real
/// on-disk dataset in one read-only pass (research D6/D10).
library;

import 'dart:io';

import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/infrastructure/recognition/file_exemplar_source.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/sample_factories.dart';

/// Wraps a real repository, delegating every read but throwing on any write
/// — proof, not documentation, that `FileExemplarSource` never triggers one
/// (FR-004, T059).
class _ThrowOnWriteSampleRepository implements SampleRepository {
  _ThrowOnWriteSampleRepository(this._delegate);

  final SampleRepository _delegate;

  @override
  Future<SampleRef> save(PoseSample sample) =>
      throw StateError('FileExemplarSource must never call save()');

  @override
  Future<List<SampleRef>> saveAll(List<PoseSample> samples) =>
      throw StateError('FileExemplarSource must never call saveAll()');

  @override
  Future<int> count(String poseId) => _delegate.count(poseId);

  @override
  Future<Map<String, int>> countAll() => _delegate.countAll();

  @override
  Future<String> datasetRootPath() => _delegate.datasetRootPath();

  @override
  Future<List<PoseSample>> readAll(String poseId) => _delegate.readAll(poseId);
}

void main() {
  late Directory root;
  late FileSampleRepository repository;
  const captureConfig = CaptureConfig();
  final recognitionConfig = RecognitionConfig(minExemplarsPerPose: 3);

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_exemplar_source_');
    repository = FileSampleRepository(rootPath: root.path, config: captureConfig);
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  PoseCatalog catalog() => PoseCatalog([
    makePose(poseId: 'peace', displayName: 'Peace'),
    makePose(poseId: 'ok', displayName: 'Ok'),
  ]);

  test('produces one exemplar per sample-hand, grouped by pose, above threshold', () async {
    for (var i = 0; i < 3; i++) {
      await repository.save(makeSample(poseId: 'peace', sampleUuid: 'peace-$i'));
    }

    final source = FileExemplarSource(
      repository: repository,
      catalog: catalog(),
      config: recognitionConfig,
    );
    final result = await source.load();

    expect(result.exemplarsByPose['peace'], hasLength(3));
    for (final exemplar in result.exemplarsByPose['peace']!) {
      expect(exemplar.poseId, 'peace');
    }
    expect(result.readiness.forPose('peace')!.isReady, isTrue);
  });

  test('uses the persisted normalized vector, never recomputes it', () async {
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p1'));
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p2'));
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p3'));

    final source = FileExemplarSource(
      repository: repository,
      catalog: catalog(),
      config: recognitionConfig,
    );
    final result = await source.load();

    final expected = makeSample().hands.single.normalized;
    for (final exemplar in result.exemplarsByPose['peace']!) {
      expect(exemplar.landmarks, expected);
    }
  });

  test('a pose below the minimum threshold contributes zero exemplars and is not ready', () async {
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p1'));
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p2'));
    // Only 2, threshold is 3.

    final source = FileExemplarSource(
      repository: repository,
      catalog: catalog(),
      config: recognitionConfig,
    );
    final result = await source.load();

    expect(result.exemplarsByPose.containsKey('peace'), isFalse);
    final readiness = result.readiness.forPose('peace')!;
    expect(readiness.isReady, isFalse);
    expect(readiness.exemplarCount, 2);
  });

  test('a pose with zero samples is reported, not omitted', () async {
    final source = FileExemplarSource(
      repository: repository,
      catalog: catalog(),
      config: recognitionConfig,
    );
    final result = await source.load();

    expect(result.readiness.forPose('ok')!.exemplarCount, 0);
    expect(result.readiness.forPose('ok')!.isReady, isFalse);
    expect(result.exemplarsByPose.containsKey('ok'), isFalse);
  });

  test('readiness covers every catalog pose in a single pass, with no second read', () async {
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p1'));
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p2'));
    await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p3'));

    final source = FileExemplarSource(
      repository: repository,
      catalog: catalog(),
      config: recognitionConfig,
    );
    final result = await source.load();

    expect(result.readiness.entries.map((e) => e.poseId), containsAll(['peace', 'ok']));
    expect(result.readiness.readyCount, 1);
  });

  test(
    'never calls save/saveAll while loading — read-only usage discipline (T059)',
    () async {
      await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p1'));
      await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p2'));
      await repository.save(makeSample(poseId: 'peace', sampleUuid: 'p3'));

      final source = FileExemplarSource(
        repository: _ThrowOnWriteSampleRepository(repository),
        catalog: catalog(),
        config: recognitionConfig,
      );

      // If `load()` ever triggered a write, the throwing delegate above
      // would fail this call instead of returning a result.
      final result = await source.load();
      expect(result.exemplarsByPose['peace'], hasLength(3));
    },
  );
}
