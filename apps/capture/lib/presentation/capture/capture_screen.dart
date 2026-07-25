/// The capture screen: live preview, countdown, and result.
///
/// The preview is **never** frozen during the countdown (FR-011) — the user
/// must be able to watch and correct their own hands, which is the entire
/// reason the countdown exists.
library;

import 'dart:async';

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/capture/capture_state.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/infrastructure/platform/platform_adapters.dart'
    show CameraPermissionStatus;
import 'package:capture/presentation/capture/capture_overlays.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/presentation/permissions/permission_screen.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Runs one capture session for a pose.
class CaptureScreen extends ConsumerStatefulWidget {
  /// Creates the capture screen.
  const CaptureScreen({required this.pose, super.key});

  /// The pose being collected.
  final PoseDefinition pose;

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen> {
  CaptureSessionState _state = const IdleState();
  LandmarkSourceSession? _session;
  Failure? _failure;
  StreamSubscription<CaptureSessionState>? _subscription;

  @override
  void initState() {
    super.initState();
    unawaited(_startSession());
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    unawaited(ref.read(handLandmarkSourceProvider).stop());
    super.dispose();
  }

  Future<void> _startSession() async {
    final permissions = ref.read(cameraPermissionsProvider);
    final status = await permissions.current();
    final granted = status == CameraPermissionStatus.granted
        ? status
        : await permissions.request();

    if (!mounted) return;
    if (granted != CameraPermissionStatus.granted) {
      setState(() => _failure = CameraFailure.permissionDenied());
      return;
    }

    try {
      final source = ref.read(handLandmarkSourceProvider);
      final session = await source.start();
      if (!mounted) return;
      setState(() => _session = session);

      final useCase = ref.read(runCaptureSessionProvider);
      _subscription = useCase.run(widget.pose, session).listen((state) {
        if (!mounted) return;
        setState(() => _state = state);
        if (state is CancelledState) _onEnded();
        if (state is FailedState) setState(() => _failure = state.failure);
        if (state is SummaryState) {
          ref.read(lifecycleProvider).recordSession(
                accepted: state.result.accepted,
                discarded: state.result.discarded,
              );
        }
      });
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    }
  }

  void _onEnded() {
    if (!mounted) return;
    Navigator.of(context).maybePop();
  }

  void _cancel() {
    ref.read(runCaptureSessionProvider).cancel();
    _onEnded();
  }

  @override
  Widget build(BuildContext context) {
    final failure = _failure;
    if (failure != null) {
      return PermissionScreen(
        failure: failure,
        onRetry: () {
          setState(() => _failure = null);
          unawaited(_startSession());
        },
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            _preview(),
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
              Padding(
                padding: Spacing.screen,
                child: Align(
                  alignment: Alignment.bottomCenter,
                  child: CaptureSummaryCard(
                    result: (_state as SummaryState).result,
                    onDismiss: _onEnded,
                  ),
                ),
              ),
            Positioned(
              left: Spacing.sm,
              top: Spacing.sm,
              child: IconButton(
                key: const Key('cancel-button'),
                onPressed: _cancel,
                icon: const Icon(Icons.close, size: 30),
                tooltip: 'Cancel',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _preview() {
    final session = _session;
    if (session == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return Center(child: Texture(textureId: session.textureId));
  }
}

/// End reasons the UI explains rather than showing as a bare failure.
extension SessionEndReasonMessage on SessionEndReason {
  /// A short, plain-language explanation of why a session ended early.
  String? get userMessage => switch (this) {
    SessionEndReason.orientationChanged =>
      'The screen rotated, so the take was discarded. Nothing was saved.',
    SessionEndReason.cancelled => null,
    _ => null,
  };
}
