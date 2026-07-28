/// Persisted, per-lens display calibration.
///
/// Replaces automatic rotation/mirror inference (the [DisplayOrientation]
/// path, still used only by the coordinate-pipeline diagnostic tool) as the
/// **production** source of truth for how the live preview and the landmark
/// overlay are rendered. Research D23–D25 established, on real hardware,
/// that reasoning about the correct transform from sensor/rotation metadata
/// alone repeatedly failed; D25's manual calibration panel proved a
/// developer sweeping every value by eye can find a combination that
/// actually works. This type is that combination, made permanent: found
/// once per device, persisted, and applied automatically from then on.
///
/// **Preview and overlay are independent transforms**, not derived from one
/// another — the working values found for this hardware use different
/// rotations for each (front: preview 0°, overlay 270°), which rules out any
/// design that ties them together.
///
/// No Flutter import here (constitution Principle I / the `domain/` layer
/// boundary test): [PreviewFit] is a domain-local stand-in for `BoxFit`,
/// translated to the real type only in `presentation/`.
library;

import 'package:capture/domain/camera/camera.dart';

/// How the preview's rotated buffer fits into its display box — a
/// domain-local mirror of `BoxFit`'s three fixed-aspect-ratio members, so
/// this file needs no Flutter import.
enum PreviewFit {
  /// Scales down to fit entirely inside the box, letterboxing/pillarboxing.
  contain('contain'),

  /// Scales up to fill the box entirely, cropping any excess.
  cover('cover'),

  /// Stretches to exactly fill the box, ignoring aspect ratio.
  fill('fill');

  const PreviewFit(this.wireValue);

  /// Stable value for persistence and JSON export/import.
  final String wireValue;

  /// Parses a wire value, falling back to [contain] for anything unknown —
  /// a corrupt or hand-edited calibration file must degrade to a safe
  /// default, never throw and block startup.
  static PreviewFit fromWire(String? value) => PreviewFit.values.firstWhere(
    (fit) => fit.wireValue == value,
    orElse: () => PreviewFit.contain,
  );
}

/// One lens's full display calibration: every transform a renderer needs,
/// for the preview texture and the landmark overlay, independently.
class CameraCalibration {
  /// Creates a calibration, defaulting to the identity transform.
  const CameraCalibration({
    this.previewRotation = 0,
    this.previewMirror = false,
    this.previewFit = PreviewFit.contain,
    this.overlayRotation = 0,
    this.overlayMirror = false,
    this.overlaySwapXY = false,
    this.overlayScale = 1.0,
    this.overlayOffsetX = 0.0,
    this.overlayOffsetY = 0.0,
  });

  /// Clockwise degrees applied to the raw preview buffer — always a
  /// multiple of 90.
  final int previewRotation;

  /// Whether the preview is horizontally flipped, after rotation.
  final bool previewMirror;

  /// How the rotated preview buffer fits into its display box.
  final PreviewFit previewFit;

  /// Clockwise degrees applied to landmark coordinates — always a multiple
  /// of 90, independent of [previewRotation].
  final int overlayRotation;

  /// Whether overlay coordinates are horizontally flipped, after rotation.
  final bool overlayMirror;

  /// Whether landmark x/y are swapped before rotation.
  final bool overlaySwapXY;

  /// Uniform overlay scale about the `(0.5, 0.5)` center, applied after
  /// mirroring.
  final double overlayScale;

  /// Horizontal overlay translation in normalized `[0, 1]` units, applied
  /// last.
  final double overlayOffsetX;

  /// Vertical overlay translation in normalized `[0, 1]` units, applied
  /// last.
  final double overlayOffsetY;

  /// [previewRotation] expressed as `0`–`3` clockwise quarter turns.
  int get previewQuarterTurns => (previewRotation ~/ 90) % 4;

  /// [overlayRotation] expressed as `0`–`3` clockwise quarter turns.
  int get overlayQuarterTurns => (overlayRotation ~/ 90) % 4;

  /// Maps one normalized landmark point through the overlay's fixed
  /// operation order — swap, then rotate, then mirror, then scale, then
  /// translate (research D25; exercised directly by tests, since a
  /// developer must be able to trust these numbers exactly match what the
  /// calibration panel showed them on a device).
  (double, double) mapOverlayPoint(double x, double y) {
    var mx = x;
    var my = y;
    if (overlaySwapXY) {
      final t = mx;
      mx = my;
      my = t;
    }
    var (rx, ry) = switch (overlayQuarterTurns) {
      0 => (mx, my),
      1 => (1 - my, mx),
      2 => (1 - mx, 1 - my),
      3 => (my, 1 - mx),
      _ => (mx, my),
    };
    if (overlayMirror) rx = 1 - rx;
    rx = 0.5 + (rx - 0.5) * overlayScale + overlayOffsetX;
    ry = 0.5 + (ry - 0.5) * overlayScale + overlayOffsetY;
    return (rx, ry);
  }

  /// Returns a copy with the given fields replaced.
  CameraCalibration copyWith({
    int? previewRotation,
    bool? previewMirror,
    PreviewFit? previewFit,
    int? overlayRotation,
    bool? overlayMirror,
    bool? overlaySwapXY,
    double? overlayScale,
    double? overlayOffsetX,
    double? overlayOffsetY,
  }) => CameraCalibration(
    previewRotation: previewRotation ?? this.previewRotation,
    previewMirror: previewMirror ?? this.previewMirror,
    previewFit: previewFit ?? this.previewFit,
    overlayRotation: overlayRotation ?? this.overlayRotation,
    overlayMirror: overlayMirror ?? this.overlayMirror,
    overlaySwapXY: overlaySwapXY ?? this.overlaySwapXY,
    overlayScale: overlayScale ?? this.overlayScale,
    overlayOffsetX: overlayOffsetX ?? this.overlayOffsetX,
    overlayOffsetY: overlayOffsetY ?? this.overlayOffsetY,
  );

