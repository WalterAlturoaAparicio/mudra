/// Test doubles for every port, so the whole application is exercisable on the
/// host with no Android device attached (research D12).
library;

import 'dart:async';

import 'package:capture/application/capture/session_ticker.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';

/// Waits until [condition] holds, or the timeout elapses.
///
/// Session completion involves real file I/O, so pumping microtasks is not
/// enough — the test must actually wait for the write to land.
Future<void> pumpUntil(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition() && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
}

/// A camera driven by the test rather than by hardware.
///
/// Complete enough to drive the **whole** pipeline, not just the capture loop
/// (FR-116, SC-030): scriptable lens set, frames in either viewing convention,
/// injectable open failures, and injectable open latency — the last of which is
/// what makes "leave while the camera is still starting" (FR-093) testable at
/// all.
class FakeCameraSource implements CameraSource {
  /// Creates a fake camera.
  FakeCameraSource({
    this.lenses = const {LensPosition.front, LensPosition.rear},
    this.openDelay = Duration.zero,
    this.detectorVersion = '0.10.14',
  });

  /// Which lenses this fake device has.
  Set<LensPosition> lenses;

  /// How long [open] takes, so a superseding request can arrive mid-flight.
  Duration openDelay;

  /// Detector version reported in session info.
  final String detectorVersion;

  /// Raised by the next [open] call, if set. Cleared after it is thrown.
  CameraFailure? failNextOpen;

  /// Every session this source has handed out, in order.
  final List<FakeCameraSession> sessions = [];

  /// How many times [open] has been called.
  int openCount = 0;

  /// The session currently open, or `null`.
  FakeCameraSession? get current =>
      sessions.where((s) => !s.closed).cast<FakeCameraSession?>().firstOrNull;

  /// How many sessions are open at once — must never exceed 1 (FR-092).
  int get liveCount => sessions.where((s) => !s.closed).length;

  @override
  Future<Set<LensPosition>> availableLenses() async => lenses;

  @override
  Future<CameraSession> open(CameraRequest request) async {
    openCount += 1;
    if (openDelay > Duration.zero) await Future<void>.delayed(openDelay);

    final failure = failNextOpen;
    if (failure != null) {
      failNextOpen = null;
      throw failure;
    }
    if (!lenses.contains(request.lens)) {
      throw CameraFailure.lensUnavailable(request.lens.wireValue);
    }

    final session = FakeCameraSession(
      info: CameraSessionInfo(
        textureId: openCount,
        previewWidth: 720,
        previewHeight: 1280,
        analysisWidth: request.analysisWidth,
        analysisHeight: request.analysisHeight,
        lens: request.lens,
        convention: request.lens.defaultConvention,
        platformLensId: request.lens == LensPosition.front ? 1 : 0,
        detectorVersion: detectorVersion,
      ),
    );
    sessions.add(session);
    return session;
  }

  /// Pushes one frame through the live session.
  void emit(LandmarkFrame frame) => current?.emit(frame);

  /// Pushes several frames in order.
  void emitAll(Iterable<LandmarkFrame> frames) => frames.forEach(emit);
}

/// One acquisition handed out by [FakeCameraSource].
class FakeCameraSession implements CameraSession {
  /// Creates a fake session.
  FakeCameraSession({required this.info});

  @override
  final CameraSessionInfo info;

  final StreamController<LandmarkFrame> _controller =
      StreamController<LandmarkFrame>.broadcast();

  /// Whether [close] has been called.
  bool closed = false;

  /// How many times [close] has been called — idempotency is a requirement.
  int closeCount = 0;

  @override
  Stream<LandmarkFrame> get frames => _controller.stream;

  @override
  Future<void> close() async {
    closeCount += 1;
    if (closed) return;
    closed = true;
    // Deliberately not awaited: a broadcast controller's close() completes only
    // once its done event has been delivered, which never happens inside a
    // widget test's fake-async zone. Waiting on it here would make the double
    // hang where the real platform channel returns.
    unawaited(_controller.close());
  }

  /// Pushes one frame to any listener.
  void emit(LandmarkFrame frame) {
    if (!_controller.isClosed) _controller.add(frame);
  }

  /// Simulates the camera failing after start.
  void fail(Object error) {
    if (!_controller.isClosed) _controller.addError(error);
  }
}

/// A ticker the test advances by hand, so no test ever waits on real time.
///
/// The session subscribes once per phase (countdown, then capture window), so
/// [advance] always targets the phase currently running.
class ManualSessionTicker implements SessionTicker {
  final List<StreamController<Duration>> _controllers = [];
  final List<Duration> _elapsed = [];
  bool _closed = false;

  /// How many phases have been subscribed to so far.
  int get phaseCount => _controllers.length;

  @override
  Stream<Duration> ticks(Duration interval) {
    // Once closed, every further phase ends immediately, so a session left
    // mid-flight can still run to completion instead of hanging a test.
    if (_closed) return const Stream<Duration>.empty();
    final controller = StreamController<Duration>();
    _controllers.add(controller);
    _elapsed.add(Duration.zero);
    return controller.stream;
  }

