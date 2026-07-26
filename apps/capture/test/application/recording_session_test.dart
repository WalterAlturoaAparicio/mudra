/// Capture session orchestration.
///
/// This is the behaviour the product is judged on: one press yields many
/// samples, the preview is never blocked, invalid frames are discarded and
/// counted, and nothing is written when a session is aborted.
library;

import 'dart:io';

import 'package:capture/application/capture/run_recording_session.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/capture/recording_state.dart';
import 'package:capture/domain/normalization/translation_scale_normalizer.dart';
import 'package:capture/domain/validation/pose_sample_validator.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

/// Whether the session has reached one of its terminal states.
bool _isTerminal(RecordingSessionState state) =>
    state is SummaryState || state is CancelledState || state is FailedState;

void main() {
  late Directory root;
  late FileSampleRepository repository;
  late FakeCameraSource source;
  late FakeCameraSession camera;
  late ManualSessionTicker ticker;
  late FakeClock clock;
  late InMemorySessionStore sessions;
  late RecordingLogger logger;

  const config = CaptureConfig();
  // Self Capture defaults: front lens, mirrored, 3-second countdown on.
  final settings = CaptureSettings.fromProfile(
    CaptureMode.selfCapture,
    config.selfCaptureProfile,
  );

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_capture_session_');
    repository = FileSampleRepository(rootPath: root.path, config: config);
    source = FakeCameraSource();
    camera = await source.open(
      const CameraRequest(
        lens: LensPosition.front,
        analysisWidth: 640,
        analysisHeight: 480,
      ),
    ) as FakeCameraSession;
    ticker = ManualSessionTicker();
    clock = FakeClock();
    sessions = InMemorySessionStore();
    logger = RecordingLogger();
  });

  tearDown(() async {
    await ticker.close();
    await camera.close();
    if (root.existsSync()) await root.delete(recursive: true);
  });

  RunRecordingSession buildUseCase({CaptureConfig? overrideConfig}) =>
      RunRecordingSession(
        validator: const PoseSampleValidator(),
        normalizer: const TranslationScaleNormalizer(),
        repository: repository,
        sessionStore: sessions,
        clock: clock,
        uuidFactory: SequentialUuidFactory(),
        config: overrideConfig ?? config,
        logger: logger,
        applicationVersion: 'mudra-capture/0.1.0',
        ticker: ticker,
      );

  /// Runs a whole session, feeding [frameCount] frames during the window.
  Future<List<RecordingSessionState>> runSession({
    required RunRecordingSession useCase,
    int frameCount = 25,
    bool valid = true,
    int handsPerFrame = 1,
    void Function()? duringCountdown,
    CaptureConfig? cfg,
  }) async {
    final effective = cfg ?? config;
    final states = <RecordingSessionState>[];

    final subscription = useCase
        .run(makePose(), camera: camera.info, settings: settings, frames: camera.frames)
        .listen(states.add);

    // Countdown: the preview keeps rendering, nothing is captured.
    await ticker.advance(const Duration(milliseconds: 50));
    duringCountdown?.call();
    await ticker.advanceBy(effective.countdown);

    // Capture window: feed frames, then let the window elapse.
    for (var i = 0; i < frameCount; i++) {
      source.emit(
        valid
            ? (handsPerFrame == 2
                  ? makeTwoHandFrame(timestampMicros: i * 33000)
                  : makeFrame(timestampMicros: i * 33000))
            : makeEmptyFrame(timestampMicros: i * 33000),
      );
    }
    await ticker.advance(const Duration(milliseconds: 50));
    await ticker.advanceBy(effective.captureWindow);
    await pumpUntil(() => states.any(_isTerminal));

    await subscription.cancel();
    return states;
  }

  test('one press yields many samples (FR-014/FR-015, SC-002)', () async {
    final states = await runSession(useCase: buildUseCase(), frameCount: 28);

    final summary = states.whereType<SummaryState>().single;
    expect(summary.result.accepted, 28);
    expect(summary.result.discarded, 0);
    expect(
      summary.result.accepted,
      greaterThanOrEqualTo(20),
      reason: 'SC-002: a single press must be worth at least 20 samples',
    );
    expect(await repository.count('peace'), 28);
  });

  test('the countdown emits states without capturing anything', () async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase.run(makePose(), camera: camera.info, settings: settings, frames: camera.frames).listen(states.add);

    await ticker.advance(const Duration(milliseconds: 500));
    // Frames arriving during the countdown must not become samples.
    source.emitAll([makeFrame(), makeFrame(), makeFrame()]);
    await ticker.advance(const Duration(milliseconds: 500));

    final countdowns = states.whereType<CountdownState>().toList();
    expect(countdowns, isNotEmpty);
    expect(countdowns.first.displayValue, 3);
    expect(await repository.count('peace'), 0);

    await ticker.close();
    await sub.cancel();
  });

  test('countdown display counts 3, 2, 1', () async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase.run(makePose(), camera: camera.info, settings: settings, frames: camera.frames).listen(states.add);

    await ticker.advance(const Duration(milliseconds: 1500));
    await ticker.advance(const Duration(milliseconds: 1000));

    final values = states
        .whereType<CountdownState>()
        .map((s) => s.displayValue)
        .toList();
    expect(values.first, 3);
    expect(values, contains(2));
    expect(values, contains(1));

    await ticker.close();
    await sub.cancel();
  });

  test('invalid frames are discarded, counted, and never written', () async {
    final states = await runSession(
      useCase: buildUseCase(),
      frameCount: 10,
      valid: false,
    );

    final summary = states.whereType<SummaryState>().single;
    expect(summary.result.accepted, 0);
    expect(summary.result.discarded, 10);
    expect(summary.result.rejectionCounts[RejectionReason.noHands], 10);
    expect(summary.result.dominantRejection, RejectionReason.noHands);
    expect(await repository.count('peace'), 0);
    expect(sessions.recorded, isEmpty, reason: 'no samples means no session record');
  });

  test('accepted + discarded equals frames observed (FR-021)', () async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase.run(makePose(), camera: camera.info, settings: settings, frames: camera.frames).listen(states.add);

    await ticker.advanceBy(config.countdown);
    source.emitAll([
      makeFrame(),
      makeEmptyFrame(),
      makeFrame(),
      makeEmptyFrame(),
      makeFrame(),
    ]);
    await ticker.advance(const Duration(milliseconds: 50));
    await ticker.advanceBy(config.captureWindow);
    await pumpUntil(() => states.any(_isTerminal));

    final summary = states.whereType<SummaryState>().single;
    expect(summary.result.accepted, 3);
    expect(summary.result.discarded, 2);
    expect(summary.result.observed, 5);

    await ticker.close();
    await sub.cancel();
  });

  test('cancelling during the countdown writes nothing (FR-016)', () async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase.run(makePose(), camera: camera.info, settings: settings, frames: camera.frames).listen(states.add);

    await ticker.advance(const Duration(milliseconds: 500));
    useCase.cancel();
    await ticker.advance(const Duration(milliseconds: 100));

    expect(states.whereType<CancelledState>(), hasLength(1));
    expect(states.whereType<SummaryState>(), isEmpty);
    expect(await repository.count('peace'), 0);
    expect(sessions.recorded, isEmpty);

    await ticker.close();
    await sub.cancel();
  });

  test('an abandoned take writes nothing (FR-050/FR-068/FR-094, SC-016)',
      () async {
    // Orientation is now locked for the whole capture screen (FR-049), and the
    // screen abandons the take when it changes anyway. What this unit owns is
    // narrower and is what matters for the dataset: **whatever** the reason, an
    // abandoned take persists nothing.
    for (final reason in [
      SessionEndReason.orientationChanged,
      SessionEndReason.cameraReleased,
      SessionEndReason.cancelled,
    ]) {
      final useCase = buildUseCase();
      final states = <RecordingSessionState>[];
      final sub = useCase
          .run(makePose(),
              camera: camera.info, settings: settings, frames: camera.frames)
          .listen(states.add);

      await ticker.advance(const Duration(milliseconds: 200));
      useCase.abandon(reason);
      await ticker.advance(const Duration(milliseconds: 100));
      await pumpUntil(() => states.any(_isTerminal));

      final cancelled = states.whereType<CancelledState>().single;
      expect(cancelled.reason, reason);
      expect(await repository.count('peace'), 0);
      expect(sessions.recorded, isEmpty);

      await sub.cancel();
    }
  });

  test('the sample limit finalizes the session normally (FR-051)', () async {
    const limited = CaptureConfig(maxSamplesPerSession: 5);
    final states = await runSession(
      useCase: buildUseCase(overrideConfig: limited),
      frameCount: 40,
      cfg: limited,
    );

    final summary = states.whereType<SummaryState>().single;
    expect(summary.result.endReason, SessionEndReason.limitReached);
    expect(summary.result.hitLimit, isTrue);
    expect(summary.result.accepted, 5);
    expect(
      await repository.count('peace'),
      5,
      reason: 'everything already accepted must be kept, not discarded',
    );
  });

  test('two-handed poses only keep two-handed frames (SC-012)', () async {
    final useCase = buildUseCase();
    final states = <RecordingSessionState>[];
    final sub = useCase.run(makeTwoHandedPose(), camera: camera.info, settings: settings, frames: camera.frames).listen(states.add);

    await ticker.advanceBy(config.countdown);
    source.emitAll([makeFrame(), makeFrame(), makeTwoHandFrame()]);
    await ticker.advance(const Duration(milliseconds: 50));
    await ticker.advanceBy(config.captureWindow);
    await pumpUntil(() => states.any(_isTerminal));

    final summary = states.whereType<SummaryState>().single;
    expect(summary.result.accepted, 1);
    expect(summary.result.discarded, 2);
    expect(
      summary.result.rejectionCounts[RejectionReason.insufficientHands],
      2,
    );

    await ticker.close();
    await sub.cancel();
  });

  test('states follow the documented lifecycle', () async {
    final states = await runSession(useCase: buildUseCase(), frameCount: 3);

    expect(states.first, isA<CountdownState>());
    expect(states.whereType<CapturingState>(), isNotEmpty);
    expect(states.whereType<SavingState>(), hasLength(1));
    expect(states.last, isA<SummaryState>());
  });

  test('per-frame logging stays at debug level (Principle V)', () async {
    await runSession(useCase: buildUseCase(), frameCount: 4, valid: false);

    final frameLogs = logger.entries.where((e) => e.$2.contains('Frame'));
    expect(frameLogs, isNotEmpty);
    expect(
      frameLogs.every((e) => e.$1 == 'debug'),
      isTrue,
      reason: 'a real-time loop must never log per frame at info or above',
    );
  });
}
