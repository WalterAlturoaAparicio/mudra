/// [CameraCalibrationNotifier]: loads a device's persisted calibration (or
/// the shipped defaults), and every mutation updates state immediately and
/// persists it in the same call — "changing any value should immediately
/// update the preview, update the overlay, and save the new value".
library;

import 'dart:convert';

import 'package:capture/application/debug/camera_calibration_notifier.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';

void main() {
  late InMemoryCalibrationStore store;
  late ProviderContainer container;

  setUp(() {
    store = InMemoryCalibrationStore();
    container = ProviderContainer(
      overrides: [calibrationStoreProvider.overrideWithValue(store)],
    );
  });

  tearDown(() => container.dispose());

  Future<CameraCalibrationSet> read() =>
      container.read(cameraCalibrationProvider.future);

  CameraCalibrationNotifier notifier() =>
      container.read(cameraCalibrationProvider.notifier);

  test('falls back to the shipped defaults when nothing is persisted', () async {
    expect(await read(), CameraCalibrationSet.defaults);
  });

  test('loads whatever this device previously saved', () async {
    final saved = CameraCalibrationSet.defaults.withLens(
      LensPosition.front,
      CameraCalibrationSet.defaults.front.copyWith(overlayScale: 1.3),
    );
    store = InMemoryCalibrationStore();
    await store.save(saved);
    final freshContainer = ProviderContainer(
      overrides: [calibrationStoreProvider.overrideWithValue(store)],
    );
    addTearDown(freshContainer.dispose);

    final loaded = await freshContainer.read(cameraCalibrationProvider.future);
    expect(loaded.front.overlayScale, 1.3);
  });

  test('every setter updates its own lens only, immediately and persisted', () async {
    await read();
    await notifier().setPreviewRotation(LensPosition.front, 90);

    final state = container.read(cameraCalibrationProvider).requireValue;
    expect(state.front.previewRotation, 90);
    expect(state.rear.previewRotation, 0, reason: 'the other lens is untouched');
    expect(store.saveCount, 1);
    expect((await store.load())!.front.previewRotation, 90);
  });

  test('setting the rear lens never touches the front lens', () async {
    await read();
    await notifier().setOverlayScale(LensPosition.rear, 1.8);

    final state = container.read(cameraCalibrationProvider).requireValue;
    expect(state.rear.overlayScale, 1.8);
    expect(state.front.overlayScale, CameraCalibrationSet.defaults.front.overlayScale);
  });

  test('every mutation method updates exactly the field it names', () async {
    await read();
    const lens = LensPosition.front;
    final n = notifier();

    await n.togglePreviewMirror(lens);
    expect(container.read(cameraCalibrationProvider).requireValue.front.previewMirror, isTrue);

    await n.setPreviewFit(lens, PreviewFit.cover);
    expect(container.read(cameraCalibrationProvider).requireValue.front.previewFit, PreviewFit.cover);

    await n.setOverlayRotation(lens, 180);
    expect(container.read(cameraCalibrationProvider).requireValue.front.overlayRotation, 180);

    await n.toggleOverlayMirror(lens);
    expect(container.read(cameraCalibrationProvider).requireValue.front.overlayMirror, isFalse,
        reason: 'defaults start mirrored=true for the front lens; toggling flips it');

    await n.toggleOverlaySwapXY(lens);
    expect(container.read(cameraCalibrationProvider).requireValue.front.overlaySwapXY, isTrue);

    await n.setOverlayOffsetX(lens, 0.2);
    expect(container.read(cameraCalibrationProvider).requireValue.front.overlayOffsetX, 0.2);

    await n.setOverlayOffsetY(lens, -0.1);
    expect(container.read(cameraCalibrationProvider).requireValue.front.overlayOffsetY, -0.1);
  });

  test('resetLens restores only that lens to its shipped default', () async {
    await read();
    final n = notifier();
    await n.setOverlayScale(LensPosition.front, 1.9);
    await n.setOverlayScale(LensPosition.rear, 1.9);

    await n.resetLens(LensPosition.front);

    final state = container.read(cameraCalibrationProvider).requireValue;
    expect(state.front, CameraCalibrationSet.defaults.front);
    expect(state.rear.overlayScale, 1.9, reason: 'the other lens is untouched by a reset');
  });

  test('importJson replaces the whole set', () async {
    await read();
    final imported = CameraCalibrationSet.defaults
        .withLens(LensPosition.front, CameraCalibrationSet.defaults.front.copyWith(overlayScale: 1.2))
        .withLens(LensPosition.rear, CameraCalibrationSet.defaults.rear.copyWith(overlayScale: 1.4));

    await notifier().importJson(jsonEncode(imported.toJson()));

    final state = container.read(cameraCalibrationProvider).requireValue;
    expect(state.front.overlayScale, 1.2);
    expect(state.rear.overlayScale, 1.4);
  });

  test('importJson throws on malformed JSON, leaving state untouched', () async {
    final before = await read();

    await expectLater(notifier().importJson('not json'), throwsFormatException);

    expect(container.read(cameraCalibrationProvider).requireValue, before);
  });
}
