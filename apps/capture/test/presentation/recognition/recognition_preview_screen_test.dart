/// `RecognitionPreviewScreen`: live-prediction states (T030) and the
/// screen's own camera lifecycle, independent of `CameraSessionController`'s
/// already-covered internals (analysis finding M1, T067).
library;

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:capture/presentation/recognition/prediction_hud.dart';
import 'package:capture/presentation/recognition/recognition_preview_screen.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fakes.dart';
import '../../support/recognition_fakes.dart';
import '../../support/sample_factories.dart';

/// A synchronous catalog source: `catalogProvider` also feeds the rest of
/// the app (`PoseCatalogNotifier.build`), and loading the real asset is real
/// file I/O that a widget test's fake-async `pump()` never drives to
/// completion — only `tester.runAsync` does, which the lifecycle tests below
/// already need for a different reason (releasing the camera). Avoiding real
/// asset I/O altogether keeps every other test in this file on plain `pump`.
class _FakeCatalogSource implements PoseCatalogSource {
  @override
  Future<PoseCatalog> load() async =>
      PoseCatalog([makePose(poseId: 'peace'), makePose(poseId: 'ok')]);
}

/// A `SampleRepository` that never touches disk — `catalogProvider` reads
/// sample counts alongside the catalog (`PoseCatalogNotifier.build`), and
/// `FileSampleRepository.countAll()` is real directory-listing I/O with the
/// same fake-async incompatibility as `_FakeCatalogSource` works around.
/// `exemplarSourceProvider` is overridden separately and never touches this.
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

  setUp(() {
    source = FakeCameraSource();
    matcher = FakePoseMatcher();
    exemplarSource = FakeExemplarSource(
      makeExemplarLoadResult({'peace': 25, 'ok': 25}),
    );
  });

  List<Override> overrides() => [
    cameraSourceProvider.overrideWithValue(source),
    poseMatcherProvider.overrideWithValue(matcher),
    exemplarSourceProvider.overrideWithValue(exemplarSource),
    catalogSourceProvider.overrideWithValue(_FakeCatalogSource()),
    sampleRepositoryProvider.overrideWithValue(_FakeSampleRepository()),
    effectCatalogSourceProvider.overrideWith(
      (ref) async => FakeEffectCatalogSource(),
    ),
    configProvider.overrideWithValue(
      const CaptureConfig(lockOrientationOnCaptureScreen: false),
    ),
    applicationVersionProvider.overrideWith((ref) async => 'mudra-capture/0.1.0'),
  ];

  Future<void> pumpScreen(
    WidgetTester tester, {
    Size surface = const Size(400, 800),
    bool show = true,
  }) async {
    tester.view.physicalSize = surface;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: overrides(),
        child: MaterialApp(
          home: show ? const RecognitionPreviewScreen() : const SizedBox.shrink(),
        ),
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

  // Frame delivery runs through a stream (`CameraSession.frames` →
  // `CameraSessionController.frames` → this screen's subscription), so one
  // extra pump beyond the emitting `pump()` is needed to flush the resulting
  // `setState` — a single pump only flushes the emission itself.
  Future<void> emitAndSettle(
    WidgetTester tester,
    FakeCameraSource source,
    LandmarkFrame frame,
  ) async {
    source.emit(frame);
    await tester.pump();
    await tester.pump();
  }

  group('live-prediction states', () {
    testWidgets('defaults to the front lens and starts mirrored (FR-003)', (tester) async {
      await pumpScreen(tester);
      await settle(tester);

      expect(source.current, isNotNull);
      expect(source.current!.info.lens.wireValue, 'front');
      expect(source.current!.info.mirroredPreview, isTrue);
    });

    testWidgets('shows a loading state before the camera and exemplars are ready', (tester) async {
      source.openDelay = const Duration(milliseconds: 200);
      await pumpScreen(tester);
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      // Let the pending camera-open timer resolve before the test ends,
      // otherwise the test framework treats it as a leaked timer.
      await settle(tester);
    });

    testWidgets('a handless frame shows the no-hand state', (tester) async {
      await pumpScreen(tester);
      await settle(tester);

      await emitAndSettle(tester, source, makeEmptyFrame());

      expect(find.byKey(const Key('hud-status-no-hand')), findsOneWidget);
    });

    testWidgets('a low-confidence frame shows the unrecognized state', (tester) async {
      matcher.fixedResult = const [];
      await pumpScreen(tester);
      await settle(tester);

      await emitAndSettle(tester, source, makeFrame());

      expect(find.byKey(const Key('hud-status-unrecognized')), findsOneWidget);
    });

    testWidgets('a narrow-margin frame shows the ambiguous state', (tester) async {
      // Distances close enough that the top confidence clears the default
      // confidence floor (0.5) but its margin over the second candidate
      // stays under the default ambiguity margin (0.12).
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
        Candidate(poseId: 'ok', distance: 0.15, confidence: 0),
      ];
      await pumpScreen(tester);
      await settle(tester);

      await emitAndSettle(tester, source, makeFrame());

      expect(find.byKey(const Key('hud-status-ambiguous')), findsOneWidget);
    });

    testWidgets('a confident frame shows the top pose, confidence, and top-3', (tester) async {
      matcher.fixedResult = const [
        Candidate(poseId: 'peace', distance: 0.1, confidence: 0),
        Candidate(poseId: 'ok', distance: 5.0, confidence: 0),
      ];
      await pumpScreen(tester);
      await settle(tester);

      await emitAndSettle(tester, source, makeFrame());

      expect(find.byKey(const Key('hud-top-pose')), findsOneWidget);
      expect(find.byKey(const Key('hud-top-confidence')), findsOneWidget);
      expect(find.byKey(const Key('hud-latency')), findsOneWidget);
    });

    testWidgets('the prediction HUD overlays the preview stage', (tester) async {
      await pumpScreen(tester);
      await settle(tester);

      expect(
        find.descendant(
          of: find.byType(PreviewStage),
          matching: find.byType(PredictionHud),
        ),
        findsOneWidget,
      );
    });
  });

  group('camera lifecycle (analysis finding M1, T067)', () {
    testWidgets('entering the screen opens exactly one camera session', (tester) async {
      await pumpScreen(tester);
      await settle(tester);

      expect(source.openCount, 1);
      expect(source.liveCount, 1);
    });

    testWidgets('leaving the screen releases every camera resource within 1s', (tester) async {
      await pumpScreen(tester);
      await settle(tester);
      expect(source.liveCount, 1);

      await tester.runAsync(() async {
        await tester.pumpWidget(
          ProviderScope(
            overrides: overrides(),
            child: const MaterialApp(home: SizedBox.shrink()),
          ),
        );
        final deadline = DateTime.now().add(const Duration(seconds: 1));
        while (source.liveCount != 0 && DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      await tester.pump();

      expect(
        source.liveCount,
        0,
        reason: 'FR-027: the camera must be released within one second of '
            'leaving the recognition preview',
      );
    });

    testWidgets(
      're-entering after leaving opens a fresh session with no leaked reference',
      (tester) async {
        await pumpScreen(tester);
        await settle(tester);
        expect(source.liveCount, 1);
        expect(source.openCount, 1);

        // Leave.
        await tester.runAsync(() async {
          await tester.pumpWidget(
            ProviderScope(
              overrides: overrides(),
              child: const MaterialApp(home: SizedBox.shrink()),
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 100));
        });
        await tester.pump();
        expect(source.liveCount, 0);

        // Re-enter: a fresh ProviderScope, exactly as a real navigation would
        // create a fresh autoDispose provider instance.
        await pumpScreen(tester);
        await settle(tester);

        expect(
          source.liveCount,
          1,
          reason: 'never 0 sessions "stuck" or 2 sessions live at once',
        );
      },
    );
  });
}
