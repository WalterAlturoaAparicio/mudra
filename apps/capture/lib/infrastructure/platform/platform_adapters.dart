/// Platform adapters: permissions, orientation, sharing, and device info.
///
/// Everything here touches a plugin or the OS. Each one implements a domain
/// port so the rest of the application — and every test — never sees a plugin
/// (constitution Principle I).
library;

import 'dart:async';
import 'dart:io' show Platform;

import 'package:capture/application/export/export_dataset.dart';
import 'package:capture/domain/export/manifest.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:share_plus/share_plus.dart';

/// The outcome of asking for camera permission.
enum CameraPermissionStatus {
  /// The user allowed it.
  granted,

  /// The user said no, but can be asked again.
  denied,

  /// The user said no permanently; only app settings can change it.
  permanentlyDenied,
}

/// Camera permission, including the permanently-denied case.
class CameraPermissions {
  /// Creates a permission adapter.
  const CameraPermissions();

  /// Requests camera access, returning what the user decided.
  Future<CameraPermissionStatus> request() async {
    final status = await Permission.camera.request();
    if (status.isGranted || status.isLimited) {
      return CameraPermissionStatus.granted;
    }
    if (status.isPermanentlyDenied || status.isRestricted) {
      return CameraPermissionStatus.permanentlyDenied;
    }
    return CameraPermissionStatus.denied;
  }

  /// The current status without prompting.
  Future<CameraPermissionStatus> current() async {
    final status = await Permission.camera.status;
    if (status.isGranted || status.isLimited) {
      return CameraPermissionStatus.granted;
    }
    if (status.isPermanentlyDenied || status.isRestricted) {
      return CameraPermissionStatus.permanentlyDenied;
    }
    return CameraPermissionStatus.denied;
  }

  /// Opens the OS settings page so a permanent denial can be undone.
  Future<bool> openSettings() => openAppSettings();
}

/// The only orientation Mudra Capture ever presents, on every screen.
///
/// The whole app is portrait-only: the capture layout, the preview's aspect
/// handling, and every stored sample's frame geometry all assume it, so there
/// is no page where landscape is a supported state.
const List<DeviceOrientation> supportedDeviceOrientations = [
  DeviceOrientation.portraitUp,
];

/// Locks the whole application to [supportedDeviceOrientations].
///
/// Called once from `main()`, before the first frame. Kept here rather than
/// called directly from the composition root so `main.dart` never needs to
/// import a platform channel itself — that stays confined to
/// `infrastructure/` (enforced by `test/architecture/layer_boundaries_test.dart`).
Future<void> lockAppOrientation() =>
    SystemChrome.setPreferredOrientations(supportedDeviceOrientations);

/// Locks orientation while a capture session runs (FR-049/FR-050).
///
/// Frame geometry must not change underneath a session: landmark coordinates
/// are normalized against the analysis frame, so a rotation mid-capture would
/// silently change what the numbers mean.
class SystemOrientationController implements OrientationController {
  /// Creates an orientation controller.
  SystemOrientationController({
    this.orientations = supportedDeviceOrientations,
  });

  /// The orientations allowed while locked.
  final List<DeviceOrientation> orientations;

  final StreamController<void> _changes = StreamController<void>.broadcast();
  Orientation? _lockedOrientation;

  @override
  Future<void> lock() async {
    _lockedOrientation = _currentOrientation();
    await SystemChrome.setPreferredOrientations(orientations);
  }

  @override
  Future<void> unlock() async {
    _lockedOrientation = null;
    // Restore the app-wide portrait-only constraint, not every orientation:
    // the capture screen's lock is *stricter* than the rest of the app, never
    // the only thing preventing landscape. Setting `DeviceOrientation.values`
    // here would briefly re-enable landscape everywhere on the way out.
    await SystemChrome.setPreferredOrientations(supportedDeviceOrientations);
  }

  @override
  Stream<void> get unexpectedChanges => _changes.stream;

  /// Called by the app shell when the media query orientation changes; if that
  /// happens while locked, the running session must abort.
  void onOrientationChanged(Orientation orientation) {
    if (_lockedOrientation != null && orientation != _lockedOrientation) {
      _changes.add(null);
    }
  }

  Orientation? _currentOrientation() {
    final view = WidgetsBinding.instance.platformDispatcher.implicitView;
    if (view == null) return null;
    final size = view.physicalSize;
    return size.width > size.height ? Orientation.landscape : Orientation.portrait;
  }

  /// Releases the change stream.
  Future<void> dispose() => _changes.close();
}

/// Hands the finished archive to the system share sheet (FR-035).
class SystemSharePresenter implements SharePresenter {
  /// Creates a share presenter.
  const SystemSharePresenter();

  @override
  Future<void> share(String path, {String? subject}) async {
    await Share.shareXFiles(
      [XFile(path, mimeType: 'application/zip')],
      subject: subject,
    );
  }
}

/// Device class information for the startup record and export manifest.
///
/// Manufacturer, model, and OS version only — never a hardware or user
/// identifier (Principle II's spirit: collect what the dataset needs, nothing
/// about the person).
class DeviceInfoSource {
  /// Creates a device info source.
  DeviceInfoSource([DeviceInfoPlugin? plugin])
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  /// Reads device information for the current platform.
  Future<DeviceInfo> read() async {
    try {
      if (Platform.isAndroid) {
        final info = await _plugin.androidInfo;
        return DeviceInfo(
          manufacturer: info.manufacturer,
          model: info.model,
          osVersion: 'Android ${info.version.release} (API ${info.version.sdkInt})',
        );
      }
      if (Platform.isIOS) {
        final info = await _plugin.iosInfo;
        return DeviceInfo(
          manufacturer: 'Apple',
          model: info.utsname.machine,
          osVersion: '${info.systemName} ${info.systemVersion}',
        );
      }
    } on Object {
      // Device details are descriptive metadata; failing to read them must
      // never block a recording session or an export.
    }
    return DeviceInfo(
      manufacturer: 'unknown',
      model: 'unknown',
      osVersion: Platform.operatingSystemVersion,
    );
  }

  /// The platform name written into the manifest.
  String get platformName => Platform.isIOS ? 'ios' : 'android';
}
