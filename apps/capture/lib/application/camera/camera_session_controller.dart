/// Owns the camera session — and is the **only** thing permitted to.
///
/// Four requirements are four statements of one invariant:
///
/// - FR-092: at most one camera session exists at any instant;
/// - FR-093: a session still starting when the screen is left is torn down
///   fully, without surfacing an error for the abandoned start;
/// - FR-070: rapid or repeated requests converge on the last one, with exactly
///   one live session;
/// - FR-066: a release completes before the next acquisition begins.
///
/// Implementing them as four guards would leave four places to get the ordering
/// wrong. Instead there is one mechanism: every operation is **serialized
/// through a single queue** and carries a monotonically increasing **request
/// token**. An open whose token is stale by the time it resolves is closed
/// immediately and never published. "The world moved on while I was starting"
/// becomes one condition, checked in one place.
///
/// The controller also applies [CanonicalViewConverter] to the frame stream, so
/// nothing above it ever observes a non-canonical frame (FR-053).
///
/// It is deliberately **pure Dart**: no widgets, no plugins (constitution
/// Principle I). The presentation layer observes app lifecycle and calls
/// [onAppPaused]/[onAppResumed], which is what lets the whole lifecycle be
/// tested on the host with no device.
library;

import 'dart:async';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/canonical_view_converter.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';

/// What the camera is doing right now.
sealed class CameraControllerState {
  /// Base constructor.
  const CameraControllerState();

  /// Whether a preview can be rendered.
  bool get isLive => this is CameraLive;
}

/// No camera is held.
class CameraClosed extends CameraControllerState {
  /// Creates the closed state.
  const CameraClosed();
}

/// A camera is being acquired; the ordered start path is running (FR-107).
class CameraOpening extends CameraControllerState {
  /// Creates the opening state.
  const CameraOpening(this.step);

  /// Which step of the start path is running, for a meaningful message.
  final CameraStartStep step;
}

/// A camera is live and producing frames.
class CameraLive extends CameraControllerState {
  /// Creates the live state.
  const CameraLive(this.info);

  /// What the live session reports about itself.
  final CameraSessionInfo info;
}

/// The camera could not be acquired, or was lost.
///
/// Never cached: each entry into the capture screen runs the start path from the
/// beginning, so a resolved cause always lets the screen be entered again
/// (FR-111).
class CameraErrored extends CameraControllerState {
  /// Creates the error state.
  const CameraErrored(this.failure);

  /// What went wrong, and how the user gets out of it.
  final CameraFailure failure;
}

/// The steps of the ordered, resumable start path (FR-107).
enum CameraStartStep {
  /// Releasing whatever was held before.
  releasing('Releasing the camera…'),

  /// Acquiring the camera device.
  acquiring('Starting the camera…'),

  /// Publishing the preview surface.
  publishing('Preparing the preview…');

  const CameraStartStep(this.message);

  /// A plain-language description of what is happening.
  final String message;
}

/// Serializes camera acquisition and release, and guarantees exactly one
/// session.
class CameraSessionController {
  /// Creates a controller over [source].
  CameraSessionController({
    required CameraSource source,
    required AppLogger logger,
    required Duration releaseTimeout,
    CanonicalViewConverter converter = const MirrorCanonicalViewConverter(),
  })  : _source = source,
        _logger = logger,
        _releaseTimeout = releaseTimeout,
        _converter = converter;

  final CameraSource _source;
  final AppLogger _logger;
  final Duration _releaseTimeout;
  final CanonicalViewConverter _converter;

  final StreamController<CameraControllerState> _states =
      StreamController<CameraControllerState>.broadcast();
  final StreamController<LandmarkFrame> _frames =
      StreamController<LandmarkFrame>.broadcast();
  final StreamController<LandmarkFrame> _rawFrames =
      StreamController<LandmarkFrame>.broadcast();

  CameraSession? _current;
  StreamSubscription<LandmarkFrame>? _frameSubscription;
  CameraRequest? _lastRequest;
  CameraControllerState _state = const CameraClosed();
  Future<void> _queue = Future<void>.value();
  int _token = 0;
  bool _pausedByLifecycle = false;
  bool _disposed = false;

