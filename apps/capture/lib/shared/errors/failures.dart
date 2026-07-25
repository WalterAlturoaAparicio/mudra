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

/// Camera permission, availability, configuration, or detector problems.
class CameraFailure extends Failure {
  /// Creates a camera failure.
  const CameraFailure(super.message, {super.debugDetail, this.code});

  /// Platform error code, e.g. `camera_configuration_unsupported`.
  final String? code;

  /// The camera is present but cannot be used in the required configuration
  /// (front-facing and mirrored). Recording is refused rather than done against
  /// an untrusted configuration (FR-044).
  factory CameraFailure.unsupportedConfiguration(String detail) =>
      CameraFailure(
        'This device cannot record with a mirrored front camera, so hand '
        'labels could not be trusted. Recording is disabled.',
        code: 'camera_configuration_unsupported',
        debugDetail: detail,
      );

  /// The user denied camera permission.
  factory CameraFailure.permissionDenied() => const CameraFailure(
    'Mudra Capture needs the camera to read hand positions. '
    'No photos or video are ever saved.',
    code: 'camera_permission_denied',
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
