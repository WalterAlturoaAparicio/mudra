/// The recording-session use case — the heart of the application.
///
/// One press of Record runs: mint a `session_uuid` → **countdown, when enabled**
/// (the preview stays live) → capture window → validate every frame → normalize
/// the accepted ones → persist them in one pass → record the take → report the
/// result.
///
/// Three R1 properties shape it:
///
/// - the countdown is **conditional** (FR-010). When disabled it is skipped
///   entirely rather than run with a zero duration, so capture begins on the
///   press;
/// - it consumes the camera controller's **canonical** frame stream, so it never
///   sees or reasons about which lens produced a frame (FR-053);
/// - it does **not own the camera**. A take is abandoned when the camera is
///   released, never the other way round (FR-094), and orientation is locked by
///   the capture screen for the whole capture session rather than per take
///   (FR-049).
///
/// It touches no widget and no plugin, which is exactly why the whole recording
/// behaviour is testable on the host with a fake camera.
library;

import 'dart:async';

import 'package:capture/application/capture/session_ticker.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/capture/recording_state.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:capture/shared/time/iso_timestamp.dart';

/// Runs one recording session and reports its state as it advances.
class RunRecordingSession {
  /// Creates the use case with its collaborators.
  RunRecordingSession({
    required SampleValidator validator,
    required LandmarkNormalizer normalizer,
    required SampleRepository repository,
    required SessionStore sessionStore,
    required Clock clock,
    required UuidFactory uuidFactory,
    required CaptureConfig config,
    required AppLogger logger,
    required String applicationVersion,
    SessionTicker ticker = const PeriodicSessionTicker(),
  })  : _validator = validator,
        _normalizer = normalizer,
        _repository = repository,
        _sessionStore = sessionStore,
        _clock = clock,
        _uuid = uuidFactory,
        _config = config,
        _logger = logger,
        _applicationVersion = applicationVersion,
        _ticker = ticker;

  final SampleValidator _validator;
  final LandmarkNormalizer _normalizer;
  final SampleRepository _repository;
  final SessionStore _sessionStore;
  final Clock _clock;
  final UuidFactory _uuid;
  final CaptureConfig _config;
  final AppLogger _logger;
  final String _applicationVersion;
  final SessionTicker _ticker;

  bool _cancelRequested = false;
  bool _running = false;
  SessionEndReason _abandonReason = SessionEndReason.cancelled;

  /// Whether a take is currently in flight.
  bool get isRunning => _running;

  /// Requests cancellation of the running take; nothing will be written.
  void cancel() {
    _abandonReason = SessionEndReason.cancelled;
    _cancelRequested = true;
  }

  /// Abandons the running take because the camera went away (FR-068/FR-094).
  ///
  /// Every no-save exit — cancel, orientation change, camera release, lens
  /// switch, mode change — routes through this one operation, so "nothing
  /// partial is ever written" is a single code path rather than six.
  void abandon(SessionEndReason reason) {
    _abandonReason = reason;
    _cancelRequested = true;
  }

