/// Centralized, typed configuration.
///
/// Every tunable value lives here so nothing is hardcoded at a call site
/// (constitution Principle V). The pose catalog is the other half of the
/// configuration story and lives in `assets/config/pose_catalog.json`.
library;

import 'package:capture/domain/camera/camera.dart';

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
    this.calibrationFileName = 'calibration.json',
    this.filenamePrefix = 'sample_',
    this.filenameDigits = 6,
    this.jsonIndent = 2,
    this.exportFileName = 'mudra_capture_export.zip',
    this.manifestFileName = 'manifest.json',
    this.maxSamplesPerSession = 120,
    this.lockOrientationOnCaptureScreen = true,
    this.computeChecksums = true,
    this.tickIntervalMillis = 50,
    this.analysisWidth = 480,
    this.analysisHeight = 640,
    this.defaultConfirmTakes = true,
    this.cameraReleaseTimeoutMillis = 1000,
    this.selfCaptureProfile = const CaptureProfile(
      defaultLens: LensPosition.front,
      countdownEnabled: true,
      countdownSeconds: 3.0,
    ),
    this.operatorCaptureProfile = const CaptureProfile(
      defaultLens: LensPosition.rear,
      countdownEnabled: false,
      countdownSeconds: 3.0,
    ),
  });

  /// Name of this configuration profile, reported in the startup record.
  final String profile;

  /// Countdown length when enabled (FR-010); the Self Capture profile's value.
  final double countdownSeconds;

  /// Self Capture defaults: front lens, mirrored, countdown on at 3 s (FR-060).
  final CaptureProfile selfCaptureProfile;

  /// Operator Capture defaults: rear lens, unmirrored, countdown off (FR-061).
  final CaptureProfile operatorCaptureProfile;

  /// Whether each completed take pauses for review by default (FR-077).
  final bool defaultConfirmTakes;

  /// Requested analysis frame width — the resolution landmarks are computed at.
  final int analysisWidth;

  /// Requested analysis frame height.
  final int analysisHeight;

  /// Budget for a full camera release, in milliseconds (SC-019).
  ///
  /// Exceeding it is logged at error rather than swallowed: a release that took
  /// too long is the first symptom of the leak this revision exists to fix.
  final int cameraReleaseTimeoutMillis;

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

  /// File holding the developer camera-calibration panel's per-lens state.
  ///
  /// Stored at the storage root, a sibling of [datasetRoot] rather than
  /// inside it — display calibration is not dataset content, and must never
  /// be swept into export scanning or integrity validation.
  final String calibrationFileName;

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

  /// Safety bound on samples buffered in one take (FR-051).
  final int maxSamplesPerSession;

  /// Whether to lock orientation for the whole **capture session** (FR-049).
  ///
  /// Locked on entering the capture screen, restored on leaving — **not** per
  /// take. The narrower per-take scope this replaced would let the device rotate
  /// between takes now that the screen persists, silently changing both the
  /// preview's aspect ratio and the frame geometry a sample's coordinates depend
  /// on.
  final bool lockOrientationOnCaptureScreen;

  /// Whether to compute per-collection checksums for the manifest.
  final bool computeChecksums;

  /// How often the session state machine advances, in milliseconds. Small
  /// enough for a smooth countdown, large enough not to compete with the
  /// detector for the frame budget.
  final int tickIntervalMillis;

  /// Session tick interval as a [Duration].
  Duration get tickInterval => Duration(milliseconds: tickIntervalMillis);

  /// Camera release budget as a [Duration].
  Duration get cameraReleaseTimeout =>
      Duration(milliseconds: cameraReleaseTimeoutMillis);

  /// The defaults [mode] establishes at capture-session initialization.
  CaptureProfile profileFor(CaptureMode mode) => switch (mode) {
    CaptureMode.selfCapture => selfCaptureProfile,
    CaptureMode.operatorCapture => operatorCaptureProfile,
  };

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
