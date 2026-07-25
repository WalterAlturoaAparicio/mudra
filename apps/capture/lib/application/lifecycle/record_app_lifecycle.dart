/// Application lifecycle observability (FR-042/FR-043).
///
/// Constitution Principle V requires explicit structured startup and shutdown
/// records. This use case owns them, and owns the running totals the shutdown
/// record reports, so no other layer has to remember to keep score.
library;

import 'package:capture/domain/ports/ports.dart';

/// Emits the run's startup and shutdown records and tracks its totals.
class RecordAppLifecycle {
  /// Creates the lifecycle recorder.
  RecordAppLifecycle({required AppLogger logger, required Clock clock})
      : _logger = logger,
        _clock = clock;

  final AppLogger _logger;
  final Clock _clock;

  DateTime? _startedAt;
  int _samplesRecorded = 0;
  int _samplesDiscarded = 0;
  int _exportCount = 0;
  bool _shutdownEmitted = false;

  /// Samples recorded across this run.
  int get samplesRecorded => _samplesRecorded;

  /// Frames discarded across this run.
  int get samplesDiscarded => _samplesDiscarded;

  /// Exports completed during this run.
  int get exportCount => _exportCount;

  /// Emits the single structured startup record for this run.
  void start({
    required String applicationVersion,
    required String configurationProfile,
    required String datasetRoot,
    required int catalogSize,
    required Map<String, Object?> cameraConfiguration,
    required Map<String, Object?> platform,
  }) {
    _startedAt = _clock.nowUtc();
    _logger.startup(
      StartupRecord(
        applicationVersion: applicationVersion,
        configurationProfile: configurationProfile,
        datasetRoot: datasetRoot,
        catalogSize: catalogSize,
        cameraConfiguration: cameraConfiguration,
        platform: platform,
      ),
    );
  }

  /// Adds one finished session's tallies to the run totals.
  void recordSession({required int accepted, required int discarded}) {
    _samplesRecorded += accepted;
    _samplesDiscarded += discarded;
  }

  /// Counts one completed export.
  void recordExport() => _exportCount += 1;

  /// Emits the single structured shutdown record for this run.
  ///
  /// Idempotent: Android can deliver more than one detach signal, and two
  /// shutdown records would make the log lie about how many runs happened.
  void stop({bool graceful = true}) {
    if (_shutdownEmitted) return;
    _shutdownEmitted = true;
    final started = _startedAt;
    _logger.shutdown(
      ShutdownRecord(
        sessionDuration:
            started == null ? Duration.zero : _clock.nowUtc().difference(started),
        totalSamplesRecorded: _samplesRecorded,
        totalSamplesDiscarded: _samplesDiscarded,
        exportCount: _exportCount,
        graceful: graceful,
      ),
    );
  }
}
