/// The capture session use case — the heart of the application.
///
/// One press of Record runs: mint a `session_uuid` → lock orientation →
/// countdown (preview stays live) → capture window → validate every frame →
/// normalize the accepted ones → persist them in one pass → record the session
/// → unlock orientation → report the result.
///
/// It touches no widget and no plugin, which is exactly why the whole recording
/// behaviour is testable on the host with a fake landmark source.
library;

import 'dart:async';

import 'package:capture/application/capture/session_ticker.dart';
import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/capture/capture_state.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:capture/shared/time/iso_timestamp.dart';

/// Runs one capture session and reports its state as it advances.
class RunCaptureSession {
  /// Creates the use case with its collaborators.
  RunCaptureSession({
    required HandLandmarkSource source,
    required SampleValidator validator,
    required LandmarkNormalizer normalizer,
    required SampleRepository repository,
    required SessionStore sessionStore,
    required Clock clock,
    required UuidFactory uuidFactory,
    required CaptureConfig config,
    required AppLogger logger,
    required String applicationVersion,
    OrientationController? orientation,
    SessionTicker ticker = const PeriodicSessionTicker(),
  })  : _source = source,
        _validator = validator,
        _normalizer = normalizer,
        _repository = repository,
        _sessionStore = sessionStore,
        _clock = clock,
        _uuid = uuidFactory,
        _config = config,
        _logger = logger,
        _applicationVersion = applicationVersion,
        _orientation = orientation,
        _ticker = ticker;

  final HandLandmarkSource _source;
  final SampleValidator _validator;
  final LandmarkNormalizer _normalizer;
  final SampleRepository _repository;
  final SessionStore _sessionStore;
  final Clock _clock;
  final UuidFactory _uuid;
  final CaptureConfig _config;
  final AppLogger _logger;
  final String _applicationVersion;
  final OrientationController? _orientation;
  final SessionTicker _ticker;

  bool _cancelRequested = false;
  bool _running = false;

  /// Whether a session is currently in flight.
  bool get isRunning => _running;

  /// Requests cancellation of the running session; nothing will be written.
  void cancel() => _cancelRequested = true;

