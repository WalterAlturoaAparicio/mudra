/// Composition root.
///
/// Every port is bound here and nowhere else, so a test can replace any
/// collaborator with a fake by overriding one provider (constitution
/// Principle I). Top-level `final` providers are immutable descriptors — the
/// mutable state lives in the `ProviderContainer`, not in a global.
library;

import 'dart:async';

import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/application/camera/capture_settings_notifier.dart';
import 'package:capture/application/capture/run_recording_session.dart';
import 'package:capture/application/capture/session_ticker.dart';
import 'package:capture/application/catalog/pose_progress_notifier.dart';
import 'package:capture/application/export/export_dataset.dart';
import 'package:capture/application/lifecycle/record_app_lifecycle.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/camera/capture_settings.dart';
import 'package:capture/domain/export/manifest.dart' show DeviceInfo;
import 'package:capture/domain/normalization/translation_scale_normalizer.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/samples/pose_sample.dart' show NormalizationInfo;
import 'package:capture/domain/validation/pose_sample_validator.dart';
import 'package:capture/infrastructure/camera/method_channel_camera_source.dart';
import 'package:capture/infrastructure/catalog/asset_pose_catalog_source.dart';
import 'package:capture/infrastructure/export/dataset_integrity_checker.dart';
import 'package:capture/infrastructure/export/manifest_builder.dart';
import 'package:capture/infrastructure/export/zip_dataset_exporter.dart';
import 'package:capture/infrastructure/platform/ambient.dart';
import 'package:capture/infrastructure/platform/platform_adapters.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/infrastructure/storage/file_session_store.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Application configuration.
final configProvider = Provider<CaptureConfig>((ref) => const CaptureConfig());

/// Wall-clock time.
final clockProvider = Provider<Clock>((ref) => const SystemClock());

/// Identity generation.
final uuidFactoryProvider = Provider<UuidFactory>((ref) => UuidV4Factory());

/// Structured logging.
final loggerProvider = Provider<AppLogger>((ref) => const StructuredAppLogger());

/// Landmark normalization, matching the engine's strategy exactly.
final normalizerProvider =
    Provider<LandmarkNormalizer>((ref) => const TranslationScaleNormalizer());

/// Frame validation.
final validatorProvider =
    Provider<SampleValidator>((ref) => const PoseSampleValidator());

/// Application-private storage root; resolved once at startup.
final storageRootProvider = FutureProvider<String>((ref) async {
  final dir = await getApplicationDocumentsDirectory();
  return dir.path;
});

/// Producing application version, e.g. `mudra-capture/0.1.0`.
final applicationVersionProvider = FutureProvider<String>((ref) async {
  final info = await PackageInfo.fromPlatform();
  final version = info.version.isEmpty ? '0.1.0' : info.version;
  return 'mudra-capture/$version';
});

/// Device class information for the manifest and startup record.
final deviceInfoSourceProvider =
    Provider<DeviceInfoSource>((ref) => DeviceInfoSource());

/// Device details, read once.
final deviceInfoProvider = FutureProvider<DeviceInfo>(
  (ref) => ref.watch(deviceInfoSourceProvider).read(),
);

/// Append-only sample storage.
final sampleRepositoryProvider = Provider<SampleRepository>((ref) {
  final root = ref.watch(storageRootProvider).requireValue;
  return FileSampleRepository(rootPath: root, config: ref.watch(configProvider));
});

/// Session records.
final sessionStoreProvider = Provider<SessionStore>((ref) {
  final root = ref.watch(storageRootProvider).requireValue;
  return FileSessionStore(rootPath: root, config: ref.watch(configProvider));
});

/// The pose catalog asset.
final catalogSourceProvider = Provider<PoseCatalogSource>(
  (ref) => AssetPoseCatalogSource(config: ref.watch(configProvider)),
);

/// The platform camera source — a capability that outlives screens.
final cameraSourceProvider = Provider<CameraSource>(
  (ref) => MethodChannelCameraSource(),
);

/// The camera **session**, scoped to the capture screen.
///
/// `autoDispose` on purpose (FR-086/FR-089): the camera is released because
/// ownership ended, not because a `dispose()` override remembered to release it.
/// An app-lifetime provider is exactly what left the device claimed after the
/// capture screen closed before revision R1.
final cameraSessionControllerProvider =
    Provider.autoDispose<CameraSessionController>((ref) {
  final controller = CameraSessionController(
    source: ref.watch(cameraSourceProvider),
    logger: ref.watch(loggerProvider),
    releaseTimeout: ref.watch(configProvider).cameraReleaseTimeout,
  );
  ref.onDispose(() => unawaited(controller.dispose()));
  return controller;
});

