/// Append-only storage guarantees.
///
/// These cover the promise the whole dataset rests on: a recorded sample is
/// never overwritten, never renumbered, and never accompanied by anything that
/// is not JSON (FR-018/FR-029, SC-008/SC-009).
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/sample_factories.dart';

void main() {
  late Directory root;
  late FileSampleRepository repository;
  const config = CaptureConfig();

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_capture_repo_');
    repository = FileSampleRepository(rootPath: root.path, config: config);
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  Directory poseDir(String poseId) =>
      Directory('${root.path}/datasets/poses/$poseId');

  test('creates the pose collection on first save', () async {
    final ref = await repository.save(makeSample());

    expect(poseDir('peace').existsSync(), isTrue);
    expect(File(ref.location).existsSync(), isTrue);
    expect(ref.sampleNumber, 'sample_000001');
  });

  test('numbers samples sequentially with zero padding', () async {
    final refs = await repository.saveAll([
      makeSample(),
      makeSample(),
      makeSample(),
    ]);

    expect(refs.map((r) => r.sampleNumber), [
      'sample_000001',
      'sample_000002',
      'sample_000003',
    ]);
  });

  test('written samples are the engine schema and re-readable', () async {
    final ref = await repository.save(makeSample(sessionUuid: 'session-1'));
    final decoded =
        jsonDecode(File(ref.location).readAsStringSync()) as Map<String, Object?>;

    expect(decoded['schema_version'], 1);
    expect(decoded['pose_id'], 'peace');
    expect(decoded['sample_number'], 'sample_000001');
    final metadata = decoded['metadata']! as Map<String, Object?>;
    final capture = metadata['capture']! as Map<String, Object?>;
    expect(capture['session_uuid'], 'session-1');
  });

  test('never overwrites an existing sample', () async {
    final first = await repository.save(makeSample());
    final originalBytes = File(first.location).readAsStringSync();

    // A fresh repository re-scans the directory rather than trusting a cache.
    final second = FileSampleRepository(rootPath: root.path, config: config);
    final next = await second.save(makeSample());

    expect(next.sampleNumber, 'sample_000002');
    expect(File(first.location).readAsStringSync(), originalBytes);
  });

  test('continues after the highest existing number, tolerating gaps', () async {
    final dir = poseDir('peace')..createSync(recursive: true);
    File('${dir.path}/sample_000004.json').writeAsStringSync('{}');

    final ref = await repository.save(makeSample());

    expect(ref.sampleNumber, 'sample_000005');
  });

  test('advances past a name collision instead of clobbering it', () async {
    // Seed the exact name the repository is about to choose.
    final dir = poseDir('peace')..createSync(recursive: true);
    File('${dir.path}/sample_000001.json').writeAsStringSync('{"seeded":true}');

    final ref = await repository.save(makeSample());

    expect(ref.sampleNumber, 'sample_000002');
    expect(
      File('${dir.path}/sample_000001.json').readAsStringSync(),
      '{"seeded":true}',
      reason: 'the pre-existing file must be untouched',
    );
  });

  test('keeps separate collections per pose', () async {
    await repository.save(makeSample());
    await repository.save(makeSample(poseId: 'dragon'));
    await repository.save(makeSample(poseId: 'dragon'));

    expect(await repository.count('peace'), 1);
    expect(await repository.count('dragon'), 2);
    expect(await repository.countAll(), {'peace': 1, 'dragon': 2});
  });

  test('counts are zero for an untouched dataset', () async {
    expect(await repository.count('peace'), 0);
    expect(await repository.countAll(), isEmpty);
  });

  test('saveAll returns refs in capture order', () async {
    final refs = await repository.saveAll([
      makeSample(poseId: 'peace'),
      makeSample(poseId: 'peace'),
    ]);
    expect(refs.first.sampleNumber, 'sample_000001');
    expect(refs.last.sampleNumber, 'sample_000002');
  });

  test('saving nothing writes nothing', () async {
    expect(await repository.saveAll([]), isEmpty);
    expect(Directory('${root.path}/datasets').existsSync(), isFalse);
  });

  test('the dataset tree contains only .json files (Principle II)', () async {
    await repository.saveAll([makeSample(), makeSample(poseId: 'dragon')]);

    final offenders = Directory('${root.path}/datasets')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => !f.path.endsWith('.json'))
        .toList();

    expect(
      offenders,
      isEmpty,
      reason: 'no image, video, or binary data may ever reach the dataset',
    );
  });
}