  /// Runs a full session for [pose], emitting each state as it is entered.
  ///
  /// The returned stream always ends in [SummaryState], [CancelledState], or
  /// [FailedState] — never mid-workflow — and never throws into its listener.
  Stream<CaptureSessionState> run(
    PoseDefinition pose,
    LandmarkSourceSession session,
  ) async* {
    if (_running) return;
    _running = true;
    _cancelRequested = false;

    final sessionUuid = _uuid.create();
    final startedAt = _clock.nowUtc();
    final countdownStartedIso = formatEngineTimestamp(startedAt);

    _logger.info('Capture session started.', {
      'session_uuid': sessionUuid,
      'pose_id': pose.poseId,
      'countdown_seconds': _config.countdownSeconds,
      'required_hands': pose.requiredHands,
    });

    StreamSubscription<void>? orientationSub;
    var orientationChanged = false;

    try {
      if (_config.lockOrientationDuringSession && _orientation != null) {
        await _orientation.lock();
        orientationSub = _orientation.unexpectedChanges.listen((_) {
          orientationChanged = true;
        });
      }

      // -- countdown: the preview keeps rendering; nothing is captured yet ----
      yield CountdownState(
        remaining: _config.countdown,
        total: _config.countdown,
      );

      await for (final elapsed in _ticker.ticks(_config.tickInterval)) {
        if (_cancelRequested) {
          yield* _cancelled(sessionUuid, pose, startedAt, SessionEndReason.cancelled);
          return;
        }
        if (orientationChanged) {
          yield* _cancelled(
            sessionUuid,
            pose,
            startedAt,
            SessionEndReason.orientationChanged,
          );
          return;
        }
        if (elapsed >= _config.countdown) break;
        yield CountdownState(
          remaining: _config.countdown - elapsed,
          total: _config.countdown,
        );
      }

      // -- capture window: every frame is validated, accepted or discarded ----
      final drafts = <PoseSample>[];
      final rejections = <RejectionReason, int>{};
      var discarded = 0;
      var endReason = SessionEndReason.completed;
      Duration observedWindow = Duration.zero;

      final frames = StreamQueueLike(_source.frames);
      try {
        await for (final elapsed in _ticker.ticks(_config.tickInterval)) {
          observedWindow = elapsed;

          if (_cancelRequested) {
            yield* _cancelled(sessionUuid, pose, startedAt, SessionEndReason.cancelled);
            return;
          }
          if (orientationChanged) {
            yield* _cancelled(
              sessionUuid,
              pose,
              startedAt,
              SessionEndReason.orientationChanged,
            );
            return;
          }

          // Drain whatever the detector produced since the last tick. The cap is
          // checked *inside* the drain: a single tick can carry more frames than
          // the limit allows, and accepting them all would overshoot silently.
          var limitHit = false;
          for (final frame in frames.drain()) {
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
                session: session,
                sessionUuid: sessionUuid,
                countdownStartedIso: countdownStartedIso,
              ),
            );
          }

          // FR-051: the cap finalizes the session normally, keeping everything
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
        frames.close();
      }

      // -- persist -----------------------------------------------------------
      yield SavingState(accepted: drafts.length);

      final refs = await _repository.saveAll(drafts);
      final finishedAt = _clock.nowUtc();

      final record = CaptureSession(
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

      final result = CaptureResult(
        sessionUuid: sessionUuid,
        poseId: pose.poseId,
        accepted: refs.length,
        discarded: discarded,
        rejectionCounts: rejections,
        duration: observedWindow,
        endReason: endReason,
        refs: refs,
      );

      _logger.info('Capture session finished.', {
        'session_uuid': sessionUuid,
        'pose_id': pose.poseId,
        'accepted': result.accepted,
        'discarded': result.discarded,
        'end_reason': endReason.wireValue,
      });

      yield SummaryState(result);
    } on Failure catch (failure) {
      _logger.error('Capture session failed.', {
        'session_uuid': sessionUuid,
        'pose_id': pose.poseId,
        'failure': failure.message,
      });
      yield FailedState(failure);
    } on Object catch (error) {
      _logger.error('Capture session failed unexpectedly.', {
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
      await orientationSub?.cancel();
      if (_config.lockOrientationDuringSession && _orientation != null) {
        await _orientation.unlock();
      }
      _running = false;
    }
  }

  Stream<CaptureSessionState> _cancelled(
    String sessionUuid,
    PoseDefinition pose,
    DateTime startedAt,
    SessionEndReason reason,
  ) async* {
    _logger.info('Capture session ended without saving.', {
      'session_uuid': sessionUuid,
      'pose_id': pose.poseId,
      'end_reason': reason.wireValue,
    });
    yield CancelledState(reason);
  }

  PoseSample _buildSample({
    required LandmarkFrame frame,
    required PoseDefinition pose,
    required LandmarkSourceSession session,
    required String sessionUuid,
    required String countdownStartedIso,
  }) {
    final timestamp = formatEngineTimestamp(_clock.nowUtc());
    final hands = [
      for (final hand in frame.hands)
        HandSample(
          handedness: hand.handedness,
          confidence: hand.confidence,
          raw: hand.landmarks,
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
        cameraIndex: session.lensFacing,
        cameraWidth: frame.frameWidth,
        cameraHeight: frame.frameHeight,
        mediapipeVersion: session.mediapipeVersion,
        applicationVersion: _applicationVersion,
        numHands: hands.length,
        hands: [
          for (final hand in hands)
            HandMeta(handedness: hand.handedness, confidence: hand.confidence),
        ],
        capture: CaptureTiming(
          captureTime: timestamp,
          countdownStartTime: countdownStartedIso,
          countdownSeconds: _config.countdownSeconds,
          sessionUuid: sessionUuid,
        ),
      ),
      hands: hands,
    );
  }
}

/// Buffers a frame stream so a tick can drain everything that arrived since the
/// previous one.
///
/// Frames arrive faster than the session advances; draining per tick keeps the
/// session loop simple without dropping anything the detector produced.
class StreamQueueLike {
  /// Subscribes to [stream] immediately and buffers what it emits.
  StreamQueueLike(Stream<LandmarkFrame> stream) {
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
