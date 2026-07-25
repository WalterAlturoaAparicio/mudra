/// Domain ports — the interfaces the rest of the application depends on.
///
/// Implementations live in `infrastructure/` and are injected at the composition
/// root; application and presentation code never imports them directly
/// (constitution Principle I). This is what lets the whole app be tested on the
/// host with no Android device attached.
library;

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/export/manifest.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';

/// What a started landmark source tells the application about itself.
///
/// These values flow straight into sample metadata, so the camera a sample was
/// recorded with is recoverable from the dataset rather than inferred.
class LandmarkSourceSession {
  /// Creates a source session descriptor.
  const LandmarkSourceSession({
    required this.textureId,
    required this.analysisWidth,
    required this.analysisHeight,
    required this.lensFacing,
    required this.mirrored,
    this.previewWidth = 0,
    this.previewHeight = 0,
    this.mediapipeVersion,
  });

  /// Flutter texture id for the preview widget.
  final int textureId;

  /// Preview surface width.
  final int previewWidth;

  /// Preview surface height.
  final int previewHeight;

  /// Analysis frame width the landmarks are normalized against.
  final int analysisWidth;

  /// Analysis frame height the landmarks are normalized against.
  final int analysisHeight;

  /// Platform lens-facing constant; MUST be `1` (front) — see FR-044.
  final int lensFacing;

  /// Whether the preview is mirrored; MUST be `true` — see FR-044.
  final bool mirrored;

  /// Detector version, recorded in sample metadata.
  final String? mediapipeVersion;
}

/// The platform seam: a stream of detected hand landmarks.
///
/// Emits one frame per detection **including frames with zero hands** — the
/// capture session counts those as discarded, so silence must never be used to
/// encode "no hands".
abstract interface class HandLandmarkSource {
  /// Acquires the camera and detector; returns the preview and metadata info.
  Future<LandmarkSourceSession> start();

  /// Frames in non-decreasing timestamp order; drops rather than queues.
  Stream<LandmarkFrame> get frames;

  /// Releases the camera; emits no further frames after it returns.
  Future<void> stop();

  /// Releases all native resources. Idempotent.
  Future<void> dispose();
}

/// Append-only sample storage.
abstract interface class SampleRepository {
  /// Persists one sample, assigning its sequential number.
  Future<SampleRef> save(PoseSample sample);

  /// Persists a whole session's samples in capture order.
  Future<List<SampleRef>> saveAll(List<PoseSample> samples);

  /// Number of samples stored for [poseId].
  Future<int> count(String poseId);

  /// Sample counts for every pose that has any.
  Future<Map<String, int>> countAll();

  /// Absolute path of the dataset root.
  Future<String> datasetRootPath();
}

/// Loads and validates the pose catalog configuration.
abstract interface class PoseCatalogSource {
  /// Returns the validated catalog, or throws `CatalogFailure`.
  Future<PoseCatalog> load();
}

/// Persists session records for the manifest and future analytics.
abstract interface class SessionStore {
  /// Records a session that produced samples. Sessions that wrote nothing are
  /// not recorded, so no orphan identifier reaches the dataset.
  Future<void> record(CaptureSession session);

  /// Every recorded session.
  Future<List<CaptureSession>> all();
}

/// What an export produced.
class ExportResult {
  /// Creates an export result.
  const ExportResult({
    required this.archivePath,
    required this.totalSamples,
    required this.poseCount,
    this.manifest,
  });

  /// Absolute path of the written archive; empty when nothing was exported.
  final String archivePath;

  /// Samples included.
  final int totalSamples;

  /// Distinct poses included.
  final int poseCount;

  /// The manifest written into the archive.
  final DatasetManifest? manifest;

  /// Whether there was nothing to export (FR-036).
  bool get isEmpty => totalSamples == 0;
}

/// Packages the dataset for the engine (the Sync action).
abstract interface class DatasetExporter {
  /// Validates, builds the manifest, and packages the dataset.
  ///
  /// Throws `IntegrityFailure` without producing an archive when a critical
  /// integrity check fails (FR-048).
  Future<ExportResult> export();
}

/// Validates a dataset before it is exported.
abstract interface class DatasetIntegrityValidator {
  /// Inspects the dataset without ever modifying it.
  Future<IntegrityReport> validate(String datasetRootPath);
}

/// Builds the export manifest from what is actually on disk.
abstract interface class DatasetManifestBuilder {
  /// Produces the manifest for the dataset at [datasetRootPath].
  Future<DatasetManifest> build(String datasetRootPath, IntegrityReport report);
}

