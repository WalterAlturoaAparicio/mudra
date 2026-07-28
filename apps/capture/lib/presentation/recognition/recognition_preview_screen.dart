/// Phase 2.75 — Live Recognition Preview screen.
///
/// A new, separate mode alongside specification 003's capture flow (FR-002),
/// reusing its camera seam exactly as the capture screen does (research D9):
/// same `cameraSessionControllerProvider`, same orientation lock, same
/// release-on-leave guarantee (FR-027). It owns no dataset-writing use case —
/// only [LoadExemplars] (read-only, FR-004) and the pure
/// `RecognitionSessionController` pipeline.
library;

import 'dart:async';

import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/application/recognition/recognition_session_controller.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/domain/recognition/stability.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:capture/presentation/debug/camera_calibration_screen.dart';
import 'package:capture/presentation/debug/coordinate_debug_toggle_button.dart';
import 'package:capture/presentation/debug/debug_overlay_toggle_button.dart';
import 'package:capture/presentation/debug/hand_landmark_debug_overlay.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/presentation/recognition/catalog_readiness_sheet.dart';
import 'package:capture/presentation/recognition/effect_overlay.dart';
import 'package:capture/presentation/recognition/prediction_hud.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Live prediction, stability, and confirmation over the existing dataset.
class RecognitionPreviewScreen extends ConsumerStatefulWidget {
  /// Creates the recognition preview screen.
  const RecognitionPreviewScreen({super.key});

  @override
  ConsumerState<RecognitionPreviewScreen> createState() =>
      _RecognitionPreviewScreenState();
}