  /// Runs a full take for [pose], emitting each state as it is entered.
  ///
  /// The returned stream always ends in [SummaryState], [CancelledState], or
  /// [FailedState] — never mid-workflow — and never throws into its listener.
  Stream<RecordingSessionState> run(
    PoseDefinition pose, {
    required CameraSessionInfo camera,
    required CaptureSettings settings,
    required Stream<LandmarkFrame> frames,
  }) async* {
    if (_running) return;
    _running = true;
    _cancelRequested = false;
    _abandonReason = SessionEndReason.cancelled;

    final sessionUuid = _uuid.create();
    final startedAt = _clock.nowUtc();
    final countdownStartedIso = formatEngineTimestamp(startedAt);
    final countdown = settings.countdown;

    _logger.info('Recording session started.', {
      'session_uuid': sessionUuid,
      'pose_id': pose.poseId,
      'mode': settings.mode.wireValue,
      'lens': settings.lens.wireValue,
      'countdown_enabled': settings.countdownEnabled,
      'countdown_seconds': settings.recordedCountdownSeconds,
      'required_hands': pose.requiredHands,
    });

    try {
      // -- countdown: skipped entirely when disabled (FR-010) ------------------
      if (settings.countdownEnabled && countdown > Duration.zero) {
        yield CountdownState(remaining: countdown, total: countdown);

        await for (final elapsed in _ticker.ticks(_config.tickInterval)) {
          if (_cancelRequested) {
            yield* _abandoned(sessionUuid, pose, _abandonReason);
            return;
          }
          if (elapsed >= countdown) break;
          yield CountdownState(
            remaining: countdown - elapsed,
            total: countdown,
          );
        }
      }

      // -- capture window: every frame is validated, accepted or discarded ----
      final drafts = <PoseSample>[];
      final rejections = <RejectionReason, int>{};
      var discarded = 0;
      var endReason = SessionEndReason.completed;
      Duration observedWindow = Duration.zero;

      final buffer = FrameBuffer(frames);
      try {
        await for (final elapsed in _ticker.ticks(_config.tickInterval)) {
          observedWindow = elapsed;

          if (_cancelRequested) {
            yield* _abandoned(sessionUuid, pose, _abandonReason);
            return;
          }

          // Drain whatever the detector produced since the last tick. The cap is
          // checked *inside* the drain: a single tick can carry more frames than
          // the limit allows, and accepting them all would overshoot silently.
          var limitHit = false;
          for (final frame in buffer.drain()) {
            if (drafts.length >= _config.maxSamplesPerSession) {
              limitHit = true;
              break;
            }
            final outcome = _validator.validate(frame, pose);
            if (!outcome.isAccepted) {
              discarded += 1;
              final reason = outcome.reason!;
              rejections[reason] = (rejections[reason] ?? 0) + 1;
              _logger.debug('Frame discarded.', {
                'session_uuid': sessionUuid,
                'reason': reason.wireValue,
              });
              continue;
            }
            drafts.add(
              _buildSample(
                frame: frame,
                pose: pose,
                camera: camera,
                settings: settings,
                sessionUuid: sessionUuid,
                countdownStartedIso: countdownStartedIso,
              ),
            );
          }

          // FR-051: the cap finalizes the take normally, keeping everything
          // already accepted — it is a stop condition, not an error.
          if (limitHit || drafts.length >= _config.maxSamplesPerSession) {
            endReason = SessionEndReason.limitReached;
            break;
          }
          if (elapsed >= _config.captureWindow) break;

          yield CapturingState(
            elapsed: elapsed,
            window: _config.captureWindow,
            accepted: drafts.length,
            discarded: discarded,
          );
        }
      } finally {
        buffer.close();
      }

      // -- persist -----------------------------------------------------------
      yield SavingState(accepted: drafts.length);

      final refs = await _repository.saveAll(drafts);
      final finishedAt = _clock.nowUtc();

      final record = RecordingSession(
        sessionUuid: sessionUuid,
        poseId: pose.poseId,
        startedAt: startedAt,
        finishedAt: finishedAt,
        totalSamples: refs.length,
        discardedSamples: discarded,
        endReason: endReason,
      );
      if (record.isRecordable) {
        await _sessionStore.record(record);
      }

      final result = RecordingResult(
        sessionUuid: sessionUuid,
        poseId: pose.poseId,
        accepted: refs.length,
        discarded: discarded,
        rejectionCounts: rejections,
        duration: observedWindow,
        endReason: endReason,
        refs: refs,
      );

      _logger.info('Recording session finished.', {
        'session_uuid': sessionUuid,
        'pose_id': pose.poseId,
        'accepted': result.accepted,
        'discarded': result.discarded,
        'end_reason': endReason.wireValue,
      });

      yield SummaryState(result);
    } on Failure catch (failure) {
      _logger.error('Recording session failed.', {
        'session_uuid': sessionUuid,
        'pose_id': pose.poseId,
        'failure': failure.message,
      });
      yield FailedState(failure);
    } on Object catch (error) {
      _logger.error('Recording session failed unexpectedly.', {
        'session_uuid': sessionUuid,
        'error': '$error',
      });
      yield FailedState(
        RepositoryFailure(
          'Something went wrong while recording. Nothing was saved.',
          debugDetail: error,
        ),
      );
    } finally {
      _running = false;
    }
  }

