/// The camera preview, at the camera's true proportions.
///
/// `Texture` is a leaf widget: it fills whatever constraints it is given. Inside
/// a `Stack(fit: StackFit.expand)` — what this replaces — it therefore stretches
/// to the screen, which is the distortion FR-097 forbids.
///
/// Wrapping it in an [AspectRatio] inside a [Center] produces letterboxing or
/// pillarboxing as a **consequence of layout** (FR-098): no branching on which
/// dimension is constrained, and no way to get one orientation right and the
/// other wrong. The neutral bands are simply the container's own background.
///
/// Overlays are children of the *same* [AspectRatio] box, which is what makes
/// FR-101's alignment structural rather than a coordinate calculation somebody
/// has to keep correct as the layout evolves.
///
/// The ratio comes from the dimensions the camera **actually reported** for the
/// running session (FR-099), never from a constant — and those are already
/// rotation-adjusted for display by the platform side.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Renders the preview undistorted, centered, with overlays aligned to it.
class PreviewStage extends StatelessWidget {
  /// Creates a preview stage.
  const PreviewStage({
    required this.info,
    this.overlays = const [],
    super.key,
  });

  /// What the live camera session reports; supplies the aspect ratio.
  final CameraSessionInfo info;

  /// Widgets drawn over the visible image area, never over the bands.
  final List<Widget> overlays;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      // The neutral band colour. Visually distinct from any camera image, so a
      // band is never mistakable for part of the picture.
      color: Colors.black,
      child: Center(
        child: AspectRatio(
          aspectRatio: info.previewAspect,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Texture(
                key: const Key('camera-preview-texture'),
                textureId: info.textureId,
              ),
              ...overlays,
            ],
          ),
        ),
      ),
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
