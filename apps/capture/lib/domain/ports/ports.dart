/// Domain ports — the interfaces the rest of the application depends on.
///
/// Implementations live in `infrastructure/` and are injected at the composition
/// root; application and presentation code never imports them directly
/// (constitution Principle I). This is what lets the whole app be tested on the
/// host with no Android device attached.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/export/manifest.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/domain/samples/pose_sample.dart';

/// The platform seam, part one: a camera **capability** that outlives screens.
///
/// Expressed entirely in lens position, preview dimensions, mirroring, and
/// lifecycle — never in a specific platform's camera API (FR-112). An
/// alternative platform is added by supplying one implementation of this and
/// [CameraSession], with no edits to recording, dataset, or presentation logic
/// (FR-114).
abstract interface class CameraSource {
  /// Which lenses this device can actually provide.
  ///
  /// Absence is **data, not an error**: an unavailable capture mode must be
  /// disabled with a stated reason before a user taps it (FR-064/FR-069), not
  /// fail at the moment of use.
  Future<Set<LensPosition>> availableLenses();

  /// Acquires the camera and detector for [request].
  ///
  /// Binds the **requested** lens explicitly — never a platform default, never a
  /// substitution (FR-044) — following a single ordered path whose every step
  /// fails distinctly (FR-107). Throws `CameraFailure` on any failure.
  Future<CameraSession> open(CameraRequest request);
}

/// The platform seam, part two: one live acquisition of the camera.
///
/// A **source** is a capability; a **session** is a resource with a birth and a
/// death. That distinction is the whole point: [close] is the only terminal
/// operation, so a session cannot be left half-released — the state the
/// pre-revision `stop`/`dispose` split made representable, and therefore
/// eventually real (FR-086).
abstract interface class CameraSession {
  /// What this session reports about itself; drives the preview and metadata.
  CameraSessionInfo get info;

  /// Frames in non-decreasing timestamp order; drops rather than queues.
  ///
  /// Emits one frame per detection **including frames with zero hands** — a
  /// recording session counts those as discarded, so silence must never be used
  /// to encode "no hands".
  Stream<LandmarkFrame> get frames;

  /// Releases **everything** this session acquired.
  ///
  /// Camera binding, preview surface, analysis stream, detector, and any
  /// background worker. Idempotent, and completes even when the preceding open
  /// failed partway (FR-095). After it returns, another application must be able
  /// to acquire the camera immediately (FR-087).
  Future<void> close();
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

  /// Reads every currently-stored sample for [poseId], in numeric filename
  /// order.
  ///
  /// Read-only: callers that only ever call this (never [save]/[saveAll]) are
  /// exactly the read-only consumers Phase 2.75's recognition preview requires
  /// (FR-004) — [ExemplarSource] is one.
  Future<List<PoseSample>> readAll(String poseId);
}

/// Loads and validates the pose catalog configuration.
abstract interface class PoseCatalogSource {
  /// Returns the validated catalog, or throws `CatalogFailure`.
  Future<PoseCatalog> load();
}

/// Persists the developer camera-calibration panel's per-lens state
/// (spec 003's persistent calibration system), so a device remembers its own
/// values across restarts without any code change.
abstract interface class CalibrationStore {
  /// Loads the persisted calibration set, or `null` if this device has never
  /// saved one — the caller falls back to [CameraCalibrationSet.defaults].
  Future<CameraCalibrationSet?> load();

  /// Persists [calibrationSet], overwriting whatever was saved before.
  Future<void> save(CameraCalibrationSet calibrationSet);
}

/// Persists session records for the manifest and future analytics.
abstract interface class SessionStore {
  /// Records a session that produced samples. Sessions that wrote nothing are
  /// not recorded, so no orphan identifier reaches the dataset.
  Future<void> record(RecordingSession session);

  /// Every recorded session.
  Future<List<RecordingSession>> all();
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

/// The recognition strategy, pluggable (Principle III's first realization).
///
/// Scores [frame]'s hands against [exemplarsByPose], returning one
/// [Candidate] per eligible pose, unsorted and with a raw [Candidate.distance]
/// only — confidence is derived one layer up, once every eligible candidate's
/// distance is known (data-model.md's pipeline).
///
/// A pose is eligible only when [frame] carries at least the hand count
/// [catalog] declares that pose requires (FR-009). Pure and deterministic: the
/// same frame and the same exemplar set always produce the same candidates.
/// Never mutates its inputs; never retains state across calls — that is
/// `StabilityState`'s job, one layer up.
abstract interface class PoseMatcher {
  /// Scores one frame against the current exemplar set.
  List<Candidate> score(
    LandmarkFrame frame,
    Map<String, List<Exemplar>> exemplarsByPose,
    PoseCatalog catalog,
  );
}

/// What one exemplar load produced: the exemplars themselves, grouped by
/// pose, plus the per-pose readiness that load already computed for free
/// (research D10) — one full read, not two.
class ExemplarLoadResult {
  /// Creates a load result.
  const ExemplarLoadResult({
    required this.exemplarsByPose,
    required this.readiness,
  });

  /// Exemplars for poses that meet the minimum sample threshold, keyed by
  /// `pose_id`. A pose below threshold has no key here at all (FR-006).
  final Map<String, List<Exemplar>> exemplarsByPose;

  /// Every catalog pose's readiness, ready or not.
  final CatalogReadiness readiness;
}

/// Read-only access to the existing dataset, for building exemplars.
abstract interface class ExemplarSource {
  /// Reads every currently-stored sample and returns one [Exemplar] per
  /// sample-hand, grouped by pose, alongside [CatalogReadiness] (FR-004,
  /// FR-005, FR-006, FR-024).
  ///
  /// Read-only — MUST NOT write, delete, or modify any sample or session
  /// record. Called once per screen entry (research D6); nothing is cached
  /// across app restarts.
  Future<ExemplarLoadResult> load();
}

/// Data-driven effect definitions (FR-019/FR-020).
abstract interface class EffectCatalogSource {
  /// Returns the effect for [poseId], or the generic fallback if none is
  /// authored — never null, so callers never branch on absence.
  EffectDefinition effectFor(String poseId);
}