  Stream<RecordingSessionState> _abandoned(
    String sessionUuid,
    PoseDefinition pose,
    SessionEndReason reason,
  ) async* {
    _logger.info('Recording session ended without saving.', {
      'session_uuid': sessionUuid,
      'pose_id': pose.poseId,
      'end_reason': reason.wireValue,
    });
    yield CancelledState(reason);
  }

  PoseSample _buildSample({
    required LandmarkFrame frame,
    required PoseDefinition pose,
    required CameraSessionInfo camera,
    required CaptureSettings settings,
    required String sessionUuid,
    required String countdownStartedIso,
  }) {
    assert(
      frame.isCanonical,
      'Frames reaching the sample builder must already be canonical (FR-053). '
      'Conversion happens once, at the camera seam.',
    );

    final timestamp = formatEngineTimestamp(_clock.nowUtc());
    final hands = [
      for (final hand in frame.hands)
        HandSample(
          handedness: hand.handedness,
          confidence: hand.confidence,
          canonicalRaw: hand.landmarks,
          normalized: _normalizer.normalize(hand.landmarks),
        ),
    ];

    return PoseSample(
      pose: Pose(
        poseId: pose.poseId,
        displayName: pose.displayName,
        description: pose.description.isEmpty ? null : pose.description,
      ),
      sampleUuid: _uuid.create(),
      timestamp: timestamp,
      normalization: NormalizationInfo(
        strategy: _normalizer.strategy,
        version: _normalizer.version,
      ),
      metadata: SampleMetadata(
        timestamp: timestamp,
        cameraIndex: camera.platformLensId,
        cameraWidth: frame.frameWidth,
        cameraHeight: frame.frameHeight,
        mediapipeVersion: camera.detectorVersion,
        applicationVersion: _applicationVersion,
        numHands: hands.length,
        hands: [
          for (final hand in hands)
            HandMeta(handedness: hand.handedness, confidence: hand.confidence),
        ],
        capture: CaptureTiming(
          captureTime: timestamp,
          countdownStartTime: countdownStartedIso,
          countdownSeconds: settings.recordedCountdownSeconds,
          countdownEnabled: settings.countdownEnabled,
          sessionUuid: sessionUuid,
        ),
        // FR-085: the configuration active at the instant of capture, so takes
        // before and after a lens or mode change each report their own. FR-058:
        // this reports what was *used*, even for a sample whose coordinates were
        // converted into the canonical convention on the way to disk.
        camera: camera.metadataWith(countdownEnabled: settings.countdownEnabled),
      ),
      hands: hands,
    );
  }
}

/// Buffers a frame stream so a tick can drain everything that arrived since the
/// previous one.
///
/// Frames arrive faster than the take advances; draining per tick keeps the loop
/// simple without dropping anything the detector produced.
class FrameBuffer {
  /// Subscribes to [stream] immediately and buffers what it emits.
  FrameBuffer(Stream<LandmarkFrame> stream) {
    _subscription = stream.listen(_buffer.add);
  }

  final List<LandmarkFrame> _buffer = [];
  late final StreamSubscription<LandmarkFrame> _subscription;

  /// Returns and clears everything buffered since the last call.
  List<LandmarkFrame> drain() {
    if (_buffer.isEmpty) return const [];
    final frames = List<LandmarkFrame>.from(_buffer);
    _buffer.clear();
    return frames;
  }

  /// Stops listening.
  void close() => unawaited(_subscription.cancel());
}
