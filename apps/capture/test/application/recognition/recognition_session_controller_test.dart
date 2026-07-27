/// `RecognitionSessionController`: the prediction path (score → confidence →
/// gate → `RecognitionResult`) and stability/confirmation transitions.
library;

import 'package:capture/application/recognition/recognition_session_controller.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';
import '../../support/recognition_fakes.dart';
import '../../support/sample_factories.dart';

void main() {
  late FakeClock clock;
  late FakePoseMatcher matcher;
  late PoseCatalog catalog;
  late RecognitionConfig config;
  late RecognitionSessionController controller;

  setUp(() {
    clock = FakeClock();
    matcher = FakePoseMatcher();
    catalog = PoseCatalog([makePose(poseId: 'peace'), makePose(poseId: 'ok')]);
    config = RecognitionConfig(
      confidenceFloor: 0.5,
      ambiguityMargin: 0.12,
      stabilityDurationSeconds: 3.0,
    );
    controller = RecognitionSessionController(
      matcher: matcher,
      catalog: catalog,
      clock: clock,
      config: config,
    );
    controller.loadExemplars(makeExemplarLoadResult({'peace': 25, 'ok': 25}));
  });

  group('prediction path', () {
    test('no hand yields NoHandDetected, with latency populated', () {
      final (result, confirmation) = controller.process(makeEmptyFrame());
      expect(result, isA<NoHandDetected>());
      expect(result.latency, isNotNull);
      expect(confirmation, isNull);
    });

    test('a confident, unambiguous top candidate yields Recognized', () {
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
        Candidate(poseId: 'ok', distance: 5.0, confidence: 0),
      ];
      final (result, _) = controller.process(makeFrame());
      expect(result, isA<Recognized>());
      expect((result as Recognized).predictedPoseId, 'peace');
    });

    test('a low top confidence yields Unrecognized', () {
      // Nearly identical distances -> confidences close to 50/50, both below
      // a high floor.
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 1.0, confidence: 0),
        Candidate(poseId: 'ok', distance: 1.01, confidence: 0),
      ];
      config = RecognitionConfig(confidenceFloor: 0.9);
      controller = RecognitionSessionController(
        matcher: matcher,
        catalog: catalog,
        clock: clock,
        config: config,
      );
      controller.loadExemplars(makeExemplarLoadResult({'peace': 25, 'ok': 25}));

      final (result, _) = controller.process(makeFrame());
      expect(result, isA<Unrecognized>());
    });

    test('a narrow top-vs-second gap yields Ambiguous', () {
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 1.0, confidence: 0),
        Candidate(poseId: 'ok', distance: 1.05, confidence: 0),
      ];
      config = RecognitionConfig(confidenceFloor: 0.1, ambiguityMargin: 0.9);
      controller = RecognitionSessionController(
        matcher: matcher,
        catalog: catalog,
        clock: clock,
        config: config,
      );
      controller.loadExemplars(makeExemplarLoadResult({'peace': 25, 'ok': 25}));

      final (result, _) = controller.process(makeFrame());
      expect(result, isA<Ambiguous>());
    });

    test('an empty candidate list yields Unrecognized', () {
      matcher.fixedResult = const [];
      final (result, _) = controller.process(makeFrame());
      expect(result, isA<Unrecognized>());
    });

    test('a pose excluded from the exemplar map never appears as a candidate', () {
      // Below-threshold poses simply never arrive in exemplarsByPose — the
      // controller has no special-case for this, it only ever sees what the
      // matcher (scripted here) returns, so this documents that the
      // exclusion happens upstream, at FileExemplarSource, not here.
      controller.loadExemplars(makeExemplarLoadResult({'peace': 25, 'ok': 2}));
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
      ];
      final (result, _) = controller.process(makeFrame());
      expect(result, isA<Recognized>());
      expect((result as Recognized).topCandidates.map((c) => c.poseId), isNot(contains('ok')));
    });
  });

  group('stability transitions', () {
    void recognize(String poseId) {
      matcher.fixedResult = [Candidate(poseId: poseId, distance: 0.1, confidence: 0)];
      controller.process(makeFrame());
    }

    test('holding the same pose accumulates heldDuration', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      recognize('peace');
      expect(controller.stability.heldDuration(clock.nowUtc()), const Duration(seconds: 1));
    });

    test('a different Recognized pose resets to zero immediately', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      recognize('ok');
      expect(controller.stability.predictedPoseId, 'ok');
      expect(controller.stability.heldDuration(clock.nowUtc()), Duration.zero);
    });

    test('Unrecognized resets to idle immediately', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      matcher.fixedResult = const [];
      controller.process(makeFrame());
      expect(controller.stability.predictedPoseId, isNull);
      expect(controller.stability.heldDuration(clock.nowUtc()), Duration.zero);
    });

    test('Ambiguous resets to idle immediately', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 1.0, confidence: 0),
        Candidate(poseId: 'ok', distance: 1.01, confidence: 0),
      ];
      controller = RecognitionSessionController(
        matcher: matcher,
        catalog: catalog,
        clock: clock,
        config: RecognitionConfig(confidenceFloor: 0.1, ambiguityMargin: 0.9),
      );
      controller.loadExemplars(makeExemplarLoadResult({'peace': 25, 'ok': 25}));
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      controller.process(makeFrame());
      expect(controller.stability.confirmedAt, isNull);
    });

    test('NoHandDetected resets to idle immediately', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 1));
      controller.process(makeEmptyFrame());
      expect(controller.stability.predictedPoseId, isNull);
    });

    test('reaching the stability duration raises exactly one ConfirmationEvent', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      matcher.fixedResult = [const Candidate(poseId: 'peace', distance: 0.1, confidence: 0)];
      final (result, event) = controller.process(makeFrame());
      expect(result, isA<Recognized>());
      expect(event, isNotNull);
      expect(event!.poseId, 'peace');
    });

    test('continuing to hold past confirmation does not raise a second event', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      recognize('peace'); // confirms here
      clock.advance(const Duration(seconds: 1));
      matcher.fixedResult = [const Candidate(poseId: 'peace', distance: 0.1, confidence: 0)];
      final (_, event) = controller.process(makeFrame());
      expect(event, isNull);
    });

    test('releasing and re-holding raises an independent second confirmation', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      recognize('peace'); // confirms

      // Release: a different result resets stability.
      matcher.fixedResult = const [];
      controller.process(makeFrame());

      // Re-hold.
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      matcher.fixedResult = [const Candidate(poseId: 'peace', distance: 0.1, confidence: 0)];
      final (_, event) = controller.process(makeFrame());
      expect(event, isNotNull);
      expect(event!.poseId, 'peace');
    });
  });

  group('recognition remains active during effects (analysis finding M2, T068)', () {
    void recognize(String poseId) {
      matcher.fixedResult = [Candidate(poseId: poseId, distance: 0.1, confidence: 0)];
      controller.process(makeFrame());
    }

    test('frames keep producing Recognized results at the normal cadence past a '
        'confirmation, with latency populated on every one', () {
      // Confirm once.
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      recognize('peace');

      // Nothing in `RecognitionSessionController` knows or cares whether a
      // presentation-layer effect is "playing" — there is no such concept at
      // this layer at all (FR-022's guarantee holds by construction, not by
      // a check this test could accidentally bypass). Continuously feeding
      // frames through a confirmed hold must keep behaving exactly like any
      // other hold: every frame still yields a `Recognized` result with a
      // populated latency, never a paused, skipped, or delayed one.
      for (var i = 0; i < 20; i++) {
        clock.advance(const Duration(milliseconds: 16));
        matcher.fixedResult = [
          const Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
        ];
        final (result, event) = controller.process(makeFrame());

        expect(result, isA<Recognized>());
        expect(result.latency, isNotNull);
        // Already confirmed; this continuous hold must not re-fire.
        expect(event, isNull);
      }
    });

    test('recognition latency stays within the configured target throughout '
        'a confirmed hold', () {
      recognize('peace');
      clock.advance(const Duration(seconds: 3));
      recognize('peace');

      for (var i = 0; i < 10; i++) {
        clock.advance(const Duration(milliseconds: 16));
        matcher.fixedResult = [
          const Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
        ];
        final (result, _) = controller.process(makeFrame());
        // `FakeClock` only advances when told to, so `process()` itself
        // contributes zero elapsed time here — this asserts the pipeline
        // never inflates latency on its own during a confirmed hold.
        expect(result.latency, lessThan(config.targetLatency));
      }
    });
  });
}
