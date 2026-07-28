/// The camera preview, at the camera's true proportions.
///
/// **Driven entirely by [CameraCalibration], not by [CameraSessionInfo]'s
/// reported rotation.** Research D23–D25 established that inferring the
/// correct rotate/mirror transform from platform-reported rotation and lens
/// facing alone repeatedly failed on real hardware; the persistent
/// per-device calibration system replaces that inference with values a
/// developer found once by eye (or the shipped defaults) and that a device
/// remembers. `CameraSessionInfo` still supplies the raw buffer's shape and
/// the texture handle — everything about *orientation* now comes from
/// [calibration].
///
/// The texture is laid out at its raw (un-rotated) size inside a
/// fixed-size box, rotated via [RotatedBox] (layout-time, not a paint-only
/// `Transform.rotate`, so the leaf actually fills its rotated proportions),
/// mirrored if [CameraCalibration.previewMirror], then the **whole** box is
/// scaled into the available space via [FittedBox] using
/// [CameraCalibration.previewFit] — contain by default, matching the
/// letterboxing/pillarboxing every device already reports as its shipped
/// default (FR-098).
///
/// **Overlays fill the whole preview pane, not just the fitted image
/// sub-rect.** This is a deliberate departure from this widget's pre-
/// calibration contract: [CameraCalibrationScreen] found its working values
/// (rotation, mirror, scale, offset) by sweeping them against an overlay
/// sized to the full pane — reusing that exact geometry here is what makes
/// a calibration found on the panel produce the identical result on the
/// real capture and recognition screens. An overlay that needs to sit
/// exactly over the visible image (rather than the calibrated landmark
/// space) is expected to size and center itself accordingly; most chrome
/// overlays (countdown, capture flash, summary card) are already centered
/// and unaffected by the distinction.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Renders the preview undistorted (per [calibration]'s fit), with overlays
/// filling the same pane.
class PreviewStage extends StatelessWidget {
  /// Creates a preview stage.
  const PreviewStage({
    required this.info,
    required this.calibration,
    this.overlays = const [],
    super.key,
  });

  /// What the live camera session reports; supplies the texture handle and
  /// the raw buffer's shape.
  final CameraSessionInfo info;

  /// This lens's persisted display calibration — the single source every
  /// rotation, mirror, fit, and landmark-mapping decision comes from.
  final CameraCalibration calibration;

  /// Widgets drawn over the whole preview pane, in the same coordinate
  /// space [calibration] maps overlay points into.
  final List<Widget> overlays;

  @override
  Widget build(BuildContext context) {
    final swapped = calibration.previewQuarterTurns.isOdd;
    final rawWidth = swapped ? info.previewHeight : info.previewWidth;
    final rawHeight = swapped ? info.previewWidth : info.previewHeight;
    // Same "degenerate size" fallback the pre-calibration implementation
    // used: a plausible portrait ratio beats a zero-size box, and the
    // fallback is still auditable via the reported (zero) dimensions in the
    // logs.
    final degenerate = rawWidth <= 0 || rawHeight <= 0;
    final displayWidth = (degenerate ? 3 : rawWidth).toDouble();
    final displayHeight = (degenerate ? 4 : rawHeight).toDouble();

    return ColoredBox(
      // The neutral band colour. Visually distinct from any camera image, so a
      // band is never mistakable for part of the picture.
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          FittedBox(
            fit: _toBoxFit(calibration.previewFit),
            child: SizedBox(
              width: displayWidth,
              height: displayHeight,
              child: _OrientedTexture(info: info, calibration: calibration),
            ),
          ),
          ...overlays,
        ],
      ),
    );
  }
}

BoxFit _toBoxFit(PreviewFit fit) => switch (fit) {
  PreviewFit.contain => BoxFit.contain,
  PreviewFit.cover => BoxFit.cover,
  PreviewFit.fill => BoxFit.fill,
};

/// Rotates the raw preview buffer per [CameraCalibration.previewRotation],
/// then mirrors it if [CameraCalibration.previewMirror].
///
/// [RotatedBox] rotates **at layout time**: it hands the `Texture` swapped
/// constraints shaped like the raw buffer, so the leaf fills its true
/// proportions — unlike `Transform.rotate`, which only repaints pixels
/// after layout and would leave the buffer overflowing or letterboxed wrong.
class _OrientedTexture extends StatelessWidget {
  const _OrientedTexture({required this.info, required this.calibration});

  final CameraSessionInfo info;
  final CameraCalibration calibration;

  @override
  Widget build(BuildContext context) {
    final rotated = RotatedBox(
      quarterTurns: calibration.previewQuarterTurns,
      child: Texture(
        key: const Key('camera-preview-texture'),
        textureId: info.textureId,
      ),
    );
    if (!calibration.previewMirror) return rotated;
    return Transform(
      alignment: Alignment.center,
      transform: Matrix4.diagonal3Values(-1.0, 1.0, 1.0),
      child: rotated,
    );
  }
}

/// The preview area before a camera is live: progress, or a failure with a way
/// out.
///
/// Never an indefinite spinner — every state here says what is happening or what
/// to do about it (SC-029).
class PreviewPlaceholder extends StatelessWidget {
  /// Creates a placeholder.
  const PreviewPlaceholder({required this.message, this.action, super.key});

  /// What is happening, in plain language.
  final String message;

  /// An optional way out, shown beneath the message.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: Spacing.screen,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (action == null)
                const CircularProgressIndicator()
              else
                const Icon(Icons.videocam_off, size: 40, color: Colors.white70),
              const SizedBox(height: Spacing.md),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white),
              ),
              if (action != null) ...[
                const SizedBox(height: Spacing.md),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}
