/// Filesystem implementation of [CalibrationStore].
///
/// Written at the storage root, **outside** [CaptureConfig.datasetRoot] —
/// display calibration is developer tooling, not dataset content, and must
/// never be discoverable by the exporter or the integrity validator, both of
/// which only ever look inside `datasets/`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/config/capture_config.dart';

/// Persists one JSON document holding both lenses' calibration.
class FileCalibrationStore implements CalibrationStore {
  /// Creates a store rooted at [rootPath].
  FileCalibrationStore({required this.rootPath, required CaptureConfig config})
      : _config = config;

  /// Application-private storage root.
  final String rootPath;

  final CaptureConfig _config;

  File get _file =>
      File('$rootPath${Platform.pathSeparator}${_config.calibrationFileName}');

  @override
  Future<CameraCalibrationSet?> load() async {
    if (!await _file.exists()) return null;
    try {
      final decoded = jsonDecode(await _file.readAsString());
      return CameraCalibrationSet.fromJson((decoded as Map).cast<String, Object?>());
    } on Object {
      // A corrupt or hand-edited file must not block startup — the caller
      // falls back to CameraCalibrationSet.defaults, same as never having
      // saved one at all.
      return null;
    }
  }

  @override
  Future<void> save(CameraCalibrationSet calibrationSet) async {
    await _file.parent.create(recursive: true);
    await _file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(calibrationSet.toJson()),
      flush: true,
    );
  }
}