class _RecognitionPreviewScreenState
    extends ConsumerState<RecognitionPreviewScreen> with WidgetsBindingObserver {
  CameraControllerState _camera = const CameraClosed();
  StreamSubscription<CameraControllerState>? _cameraSubscription;
  StreamSubscription<LandmarkFrame>? _frameSubscription;
  StreamSubscription<LandmarkFrame>? _rawFrameSubscription;
  StreamSubscription<void>? _orientationSubscription;
  LandmarkFrame? _lastRawFrame;

  late final CameraSessionController _controller;
  late final OrientationController _orientation;
  RecognitionSessionController? _recognition;
  bool _recognitionStarted = false;

  bool _loadingExemplars = true;
  ExemplarLoadFailure? _loadError;
  RecognitionResult? _result;
  DateTime _now = DateTime.now();
  CatalogReadiness _readiness = CatalogReadiness(const []);

  EffectDefinition? _activeEffect;
  Offset _activeEffectAnchor = const Offset(0.5, 0.5);
  DateTime? _activeEffectKey;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Same ownership pattern as `CaptureScreen`: `listenManual` keeps the
    // autoDispose provider alive for exactly as long as this screen is
    // mounted (research D9), so leaving releases the camera as a consequence
    // of ownership ending, not a remembered call.
    ref.listenManual(cameraSessionControllerProvider, (_, __) {});
    _controller = ref.read(cameraSessionControllerProvider);
    _orientation = ref.read(orientationControllerProvider);
    _camera = _controller.state;
    _cameraSubscription = _controller.states.listen((state) {
      if (mounted) setState(() => _camera = state);
    });

    unawaited(_lockOrientation());
    unawaited(_acquireCamera());

    // `recognitionSessionControllerProvider`/`exemplarSourceProvider` both
    // read the already-loaded catalog (they never fetch it themselves), so
    // recognition must not start building either until the catalog — loaded
    // once, app-wide, well before this screen is reachable from the home
    // screen — is actually ready. A standalone widget test that pumps this
    // screen without that guarantee would otherwise hit the catalog mid-load.
    final initialCatalog = ref.read(catalogProvider).valueOrNull?.catalog;
    if (initialCatalog != null) {
      _startRecognition();
    } else {
      ref.listenManual(catalogProvider, (previous, next) {
        if (!_recognitionStarted && next.valueOrNull != null) _startRecognition();
      });
    }
  }

  void _startRecognition() {
    if (_recognitionStarted) return;
    _recognitionStarted = true;
    ref.listenManual(recognitionSessionControllerProvider, (_, __) {});
    _recognition = ref.read(recognitionSessionControllerProvider);
    unawaited(_loadExemplarsThenSubscribe());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_cameraSubscription?.cancel());
    unawaited(_frameSubscription?.cancel());
    unawaited(_rawFrameSubscription?.cancel());
    unawaited(_orientationSubscription?.cancel());
    unawaited(_controller.release(CameraReleaseReason.screenLeft));
    unawaited(_orientation.unlock());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _controller;
    switch (state) {
      case AppLifecycleState.inactive:
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        unawaited(controller.onAppPaused());
      case AppLifecycleState.resumed:
        unawaited(controller.onAppResumed());
    }
  }

  Future<void> _lockOrientation() async {
    if (!ref.read(configProvider).lockOrientationOnCaptureScreen) return;
    await _orientation.lock();
    _orientationSubscription = _orientation.unexpectedChanges.listen((_) {});
  }

  Future<void> _acquireCamera() async {
    final config = ref.read(configProvider);
    await _controller.request(
      CameraRequest(
        lens: LensPosition.front,
        analysisWidth: config.analysisWidth,
        analysisHeight: config.analysisHeight,
      ),
    );
  }

  /// Loads the current dataset's exemplars once (FR-004), then begins
  /// consuming frames — never the other way round (T027): a frame must never
  /// be scored against a stale or empty exemplar set.
  Future<void> _loadExemplarsThenSubscribe() async {
    try {
      final result = await ref.read(loadExemplarsProvider).call();
      if (!mounted) return;
      _recognition!.loadExemplars(result);
      setState(() {
        _loadingExemplars = false;
        _readiness = result.readiness;
      });
      _frameSubscription = _controller.frames.listen(_onFrame);
      // Raw (uncanonicalized) frames, kept only for the effect anchor below —
      // matching must stay on the canonical stream above (FR-004's dataset
      // convention), but where the effect is *drawn* must agree with what the
      // preview actually shows (see `DisplayOrientation`'s doc comment).
      _rawFrameSubscription =
          _controller.rawFrames.listen((frame) => _lastRawFrame = frame);
    } on ExemplarLoadFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _loadingExemplars = false;
        _loadError = failure;
      });
    }
  }

  void _onFrame(LandmarkFrame frame) {
    final recognition = _recognition;
    if (recognition == null) return;
    // Confirmation and effect lookup never gate this: the live pipeline
    // keeps running unconditionally every frame (FR-022) — `_triggerEffect`
    // below only ever adds presentation state, never blocks or delays this.
    final (result, confirmation) = recognition.process(frame);
    if (!mounted) return;
    setState(() {
      _result = result;
      _now = DateTime.now();
    });
    if (confirmation != null) unawaited(_triggerEffect(confirmation, frame));
  }

  /// Looks up [event.poseId]'s effect and starts exactly one playback,
  /// anchored to the confirming frame's hand landmarks (FR-019/FR-022).
  ///
  /// Awaits the catalog's own future rather than reading a possibly-still-
  /// loading `AsyncValue` — the catalog is a small bundled asset that
  /// resolves quickly, but a confirmation can in principle be the very first
  /// read of it, and a silently-skipped effect would be a worse failure mode
  /// than one extra `await`. Recognition itself is unaffected either way:
  /// this runs after `process()` has already returned (FR-022).
  Future<void> _triggerEffect(ConfirmationEvent event, LandmarkFrame frame) async {
    final catalogSource = await ref.read(effectCatalogSourceProvider.future);
    if (!mounted) return;
    setState(() {
      _activeEffect = catalogSource.effectFor(event.poseId);
      _activeEffectAnchor = _anchorFor(_lastRawFrame);
      _activeEffectKey = event.confirmedAt;
    });
  }

  /// The centroid of every hand in [frame], mapped into **display space**
  /// via this lens's persisted [CameraCalibration] — a demo-quality anchor,
  /// not a per-pose-tuned one (FR-021), but one that must still land on the
  /// hand the user actually sees.
  ///
  /// [frame] MUST be a **raw** frame (`_lastRawFrame`, sourced from
  /// `CameraSessionController.rawFrames`), never the canonicalized frame
  /// [recognition] just matched against — canonicalization is a
  /// dataset-storage convention (mirrored for the rear lens) unrelated to
  /// what the rear lens's actual, unmirrored preview shows on screen. See
  /// [CameraCalibration]'s doc comment for the full explanation.
  Offset _anchorFor(LandmarkFrame? frame) {
    final info = _controller.info;
    if (frame == null || info == null || frame.hands.isEmpty) {
      return const Offset(0.5, 0.5);
    }
    final calibrationSet =
        ref.read(cameraCalibrationProvider).valueOrNull ?? CameraCalibrationSet.defaults;
    final calibration = calibrationSet.forLens(info.lens);
    var sumX = 0.0;
    var sumY = 0.0;
    var count = 0;
    for (final hand in frame.hands) {
      for (final point in hand.landmarks.points) {
        final (x, y) = calibration.mapOverlayPoint(point.x, point.y);
        sumX += x;
        sumY += y;
        count++;
      }
    }
    return Offset(sumX / count, sumY / count);
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(catalogProvider).valueOrNull?.catalog;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Recognition Preview'),
        actions: [
          if (catalog != null && !_loadingExemplars)
            IconButton(
              key: const Key('open-readiness-sheet-button'),
              tooltip: 'Dataset readiness',
              icon: const Icon(Icons.fact_check_outlined),
              onPressed: () => _openReadinessSheet(catalog),
            ),
          if (!kReleaseMode) ...[
            const DebugOverlayToggleButton(),
            const CoordinateDebugToggleButton(),
            IconButton(
              key: const Key('open-camera-calibration'),
              tooltip: 'Camera calibration',
              icon: const Icon(Icons.tune),
              onPressed: () => unawaited(openCameraCalibrationScreen(context)),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: catalog == null
            ? const Center(child: CircularProgressIndicator())
            : _body(catalog),
      ),
    );
  }

  /// Opens the readiness view without a second dataset read — it renders the
  /// `CatalogReadiness` `LoadExemplars` already produced for this visit
  /// (research D10).
  void _openReadinessSheet(PoseCatalog catalog) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => CatalogReadinessSheet(catalog: catalog, readiness: _readiness),
    );
  }

  Widget _body(PoseCatalog catalog) {
    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: Spacing.screen,
          child: Column(
            key: const Key('recognition-load-error'),
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Palette.discarded),
              const SizedBox(height: Spacing.md),
              Text(
                _loadError!.message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: Spacing.md),
              FilledButton(
                onPressed: () {
                  setState(() {
                    _loadError = null;
                    _loadingExemplars = true;
                  });
                  unawaited(_loadExemplarsThenSubscribe());
                },
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
    }

    if (_loadingExemplars) {
      return const Center(
        key: Key('recognition-loading'),
        child: CircularProgressIndicator(),
      );
    }

    return Padding(
      padding: Spacing.screen,
      child: _preview(catalog),
    );
  }

  Widget _preview(PoseCatalog catalog) {
    final camera = _camera;
    final calibrationSet =
        ref.watch(cameraCalibrationProvider).valueOrNull ?? CameraCalibrationSet.defaults;
    return switch (camera) {
      CameraLive(:final info) => PreviewStage(
        info: info,
        calibration: calibrationSet.forLens(info.lens),
        overlays: [
          if (!kReleaseMode && ref.watch(debugOverlayEnabledProvider))
            HandLandmarkDebugOverlay(
              frames: _controller.rawFrames,
              info: info,
              calibration: calibrationSet.forLens(info.lens),
              showCoordinateDebug: ref.watch(coordinateDebugEnabledProvider),
            ),
          PredictionHud(
            result: _result,
            // Safe: `_preview` is only reached once `_loadingExemplars` is
            // false, which only happens after `_recognition` is created.
            stability: _recognition!.stability,
            stabilityDuration: ref.read(recognitionConfigProvider).stabilityDuration,
            catalog: catalog,
            now: _now,
            readiness: _readiness,
          ),
          if (_activeEffect != null)
            EffectOverlay(
              key: ValueKey(_activeEffectKey),
              definition: _activeEffect!,
              anchor: _activeEffectAnchor,
              onCompleted: () {
                if (!mounted) return;
                setState(() {
                  _activeEffect = null;
                  _activeEffectKey = null;
                });
              },
            ),
        ],
      ),
      CameraOpening(:final step) => PreviewPlaceholder(message: step.message),
      CameraErrored(:final failure) =>
        PreviewPlaceholder(message: failure.message),
      CameraClosed() => const PreviewPlaceholder(message: 'Camera is off.'),
    };
  }
}
