/// End-to-end confirm-then-effect cycle through `RecognitionPreviewScreen`
/// (T043–T045): exactly one playback per confirmation, the generic fallback
/// for an unthemed pose, and two independent playbacks across release/
/// re-hold (SC-008).
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/presentation/recognition/effect_overlay.dart';
import 'package:capture/presentation/recognition/recognition_preview_screen.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';
import '../../support/recognition_fakes.dart';
import '../../support/sample_factories.dart';

class _FakeCatalogSource implements PoseCatalogSource {
  @override
  Future<PoseCatalog> load() async => PoseCatalog([
    makePose(poseId: 'peace'),
    makePose(poseId: 'ok'),
    makeTwoHandedPose(poseId: 'dragon'),
  ]);
}

class _FakeSampleRepository implements SampleRepository {
  @override
  Future<SampleRef> save(PoseSample sample) async =>
      throw UnimplementedError('not used by the recognition preview screen');

  @override
  Future<List<SampleRef>> saveAll(List<PoseSample> samples) async => const [];

  @override
  Future<int> count(String poseId) async => 0;

  @override
  Future<Map<String, int>> countAll() async => const {};

  @override
  Future<String> datasetRootPath() async => '';

  @override
  Future<List<PoseSample>> readAll(String poseId) async => const [];
}

