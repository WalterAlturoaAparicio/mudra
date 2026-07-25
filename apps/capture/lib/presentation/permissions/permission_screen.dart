/// Explains why the camera is needed, and what is (and is not) stored.
///
/// A contributor handing over their camera deserves a straight answer: the app
/// reads hand positions and never saves an image (Principle II).
library;

import 'package:capture/presentation/design/design.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shown when the camera cannot be used, with a way forward.
class PermissionScreen extends ConsumerWidget {
  /// Creates the screen.
  const PermissionScreen({
    required this.failure,
    required this.onRetry,
    super.key,
  });

  /// Why the camera is unavailable.
  final Failure failure;

  /// Called when the user wants to try again.
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isPermission =
        failure is CameraFailure &&
        (failure as CameraFailure).code == 'camera_permission_denied';

    return Scaffold(
      appBar: AppBar(),
      body: Padding(
        padding: Spacing.screen,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(
              isPermission ? Icons.camera_alt_outlined : Icons.videocam_off,
              size: 64,
              color: Colors.white54,
            ),
            const SizedBox(height: Spacing.lg),
            Text(
              failure.message,
              key: const Key('permission-message'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, height: 1.4),
            ),
            const SizedBox(height: Spacing.md),
            const Text(
              'Only hand positions are recorded. No photos or video are ever '
              'saved or sent anywhere.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white60, fontSize: 14),
            ),
            const SizedBox(height: Spacing.xl),
            FilledButton(
              key: const Key('permission-retry'),
              onPressed: onRetry,
              child: const Text('Try again'),
            ),
            if (isPermission) ...[
              const SizedBox(height: Spacing.sm),
              OutlinedButton(
                onPressed: () =>
                    ref.read(cameraPermissionsProvider).openSettings(),
                child: const Text('Open settings'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