  /// The current state.
  CameraControllerState get state => _state;

  /// State changes, for the UI to render.
  Stream<CameraControllerState> get states => _states.stream;

  /// What the live session reports, or `null` when no camera is held.
  CameraSessionInfo? get info =>
      _state is CameraLive ? (_state as CameraLive).info : null;

  /// Canonical landmark frames from whichever session is live (FR-053).
  ///
  /// Frames from a superseded session never reach here: its subscription is
  /// cancelled before the next session is bound. This is what recording
  /// (FR-014) and recognition matching consume — canonicalization is a
  /// **dataset-storage** convention, so anything comparing a live frame
  /// against previously recorded exemplars must stay on this stream.
  Stream<LandmarkFrame> get frames => _frames.stream;

  /// Landmark frames exactly as the session produced them, **before**
  /// canonicalization — analysis-space coordinates, unmirrored, from
  /// whichever session is live.
  ///
  /// This is what anything rendering onto the live preview must consume
  /// instead of [frames]: canonicalization mirrors rear-lens coordinates to
  /// match dataset-storage convention, which has no relationship to what the
  /// rear lens's actual (unmirrored) preview pixels show on screen. Combine
  /// this stream with [DisplayOrientation.fromSession] to map into display
  /// space (see that class's doc for the full root-cause explanation).
  Stream<LandmarkFrame> get rawFrames => _rawFrames.stream;

  /// Which lenses the device can provide (FR-064/FR-069).
  Future<Set<LensPosition>> availableLenses() => _source.availableLenses();

  /// Acquires [request]'s lens, replacing any session already held.
  ///
  /// Returns when this request has been fully processed — either it is live, it
  /// failed, or a newer request superseded it.
  Future<void> request(CameraRequest request) {
    if (_disposed) return Future<void>.value();
    _lastRequest = request;
    final token = ++_token;
    return _enqueue(() => _open(request, token));
  }

  /// Releases the camera, recording [reason] (FR-096).
  ///
  /// Idempotent: releasing when nothing is held is a no-op, not an error.
  Future<void> release(CameraReleaseReason reason) {
    if (_disposed) return Future<void>.value();
    _token++;
    return _enqueue(() => _close(reason));
  }

  /// The application went to the background or the screen locked (FR-090).
  ///
  /// Remembers that the release was involuntary, so [onAppResumed] knows to
  /// reacquire — and so a user who left the screen while backgrounded does
  /// **not** get a camera when the app returns.
  Future<void> onAppPaused() async {
    if (_disposed || _current == null && _state is! CameraOpening) return;
    _pausedByLifecycle = true;
    await release(CameraReleaseReason.backgrounded);
  }

  /// The capture screen returned to the foreground (FR-090).
  Future<void> onAppResumed() async {
    if (_disposed || !_pausedByLifecycle) return;
    _pausedByLifecycle = false;
    final request = _lastRequest;
    if (request != null) await this.request(request);
  }

  /// Releases everything and stops accepting work.
  Future<void> dispose() async {
    if (_disposed) return;
    await release(CameraReleaseReason.shutdown);
    _disposed = true;
    await _states.close();
    await _frames.close();
    await _rawFrames.close();
  }

  // -- internals -------------------------------------------------------------

  /// Chains [operation] after everything already queued.
  ///
  /// This is what makes "at most one session at any instant" true rather than
  /// merely likely: two concurrent requests cannot both be inside `open`.
  Future<void> _enqueue(Future<void> Function() operation) {
    final next = _queue.then((_) => operation());
    _queue = next.catchError((Object _) {});
    return next;
  }

