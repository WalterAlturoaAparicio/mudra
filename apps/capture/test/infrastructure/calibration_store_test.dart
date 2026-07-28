/// [FileCalibrationStore]: persistence for the developer camera-calibration
/// panel's per-lens state, written outside `datasets/` so it is invisible to
/// export and integrity validation.
library;

import 'dart:io';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/infrastructure/storage/file_calibration_store.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Directory root;
  late FileCalibrationStore store;
  const config = CaptureConfig();

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_capture_calibration_');
    store = FileCalibrationStore(rootPath: root.path, config: config);
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  test('load returns null when nothing has ever been saved', () async {
    expect(await store.load(), isNull);
  });

  test('save then load round-trips exactly', () async {
    const set = CameraCalibrationSet.defaults;
    await store.save(set);

    expect(await store.load(), set);
  });

  test('a later save overwrites, never appends', () async {
    await store.save(CameraCalibrationSet.defaults);
    final updated = CameraCalibrationSet.defaults.withLens(
      LensPosition.front,
      CameraCalibrationSet.defaults.front.copyWith(overlayScale: 1.9),
    );
    await store.save(updated);

    expect(await store.load(), updated);
  });

  test('is written outside datasets/, invisible to export/integrity scanning', () async {
    await store.save(CameraCalibrationSet.defaults);

    expect(
      File('${root.path}${Platform.pathSeparator}calibration.json').existsSync(),
      isTrue,
    );
    expect(
      Directory('${root.path}${Platform.pathSeparator}datasets').existsSync(),
      isFalse,
      reason: 'calibration must never live inside the dataset tree',
    );
  });

  test('a corrupt file degrades to null rather than throwing', () async {
    final file = File('${root.path}${Platform.pathSeparator}calibration.json');
    await file.parent.create(recursive: true);
    await file.writeAsString('not json at all {{{');

    expect(await store.load(), isNull);
  });
}
