/// The **complete** recognition pipeline, with no physical camera and no
/// stored-dataset writes (T060, mirrors `full_pipeline_test.dart`'s pattern).
///
/// Fixture dataset (written via the real `FileSampleRepository`) → real
/// `FileExemplarSource` → `FakeCameraSource`-driven frames through the real
/// `CameraSessionController` → real `WeightedEuclideanNearestNeighborMatcher`
/// via `RecognitionSessionController` → `ConfirmationEvent` → effect lookup
/// via a real (parsed, not asset-loaded) `AssetEffectCatalogSource` — with
/// zero dataset writes asserted throughout (FR-004).
library;

import 'dart:io';

import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/application/recognition/load_exemplars.dart';
import 'package:capture/application/recognition/recognition_session_controller.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/infrastructure/effects/asset_effect_catalog_source.dart';
import 'package:capture/infrastructure/recognition/file_exemplar_source.dart';
import 'package:capture/infrastructure/recognition/weighted_euclidean_matcher.dart';
import 'package:capture/infrastructure/storage/file_sample_repository.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';
import '../support/sample_factories.dart';

const _effectCatalogJson = '''
{
  "catalog_version": 1,
  "effects": [
    {"pose_id": "peace", "kind": "glow", "color": "#2BB673", "intensity": 0.9}
  ],
  "generic_fallback": {"kind": "genericConfirm", "color": "#4C6FFF"}
}
''';

void main() {
  late Directory root;
  late FakeCameraSource source;
  late CameraSessionController cameraController;
  late FileSampleRepository repository;
  late RecordingLogger logger;
  const captureConfig = CaptureConfig();
  final recognitionConfig = RecognitionConfig(minExemplarsPerPose: 20);
  final catalog = PoseCatalog([makePose(poseId: 'peace'), makePose(poseId: 'ok')]);

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mudra_recognition_pipeline_');
    source = FakeCameraSource();
    logger = RecordingLogger();
    cameraController = CameraSessionController(
      source: source,
      logger: logger,
      releaseTimeout: captureConfig.cameraReleaseTimeout,
    );
    repository = FileSampleRepository(rootPath: root.path, config: captureConfig);
  });

  tearDown(() async {
    await cameraController.dispose();
    if (root.existsSync()) await root.delete(recursive: true);
  });

  test(
    'fixture dataset → exemplars → camera frames → Recognized → confirmed → '
    'effect, with zero dataset writes throughout',
    () async {
      // ---- fixture dataset, written once, up front --------------------------
      for (var i = 0; i < 25; i++) {
        await repository.save(makeSample(poseId: 'peace', sampleUuid: 'peace-$i'));
      }
      final countsBeforeRecognition = await repository.countAll();
      expect(countsBeforeRecognition, {'peace': 25});

      // ---- exemplar loading (read-only, FR-004) ------------------------------
      final exemplarSource = FileExemplarSource(
        repository: repository,
        catalog: catalog,
        config: recognitionConfig,
      );
      final loadExemplars = LoadExemplars(source: exemplarSource, logger: logger);
      final loadResult = await loadExemplars.call();
      expect(loadResult.readiness.forPose('peace')!.isReady, isTrue);
      expect(loadResult.exemplarsByPose['peace'], hasLength(25));

      // ---- camera acquisition, through the real controller -------------------
      await cameraController.request(
        CameraRequest(
          lens: LensPosition.front,
          analysisWidth: captureConfig.analysisWidth,
          analysisHeight: captureConfig.analysisHeight,
        ),
      );
      expect(cameraController.state, isA<CameraLive>());

      // ---- the real matcher and controller -----------------------------------
      final clock = FakeClock();
      final recognitionController = RecognitionSessionController(
        matcher: WeightedEuclideanNearestNeighborMatcher(
          weights: recognitionConfig.landmarkWeights,
        ),
        catalog: catalog,
        clock: clock,
        config: recognitionConfig,
      );
      recognitionController.loadExemplars(loadResult);

      // The same landmark shape as the stored fixture samples, so the live
      // frame reads as a strong match against them.
      final frames = <LandmarkFrame>[];
      final subscription = cameraController.frames.listen(frames.add);

      final matchingHand = makeSample().hands.single.normalized;
      final frame = makeFrame(hands: [makeHandDetection(landmarks: matchingHand)]);

      source.emit(frame);
      await pumpUntil(() => frames.isNotEmpty);
      final (firstResult, firstConfirmation) =
          recognitionController.process(frames.removeAt(0));
      expect(firstResult, isA<Recognized>());
      expect(firstConfirmation, isNull);

      clock.advance(const Duration(seconds: 3));
      source.emit(frame);
      await pumpUntil(() => frames.isNotEmpty);
      final (secondResult, confirmation) =
          recognitionController.process(frames.removeAt(0));
      expect(secondResult, isA<Recognized>());
      expect(confirmation, isNotNull);
      expect(confirmation!.poseId, 'peace');

      // ---- effect lookup closes the pipeline ---------------------------------
      final effectCatalog = AssetEffectCatalogSource.parse(_effectCatalogJson);
      final effect = effectCatalog.effectFor(confirmation.poseId);
      expect(effect.kind.name, 'glow');

      await subscription.cancel();

      // ---- zero dataset writes throughout the whole recognition pipeline ----
      expect(await repository.countAll(), countsBeforeRecognition);

      await cameraController.release(CameraReleaseReason.screenLeft);
      expect(source.liveCount, 0);
    },
  );
}
