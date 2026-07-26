/// Mudra Capture — application entry point and composition root.
///
/// Boots configuration, storage, and the pose catalog, emits the structured
/// startup record Principle V requires (FR-042), and hands control to the home
/// screen. Nothing here contains business logic; it only wires collaborators.
library;

import 'dart:async';

import 'package:capture/application/catalog/pose_progress_notifier.dart';
import 'package:capture/infrastructure/platform/platform_adapters.dart'
    show lockAppOrientation;
import 'package:capture/presentation/design/design.dart';
import 'package:capture/presentation/home/home_screen.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait-only, on every screen — not only the capture session's own,
  // stricter lock (FR-049). No page's layout is designed for landscape.
  await lockAppOrientation();

  final container = ProviderContainer();

  // Resolve what every other provider depends on before the first frame, so no
  // screen has to cope with a half-initialized application.
  await container.read(storageRootProvider.future);
  await container.read(applicationVersionProvider.future);
  await container.read(deviceInfoProvider.future);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const MudraCaptureApp(),
    ),
  );
}

/// The application shell.
class MudraCaptureApp extends ConsumerStatefulWidget {
  /// Creates the shell.
  const MudraCaptureApp({super.key});

  @override
  ConsumerState<MudraCaptureApp> createState() => _MudraCaptureAppState();
}

class _MudraCaptureAppState extends ConsumerState<MudraCaptureApp>
    with WidgetsBindingObserver {
  bool _startupEmitted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    // FR-043: the shutdown record reports what this run actually produced.
    ref.read(lifecycleProvider).stop();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      ref.read(lifecycleProvider).stop();
    }
  }

  @override
  void didChangeMetrics() {
    // Feeds the orientation guard: a rotation while a session is running must
    // abort it rather than silently changing the frame geometry (FR-050).
    final view = WidgetsBinding.instance.platformDispatcher.implicitView;
    if (view == null) return;
    final size = view.physicalSize;
    ref.read(orientationControllerProvider).onOrientationChanged(
          size.width > size.height
              ? Orientation.landscape
              : Orientation.portrait,
        );
  }

  @override
  Widget build(BuildContext context) {
    // The startup record needs the catalog size, so it is emitted once the
    // catalog resolves rather than blindly at boot.
    ref.listen(catalogProvider, (previous, next) {
      final state = next.valueOrNull;
      if (state == null || _startupEmitted) return;
      _startupEmitted = true;
      unawaited(_emitStartup(state));
    });

    return MaterialApp(
      title: 'Mudra Capture',
      debugShowCheckedModeBanner: false,
      theme: buildCaptureTheme(),
      home: const HomeScreen(),
    );
  }

  Future<void> _emitStartup(CatalogState state) async {
    final config = ref.read(configProvider);
    final device = ref.read(deviceInfoProvider).requireValue;
    final repository = ref.read(sampleRepositoryProvider);

    ref.read(lifecycleProvider).start(
          applicationVersion: ref.read(applicationVersionProvider).requireValue,
          configurationProfile: config.profile,
          datasetRoot: await repository.datasetRootPath(),
          catalogSize: state.catalog.size,
          cameraConfiguration: {
            'lens_facing': 1,
            'mirrored': true,
            'countdown_seconds': config.countdownSeconds,
            'capture_window_seconds': config.captureWindowSeconds,
          },
          platform: {
            'platform': ref.read(deviceInfoSourceProvider).platformName,
            'manufacturer': device.manufacturer,
            'model': device.model,
            'os_version': device.osVersion,
          },
        );
  }
}
