/// The capture screen: reference, progress, preview, and controls — the loop a
/// contributor actually works in.
///
/// Four R1 properties, all of which this widget exists to hold:
///
/// - **It expresses intent, never ownership.** It asks the camera controller to
///   acquire on mount and to release on unmount; the controller owns the
///   resource (FR-086). The old `stop()`-in-`dispose()` path — which released
///   nothing native — is gone.
/// - **It is a loop.** Every terminal state returns to idle *on this screen*
///   with the camera still held (FR-076). Leaving is an explicit user action.
/// - **Orientation is locked for the whole visit**, not per take (FR-049), so
///   neither the preview's aspect ratio nor a sample's frame geometry can change
///   while the screen is open.
/// - **All five required elements are visible at once** — reference, progress,
///   preview, Record, Sync — with the preview as the flexible one, so a small
///   screen shrinks the preview rather than clipping anything (FR-102/FR-106).
library;

import 'dart:async';

import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/capture/recording_state.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/presentation/capture/capture_control_bar.dart';
import 'package:capture/presentation/capture/capture_overlays.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/presentation/permissions/permission_screen.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The capture loop for one pose.
class CaptureScreen extends ConsumerStatefulWidget {
  /// Creates the capture screen.
  const CaptureScreen({required this.pose, super.key});

