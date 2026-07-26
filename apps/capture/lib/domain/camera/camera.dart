/// Camera domain vocabulary.
///
/// Everything the application knows about a camera, expressed **without naming a
/// platform** (FR-112): lens position, preview dimensions, mirroring, lifecycle.
/// No type here mentions CameraX, AVFoundation, or a texture backend, which is
/// what lets a second platform be added by supplying one implementation
/// (FR-114).
///
/// Nothing here imports Flutter, plugins, or `dart:io`.
library;

/// Which physical camera is in use.
enum LensPosition {
  /// The lens facing the user.
  front('front'),

  /// The lens facing away from the user.
  rear('rear');

  const LensPosition(this.wireValue);

  /// Value stored in `metadata.camera.position` (FR-081).
  final String wireValue;

  /// The other lens — used by the switch control (FR-065).
  LensPosition get opposite =>
      this == LensPosition.front ? LensPosition.rear : LensPosition.front;

  /// The viewing convention this lens produces by default.
  ///
  /// A session reports what it *actually* produced rather than what the lens
  /// implies, so this is a default rather than a rule.
  ViewConvention get defaultConvention => this == LensPosition.front
      ? ViewConvention.canonical
      : ViewConvention.unmirrored;

  /// Parses a wire value; unknown values throw, because a lens the application
  /// cannot name is a contract violation, not a recoverable condition.
  static LensPosition fromWire(String value) => switch (value) {
    'front' => LensPosition.front,
    'rear' => LensPosition.rear,
    _ => throw ArgumentError.value(value, 'value', 'Unknown lens position'),
  };
}

/// Which mirroring convention a set of landmark coordinates is expressed in.
///
/// The names describe the **convention**, not the lens, so a future platform
/// that mirrors differently needs no new vocabulary.
enum ViewConvention {
  /// The mirrored front-camera view every stored sample uses (FR-053).
  canonical,

  /// What a rear lens produces; converted before storage.
  unmirrored;

  /// Whether the preview shown to the person posing is mirrored (FR-082).
  bool get isMirrored => this == ViewConvention.canonical;
}

/// A named preset of capture defaults.
enum CaptureMode {
  /// Recording yourself: front lens, mirrored, countdown on.
  selfCapture('self_capture', 'Self Capture'),

  /// Recording someone else: rear lens, unmirrored, countdown off.
  operatorCapture('operator_capture', 'Operator Capture');

  const CaptureMode(this.wireValue, this.displayName);

  /// Stable value for logs and diagnostics.
  final String wireValue;

  /// Human-facing label.
  final String displayName;
}

/// The defaults a [CaptureMode] establishes.
///
/// A profile establishes values **once**, at capture-session initialization —
/// entering the capture screen or changing mode (FR-071). It is not a live rule:
/// after initialization the values belong to `CaptureSettings`, and re-entering
/// the screen with the same mode does not re-apply the profile.
class CaptureProfile {
  /// Creates a capture profile.
  const CaptureProfile({
    required this.defaultLens,
    required this.countdownEnabled,
    required this.countdownSeconds,
  });

  /// The lens this mode starts with.
  final LensPosition defaultLens;

  /// Whether a countdown precedes a take by default.
  final bool countdownEnabled;

  /// Countdown length in seconds when enabled.
  final double countdownSeconds;

  @override
  bool operator ==(Object other) =>
      other is CaptureProfile &&
      other.defaultLens == defaultLens &&
      other.countdownEnabled == countdownEnabled &&
      other.countdownSeconds == countdownSeconds;

  @override
  int get hashCode =>
      Object.hash(defaultLens, countdownEnabled, countdownSeconds);
}

/// What the application asks a camera for.
///
/// Mirroring is a property of the lens, not a request, so it is deliberately
/// absent (FR-067).
class CameraRequest {
  /// Creates a camera request.
  const CameraRequest({
    required this.lens,
    required this.analysisWidth,
    required this.analysisHeight,
  });

  /// Which lens to bind — explicit, never a platform default (FR-044).
  final LensPosition lens;

  /// Requested analysis frame width.
  final int analysisWidth;

  /// Requested analysis frame height.
  final int analysisHeight;

  @override
  bool operator ==(Object other) =>
      other is CameraRequest &&
      other.lens == lens &&
      other.analysisWidth == analysisWidth &&
      other.analysisHeight == analysisHeight;

  @override
  int get hashCode => Object.hash(lens, analysisWidth, analysisHeight);
}

/// What a live camera reports about itself.
///
/// Every field either drives the preview or lands in sample metadata.
class CameraSessionInfo {
  /// Creates a camera session descriptor.
  const CameraSessionInfo({
    required this.textureId,
    required this.previewWidth,
    required this.previewHeight,
    required this.analysisWidth,
    required this.analysisHeight,
    required this.lens,
    required this.convention,
    required this.platformLensId,
    this.rotationDegrees = 0,
    this.detectorVersion,
  });

