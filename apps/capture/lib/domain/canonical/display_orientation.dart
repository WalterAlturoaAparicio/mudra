/// The transform from **analysis space** to **display space** — the single
/// place both facts a renderer needs are decided, so a preview widget and a
/// landmark overlay can never disagree about where a point belongs.
///
/// ## Coordinate spaces
///
/// - **Analysis space**: what [LandmarkFrame]'s `x`/`y` are normalized
///   against — [LandmarkFrame.frameWidth]/[LandmarkFrame.frameHeight], the
///   raw buffer the camera sensor delivered, before any rotation. This is
///   also what the camera's raw preview buffer is shaped like.
/// - **Display space**: what actually appears on screen — the preview
///   widget's box, and the space every renderer (the debug overlay, the
///   recognition effect anchor) must draw into.
///
/// ## Root cause this exists to fix
///
/// Before this type existed, nothing computed the analysis→display
/// transform in one place, so the preview and any overlay drifted apart in
/// two independent ways:
///
/// 1. **Rotation was decided twice, inconsistently.** The platform computed
///    a rotation guess from *screen* rotation alone (ignoring sensor
///    orientation and lens facing) and used it only to relabel
///    `previewWidth`/`previewHeight` for the aspect ratio — never to rotate
///    the actual preview buffer, and never applied to landmark coordinates
///    at all. Landmarks stayed in raw sensor-orientation space while the box
///    they were painted into was sized by a differently-rotated number.
/// 2. **Mirroring was applied to the wrong stream.** The only mirror
///    transform in the app is [CanonicalViewConverter] (`x' = 1-x` for the
///    rear lens), a **dataset-storage** convention — "every stored sample
///    looks like the mirrored front camera" — applied unconditionally to
///    [CameraSessionController.frames]. Reusing that stream for on-screen
///    rendering mirrored the rear lens's landmarks (to match storage
///    convention) while nothing ever mirrored the rear lens's actual preview
///    pixels (correctly — a rear camera should not be mirrored for display).
///    The two lenses' *display* mirroring truth is simply
///    `mirrored == (lens == front)`, already carried on
///    [CameraSessionInfo.mirroredPreview] — this type uses exactly that,
///    never the canonicalized stream.
///
/// [PreviewStage] consumes this to orient/mirror the `Texture` widget itself;
/// `HandLandmarkPainter` and the recognition effect anchor consume it to map
/// **raw** (uncanonicalized) landmark coordinates into that same box.
/// Recording and recognition matching are entirely untouched by this file —
/// they keep consuming the canonical stream exactly as before, because
/// canonicalization and display orientation answer two different questions.
library;

import 'package:capture/domain/camera/camera.dart';

/// One `[0, 1]` point, in whichever space it is documented to be in.
typedef NormalizedPoint = (double x, double y);

/// One `(width, height)` size, in whichever space it is documented to be in.
typedef PixelSize = (int width, int height);

/// The rotate-then-mirror transform from analysis space to display space for
/// one live camera session.
///
/// Immutable and derived once per session from [CameraSessionInfo] — the
/// same session every consumer (preview, overlay, effect anchor) already
/// holds, so there is exactly one instance in play at a time and no way for
/// two renderers to compute a different answer.
class DisplayOrientation {
  /// Creates a transform from already-validated components.
  ///
  /// Prefer [DisplayOrientation.fromSession] outside tests.
  const DisplayOrientation({required this.quarterTurns, required this.mirrored});

  /// Derives the transform from a live session's report.
  ///
  /// Throws if the platform reports a rotation this application does not
  /// recognize — a device orientation is always a multiple of 90°; anything
  /// else is a contract violation from the platform channel, not a value to
  /// silently coerce (the same "unknown values throw" discipline
  /// [LensPosition.fromWire] already applies).
  factory DisplayOrientation.fromSession(CameraSessionInfo info) =>
      DisplayOrientation(
        quarterTurns: _quarterTurnsFrom(info.rotationDegrees),
        mirrored: info.mirroredPreview,
      );

  /// How many 90° **clockwise** turns separate analysis space from display
  /// space. Always `0`, `1`, `2`, or `3`.
  final int quarterTurns;

  /// Whether display space additionally mirrors horizontally, applied
  /// **after** the rotation above — matching
  /// [CameraSessionInfo.mirroredPreview], the same flag [PreviewStage] uses
  /// to decide whether to flip the `Texture` widget.
  final bool mirrored;

  static int _quarterTurnsFrom(int rotationDegrees) => switch (rotationDegrees) {
    0 => 0,
    90 => 1,
    180 => 2,
    270 => 3,
    _ => throw ArgumentError.value(
      rotationDegrees,
      'rotationDegrees',
      'A device rotation is always 0, 90, 180, or 270 degrees.',
    ),
  };

  /// Maps one normalized analysis-space point to normalized display space.
  ///
  /// Rotation first, mirroring second — the same order [PreviewStage]
  /// applies to the `Texture` widget (rotate the raw buffer into display
  /// orientation, then flip it), so a point computed here and a pixel
  /// painted there always describe the same physical location.
  ///
  /// The four rotation cases are the standard image-rotation formulas for a
  /// point normalized to `[0, 1]` in each axis (derived from rotating pixel
  /// coordinates `(px, py)` in a `W×H` image by clockwise quarter turns,
  /// then normalizing): a point that was near the analysis frame's left edge
  /// ends up near display space's top edge after one clockwise turn, and so
  /// on. No trigonometry and no magic constants — only the four fixed
  /// permutations a quarter turn can produce.
  NormalizedPoint mapPoint(double x, double y) {
    final (rx, ry) = switch (quarterTurns) {
      0 => (x, y),
      1 => (1 - y, x), // 90° clockwise
      2 => (1 - x, 1 - y), // 180°
      3 => (y, 1 - x), // 270° clockwise (90° counter-clockwise)
      _ => (x, y), // unreachable: quarterTurns is always 0..3
    };
    return mirrored ? (1 - rx, ry) : (rx, ry);
  }

  /// Maps an analysis-space `[width, height]` to its display-space shape.
  ///
  /// Odd quarter turns swap the axes — a `W×H` buffer rotated 90° or 270°
  /// occupies an `H×W` box on screen.
  PixelSize mapSize(int width, int height) =>
      quarterTurns.isOdd ? (height, width) : (width, height);

  @override
  bool operator ==(Object other) =>
      other is DisplayOrientation &&
      other.quarterTurns == quarterTurns &&
      other.mirrored == mirrored;

  @override
  int get hashCode => Object.hash(quarterTurns, mirrored);

  @override
  String toString() =>
      'DisplayOrientation(quarterTurns: $quarterTurns, mirrored: $mirrored)';
}