  /// The pose being collected.
  final PoseDefinition pose;

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen>
    with WidgetsBindingObserver {
  RecordingSessionState _state = const IdleState();
  CameraControllerState _camera = const CameraClosed();
  StreamSubscription<RecordingSessionState>? _takeSubscription;
  StreamSubscription<CameraControllerState>? _cameraSubscription;
  StreamSubscription<void>? _orientationSubscription;
  String? _notice;

  // Held directly rather than read through `ref` in dispose(): Riverpod forbids
  // `ref` once the widget is disposed, and releasing the camera on the way out
  // is the one thing this screen must never fail to do.
  late final CameraSessionController _controller;
  late final OrientationController _orientation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // `ref.read` alone would NOT keep an autoDispose provider alive — it
    // establishes no subscription, so the controller would be disposed the
    // moment this method returned, releasing the camera it had just acquired.
    // `listenManual` holds it for exactly as long as this screen is mounted,
    // which is the ownership FR-086 describes.
    ref.listenManual(cameraSessionControllerProvider, (_, __) {});
    _controller = ref.read(cameraSessionControllerProvider);
    _orientation = ref.read(orientationControllerProvider);
    _camera = _controller.state;
    _cameraSubscription = _controller.states.listen((state) {
      if (mounted) setState(() => _camera = state);
    });
    // FR-049: locked for the whole capture session, restored on leaving.
    unawaited(_lockOrientation());
    unawaited(_acquireCamera());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_takeSubscription?.cancel());
    unawaited(_cameraSubscription?.cancel());
    unawaited(_orientationSubscription?.cancel());
    // The controller's provider is autoDispose, so leaving this screen releases
    // the camera as a consequence of ownership ending. Asking explicitly makes
    // the reason accurate in the structured log (FR-096).
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
        _abandonTake();
        unawaited(controller.onAppPaused());
      case AppLifecycleState.resumed:
        unawaited(controller.onAppResumed());
    }
  }

  Future<void> _lockOrientation() async {
    if (!ref.read(configProvider).lockOrientationOnCaptureScreen) return;
    final orientation = _orientation;
    await orientation.lock();
    // FR-050: the lock is the mechanism; this is the safety net for a change it
    // could not prevent. The in-flight take is abandoned without saving, but the
    // camera is **not** released — the screen stays ready for the next take.
    _orientationSubscription = orientation.unexpectedChanges.listen((_) {
      final useCase = ref.read(runRecordingSessionProvider);
      if (useCase.isRunning) {
        useCase.abandon(SessionEndReason.orientationChanged);
      }
    });
  }

  Future<void> _acquireCamera() async {
    await _controller.request(
      ref.read(captureSettingsProvider.notifier).cameraRequest,
    );
  }

  /// Ends any in-flight take without saving (FR-068/FR-094).
  ///
  /// Returns whether a take was actually abandoned, so the caller can decide
  /// whether the user needs telling.
  bool _abandonTake() {
    final useCase = ref.read(runRecordingSessionProvider);
    if (!useCase.isRunning) return false;
    useCase.abandon(SessionEndReason.cameraReleased);
    return true;
  }

  void _startTake() {
    final info = _controller.info;
    if (info == null) return;

    final controller = _controller;
    final settings = ref.read(captureSettingsProvider);
    final useCase = ref.read(runRecordingSessionProvider);
    if (useCase.isRunning) return;

    setState(() => _notice = null);

    unawaited(_takeSubscription?.cancel());
    _takeSubscription = useCase
        .run(
          widget.pose,
          camera: info,
          settings: settings,
          frames: controller.frames,
        )
        .listen((state) {
      if (!mounted) return;
      setState(() => _state = state);

      if (state is SummaryState) {
        ref.read(lifecycleProvider).recordSession(
              accepted: state.result.accepted,
              discarded: state.result.discarded,
            );
        // FR-080: progress updates after every saved take, whether or not the
        // summary is shown.
        unawaited(ref.read(catalogProvider.notifier).refreshCounts());
        // FR-078: with confirmation off the screen returns to ready at once and
        // the result is still conveyed, without blocking.
        if (!ref.read(captureSettingsProvider).confirmTakes) {
          _showNotice(
            '${state.result.accepted} saved · '
            '${state.result.discarded} discarded',
          );
          _returnToIdle();
        }
      }
      if (state is CancelledState) {
        _showNotice(state.reason.userMessage);
        _returnToIdle();
      }
    });
  }

  /// FR-076: back to ready **on this screen**, camera untouched.
  void _returnToIdle() {
    if (!mounted) return;
    setState(() => _state = const IdleState());
  }

  void _showNotice(String? message) {
    if (message == null || !mounted) return;
    setState(() => _notice = message);
  }

  void _onModeChanged(CaptureMode mode) {
    _abandonTake();
    ref.read(captureSettingsProvider.notifier).selectMode(mode);
    _returnToIdle();
    unawaited(_acquireCamera());
  }

  void _onLensToggled() {
    final wasRunning = _abandonTake();
    ref.read(captureSettingsProvider.notifier).toggleLens();
    _returnToIdle();
    if (wasRunning) {
      // FR-068: the user did this, so say plainly that nothing was kept.
      _showNotice('Camera switched — that take was discarded. Nothing saved.');
    }
    unawaited(_acquireCamera());
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(captureSettingsProvider);
    final lenses = ref.watch(availableLensesProvider).valueOrNull ?? const {};
    final progress =
        ref.watch(catalogProvider).valueOrNull?.progressFor(widget.pose);
    final camera = _camera;

    // A permission problem is not a preview problem: it gets the screen that
    // explains it, with the route out the failure itself names (FR-109/FR-110).
    if (camera is CameraErrored &&
        (camera.failure.recovery == CameraRecovery.requestPermission ||
            camera.failure.recovery == CameraRecovery.openSettings)) {
      return PermissionScreen(
        failure: camera.failure,
        onRetry: () => unawaited(_acquireCamera()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.pose.displayName),
        actions: [
          RequiredHandsBadge(requiredHands: widget.pose.requiredHands),
          const SizedBox(width: Spacing.md),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: Spacing.screen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // -- reference + progress: fixed, always visible (FR-102/FR-104)
              SizedBox(
                height: 72,
                child: Row(
                  children: [
                    AspectRatio(
                      aspectRatio: 1,
                      child: PoseReferenceImage(
                        key: const Key('capture-reference-image'),
                        assetPath: widget.pose.referenceImage,
                        displayName: widget.pose.displayName,
                        compact: true,
                      ),
                    ),
                    const SizedBox(width: Spacing.md),
                    Expanded(
                      child: ProgressBar(
                        key: const Key('capture-progress'),
                        fraction: progress?.fraction ?? 0,
                        collected: progress?.collected ?? 0,
                        target: widget.pose.targetSampleCount,
                        isComplete: progress?.isComplete ?? false,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Spacing.sm),

              // -- preview: the flexible element, so it yields space first
              //    (FR-100/FR-103/FR-106)
              Expanded(
                key: const Key('preview-area'),
                child: _preview(camera),
              ),
              const SizedBox(height: Spacing.sm),

              if (_notice != null) ...[
                Text(
                  _notice!,
                  key: const Key('capture-notice'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
                const SizedBox(height: Spacing.sm),
              ],

              // -- settings controls (FR-105)
              CaptureControlBar(
                settings: settings,
                availableLenses: lenses,
                enabled: !_state.isActive,
                onModeChanged: _onModeChanged,
                onLensToggled: _onLensToggled,
                onCountdownChanged: (value) => ref
                    .read(captureSettingsProvider.notifier)
                    .setCountdownEnabled(enabled: value),
                onConfirmTakesChanged: (value) => ref
                    .read(captureSettingsProvider.notifier)
                    .setConfirmTakes(enabled: value),
              ),
              const SizedBox(height: Spacing.sm),

              // -- Record and Sync: fixed, always reachable (FR-102)
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      key: const Key('record-button'),
                      onPressed: camera.isLive && !_state.isActive
                          ? _startTake
                          : null,
                      icon: const Icon(Icons.fiber_manual_record),
                      label: Text(_state.isActive ? 'Recording…' : 'Record'),
                    ),
                  ),
                  const SizedBox(width: Spacing.sm),
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('sync-button'),
                      onPressed: _state.isActive
                          ? null
                          : () => unawaited(
                              ref.read(exportDatasetProvider).run().drain<void>(),
                            ),
                      icon: const Icon(Icons.ios_share),
                      label: const Text('Sync'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _preview(CameraControllerState camera) {
    return switch (camera) {
      CameraLive(:final info) => PreviewStage(
        info: info,
        overlays: [
          if (_state is CountdownState)
            CountdownOverlay(
              state: _state as CountdownState,
              pose: widget.pose,
            ),
          if (_state is CapturingState)
            CapturingOverlay(state: _state as CapturingState),
          if (_state is SavingState)
            const Center(child: CircularProgressIndicator()),
          if (_state is SummaryState)
            Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: Spacing.screen,
                child: CaptureSummaryCard(
                  result: (_state as SummaryState).result,
                  onDismiss: _returnToIdle,
                ),
              ),
            ),
        ],
      ),
      CameraOpening(:final step) => PreviewPlaceholder(message: step.message),
      CameraErrored(:final failure) => PreviewPlaceholder(
        message: failure.message,
        action: _recoveryAction(failure),
      ),
      CameraClosed() => const PreviewPlaceholder(message: 'Camera is off.'),
    };
  }

  /// Every failure gets a working way out — none ends in a spinner (SC-029).
  Widget _recoveryAction(CameraFailure failure) => switch (failure.recovery) {
    CameraRecovery.openSettings => FilledButton(
      key: const Key('open-settings-button'),
      onPressed: () =>
          unawaited(ref.read(cameraPermissionsProvider).openSettings()),
      child: const Text('Open settings'),
    ),
    CameraRecovery.useOtherLens => FilledButton(
      key: const Key('use-other-lens-button'),
      onPressed: _onLensToggled,
      child: const Text('Use the other camera'),
    ),
    CameraRecovery.requestPermission || CameraRecovery.retry => FilledButton(
      key: const Key('retry-camera-button'),
      onPressed: () => unawaited(_acquireCamera()),
      child: const Text('Try again'),
    ),
  };
}

/// End reasons the UI explains rather than showing as a bare failure.
extension SessionEndReasonMessage on SessionEndReason {
  /// A short, plain-language explanation of why a take ended early.
  String? get userMessage => switch (this) {
    SessionEndReason.orientationChanged =>
      'The screen rotated, so the take was discarded. Nothing was saved.',
    SessionEndReason.cameraReleased =>
      'The camera stopped, so the take was discarded. Nothing was saved.',
    SessionEndReason.cancelled => null,
    _ => null,
  };
}