/// Mode, lens, countdown, and take-confirmation for the capture session.
///
/// Scoped to the application run, **not** to the capture screen widget: a screen
/// the OS recreates must not reset a user's countdown (FR-071/FR-091), and
/// FR-063's "remember the most recent mode" then needs no extra mechanism.
final captureSettingsProvider =
    NotifierProvider<CaptureSettingsNotifier, CaptureSettings>(
  () => CaptureSettingsNotifier(const CaptureConfig()),
);

/// Which lenses this device actually has (FR-064/FR-069).
final availableLensesProvider = FutureProvider<Set<LensPosition>>(
  (ref) => ref.watch(cameraSourceProvider).availableLenses(),
);

/// Session ticker.
final sessionTickerProvider =
    Provider<SessionTicker>((ref) => const PeriodicSessionTicker());

/// Orientation locking.
final orientationControllerProvider = Provider<SystemOrientationController>((ref) {
  final controller = SystemOrientationController();
  ref.onDispose(controller.dispose);
  return controller;
});

/// Camera permission handling.
final cameraPermissionsProvider =
    Provider<CameraPermissions>((ref) => const CameraPermissions());

/// Share sheet presentation.
final sharePresenterProvider =
    Provider<SharePresenter>((ref) => const SystemSharePresenter());

/// Lifecycle observability (FR-042/FR-043).
final lifecycleProvider = Provider<RecordAppLifecycle>(
  (ref) => RecordAppLifecycle(
    logger: ref.watch(loggerProvider),
    clock: ref.watch(clockProvider),
  ),
);

/// Catalog and progress state.
final catalogProvider =
    AsyncNotifierProvider<PoseCatalogNotifier, CatalogState>(
  PoseCatalogNotifier.new,
);

/// The recording-session use case (one take).
///
/// It no longer takes a camera: the controller owns the camera, and a take is
/// abandoned when the camera goes away rather than the other way round (FR-094).
/// Orientation is likewise not its concern — the capture screen locks it for the
/// whole capture session (FR-049).
final runRecordingSessionProvider = Provider<RunRecordingSession>((ref) {
  return RunRecordingSession(
    validator: ref.watch(validatorProvider),
    normalizer: ref.watch(normalizerProvider),
    repository: ref.watch(sampleRepositoryProvider),
    sessionStore: ref.watch(sessionStoreProvider),
    clock: ref.watch(clockProvider),
    uuidFactory: ref.watch(uuidFactoryProvider),
    config: ref.watch(configProvider),
    logger: ref.watch(loggerProvider),
    applicationVersion: ref.watch(applicationVersionProvider).requireValue,
    ticker: ref.watch(sessionTickerProvider),
  );
});

/// Dataset integrity validation.
final integrityValidatorProvider = Provider<DatasetIntegrityValidator>((ref) {
  return DatasetIntegrityChecker(
    config: ref.watch(configProvider),
    catalog: ref.watch(catalogProvider).valueOrNull?.catalog,
  );
});

/// Export manifest construction.
final manifestBuilderProvider = Provider<DatasetManifestBuilder>((ref) {
  final normalizer = ref.watch(normalizerProvider);
  return ManifestBuilder(
    config: ref.watch(configProvider),
    clock: ref.watch(clockProvider),
    sessionStore: ref.watch(sessionStoreProvider),
    captureVersion: ref.watch(applicationVersionProvider).requireValue,
    platform: ref.watch(deviceInfoSourceProvider).platformName,
    device: ref.watch(deviceInfoProvider).requireValue,
    normalization: NormalizationInfo(
      strategy: normalizer.strategy,
      version: normalizer.version,
    ),
  );
});

/// The dataset exporter.
final datasetExporterProvider = Provider<DatasetExporter>((ref) {
  final root = ref.watch(storageRootProvider).requireValue;
  return ZipDatasetExporter(
    repository: ref.watch(sampleRepositoryProvider),
    validator: ref.watch(integrityValidatorProvider),
    manifestBuilder: ref.watch(manifestBuilderProvider),
    config: ref.watch(configProvider),
    logger: ref.watch(loggerProvider),
    outputDirectoryPath: root,
  );
});

/// The Sync use case.
final exportDatasetProvider = Provider<ExportDataset>((ref) {
  return ExportDataset(
    exporter: ref.watch(datasetExporterProvider),
    sharePresenter: ref.watch(sharePresenterProvider),
    logger: ref.watch(loggerProvider),
    lifecycle: ref.watch(lifecycleProvider),
  );
});