  /// Preview surface handle.
  final int textureId;

  /// **Display-oriented** preview width — the source of the aspect ratio.
  final int previewWidth;

  /// **Display-oriented** preview height — the source of the aspect ratio.
  final int previewHeight;

  /// Analysis frame width landmarks are normalized against.
  final int analysisWidth;

  /// Analysis frame height landmarks are normalized against.
  final int analysisHeight;

  /// Which lens produced this session (FR-081).
  final LensPosition lens;

  /// The convention this session's frames are actually in.
  final ViewConvention convention;

  /// The platform's own lens identifier, preserved verbatim (FR-084).
  final int platformLensId;

  /// Rotation the platform applied to reach display orientation.
  ///
  /// Reported so [previewWidth]/[previewHeight] are auditable rather than
  /// inferred.
  final int rotationDegrees;

  /// Detector version, written into `metadata.versions.mediapipe`.
  final String? detectorVersion;

  /// Whether the preview shown to the person posing is mirrored (FR-082).
  bool get mirroredPreview => convention.isMirrored;

  /// Preview aspect ratio, used to letterbox or pillarbox (FR-097–FR-099).
  ///
  /// Falls back to `3 / 4` if the platform reported a degenerate size — a
  /// plausible portrait preview is better than a division by zero, and the
  /// fallback is visible in the logs via the reported dimensions.
  double get previewAspect {
    if (previewWidth <= 0 || previewHeight <= 0) return 3 / 4;
    return previewWidth / previewHeight;
  }

  /// The descriptive record attached to samples taken during this session.
  ///
  /// [countdownEnabled] comes from the live capture settings, not from the
  /// camera — the camera does not know whether a countdown ran.
  CameraMetadata metadataWith({required bool countdownEnabled}) =>
      CameraMetadata(
        position: lens,
        mirroredPreview: mirroredPreview,
        platformLensId: platformLensId,
        countdownEnabled: countdownEnabled,
      );
}

/// The descriptive camera record attached to every stored sample.
///
/// Additive to the engine's schema v1 and never contains pixel data (FR-085,
/// Principle II).
///
/// **Invariant (FR-058)**: this reports what was **used**, never what was
/// stored. A rear-lens sample converted into the canonical convention still
/// reports [position] `rear` and [mirroredPreview] `false` — that is what makes
/// the conversion auditable instead of invisible.
class CameraMetadata {
  /// Creates a camera metadata record.
  const CameraMetadata({
    required this.position,
    required this.mirroredPreview,
    required this.platformLensId,
    required this.countdownEnabled,
  });

  /// Which lens was used (FR-081).
  final LensPosition position;

  /// Whether the person posing saw a mirrored image (FR-082).
  final bool mirroredPreview;

  /// The platform's lens identifier, verbatim (FR-084).
  final int platformLensId;

  /// Whether a countdown preceded this take (FR-083).
  final bool countdownEnabled;

  @override
  bool operator ==(Object other) =>
      other is CameraMetadata &&
      other.position == position &&
      other.mirroredPreview == mirroredPreview &&
      other.platformLensId == platformLensId &&
      other.countdownEnabled == countdownEnabled;

  @override
  int get hashCode =>
      Object.hash(position, mirroredPreview, platformLensId, countdownEnabled);
}

/// Why a camera session was released.
///
/// Every release records its reason in the structured `camera_released` event
/// (FR-096). A leak in the field shows up as an acquire with no matching
/// release, which is only actionable when the releases say why they happened.
enum CameraReleaseReason {
  /// The user left the capture screen.
  screenLeft('screen_left'),

  /// The application went to the background or the screen locked.
  backgrounded('backgrounded'),

  /// The user switched lenses.
  lensSwitch('lens_switch'),

  /// The user changed capture mode.
  modeChange('mode_change'),

  /// A newer request superseded the one that opened this session.
  superseded('superseded'),

  /// The camera or detector failed.
  error('error'),

  /// The application is shutting down.
  shutdown('shutdown');

  const CameraReleaseReason(this.wireValue);

  /// Stable value for structured logs.
  final String wireValue;

  /// Whether an in-flight take ended because of a user action it implies.
  ///
  /// Drives the "nothing was saved" message: a lens switch or mode change is
  /// something the user did and should be told about (FR-068), while
  /// backgrounding needs no explanation on return.
  bool get needsUserExplanation =>
      this == CameraReleaseReason.lensSwitch ||
      this == CameraReleaseReason.modeChange;
}
