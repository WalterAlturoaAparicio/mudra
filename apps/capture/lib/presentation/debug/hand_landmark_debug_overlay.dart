/// The developer-only hand landmark debug overlay (spec 003 Revision R2).
///
/// A self-contained rendering component (FR-124): it depends on nothing but
/// the [LandmarkFrame] stream and [CameraSessionInfo] it is given, and
/// nothing in the recording or recognition pipeline depends on it. It owns
/// its **own** subscription to that stream — a broadcast stream
/// `RunRecordingSession` and `RecognitionSessionController` subscribe to
/// independently (on `CameraSessionController.frames`, not this widget's
/// `rawFrames`) — so adding it never changes what either of them observes
/// (FR-122).
///
/// [frames] MUST be `CameraSessionController.rawFrames`, never `.frames` —
/// see [DisplayOrientation]'s doc comment for why reusing the
/// dataset-canonicalized stream for on-screen rendering is exactly the bug
/// this type was introduced to fix (rear-lens landmarks drawn mirrored over
/// an unmirrored preview).
///
/// Mounted only while the debug toggle is on: leaving it out of the widget
/// tree is what makes disabling it release its subscription, by the same
/// ownership pattern `cameraSessionControllerProvider` uses for the camera
/// itself (FR-126), rather than a remembered `cancel()` call.
library;

import 'dart:async';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/canonical/display_orientation.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/debug/coordinate_debug_painter.dart';
import 'package:capture/presentation/debug/hand_landmark_painter.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Renders the live landmark stream's hands over the preview, plus a compact
/// readout of handedness, confidence, and hand count (FR-117/FR-120), and —
/// when [showCoordinateDebug] is on — the temporary coordinate-pipeline
/// diagnostics from [CoordinateDebugPainter] plus throttled console logging
/// of every value that feeds the analysis-space → display-space transform.
class HandLandmarkDebugOverlay extends StatefulWidget {
  /// Creates the overlay, drawing frames from [frames] as they arrive,
  /// mapped into display space using [info].
  const HandLandmarkDebugOverlay({
    required this.frames,
    required this.info,
    required this.calibration,
    this.showCoordinateDebug = false,
    super.key,
  });

  /// The live camera session's **raw** (uncanonicalized) landmark frames —
  /// `CameraSessionController.rawFrames`.
  final Stream<LandmarkFrame> frames;

  /// What the live session reports about itself — used for the
  /// coordinate-pipeline diagnostics only; the landmarks themselves are
  /// mapped via [calibration].
  final CameraSessionInfo info;

  /// This lens's persisted overlay calibration — the same value [PreviewStage]
  /// is given for its `Texture`, so the two can never observe a different
  /// transform.
  final CameraCalibration calibration;

  /// Whether to also draw [CoordinateDebugPainter]'s diagnostics and log
  /// throttled coordinate-pipeline values to the console (temporary
  /// investigation tooling — see that painter's doc comment).
  final bool showCoordinateDebug;

  @override
  State<HandLandmarkDebugOverlay> createState() =>
      _HandLandmarkDebugOverlayState();
}

class _HandLandmarkDebugOverlayState extends State<HandLandmarkDebugOverlay> {
  LandmarkFrame? _frame;
  StreamSubscription<LandmarkFrame>? _subscription;
  DateTime? _lastLoggedAt;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(covariant HandLandmarkDebugOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.frames, widget.frames)) {
      unawaited(_subscription?.cancel());
      _frame = null;
      _subscribe();
    }
  }

  void _subscribe() {
    _subscription = widget.frames.listen((frame) {
      if (!mounted) return;
      setState(() => _frame = frame);
      if (widget.showCoordinateDebug) _maybeLog(frame);
    });
  }

  /// Prints the full coordinate-pipeline state at most once a second —
  /// frequent enough to catch a change, rare enough not to flood the
  /// console at frame rate. Temporary instrumentation (research D24); grep
  /// for `[coord-debug]` to find or remove every line this adds.
  void _maybeLog(LandmarkFrame frame) {
    final now = DateTime.now();
    if (_lastLoggedAt != null &&
        now.difference(_lastLoggedAt!) < const Duration(seconds: 1)) {
      return;
    }
    _lastLoggedAt = now;

    final info = widget.info;
    final orientation = DisplayOrientation.fromSession(info);
    final buffer = StringBuffer()
      ..writeln('[coord-debug] lens=${info.lens.wireValue} '
          'mirroredPreview=${info.mirroredPreview} '
          'rotationDegrees=${info.rotationDegrees} '
          'quarterTurns=${orientation.quarterTurns}')
      ..writeln('[coord-debug] preview=${info.previewWidth}x${info.previewHeight} '
          '(raw) analysis=${info.analysisWidth}x${info.analysisHeight} '
          '(raw) frame=${frame.frameWidth}x${frame.frameHeight}')
      ..writeln('[coord-debug] hands=${frame.hands.length}');
    for (final hand in frame.hands) {
      for (final (index, label) in coordinateDebugLandmarks) {
        final point = hand.landmarks.points[index];
        final (dx, dy) = orientation.mapPoint(point.x, point.y);
        buffer.writeln(
          '[coord-debug]   ${hand.handedness.wireValue} $label: '
          'raw=(${point.x.toStringAsFixed(3)}, ${point.y.toStringAsFixed(3)}) '
          '-> display=(${dx.toStringAsFixed(3)}, ${dy.toStringAsFixed(3)})',
        );
      }
    }
    debugPrint(buffer.toString());
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final orientation = DisplayOrientation.fromSession(widget.info);
    return IgnorePointer(
      child: Stack(
        fit: StackFit.expand,
        children: [
          CustomPaint(
            key: const Key('debug-overlay-paint'),
            painter: HandLandmarkPainter(frame: _frame, calibration: widget.calibration),
            size: Size.infinite,
          ),
          if (widget.showCoordinateDebug)
            CustomPaint(
              key: const Key('coordinate-debug-paint'),
              painter: CoordinateDebugPainter(frame: _frame, orientation: orientation),
              size: Size.infinite,
            ),
          Positioned(
            left: Spacing.sm,
            bottom: Spacing.sm,
            child: _StatsPanel(frame: _frame),
          ),
        ],
      ),
    );
  }
}

/// A small, legible readout of what the current frame reports (FR-120).
class _StatsPanel extends StatelessWidget {
  const _StatsPanel({required this.frame});

  final LandmarkFrame? frame;

  @override
  Widget build(BuildContext context) {
    final hands = frame?.hands ?? const <HandDetection>[];
    return Container(
      key: const Key('debug-overlay-stats'),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.sm,
        vertical: Spacing.xs,
      ),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Hands: ${hands.length}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          for (final hand in hands)
            Text(
              '${hand.handedness.wireValue} '
              '${hand.confidence.toStringAsFixed(2)}',
              style: TextStyle(color: _colorFor(hand.handedness), fontSize: 12),
            ),
        ],
      ),
    );
  }

  Color _colorFor(Handedness handedness) => switch (handedness) {
    Handedness.left => Palette.leftHand,
    Handedness.right => Palette.rightHand,
    Handedness.unknown => Palette.unknownHand,
  };
}
