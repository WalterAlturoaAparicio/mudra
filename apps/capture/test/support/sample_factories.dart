/// Test factories for the capture domain (not a test file itself).
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/samples/pose_sample.dart';

/// Builds a deterministic 21-point hand, optionally translated and scaled.
HandLandmarks makeHandLandmarks({double offset = 0, double scale = 1}) =>
    HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        Landmark(
          x: offset + scale * (0.01 * i),
          y: offset + scale * (0.02 * i),
          z: scale * (0.005 * i),
        ),
    ]);

/// Builds a hand whose coordinates are not finite, for validation tests.
HandLandmarks makeNonFiniteHandLandmarks() => HandLandmarks([
  const Landmark(x: double.nan, y: 0, z: 0),
  for (var i = 1; i < handLandmarkCount; i++)
    Landmark(x: 0.01 * i, y: 0.02 * i, z: 0),
]);

/// Builds one detected hand.
HandDetection makeHandDetection({
  Handedness handedness = Handedness.right,
  double confidence = 0.97,
  HandLandmarks? landmarks,
}) => HandDetection(
  handedness: handedness,
  confidence: confidence,
  landmarks: landmarks ?? makeHandLandmarks(),
);

/// Builds a frame; defaults to a single right hand in the canonical convention.
///
/// [convention] lets a test deliver a frame as a rear lens actually would, so
/// the canonical conversion is exercised rather than bypassed.
LandmarkFrame makeFrame({
  List<HandDetection>? hands,
  int width = 640,
  int height = 480,
  int timestampMicros = 0,
  ViewConvention convention = ViewConvention.canonical,
}) => LandmarkFrame(
  hands: hands ?? [makeHandDetection()],
  frameWidth: width,
  frameHeight: height,
  timestampMicros: timestampMicros,
  convention: convention,
);

/// Builds a frame containing two hands, for two-handed pose tests.
LandmarkFrame makeTwoHandFrame({
  int timestampMicros = 0,
  ViewConvention convention = ViewConvention.canonical,
}) => makeFrame(
  hands: [
    makeHandDetection(handedness: Handedness.left, confidence: 0.94),
    makeHandDetection(),
  ],
  timestampMicros: timestampMicros,
  convention: convention,
);

/// Builds a frame with no hands at all.
LandmarkFrame makeEmptyFrame({int timestampMicros = 0}) =>
    makeFrame(hands: const [], timestampMicros: timestampMicros);

/// Builds a pose definition with sensible defaults.
PoseDefinition makePose({
  String poseId = 'peace',
  String displayName = 'Peace',
  String description = 'Index and middle finger extended.',
  String? referenceImage = 'assets/poses/peace.png',
  int targetSampleCount = 500,
  int requiredHands = 1,
}) => PoseDefinition(
  poseId: poseId,
  displayName: displayName,
  description: description,
  referenceImage: referenceImage,
  targetSampleCount: targetSampleCount,
  requiredHands: requiredHands,
);

/// Builds a two-handed pose definition.
PoseDefinition makeTwoHandedPose({String poseId = 'dragon'}) =>
    makePose(poseId: poseId, displayName: 'Dragon', requiredHands: 2);

/// Builds a fully populated sample matching the engine's schema.
PoseSample makeSample({
  String poseId = 'peace',
  String sampleNumber = 'sample_000001',
  String? sessionUuid,
  String sampleUuid = '550e8400-e29b-41d4-a716-446655440000',
  int handCount = 1,
}) {
  final hands = [
    for (var i = 0; i < handCount; i++)
      HandSample(
        handedness: i == 0 ? Handedness.right : Handedness.left,
        confidence: 0.98 - 0.02 * i,
        canonicalRaw: makeHandLandmarks(),
        normalized: makeHandLandmarks(offset: -0.1),
      ),
  ];
  const timestamp = '2026-07-24T13:20:00.123456+00:00';

  return PoseSample(
    pose: Pose(poseId: poseId, displayName: 'Peace'),
    sampleUuid: sampleUuid,
    sampleNumber: sampleNumber,
    timestamp: timestamp,
    normalization: const NormalizationInfo(
      strategy: 'translation_scale',
      version: '1.0',
    ),
    metadata: SampleMetadata(
      timestamp: timestamp,
      cameraIndex: 1,
      cameraWidth: 640,
      cameraHeight: 480,
      mediapipeVersion: '0.10.14',
      applicationVersion: 'mudra-capture/0.1.0',
      numHands: hands.length,
      hands: [
        for (final hand in hands)
          HandMeta(handedness: hand.handedness, confidence: hand.confidence),
      ],
      capture: CaptureTiming(
        captureTime: timestamp,
        countdownStartTime: '2026-07-24T13:19:56.400000+00:00',
        countdownSeconds: 3,
        sessionUuid: sessionUuid,
      ),
    ),
    hands: hands,
  );
}

/// Builds a catalog that deliberately omits [missingPoseId], for testing the
/// catalog-coverage warning during integrity validation.
PoseCatalog makeCatalogWithout(String missingPoseId) => PoseCatalog([
  for (final id in ['peace', 'dragon', 'ok'])
    if (id != missingPoseId)
      makePose(poseId: id, displayName: id, referenceImage: null),
]);

/// Builds a session record.
RecordingSession makeSession({
  String sessionUuid = 'session-0001',
  String poseId = 'peace',
  int totalSamples = 24,
  int discardedSamples = 2,
  SessionEndReason endReason = SessionEndReason.completed,
}) => RecordingSession(
  sessionUuid: sessionUuid,
  poseId: poseId,
  startedAt: DateTime.utc(2026, 7, 24, 13, 19, 56),
  finishedAt: DateTime.utc(2026, 7, 24, 13, 20, 1),
  totalSamples: totalSamples,
  discardedSamples: discardedSamples,
  endReason: endReason,
);