  /// Advances the current phase by [step] and lets the session react.
  Future<void> advance(Duration step) async {
    // Always yield first: the session may not have subscribed yet, and a
    // synchronous early return would starve its generator entirely.
    await _settle();
    if (_controllers.isEmpty || _closed) {
      await _settle();
      return;
    }
    final index = _controllers.length - 1;
    _elapsed[index] += step;
    if (!_controllers[index].isClosed) {
      _controllers[index].add(_elapsed[index]);
    }
    await _settle();
  }

  /// Advances by [step] repeatedly until [total] has elapsed in this phase.
  Future<void> advanceBy(Duration total, {Duration? step}) async {
    final increment = step ?? const Duration(milliseconds: 50);
    var moved = Duration.zero;
    while (moved < total) {
      await advance(increment);
      moved += increment;
    }
  }

  /// Ends every phase, present and future.
  Future<void> close() async {
    _closed = true;
    for (final controller in _controllers) {
      if (!controller.isClosed) await controller.close();
    }
    await _settle();
  }

  /// Lets pending microtasks and event-loop callbacks run.
  Future<void> _settle() async {
    for (var i = 0; i < 4; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }
}

/// A clock the test moves deliberately.
class FakeClock implements Clock {
  /// Creates a clock starting at a fixed instant.
  FakeClock([DateTime? start])
      : _now = start ?? DateTime.utc(2026, 7, 24, 13, 19, 56, 400);

  DateTime _now;

  @override
  DateTime nowUtc() => _now;

  /// Moves the clock forward.
  void advance(Duration step) => _now = _now.add(step);
}

/// Deterministic, readable identities: `uuid-1`, `uuid-2`, …
class SequentialUuidFactory implements UuidFactory {
  /// Creates a factory with an optional prefix.
  SequentialUuidFactory([this.prefix = 'uuid']);

  /// Prefix for generated identifiers.
  final String prefix;

  int _next = 0;

  @override
  String create() => '$prefix-${++_next}';
}

/// Holds calibration state in memory instead of writing it to disk.
class InMemoryCalibrationStore implements CalibrationStore {
  CameraCalibrationSet? _saved;

  /// How many times [save] has been called.
  int saveCount = 0;

  @override
  Future<CameraCalibrationSet?> load() async => _saved;

  @override
  Future<void> save(CameraCalibrationSet calibrationSet) async {
    saveCount += 1;
    _saved = calibrationSet;
  }
}

/// Captures session records instead of writing them.
class InMemorySessionStore implements SessionStore {
  /// Everything recorded so far.
  final List<RecordingSession> recorded = [];

  @override
  Future<void> record(RecordingSession session) async => recorded.add(session);

  @override
  Future<List<RecordingSession>> all() async => List.of(recorded);
}

/// Collects log output so tests can assert on structured records.
class RecordingLogger implements AppLogger {
  /// Every `(level, message, fields)` triple emitted.
  final List<(String, String, Map<String, Object?>)> entries = [];

  /// Startup records emitted.
  final List<StartupRecord> startups = [];

  /// Shutdown records emitted.
  final List<ShutdownRecord> shutdowns = [];

  @override
  void debug(String message, [Map<String, Object?> fields = const {}]) =>
      entries.add(('debug', message, fields));

  @override
  void info(String message, [Map<String, Object?> fields = const {}]) =>
      entries.add(('info', message, fields));

  @override
  void error(String message, [Map<String, Object?> fields = const {}]) =>
      entries.add(('error', message, fields));

  @override
  void startup(StartupRecord record) {
    startups.add(record);
    entries.add(('info', 'startup', record.toFields()));
  }

  @override
  void shutdown(ShutdownRecord record) {
    shutdowns.add(record);
    entries.add(('info', 'shutdown', record.toFields()));
  }

  /// Fields of the last entry whose message contains [fragment].
  Map<String, Object?>? fieldsFor(String fragment) {
    for (final entry in entries.reversed) {
      if (entry.$2.contains(fragment)) return entry.$3;
    }
    return null;
  }
}

/// An orientation controller the test can trip on demand.
class FakeOrientationController implements OrientationController {
  final StreamController<void> _changes = StreamController<void>.broadcast();

  /// Whether orientation is currently locked.
  bool locked = false;

  /// How many times the lock has been taken.
  int lockCount = 0;

  /// How many times it has been released.
  int unlockCount = 0;

  @override
  Future<void> lock() async {
    locked = true;
    lockCount += 1;
  }

  @override
  Future<void> unlock() async {
    locked = false;
    unlockCount += 1;
  }

  @override
  Stream<void> get unexpectedChanges => _changes.stream;

  /// Simulates the screen rotating despite the lock.
  void rotate() => _changes.add(null);

  /// Closes the change stream.
  Future<void> close() => _changes.close();
}