/// The outcome of validating one captured frame.
class ValidationOutcome {
  /// Creates an accepted outcome.
  const ValidationOutcome.accepted() : reason = null;

  /// Creates a rejected outcome carrying why.
  const ValidationOutcome.rejected(RejectionReason this.reason);

  /// Why the frame was rejected, or `null` when it was accepted.
  final RejectionReason? reason;

  /// Whether the frame may be stored.
  bool get isAccepted => reason == null;
}

/// Decides whether a captured frame may become a sample.
abstract interface class SampleValidator {
  /// Validates [frame] against the rules for [pose].
  ValidationOutcome validate(LandmarkFrame frame, PoseDefinition pose);
}

/// Converts raw landmarks into a comparable, normalized form.
abstract interface class LandmarkNormalizer {
  /// Strategy name stamped into every sample, e.g. `translation_scale`.
  String get strategy;

  /// Strategy version stamped into every sample, e.g. `1.0`.
  String get version;

  /// Returns a normalized copy of [hand]; never mutates its input.
  HandLandmarks normalize(HandLandmarks hand);
}

/// Locks screen orientation for the duration of a capture session (FR-049).
abstract interface class OrientationController {
  /// Fixes the current orientation.
  Future<void> lock();

  /// Restores free rotation. Called on every exit path, including failures.
  Future<void> unlock();

  /// Fires when orientation changes despite the lock (FR-050).
  Stream<void> get unexpectedChanges;
}

/// Wall-clock time, injected so tests are deterministic.
abstract interface class Clock {
  /// The current UTC time.
  DateTime nowUtc();
}

/// Identity generation, injected so tests are deterministic.
abstract interface class UuidFactory {
  /// A fresh UUID v4 string.
  String create();
}

/// Structured startup record (FR-042).
class StartupRecord {
  /// Creates a startup record.
  const StartupRecord({
    required this.applicationVersion,
    required this.configurationProfile,
    required this.datasetRoot,
    required this.catalogSize,
    required this.cameraConfiguration,
    required this.platform,
  });

  /// Producing application version, e.g. `mudra-capture/0.1.0`.
  final String applicationVersion;

  /// Active configuration profile name.
  final String configurationProfile;

  /// Absolute dataset root path.
  final String datasetRoot;

  /// Number of poses in the loaded catalog.
  final int catalogSize;

  /// Camera configuration, e.g. lens facing and mirroring.
  final Map<String, Object?> cameraConfiguration;

  /// Platform and device information.
  final Map<String, Object?> platform;

  /// The structured field map written to the log.
  Map<String, Object?> toFields() => {
    'application_version': applicationVersion,
    'configuration_profile': configurationProfile,
    'dataset_root': datasetRoot,
    'catalog_size': catalogSize,
    'camera_configuration': cameraConfiguration,
    'platform': platform,
  };
}

/// Structured shutdown record (FR-043).
class ShutdownRecord {
  /// Creates a shutdown record.
  const ShutdownRecord({
    required this.sessionDuration,
    required this.totalSamplesRecorded,
    required this.totalSamplesDiscarded,
    required this.exportCount,
    required this.graceful,
  });

  /// How long the application ran.
  final Duration sessionDuration;

  /// Samples recorded across the run.
  final int totalSamplesRecorded;

  /// Frames discarded across the run.
  final int totalSamplesDiscarded;

  /// How many exports completed during the run.
  final int exportCount;

  /// Whether shutdown was graceful.
  final bool graceful;

  /// The structured field map written to the log.
  Map<String, Object?> toFields() => {
    'session_duration_ms': sessionDuration.inMilliseconds,
    'total_samples_recorded': totalSamplesRecorded,
    'total_samples_discarded': totalSamplesDiscarded,
    'export_count': exportCount,
    'graceful': graceful,
  };
}

/// Structured logging.
///
/// Per-frame events are logged at debug only — never info — mirroring the
/// engine's rule against per-frame logging in a real-time loop (Principle V).
abstract interface class AppLogger {
  /// Diagnostic detail, including per-frame events.
  void debug(String message, [Map<String, Object?> fields]);

  /// Notable lifecycle events.
  void info(String message, [Map<String, Object?> fields]);

  /// Failures worth investigating.
  void error(String message, [Map<String, Object?> fields]);

  /// Emits the single structured startup record for this run (FR-042).
  void startup(StartupRecord record);

  /// Emits the single structured shutdown record for this run (FR-043).
  void shutdown(ShutdownRecord record);
}
