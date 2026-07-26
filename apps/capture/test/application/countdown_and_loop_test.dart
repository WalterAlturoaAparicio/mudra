/// The conditional countdown (FR-010) and the camera metadata a take records
/// (FR-081–FR-085).
///
/// The countdown being *skipped* rather than run at zero length matters: a
/// zero-length countdown would still emit a countdown state, still flash an
/// overlay, and still cost a frame — which is exactly the throughput SC-028
/// asks Operator Capture to recover.
library;

import 'dart:io';

import 'package:capture/application/capture/run_recording_session.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/domain/capture/recording_state.dart';
import 'package:capture/domain/normalization/translation_scale_normalizer.dart';
import 'package:capture/domain/validation/pose_sample_validator.dart';
import 'package:capture/infrastructure/serialization/pose_sample_serializer.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

void main() {
  late Directory root;
  late FileSampleRepository repository;
  late FakeCameraSource source;
  late ManualSessionTicker ticker;
  late InMemorySessionStore sessions;
  late RecordingLogger logger;

  const config = CaptureConfig();
  const serializer = PoseSampleSerializer();

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_countdown_');
    repository = FileSampleRepository(rootPath: root.path, config: config);
    source = FakeCameraSource();
    ticker = ManualSessionTicker();
    sessions = InMemorySessionStore();
    logger = RecordingLogger();
  });

  tearDown(() async {
    await ticker.close();
    if (root.existsSync()) await root.delete(recursive: true);
  });

  RunRecordingSession buildUseCase() => RunRecordingSession(
    validator: const PoseSampleValidator(),
    normalizer: const TranslationScaleNormalizer(),
    repository: repository,
    sessionStore: sessions,
    clock: FakeClock(),
    uuidFactory: SequentialUuidFactory(),
    config: config,
    logger: logger,
    applicationVersion: 'mudra-capture/0.1.0',
    ticker: ticker,
  );

  Future<FakeCameraSession> openCamera(LensPosition lens) async =>
      await source.open(
        CameraRequest(lens: lens, analysisWidth: 640, analysisHeight: 480),
      ) as FakeCameraSession;

  CaptureSettings settingsFor(CaptureMode mode) =>
      CaptureSettings.fromProfile(mode, config.profileFor(mode));

  /// Runs one take end to end and returns every state it passed through.
  Future<List<RecordingSessionState>> runTake({
    required CaptureSettings settings,
    required FakeCameraSession camera,
    int frameCount = 24,
  }) async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase
        .run(
          makePose(),
          camera: camera.info,
          settings: settings,
          frames: camera.frames,
        )
        .listen(states.add);

    // Let the generator reach its first tick subscription before emitting.
    // Without a countdown there is no other yield point, and frames pushed into
    // a broadcast stream with no listener yet are simply lost.
    await ticker.advance(const Duration(milliseconds: 50));
    if (settings.countdownEnabled) {
      await ticker.advanceBy(settings.countdown);
      await ticker.advance(const Duration(milliseconds: 50));
    }

    for (var i = 0; i < frameCount; i++) {
      camera.emit(makeFrame(timestampMicros: i * 33000));
    }
    await ticker.advance(const Duration(milliseconds: 50));
    await ticker.advanceBy(config.captureWindow);
    await pumpUntil(() => states.any((s) => s.isTerminal));

    await sub.cancel();
    return states;
  }

  group('the countdown is conditional (FR-010)', () {
    test('with it enabled, countdown states are emitted before capture', () async {
      final camera = await openCamera(LensPosition.front);
      final states = await runTake(
        settings: settingsFor(CaptureMode.selfCapture),
        camera: camera,
      );

      expect(states.whereType<CountdownState>(), isNotEmpty);
      final countdownIndex = states.indexWhere((s) => s is CountdownState);
      final capturingIndex = states.indexWhere((s) => s is CapturingState);
      expect(countdownIndex, lessThan(capturingIndex));
    });

    test('with it disabled, no countdown state is ever emitted', () async {
      final camera = await openCamera(LensPosition.rear);
      final states = await runTake(
        settings: settingsFor(CaptureMode.operatorCapture),
        camera: camera,
      );

      expect(
        states.whereType<CountdownState>(),
        isEmpty,
        reason: 'FR-010: capture must begin immediately, with no countdown '
            'phase — not a zero-length one',
      );
      expect(states.whereType<SummaryState>().single.result.accepted, 24);
    });

    test('a user-disabled countdown in Self Capture is also skipped', () async {
      final camera = await openCamera(LensPosition.front);
      final states = await runTake(
        settings: settingsFor(
          CaptureMode.selfCapture,
        ).copyWith(countdownEnabled: false),
        camera: camera,
      );

      expect(states.whereType<CountdownState>(), isEmpty);
    });
  });

  group('camera metadata records what was used (FR-081–FR-085)', () {
    test('a Self Capture sample reports front, mirrored, countdown on', () async {
      final camera = await openCamera(LensPosition.front);
      await runTake(
        settings: settingsFor(CaptureMode.selfCapture),
        camera: camera,
      );

      final file = File(
        '${root.path}/datasets/poses/peace/sample_000001.json',
      );
      final map = serializer.toMap(serializer.fromJson(file.readAsStringSync()));
      final cameraBlock =
          (map['metadata']! as Map<String, Object?>)['camera']!
              as Map<String, Object?>;
      final captureBlock =
          (map['metadata']! as Map<String, Object?>)['capture']!
              as Map<String, Object?>;

      expect(cameraBlock['position'], 'front');
      expect(cameraBlock['mirrored_preview'], isTrue);
      expect(cameraBlock['lens_facing'], 1);
      expect(captureBlock['countdown_enabled'], isTrue);
      expect(captureBlock['countdown_seconds'], 3.0);
    });

    test('an Operator Capture sample reports rear, unmirrored, countdown off',
        () async {
      final camera = await openCamera(LensPosition.rear);
      await runTake(
        settings: settingsFor(CaptureMode.operatorCapture),
        camera: camera,
      );

      final file = File(
        '${root.path}/datasets/poses/peace/sample_000001.json',
      );
      final map = serializer.toMap(serializer.fromJson(file.readAsStringSync()));
      final metadata = map['metadata']! as Map<String, Object?>;
      final cameraBlock = metadata['camera']! as Map<String, Object?>;
      final captureBlock = metadata['capture']! as Map<String, Object?>;

      expect(cameraBlock['position'], 'rear');
      expect(cameraBlock['mirrored_preview'], isFalse);
      expect(cameraBlock['lens_facing'], 0);
      expect(captureBlock['countdown_enabled'], isFalse);
      expect(
        captureBlock['countdown_seconds'],
        0.0,
        reason: 'a disabled countdown records as zero length',
      );
    });

    test('lens_facing always equals camera.index (research D19)', () async {
      for (final lens in LensPosition.values) {
        final camera = await openCamera(lens);
        final localRoot =
            await Directory.systemTemp.createTemp('mudra_lensfacing_');
        addTearDown(() async {
          if (localRoot.existsSync()) await localRoot.delete(recursive: true);
        });

        final useCase = RunRecordingSession(
          validator: const PoseSampleValidator(),
          normalizer: const TranslationScaleNormalizer(),
          repository:
              FileSampleRepository(rootPath: localRoot.path, config: config),
          sessionStore: InMemorySessionStore(),
          clock: FakeClock(),
          uuidFactory: SequentialUuidFactory(),
          config: config,
          logger: RecordingLogger(),
          applicationVersion: 'mudra-capture/0.1.0',
          ticker: ticker,
        );

        final states = <RecordingSessionState>[];
        final settings = settingsFor(
          lens == LensPosition.front
              ? CaptureMode.selfCapture
              : CaptureMode.operatorCapture,
        );
        final sub = useCase
            .run(
              makePose(),
              camera: camera.info,
              settings: settings,
              frames: camera.frames,
            )
            .listen(states.add);

        await ticker.advance(const Duration(milliseconds: 50));
        if (settings.countdownEnabled) {
          await ticker.advanceBy(settings.countdown);
          await ticker.advance(const Duration(milliseconds: 50));
        }
        camera.emit(makeFrame());
        await ticker.advance(const Duration(milliseconds: 50));
        await ticker.advanceBy(config.captureWindow);
        await pumpUntil(() => states.any((s) => s.isTerminal));
        await sub.cancel();

        final file = File(
          '${localRoot.path}/datasets/poses/peace/sample_000001.json',
        );
        final map =
            serializer.toMap(serializer.fromJson(file.readAsStringSync()));
        final cameraBlock =
            (map['metadata']! as Map<String, Object?>)['camera']!
                as Map<String, Object?>;

        expect(
          cameraBlock['lens_facing'],
          cameraBlock['index'],
          reason: 'the two must never disagree, for either lens',
        );
      }
    });
  });

  group('conversion is auditable, not invisible (FR-058)', () {
    test('a converted rear-lens sample still reports the rear lens', () async {
      final camera = await openCamera(LensPosition.rear);

      // A frame as the rear lens actually delivers it: unmirrored.
      final useCase = buildUseCase();
      final states = <RecordingSessionState>[];
      final settings = settingsFor(CaptureMode.operatorCapture);
      final sub = useCase
          .run(
            makePose(),
            camera: camera.info,
            settings: settings,
            // Frames reaching the use case are already canonical — the
            // controller converts at the seam — but the metadata must still
            // name the lens that was used.
            frames: camera.frames,
          )
          .listen(states.add);

      await ticker.advance(const Duration(milliseconds: 50));
      camera.emit(makeFrame());
      await ticker.advance(const Duration(milliseconds: 50));
      await ticker.advanceBy(config.captureWindow);
      await pumpUntil(() => states.any((s) => s.isTerminal));
      await sub.cancel();

      final file = File(
        '${root.path}/datasets/poses/peace/sample_000001.json',
      );
      final sample = serializer.fromJson(file.readAsStringSync());

      expect(sample.metadata.camera?.position, LensPosition.rear);
      expect(sample.metadata.camera?.mirroredPreview, isFalse);
    });
  });
}