void main() {
  late FakeCameraSource source;
  late FakePoseMatcher matcher;
  late FakeExemplarSource exemplarSource;
  late FakeClock clock;

  setUp(() {
    source = FakeCameraSource();
    matcher = FakePoseMatcher();
    exemplarSource = FakeExemplarSource(
      makeExemplarLoadResult({'peace': 25, 'ok': 25}),
    );
    clock = FakeClock();
  });

  List<Override> overrides({Map<String, EffectDefinition> effects = const {}}) => [
    cameraSourceProvider.overrideWithValue(source),
    poseMatcherProvider.overrideWithValue(matcher),
    exemplarSourceProvider.overrideWithValue(exemplarSource),
    catalogSourceProvider.overrideWithValue(_FakeCatalogSource()),
    sampleRepositoryProvider.overrideWithValue(_FakeSampleRepository()),
    clockProvider.overrideWithValue(clock),
    recognitionConfigProvider.overrideWithValue(
      RecognitionConfig(stabilityDurationSeconds: 3.0),
    ),
    effectCatalogSourceProvider.overrideWith(
      (ref) async => FakeEffectCatalogSource(byPoseId: effects),
    ),
    configProvider.overrideWithValue(
      const CaptureConfig(lockOrientationOnCaptureScreen: false),
    ),
    applicationVersionProvider.overrideWith((ref) async => 'mudra-capture/0.1.0'),
  ];

  Future<void> pumpScreen(WidgetTester tester, List<Override> overrides) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: const MaterialApp(home: RecognitionPreviewScreen()),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  /// Feeds one confidently-`peace` frame, then flushes the resulting
  /// `setState` — mirrors `recognition_preview_screen_test.dart`'s
  /// `emitAndSettle` pattern.
  Future<void> holdPeace(WidgetTester tester) async {
    matcher.fixedResult = const [
      Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
      Candidate(poseId: 'ok', distance: 5.0, confidence: 0),
    ];
    source.emit(makeFrame());
    await tester.pump();
    await tester.pump();
  }

  testWidgets(
    'a full confirm-then-effect cycle plays exactly one effect per confirmation (T043)',
    (tester) async {
      await pumpScreen(tester, overrides(effects: {
        'peace': EffectDefinition(kind: EffectKind.glow),
      }));
      await settle(tester);

      await holdPeace(tester);
      expect(find.byType(EffectOverlay), findsNothing, reason: 'not yet confirmed');

      clock.advance(const Duration(seconds: 3));
      await holdPeace(tester);

      expect(
        find.byType(EffectOverlay),
        findsOneWidget,
        reason: 'reaching the stability duration triggers exactly one playback',
      );

      // Continuing to hold does not add a second overlay.
      clock.advance(const Duration(seconds: 1));
      await holdPeace(tester);
      expect(find.byType(EffectOverlay), findsOneWidget);
    },
  );

  testWidgets(
    'the prediction HUD keeps updating while an effect is mid-playback (T068)',
    (tester) async {
      await pumpScreen(tester, overrides(effects: {
        'peace': EffectDefinition(kind: EffectKind.glow),
      }));
      await settle(tester);

      await holdPeace(tester);
      clock.advance(const Duration(seconds: 3));
      await holdPeace(tester);
      expect(find.byType(EffectOverlay), findsOneWidget);

      // Advance only partway through the effect's own playback — it must
      // still be mid-animation, not finished — while continuing to feed
      // frames. Recognition is not gated by presentation state (FR-022): the
      // HUD must keep reflecting fresh results the whole time.
      await tester.pump(effectPlaybackDuration ~/ 2);
      expect(
        find.byType(EffectOverlay),
        findsOneWidget,
        reason: 'the effect must still be playing at the halfway point',
      );

      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 0.05, confidence: 0),
        Candidate(poseId: 'ok', distance: 6.0, confidence: 0),
      ];
      clock.advance(const Duration(milliseconds: 16));
      source.emit(makeFrame(timestampMicros: 12345));
      await tester.pump();
      await tester.pump();

      expect(
        find.byKey(const Key('hud-top-pose')),
        findsOneWidget,
        reason: 'the HUD keeps showing a live prediction throughout playback',
      );
      expect(find.byKey(const Key('hud-latency')), findsOneWidget);
      expect(
        find.byType(EffectOverlay),
        findsOneWidget,
        reason: 'the effect keeps playing independently of the frame just processed',
      );
    },
  );

  testWidgets(
    'a pose_id with no themed entry plays the generic fallback (T044)',
    (tester) async {
      // No 'peace' entry in the effect catalog at all.
      await pumpScreen(tester, overrides());
      await settle(tester);

      await holdPeace(tester);
      clock.advance(const Duration(seconds: 3));
      await holdPeace(tester);

      final overlay = tester.widget<EffectOverlay>(find.byType(EffectOverlay));
      expect(overlay.definition.kind, EffectKind.genericConfirm);
    },
  );

  testWidgets(
    'releasing and re-holding produces two independent playbacks, not one merged (T045)',
    (tester) async {
      await pumpScreen(tester, overrides(effects: {
        'peace': EffectDefinition(kind: EffectKind.glow),
      }));
      await settle(tester);

      await holdPeace(tester);
      clock.advance(const Duration(seconds: 3));
      await holdPeace(tester);
      expect(find.byType(EffectOverlay), findsOneWidget);
      final firstKey = tester.widget<EffectOverlay>(find.byType(EffectOverlay)).key;

      // Let the first playback finish.
      await tester.pump(effectPlaybackDuration + const Duration(milliseconds: 50));
      expect(find.byType(EffectOverlay), findsNothing);

      // Release: an unrecognized frame resets stability.
      matcher.fixedResult = const [];
      source.emit(makeFrame());
      await tester.pump();
      await tester.pump();

      // Re-hold from scratch.
      await holdPeace(tester);
      clock.advance(const Duration(seconds: 3));
      await holdPeace(tester);

      expect(find.byType(EffectOverlay), findsOneWidget);
      final secondKey = tester.widget<EffectOverlay>(find.byType(EffectOverlay)).key;
      expect(
        secondKey,
        isNot(equals(firstKey)),
        reason: 'the second confirmation must be an independent playback, '
            'not a continuation of the first',
      );
    },
  );

  testWidgets(
    "a two-handed pose's confirmation and effect playback render identically "
    'in kind to a one-handed pose (T057)',
    (tester) async {
      await pumpScreen(tester, overrides(effects: {
        'dragon': EffectDefinition(kind: EffectKind.particleBurst),
      }));
      await settle(tester);

      Future<void> holdDragon() async {
        matcher.fixedResult = const [
          Candidate(poseId: 'dragon', distance: 0.1, confidence: 0),
          Candidate(poseId: 'peace', distance: 5.0, confidence: 0),
        ];
        source.emit(makeTwoHandFrame());
        await tester.pump();
        await tester.pump();
      }

      await holdDragon();
      expect(find.byType(EffectOverlay), findsNothing, reason: 'not yet confirmed');

      clock.advance(const Duration(seconds: 3));
      await holdDragon();

      expect(
        find.byType(EffectOverlay),
        findsOneWidget,
        reason: 'a two-handed pose confirms and plays an effect exactly like a '
            'one-handed one — only the matcher-level eligibility gate differs',
      );
      final overlay = tester.widget<EffectOverlay>(find.byType(EffectOverlay));
      expect(overlay.definition.kind, EffectKind.particleBurst);
      expect(find.byKey(const Key('hud-confirmed')), findsOneWidget);
    },
  );
}