  Future<void> _open(CameraRequest request, int token) async {
    if (token != _token) return;

    _emit(const CameraOpening(CameraStartStep.releasing));
    await _close(
      _current == null
          ? CameraReleaseReason.superseded
          : (request.lens == _current!.info.lens
              ? CameraReleaseReason.superseded
              : CameraReleaseReason.lensSwitch),
      silent: _current == null,
    );

    // Superseded while the previous session was closing.
    if (token != _token) return;

    _emit(const CameraOpening(CameraStartStep.acquiring));
    final startedAt = DateTime.now();

    final CameraSession session;
    try {
      session = await _source.open(request);
    } on CameraFailure catch (failure) {
      // An abandoned start must not surface an error (FR-093): if a newer
      // request or a release arrived while we were opening, this failure is no
      // longer anybody's problem.
      if (token != _token) return;
      _logger.error('Camera start failed.', {
        'lens': request.lens.wireValue,
        'code': failure.code,
      });
      _emit(CameraErrored(failure));
      return;
    } on Object catch (error) {
      if (token != _token) return;
      _emit(CameraErrored(CameraFailure.startFailed(error)));
      return;
    }

    // The world moved on while we were starting: close what we just opened and
    // publish nothing (FR-093, FR-070).
    if (token != _token) {
      await _closeSession(session, CameraReleaseReason.superseded);
      return;
    }

    _emit(const CameraOpening(CameraStartStep.publishing));
    _current = session;
    _frameSubscription = session.frames.listen(
      (frame) {
        // One subscription to the platform stream, two independent
        // publications: canonical for recording/recognition (unchanged
        // behaviour), raw for anything rendering onto the live preview (see
        // [rawFrames] and [DisplayOrientation]). Neither consumer's presence
        // affects the other — both are ordinary broadcast listeners.
        if (!_rawFrames.isClosed) _rawFrames.add(frame);
        if (_frames.isClosed) return;
        _frames.add(_converter.toCanonical(frame));
      },
      onError: (Object error, StackTrace stack) {
        final failure = error is CameraFailure
            ? error
            : CameraFailure.startFailed(error);
        unawaited(release(CameraReleaseReason.error));
        if (!_states.isClosed) _emit(CameraErrored(failure));
      },
    );

    _logger.info('camera_acquired', {
      'lens': session.info.lens.wireValue,
      'mirrored': session.info.mirroredPreview,
      'preview': '${session.info.previewWidth}x${session.info.previewHeight}',
      'analysis': '${session.info.analysisWidth}x${session.info.analysisHeight}',
      'platform_lens_id': session.info.platformLensId,
      // Auditable rather than inferred (D23): a wrong on-screen rotation is
      // otherwise indistinguishable, from the logs alone, between "the
      // platform reported the wrong value" and "Dart mistransformed a
      // correct one".
      'rotation_degrees': session.info.rotationDegrees,
      'duration_ms': DateTime.now().difference(startedAt).inMilliseconds,
    });

    _emit(CameraLive(session.info));
  }

  Future<void> _close(CameraReleaseReason reason, {bool silent = false}) async {
    final session = _current;
    _current = null;
    await _frameSubscription?.cancel();
    _frameSubscription = null;

    if (session == null) {
      if (!silent) _emit(const CameraClosed());
      return;
    }

    await _closeSession(session, reason);
    _emit(const CameraClosed());
  }

  Future<void> _closeSession(
    CameraSession session,
    CameraReleaseReason reason,
  ) async {
    final startedAt = DateTime.now();
    try {
      await session.close();
    } on Object catch (error) {
      // Teardown is best-effort and must complete even when the preceding start
      // failed partway (FR-095) — a failure here must never leave the caller
      // believing the camera is still held.
      _logger.error('Camera release failed.', {
        'reason': reason.wireValue,
        'error': '$error',
      });
    }

    final elapsed = DateTime.now().difference(startedAt);
    final fields = <String, Object?>{
      'reason': reason.wireValue,
      'duration_ms': elapsed.inMilliseconds,
    };
    if (elapsed > _releaseTimeout) {
      // SC-019: a slow release is the first symptom of the leak this revision
      // exists to fix, so it is logged loudly rather than swallowed.
      _logger.error('camera_released (slow)', fields);
    } else {
      _logger.info('camera_released', fields);
    }
  }

  void _emit(CameraControllerState state) {
    _state = state;
    if (!_states.isClosed) _states.add(state);
  }
}
