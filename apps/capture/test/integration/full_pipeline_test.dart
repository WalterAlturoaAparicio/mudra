/// The **complete** pipeline, with no physical camera (FR-116, SC-030).
///
/// Every other test proves one stage. This one proves they compose: camera
/// initialization → mode and settings → canonical conversion → capture →
/// validation → normalization → persistence → integrity → manifest → archive.
///
/// SC-030 was previously served only implicitly — unit tests happened to use a
/// fake, and the end-to-end claim was inferred from that. Inference is not
/// verification, which is why this file exists.
library;

import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/application/capture/run_recording_session.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/domain/capture/recording_state.dart';
import 'package:capture/domain/export/manifest.dart' show DeviceInfo;
import 'package:capture/domain/normalization/translation_scale_normalizer.dart';
import 'package:capture/domain/samples/pose_sample.dart' show NormalizationInfo;
import 'package:capture/domain/validation/pose_sample_validator.dart';
import 'package:capture/infrastructure/export/dataset_integrity_checker.dart';
import 'package:capture/infrastructure/export/manifest_builder.dart';
import 'package:capture/infrastructure/export/zip_dataset_exporter.dart';
import 'package:capture/infrastructure/serialization/pose_sample_serializer.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/infrastructure/storage/file_session_store.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

void main() {
  const config = CaptureConfig();
  const serializer = PoseSampleSerializer();

  late Directory root;
  late FakeCameraSource source;
  late CameraSessionController controller;
  late FileSampleRepository repository;
  late FileSessionStore sessionStore;
  late ManualSessionTicker ticker;
  late RecordingLogger logger;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_pipeline_');
    source = FakeCameraSource();
    logger = RecordingLogger();
    controller = CameraSessionController(
      source: source,
      logger: logger,
      releaseTimeout: config.cameraReleaseTimeout,
    );
    repository = FileSampleRepository(rootPath: root.path, config: config);
    sessionStore = FileSessionStore(rootPath: root.path, config: config);
    ticker = ManualSessionTicker();
  });

  tearDown(() async {
    await ticker.close();
    await controller.dispose();
    if (root.existsSync()) await root.delete(recursive: true);
  });

  CaptureSettings settingsFor(CaptureMode mode) =>
      CaptureSettings.fromProfile(mode, config.profileFor(mode));

  /// Records one take through the **whole** stack: the controller's canonical
  /// frame stream, the real validator, normalizer, repository, and session
  /// store.
  Future<RecordingResult> recordTake({
    required CaptureMode mode,
    required String poseId,
    int frameCount = 12,
    bool twoHanded = false,
  }) async {
    final settings = settingsFor(mode);

    // 1. Camera initialization, through the controller that owns the invariant.
    await controller.request(
      CameraRequest(
        lens: settings.lens,
        analysisWidth: config.analysisWidth,
        analysisHeight: config.analysisHeight,
      ),
    );
    expect(controller.state, isA<CameraLive>());
    final info = controller.info!;

    final useCase = RunRecordingSession(
      validator: const PoseSampleValidator(),
      normalizer: const TranslationScaleNormalizer(),
      repository: repository,
      sessionStore: sessionStore,
      clock: FakeClock(),
      uuidFactory: SequentialUuidFactory('$poseId-${mode.wireValue}'),
      config: config,
      logger: logger,
      applicationVersion: 'mudra-capture/0.1.0',
      ticker: ticker,
    );

    final states = <RecordingSessionState>[];
    final sub = useCase
        .run(
          twoHanded
              ? makeTwoHandedPose(poseId: poseId)
              : makePose(poseId: poseId),
          camera: info,
          settings: settings,
          frames: controller.frames,
        )
        .listen(states.add);

    await ticker.advance(const Duration(milliseconds: 50));
    if (settings.countdownEnabled) {
      await ticker.advanceBy(settings.countdown);
      await ticker.advance(const Duration(milliseconds: 50));
    }

    // 2. Frames arrive in the lens's own convention; the controller converts.
    for (var i = 0; i < frameCount; i++) {
      source.emit(
        twoHanded
            ? makeTwoHandFrame(
                timestampMicros: i * 33000,
                convention: info.convention,
              )
            : makeFrame(
                timestampMicros: i * 33000,
                convention: info.convention,
              ),
      );
    }

    await ticker.advance(const Duration(milliseconds: 50));
    await ticker.advanceBy(config.captureWindow);
    await pumpUntil(() => states.any((s) => s.isTerminal));
    await sub.cancel();

    return states.whereType<SummaryState>().single.result;
  }

  test('the whole pipeline runs end to end with no camera hardware', () async {
    // ---- capture: both modes, both lenses, one- and two-handed poses -------
    final selfResult = await recordTake(
      mode: CaptureMode.selfCapture,
      poseId: 'peace',
      frameCount: 12,
    );
    expect(selfResult.accepted, 12);
    expect(selfResult.discarded, 0);

    final operatorResult = await recordTake(
      mode: CaptureMode.operatorCapture,
      poseId: 'dragon',
      frameCount: 9,
      twoHanded: true,
    );
    expect(operatorResult.accepted, 9);

    // ---- storage ----------------------------------------------------------
    expect(await repository.count('peace'), 12);
    expect(await repository.count('dragon'), 9);
    expect(await sessionStore.all(), hasLength(2));

    // ---- every stored sample is canonical, whichever lens took it ---------
    final rearSample = serializer.fromJson(
      File(
        '${root.path}/datasets/poses/dragon/sample_000001.json',
      ).readAsStringSync(),
    );
    expect(
      rearSample.metadata.camera!.position,
      LensPosition.rear,
      reason: 'FR-058: metadata names the lens actually used',
    );
    expect(rearSample.metadata.camera!.mirroredPreview, isFalse);
    expect(
      rearSample.metadata.camera!.countdownEnabled,
      isFalse,
      reason: 'Operator Capture starts with the countdown off',
    );

    // ---- integrity --------------------------------------------------------
    final validator = DatasetIntegrityChecker(config: config);
    final report = await validator.validate(await repository.datasetRootPath());
    expect(
      report.criticalFailures,
      isEmpty,
      reason: 'a dataset this pipeline produced must pass its own gate',
    );
    expect(report.checkedSamples, 21);

    // ---- manifest + archive ----------------------------------------------
    final exporter = ZipDatasetExporter(
      repository: repository,
      validator: validator,
      manifestBuilder: ManifestBuilder(
        config: config,
        clock: FakeClock(),
        sessionStore: sessionStore,
        captureVersion: 'mudra-capture/0.1.0',
        platform: 'android',
        device: const DeviceInfo(
          manufacturer: 'test',
          model: 'host',
          osVersion: 'n/a',
        ),
        normalization: const NormalizationInfo(
          strategy: 'translation_scale',
          version: '1.0',
        ),
      ),
      config: config,
      logger: logger,
      outputDirectoryPath: root.path,
    );

    final export = await exporter.export();

    expect(export.totalSamples, 21);
    expect(export.poseCount, 2);
    expect(File(export.archivePath).existsSync(), isTrue);

    // ---- the archive contains what was recorded ---------------------------
    final archive = ZipDecoder().decodeBytes(
      File(export.archivePath).readAsBytesSync(),
    );
    final names = archive.files.map((f) => f.name).toList();

    expect(names, contains('manifest.json'));
    expect(
      names.where((n) => n.startsWith('datasets/poses/peace/')).length,
      12,
    );
    expect(
      names.where((n) => n.startsWith('datasets/poses/dragon/')).length,
      9,
    );

    final manifestEntry = archive.files.firstWhere(
      (f) => f.name == 'manifest.json',
    );
    final manifest = jsonDecode(
      utf8.decode(manifestEntry.content as List<int>),
    ) as Map<String, Object?>;

    expect(manifest['total_samples'], 21);
    expect(
      (manifest['pose_counts']! as Map<String, Object?>)['peace'],
      12,
    );
    expect(manifest['schema_version'], 1);

    // ---- every archived sample re-parses ----------------------------------
    for (final file in archive.files) {
      if (!file.name.endsWith('.json') || file.name == 'manifest.json') continue;
      final sample = serializer.fromJson(
        utf8.decode(file.content as List<int>),
      );
      expect(sample.schemaVersion, 1);
      for (final hand in sample.hands) {
        expect(hand.canonicalRaw.points, hasLength(21));
        expect(hand.normalized.points, hasLength(21));
      }
    }

    // ---- and the camera is released cleanly at the end --------------------
    await controller.release(CameraReleaseReason.screenLeft);
    expect(source.liveCount, 0);
  });

  test('the pipeline never writes a non-JSON file (Principle II)', () async {
    await recordTake(mode: CaptureMode.selfCapture, poseId: 'peace');

    final datasetRoot = Directory(
      '${root.path}/${config.datasetRoot}/${config.posesDirname}',
    );
    final offenders = datasetRoot
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => !f.path.endsWith('.json'))
        .toList();

    expect(offenders, isEmpty);
  });
}
