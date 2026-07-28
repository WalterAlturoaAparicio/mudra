/// The developer camera-calibration panel's live state (research D25,
/// persistent-calibration follow-up).
///
/// **This tool is permanent**, not temporary: D25 built it to find a working
/// combination of display transforms by hand once; this notifier is what
/// makes that combination (and any future device's own) survive restarts,
/// per-lens, with zero code change (Objective 1–3 of the persistent
/// calibration system). `CameraCalibrationScreen` stays reachable as a
/// `!kReleaseMode`-gated Developer Tool rather than being deleted once a fix
/// ships.
///
/// Every mutation updates the in-memory state immediately (so the preview
/// and overlay react with no rebuild) and persists it via [CalibrationStore]
/// in the same call — "changing any value should immediately update the
/// preview, update the overlay, and save the new value" is exactly what
/// [_update] does, in that order.
library;

import 'dart:convert';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Loads, saves, and exposes the live [CameraCalibrationSet].
class CameraCalibrationNotifier extends AsyncNotifier<CameraCalibrationSet> {
  @override
  Future<CameraCalibrationSet> build() async {
    final loaded = await ref.watch(calibrationStoreProvider).load();
    return loaded ?? CameraCalibrationSet.defaults;
  }

  Future<void> _update(
    CameraCalibrationSet Function(CameraCalibrationSet current) transform,
  ) async {
    final current = state.valueOrNull ?? CameraCalibrationSet.defaults;
    final next = transform(current);
    state = AsyncData(next);
    await ref.read(calibrationStoreProvider).save(next);
  }

  /// Sets [lens]'s preview rotation, in clockwise degrees (a multiple of 90).
  Future<void> setPreviewRotation(LensPosition lens, int degrees) => _update(
    (set) => set.withLens(
      lens,
      set.forLens(lens).copyWith(previewRotation: degrees),
    ),
  );

  /// Flips [lens]'s preview mirror control.
  Future<void> togglePreviewMirror(LensPosition lens) => _update(
    (set) => set.withLens(
      lens,
      set.forLens(lens).copyWith(previewMirror: !set.forLens(lens).previewMirror),
    ),
  );

  /// Sets how [lens]'s rotated preview buffer fits into its box.
  Future<void> setPreviewFit(LensPosition lens, PreviewFit fit) => _update(
    (set) => set.withLens(lens, set.forLens(lens).copyWith(previewFit: fit)),
  );

  /// Sets [lens]'s overlay rotation, in clockwise degrees (a multiple of 90).
  Future<void> setOverlayRotation(LensPosition lens, int degrees) => _update(
    (set) => set.withLens(
      lens,
      set.forLens(lens).copyWith(overlayRotation: degrees),
    ),
  );

  /// Flips [lens]'s overlay mirror control.
  Future<void> toggleOverlayMirror(LensPosition lens) => _update(
    (set) => set.withLens(
      lens,
      set.forLens(lens).copyWith(overlayMirror: !set.forLens(lens).overlayMirror),
    ),
  );

  /// Flips [lens]'s overlay swap-X/Y control.
  Future<void> toggleOverlaySwapXY(LensPosition lens) => _update(
    (set) => set.withLens(
      lens,
      set.forLens(lens).copyWith(overlaySwapXY: !set.forLens(lens).overlaySwapXY),
    ),
  );

  /// Sets [lens]'s overlay uniform scale.
  Future<void> setOverlayScale(LensPosition lens, double scale) => _update(
    (set) => set.withLens(lens, set.forLens(lens).copyWith(overlayScale: scale)),
  );

  /// Sets [lens]'s overlay horizontal offset.
  Future<void> setOverlayOffsetX(LensPosition lens, double offsetX) => _update(
    (set) =>
        set.withLens(lens, set.forLens(lens).copyWith(overlayOffsetX: offsetX)),
  );

  /// Sets [lens]'s overlay vertical offset.
  Future<void> setOverlayOffsetY(LensPosition lens, double offsetY) => _update(
    (set) =>
        set.withLens(lens, set.forLens(lens).copyWith(overlayOffsetY: offsetY)),
  );

  /// Resets [lens]'s calibration to its shipped default, leaving the other
  /// lens untouched.
  Future<void> resetLens(LensPosition lens) => _update(
    (set) => set.withLens(lens, CameraCalibrationSet.defaults.forLens(lens)),
  );

  /// Replaces the **whole** set (both lenses) from a previously exported
  /// document — Developer UX's "Import calibration (JSON)", for comparing
  /// values found on a different device. Throws [FormatException] on
  /// malformed JSON; the caller is expected to show that to the developer
  /// rather than silently discard it.
  Future<void> importJson(String json) => _update(
    (_) => CameraCalibrationSet.fromJson(
      (jsonDecode(json) as Map).cast<String, Object?>(),
    ),
  );
}