  /// The field map persisted and used for JSON export/import.
  Map<String, Object?> toJson() => {
    'previewRotation': previewRotation,
    'previewMirror': previewMirror,
    'previewFit': previewFit.wireValue,
    'overlayRotation': overlayRotation,
    'overlayMirror': overlayMirror,
    'overlaySwapXY': overlaySwapXY,
    'overlayScale': overlayScale,
    'overlayOffsetX': overlayOffsetX,
    'overlayOffsetY': overlayOffsetY,
  };

  /// Parses a calibration from decoded JSON. Missing fields fall back to the
  /// identity transform field-by-field, so a partially hand-edited file
  /// degrades gracefully rather than throwing.
  factory CameraCalibration.fromJson(Map<String, Object?> json) =>
      CameraCalibration(
        previewRotation: (json['previewRotation'] as num?)?.toInt() ?? 0,
        previewMirror: json['previewMirror'] as bool? ?? false,
        previewFit: PreviewFit.fromWire(json['previewFit'] as String?),
        overlayRotation: (json['overlayRotation'] as num?)?.toInt() ?? 0,
        overlayMirror: json['overlayMirror'] as bool? ?? false,
        overlaySwapXY: json['overlaySwapXY'] as bool? ?? false,
        overlayScale: (json['overlayScale'] as num?)?.toDouble() ?? 1.0,
        overlayOffsetX: (json['overlayOffsetX'] as num?)?.toDouble() ?? 0.0,
        overlayOffsetY: (json['overlayOffsetY'] as num?)?.toDouble() ?? 0.0,
      );

  @override
  bool operator ==(Object other) =>
      other is CameraCalibration &&
      other.previewRotation == previewRotation &&
      other.previewMirror == previewMirror &&
      other.previewFit == previewFit &&
      other.overlayRotation == overlayRotation &&
      other.overlayMirror == overlayMirror &&
      other.overlaySwapXY == overlaySwapXY &&
      other.overlayScale == overlayScale &&
      other.overlayOffsetX == overlayOffsetX &&
      other.overlayOffsetY == overlayOffsetY;

  @override
  int get hashCode => Object.hash(
    previewRotation,
    previewMirror,
    previewFit,
    overlayRotation,
    overlayMirror,
    overlaySwapXY,
    overlayScale,
    overlayOffsetX,
    overlayOffsetY,
  );

  @override
  String toString() =>
      'preview(rot=$previewRotation° mirror=$previewMirror '
      'fit=${previewFit.wireValue}) '
      'overlay(rot=$overlayRotation° mirror=$overlayMirror '
      'swapXY=$overlaySwapXY scale=${overlayScale.toStringAsFixed(2)} '
      'dx=${overlayOffsetX.toStringAsFixed(2)} '
      'dy=${overlayOffsetY.toStringAsFixed(2)})';
}

/// Both lenses' calibration, together — what is actually loaded, saved, and
/// exported/imported as one document, so comparing two devices means
/// comparing one file.
class CameraCalibrationSet {
  /// Creates a set from both lenses' calibration.
  const CameraCalibrationSet({required this.front, required this.rear});

  /// The front (user-facing) lens's calibration.
  final CameraCalibration front;

  /// The rear (world-facing) lens's calibration.
  final CameraCalibration rear;

  /// The working values found by hand for the reference device (research
  /// D25's calibration panel), used until a device saves its own —
  /// Objective 1 of the persistent-calibration system.
  static const defaults = CameraCalibrationSet(
    front: CameraCalibration(
      previewRotation: 0,
      previewMirror: false,
      previewFit: PreviewFit.contain,
      overlayRotation: 270,
      overlayMirror: true,
      overlaySwapXY: false,
      overlayScale: 0.75,
    ),
    rear: CameraCalibration(
      previewRotation: 0,
      previewMirror: false,
      previewFit: PreviewFit.contain,
      overlayRotation: 90,
      overlayMirror: true,
      overlaySwapXY: false,
      overlayScale: 0.75,
    ),
  );

  /// This set's calibration for [lens].
  CameraCalibration forLens(LensPosition lens) =>
      lens == LensPosition.front ? front : rear;

  /// Returns a copy with [lens]'s calibration replaced by [calibration].
  CameraCalibrationSet withLens(LensPosition lens, CameraCalibration calibration) =>
      lens == LensPosition.front
          ? CameraCalibrationSet(front: calibration, rear: rear)
          : CameraCalibrationSet(front: front, rear: calibration);

  /// The document persisted and used for JSON export/import.
  Map<String, Object?> toJson() => {'front': front.toJson(), 'rear': rear.toJson()};

  /// Parses a set from decoded JSON. A missing lens falls back to that
  /// lens's default rather than throwing, so an old or hand-edited file
  /// with only one lens still loads.
  factory CameraCalibrationSet.fromJson(Map<String, Object?> json) =>
      CameraCalibrationSet(
        front: json['front'] == null
            ? defaults.front
            : CameraCalibration.fromJson((json['front']! as Map).cast<String, Object?>()),
        rear: json['rear'] == null
            ? defaults.rear
            : CameraCalibration.fromJson((json['rear']! as Map).cast<String, Object?>()),
      );

  @override
  bool operator ==(Object other) =>
      other is CameraCalibrationSet && other.front == front && other.rear == rear;

  @override
  int get hashCode => Object.hash(front, rear);
}
