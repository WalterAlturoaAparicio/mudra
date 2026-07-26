/// Failure types.
///
/// Every failure carries a message fit to show a user — the presentation layer
/// renders it, it never re-words it. Technical detail belongs in [debugDetail].
library;

/// Base type for anything that can go wrong in a way the user must see.
sealed class Failure implements Exception {
  /// Creates a failure.
  const Failure(this.message, {this.debugDetail});

  /// Plain-language explanation shown to the user.
  final String message;

  /// Optional technical detail for logs; never shown in the UI.
  final Object? debugDetail;

  @override
  String toString() => '$runtimeType: $message';
}

/// How a camera failure can be resolved.
///
/// Every camera failure carries one, because FR-111 and SC-029 require that no
/// path ends in a dead end: after the cause is resolved, re-entering the capture
/// screen must succeed.
enum CameraRecovery {
  /// Ask for permission again.
  requestPermission,

  /// Send the user to the OS settings page (FR-110).
  openSettings,

  /// Try the same thing again — the cause is transient (FR-108).
  retry,

  /// Use the other lens or the other capture mode (FR-064/FR-069).
  useOtherLens,
}

/// Camera permission, availability, lens, or detector problems.
///
/// A **taxonomy**, not a single type: each variant has a distinct cause, a
/// distinct plain-language explanation, and a distinct route out (FR-107–FR-111).
/// A generic "camera error" would leave the user with nothing to do, which is
/// exactly what SC-029 forbids.
class CameraFailure extends Failure {
  /// Creates a camera failure.
  const CameraFailure(
    super.message, {
    super.debugDetail,
    this.code,
    this.recovery = CameraRecovery.retry,
  });

  /// Platform error code, e.g. `camera_busy`.
  final String? code;

  /// How the user can get out of this state.
  final CameraRecovery recovery;

  /// The user denied camera permission, but can be asked again.
  factory CameraFailure.permissionDenied() => const CameraFailure(
    'Mudra Capture needs the camera to read hand positions. '
    'No photos or video are ever saved.',
    code: 'camera_permission_denied',
    recovery: CameraRecovery.requestPermission,
  );

  /// Permission was denied permanently; only system settings can change it.
  factory CameraFailure.permissionPermanentlyDenied() => const CameraFailure(
    'Camera access is turned off for Mudra Capture. Open system settings to '
    'allow the camera, then come back.',
    code: 'camera_permission_permanently_denied',
    recovery: CameraRecovery.openSettings,
  );

  /// Another application is holding the camera (FR-108).
  factory CameraFailure.busy([Object? detail]) => CameraFailure(
    'Another app is using the camera. Close it and try again.',
    code: 'camera_busy',
    recovery: CameraRecovery.retry,
    debugDetail: detail,
  );

  /// The requested lens is absent or disappeared mid-session.
  ///
  /// The *other* lens, and the mode that uses it, stay fully usable — which is
  /// why this is a distinct variant rather than a generic start failure
  /// (FR-064/FR-069).
  factory CameraFailure.lensUnavailable(String lens, [Object? detail]) =>
      CameraFailure(
        'This device has no $lens camera, so that capture mode is unavailable. '
        'The other mode still works.',
        code: 'lens_unavailable',
        recovery: CameraRecovery.useOtherLens,
        debugDetail: detail,
      );

  /// The hand-detection model could not be loaded.
  factory CameraFailure.detectorUnavailable([Object? detail]) => CameraFailure(
    'Hand detection could not start. Try again.',
    code: 'model_unavailable',
    recovery: CameraRecovery.retry,
    debugDetail: detail,
  );

  /// Any other failure while starting the camera.
  factory CameraFailure.startFailed([Object? detail]) => CameraFailure(
    'The camera could not be started. Try again.',
    code: 'camera_start_failed',
    recovery: CameraRecovery.retry,
    debugDetail: detail,
  );
}

/// Reading or writing the dataset failed.
class RepositoryFailure extends Failure {
  /// Creates a repository failure.
  const RepositoryFailure(super.message, {super.debugDetail});
}

/// The pose catalog asset is missing or malformed — a developer error.
class CatalogFailure extends Failure {
  /// Creates a catalog failure.
  const CatalogFailure(super.message, {super.debugDetail});
}

/// Building or writing the export archive failed.
class ExportFailure extends Failure {
  /// Creates an export failure.
  const ExportFailure(super.message, {super.debugDetail});
}

/// Dataset integrity validation found a critical problem, so no archive was
/// produced (FR-048).
class IntegrityFailure extends Failure {
  /// Creates an integrity failure naming the failed check.
  const IntegrityFailure(super.message, {required this.check, super.debugDetail});

  /// Which integrity check failed, e.g. `duplicate_detection`.
  final String check;
}

/// Orientation changed while a session was running (FR-050).
class OrientationChangedFailure extends Failure {
  /// Creates an orientation failure.
  const OrientationChangedFailure()
      : super(
          'The screen rotated during recording, so the take was discarded. '
          'Nothing was saved — please try again.',
        );
}
