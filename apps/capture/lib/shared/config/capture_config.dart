/// Centralized, typed configuration.
///
/// Every tunable value lives here so nothing is hardcoded at a call site
/// (constitution Principle V). The pose catalog is the other half of the
/// configuration story and lives in `assets/config/pose_catalog.json`.
library;

/// All tunable values for the capture application.
class CaptureConfig {
  /// Creates a configuration, using the documented defaults for anything unset.
  const CaptureConfig({
    this.profile = 'default',
    this.countdownSeconds = 3.0,
    this.captureWindowSeconds = 1.0,
    this.defaultTargetSampleCount = 500,
    this.defaultRequiredHands = 1,
    this.datasetRoot = 'datasets',
    this.posesDirname = 'poses',
    this.sessionsFileName = 'sessions.json',
    this.filenamePrefix = 'sample_',
    this.filenameDigits = 6,
    this.jsonIndent = 2,
    this.exportFileName = 'mudra_capture_export.zip',
    this.manifestFileName = 'manifest.json',
    this.maxSamplesPerSession = 120,
    this.lockOrientationDuringSession = true,
    this.computeChecksums = true,
    this.tickIntervalMillis = 50,
  });

  /// Name of this configuration profile, reported in the startup record.
  final String profile;

  /// Countdown length before capture begins (FR-010).
  final double countdownSeconds;

  /// Automatic capture window length (FR-014).
  final double captureWindowSeconds;

  /// Fallback target when a catalog entry omits one.
  final int defaultTargetSampleCount;

  /// Fallback required hand count when a catalog entry omits one.
  final int defaultRequiredHands;

  /// Dataset root directory name, mirroring the engine's layout.
  final String datasetRoot;

  /// Sub-directory holding per-pose sample collections.
  final String posesDirname;

  /// File holding session records, stored outside the poses tree.
  final String sessionsFileName;

  /// Sample filename prefix.
  final String filenamePrefix;

  /// Zero-padded width of the sample number.
  final int filenameDigits;

  /// Indentation for written JSON — human-readable by contract.
  final int jsonIndent;

  /// Name of the produced archive.
  final String exportFileName;

  /// Name of the manifest inside the archive (FR-047).
  final String manifestFileName;

  /// Safety bound on samples buffered in one session (FR-051).
  final int maxSamplesPerSession;

  /// Whether to lock orientation for the duration of a session (FR-049).
  final bool lockOrientationDuringSession;

  /// Whether to compute per-collection checksums for the manifest.
  final bool computeChecksums;

  /// How often the session state machine advances, in milliseconds. Small
  /// enough for a smooth countdown, large enough not to compete with the
  /// detector for the frame budget.
  final int tickIntervalMillis;

  /// Session tick interval as a [Duration].
  Duration get tickInterval => Duration(milliseconds: tickIntervalMillis);

  /// Countdown length as a [Duration].
  Duration get countdown =>
      Duration(microseconds: (countdownSeconds * 1000000).round());

  /// Capture window as a [Duration].
  Duration get captureWindow =>
      Duration(microseconds: (captureWindowSeconds * 1000000).round());

  /// Formats [number] as a zero-padded sample stem, e.g. `sample_000023`.
  String sampleStem(int number) =>
      '$filenamePrefix${number.toString().padLeft(filenameDigits, '0')}';
}
