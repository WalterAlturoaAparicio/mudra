/// `PredictionHud`'s three visibly distinct states (FR-023): confidently and
/// stably recognized; attempted but unstable/low-confidence/contested; and
/// insufficient data to attempt at all.
library;

import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/domain/recognition/stability.dart';
import 'package:capture/presentation/recognition/prediction_hud.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/sample_factories.dart';

void main() {
  final catalog = PoseCatalog([makePose(poseId: 'peace'), makePose(poseId: 'ok')]);
  final ready = CatalogReadiness(const [
    PoseReadiness(poseId: 'peace', exemplarCount: 25, minRequired: 20),
    PoseReadiness(poseId: 'ok', exemplarCount: 25, minRequired: 20),
  ]);
  final notReady = CatalogReadiness(const [
    PoseReadiness(poseId: 'peace', exemplarCount: 2, minRequired: 20),
    PoseReadiness(poseId: 'ok', exemplarCount: 0, minRequired: 20),
  ]);
  final now = DateTime.utc(2026, 1, 1);

  Future<void> pumpHud(
    WidgetTester tester, {
    required RecognitionResult? result,
    required CatalogReadiness readiness,
    StabilityState stability = StabilityState.idle,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PredictionHud(
          result: result,
          stability: stability,
          stabilityDuration: const Duration(seconds: 3),
          catalog: catalog,
          now: now,
          readiness: readiness,
        ),
      ),
    );
  }

  testWidgets('confidently and stably recognized renders the confirmed state', (tester) async {
    final confirmedAt = now.subtract(const Duration(seconds: 1));
    await pumpHud(
      tester,
      readiness: ready,
      stability: StabilityState(
        predictedPoseId: 'peace',
        heldSince: now.subtract(const Duration(seconds: 4)),
        confirmedAt: confirmedAt,
      ),
      result: Recognized(
        topCandidates: const [Candidate(poseId: 'peace', distance: 0.1, confidence: 0.95)],
        latency: const Duration(milliseconds: 40),
        frameTimestamp: 0,
      ),
    );

    expect(find.byKey(const Key('hud-confirmed')), findsOneWidget);
    expect(find.byKey(const Key('hud-status-unrecognized')), findsNothing);
    expect(find.byKey(const Key('hud-status-ambiguous')), findsNothing);
    expect(find.byKey(const Key('hud-status-insufficient-data')), findsNothing);
  });

  testWidgets(
    'attempted but unstable/contested renders distinctly from confirmed or insufficient',
    (tester) async {
      await pumpHud(
        tester,
        readiness: ready,
        result: Ambiguous(
          topCandidates: const [
            Candidate(poseId: 'peace', distance: 1.0, confidence: 0.51),
            Candidate(poseId: 'ok', distance: 1.02, confidence: 0.49),
          ],
          latency: const Duration(milliseconds: 40),
          frameTimestamp: 0,
        ),
      );

      expect(find.byKey(const Key('hud-status-ambiguous')), findsOneWidget);
      expect(find.byKey(const Key('hud-confirmed')), findsNothing);
      expect(find.byKey(const Key('hud-status-insufficient-data')), findsNothing);
    },
  );

  testWidgets(
    'attempted but low-confidence also renders distinctly (Unrecognized)',
    (tester) async {
      await pumpHud(
        tester,
        readiness: ready,
        result: const Unrecognized(
          topCandidates: [],
          latency: Duration(milliseconds: 40),
          frameTimestamp: 0,
        ),
      );

      expect(find.byKey(const Key('hud-status-unrecognized')), findsOneWidget);
      expect(find.byKey(const Key('hud-confirmed')), findsNothing);
      expect(find.byKey(const Key('hud-status-insufficient-data')), findsNothing);
    },
  );

  testWidgets(
    'insufficient data renders distinctly, even with a live result available',
    (tester) async {
      await pumpHud(
        tester,
        readiness: notReady,
        result: const Unrecognized(
          topCandidates: [],
          latency: Duration(milliseconds: 40),
          frameTimestamp: 0,
        ),
      );

      expect(find.byKey(const Key('hud-status-insufficient-data')), findsOneWidget);
      expect(find.byKey(const Key('hud-status-unrecognized')), findsNothing);
      expect(find.byKey(const Key('hud-confirmed')), findsNothing);
    },
  );
}
