/// The developer camera calibration panel — a **permanent** Developer Tool
/// (persistent per-device calibration system), not the temporary D25
/// instrument it started as.
///
/// D23/D24 established that inferring the correct preview/overlay transform
/// from platform-reported rotation and lens facing alone repeatedly failed
/// on real hardware; D25 built this screen to let a developer sweep every
/// transform by eye until it actually lines up. That combination is no
/// longer thrown away once found: every control here edits the same
/// [CameraCalibration] the live capture and recognition screens render
/// with (via [cameraCalibrationProvider]), persisted per lens, per device,
/// surviving restarts. Reachable only outside a release build
/// (`!kReleaseMode`), same as the other developer overlays.
///
/// **Renders through the exact same widgets production uses** —
/// [PreviewStage] for the texture, [HandLandmarkPainter] for the landmarks
/// — rather than a standalone pipeline. D25's original tool deliberately
/// used its own manual rendering to avoid touching production code while
/// experimenting; now that the values it finds *are* the production
/// values, keeping two separate implementations would risk exactly the
/// preview/overlay drift D23–D25 spent so much effort fixing. What you
/// calibrate is what you get.
///
/// This screen never calls `request()` — it reuses whatever camera session
/// is already live on the screen that opened it
/// (`cameraSessionControllerProvider` is an app-run singleton).
library;

import 'dart:async';
import 'dart:convert';

import 'package:capture/application/camera/camera_session_controller.dart';
import 'package:capture/application/debug/camera_calibration_notifier.dart';
import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/camera_calibration.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/presentation/capture/preview_stage.dart';
import 'package:capture/presentation/debug/hand_landmark_painter.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:capture/shared/di/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The four rotation choices every rotation control offers, in degrees.
const List<int> _rotationChoices = [0, 90, 180, 270];

/// Opens the calibration screen, reusing whichever camera session is already
/// live on the screen that calls this.
Future<void> openCameraCalibrationScreen(BuildContext context) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => const CameraCalibrationScreen()),
  );
}

/// The calibration screen itself.
class CameraCalibrationScreen extends ConsumerStatefulWidget {
  /// Creates the calibration screen.
  const CameraCalibrationScreen({super.key});

  @override
  ConsumerState<CameraCalibrationScreen> createState() =>
      _CameraCalibrationScreenState();
}

class _CameraCalibrationScreenState
    extends ConsumerState<CameraCalibrationScreen> {
  late final CameraSessionController _controller;
  CameraControllerState _camera = const CameraClosed();
  LandmarkFrame? _frame;
  StreamSubscription<CameraControllerState>? _cameraSubscription;
  StreamSubscription<LandmarkFrame>? _frameSubscription;

  @override
  void initState() {
    super.initState();
    // Read-only reuse: this screen never calls `request()`. The provider is
    // a singleton for the app run, so this is the exact same session the
    // screen underneath is already showing. `listenManual` (the same idiom
    // `CaptureScreen`/`RecognitionPreviewScreen` use) makes this screen able
    // to hold the autoDispose provider alive on its own too, rather than
    // depending entirely on the screen beneath it still being mounted.
    ref.listenManual(cameraSessionControllerProvider, (_, __) {});
    _controller = ref.read(cameraSessionControllerProvider);
    _camera = _controller.state;
    _cameraSubscription = _controller.states.listen((state) {
      if (mounted) setState(() => _camera = state);
    });
    _frameSubscription = _controller.rawFrames.listen((frame) {
      if (mounted) setState(() => _frame = frame);
    });
  }

  @override
  void dispose() {
    unawaited(_cameraSubscription?.cancel());
    unawaited(_frameSubscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final calibrationSet =
        ref.watch(cameraCalibrationProvider).valueOrNull ?? CameraCalibrationSet.defaults;
    final notifier = ref.read(cameraCalibrationProvider.notifier);
    final camera = _camera;
    final lens = camera is CameraLive ? camera.info.lens : null;
    final calibration = lens == null ? null : calibrationSet.forLens(lens);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Camera Calibration'),
        actions: [
          IconButton(
            key: const Key('calibration-reset'),
            tooltip: 'Reset this lens to defaults',
            icon: const Icon(Icons.restart_alt),
            onPressed: lens == null
                ? null
                : () => unawaited(notifier.resetLens(lens)),
          ),
          IconButton(
            key: const Key('calibration-export'),
            tooltip: 'Export calibration (JSON)',
            icon: const Icon(Icons.ios_share),
            onPressed: () => _showExport(context, calibrationSet),
          ),
          IconButton(
            key: const Key('calibration-import'),
            tooltip: 'Import calibration (JSON)',
            icon: const Icon(Icons.file_download_outlined),
            onPressed: () => _showImport(context, notifier),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: _Preview(camera: camera, frame: _frame, calibration: calibration),
          ),
          Expanded(
            flex: 4,
            child: lens == null || calibration == null
                ? const Center(
                    child: Text(
                      'No controls to show yet — open this from Capture or '
                      'Recognition Preview once the camera is live.',
                      textAlign: TextAlign.center,
                    ),
                  )
                : SingleChildScrollView(
                    padding: Spacing.screen,
                    child: _ControlsPanel(
                      lens: lens,
                      calibration: calibration,
                      notifier: notifier,
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  void _showExport(BuildContext context, CameraCalibrationSet calibrationSet) {
    final text = const JsonEncoder.withIndent('  ').convert(calibrationSet.toJson());
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Export calibration'),
        content: SingleChildScrollView(
          child: SelectableText(text, key: const Key('calibration-export-text')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  void _showImport(BuildContext context, CameraCalibrationNotifier notifier) {
    final textController = TextEditingController();
    String? error;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          return AlertDialog(
            title: const Text('Import calibration'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  key: const Key('calibration-import-field'),
                  controller: textController,
                  maxLines: 8,
                  decoration: const InputDecoration(
                    hintText: 'Paste an exported calibration document here',
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: Spacing.sm),
                  Text(
                    error!,
                    key: const Key('calibration-import-error'),
                    style: const TextStyle(color: Palette.discarded),
                  ),
                ],
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                key: const Key('calibration-import-submit'),
                onPressed: () async {
                  try {
                    await notifier.importJson(textController.text);
                    if (dialogContext.mounted) Navigator.of(dialogContext).pop();
                  } on Object catch (e) {
                    setDialogState(() => error = 'Could not parse that JSON: $e');
                  }
                },
                child: const Text('Import'),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The live preview, rendered through the exact same [PreviewStage] and
/// [HandLandmarkPainter] production screens use, so calibrating here means
/// calibrating what a real user actually sees.
class _Preview extends StatelessWidget {
  const _Preview({required this.camera, required this.frame, required this.calibration});

  final CameraControllerState camera;
  final LandmarkFrame? frame;
  final CameraCalibration? calibration;

  @override
  Widget build(BuildContext context) {
    final state = camera;
    final currentCalibration = calibration;
    if (state is! CameraLive || currentCalibration == null) {
      return const ColoredBox(
        color: Colors.black,
        child: Center(
          child: Text(
            'Waiting for the camera session already live on the previous '
            'screen…',
            style: TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return PreviewStage(
      info: state.info,
      calibration: currentCalibration,
      overlays: [
        CustomPaint(
          key: const Key('calibration-overlay-paint'),
          painter: HandLandmarkPainter(frame: frame, calibration: currentCalibration),
        ),
        Positioned(
          left: Spacing.sm,
          top: Spacing.sm,
          right: Spacing.sm,
          child: _ValuesBanner(calibration: currentCalibration),
        ),
      ],
    );
  }
}

/// The current numeric values, always visible while calibrating.
class _ValuesBanner extends StatelessWidget {
  const _ValuesBanner({required this.calibration});

  final CameraCalibration calibration;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('calibration-values-banner'),
      padding: const EdgeInsets.symmetric(horizontal: Spacing.sm, vertical: Spacing.xs),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        calibration.toString(),
        style: const TextStyle(color: Colors.white, fontSize: 11),
      ),
    );
  }
}

/// Every control for the currently-live [lens], grouped into a Preview
/// section and an Overlay section.
class _ControlsPanel extends StatelessWidget {
  const _ControlsPanel({
    required this.lens,
    required this.calibration,
    required this.notifier,
  });

  final LensPosition lens;
  final CameraCalibration calibration;
  final CameraCalibrationNotifier notifier;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Calibrating: ${lens.wireValue} lens',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: Spacing.sm),
        _SectionCard(
          title: 'Preview',
          children: [
            _RotationRow(
              keyPrefix: 'preview',
              value: calibration.previewRotation,
              onChanged: (degrees) =>
                  unawaited(notifier.setPreviewRotation(lens, degrees)),
            ),
            _SwitchRow(
              rowKey: const Key('preview-mirror-switch'),
              label: 'Mirror',
              value: calibration.previewMirror,
              onChanged: (_) => unawaited(notifier.togglePreviewMirror(lens)),
            ),
            _FitRow(
              value: calibration.previewFit,
              onChanged: (fit) => unawaited(notifier.setPreviewFit(lens, fit)),
            ),
          ],
        ),
        const SizedBox(height: Spacing.md),
        _SectionCard(
          title: 'Overlay',
          children: [
            _RotationRow(
              keyPrefix: 'overlay',
              value: calibration.overlayRotation,
              onChanged: (degrees) =>
                  unawaited(notifier.setOverlayRotation(lens, degrees)),
            ),
            _SwitchRow(
              rowKey: const Key('overlay-mirror-switch'),
              label: 'Mirror',
              value: calibration.overlayMirror,
              onChanged: (_) => unawaited(notifier.toggleOverlayMirror(lens)),
            ),
            _SwitchRow(
              rowKey: const Key('overlay-swap-xy-switch'),
              label: 'Swap X/Y',
              value: calibration.overlaySwapXY,
              onChanged: (_) => unawaited(notifier.toggleOverlaySwapXY(lens)),
            ),
            _SliderRow(
              sliderKey: const Key('overlay-scale-slider'),
              label: 'Scale',
              value: calibration.overlayScale,
              min: 0.5,
              max: 2.0,
              onChanged: (v) => unawaited(notifier.setOverlayScale(lens, v)),
            ),
            _SliderRow(
              sliderKey: const Key('overlay-offset-x-slider'),
              label: 'X Offset',
              value: calibration.overlayOffsetX,
              min: -0.5,
              max: 0.5,
              onChanged: (v) => unawaited(notifier.setOverlayOffsetX(lens, v)),
            ),
            _SliderRow(
              sliderKey: const Key('overlay-offset-y-slider'),
              label: 'Y Offset',
              value: calibration.overlayOffsetY,
              min: -0.5,
              max: 0.5,
              onChanged: (v) => unawaited(notifier.setOverlayOffsetY(lens, v)),
            ),
          ],
        ),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Palette.elevated,
      child: Padding(
        padding: const EdgeInsets.all(Spacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: Spacing.sm),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _RotationRow extends StatelessWidget {
  const _RotationRow({
    required this.keyPrefix,
    required this.value,
    required this.onChanged,
  });

  final String keyPrefix;
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Spacing.xs),
      child: Row(
        children: [
          const SizedBox(width: 72, child: Text('Rotation')),
          Expanded(
            child: SegmentedButton<int>(
              key: Key('$keyPrefix-rotation-segmented'),
              segments: [
                for (final degrees in _rotationChoices)
                  ButtonSegment(value: degrees, label: Text('$degrees°')),
              ],
              selected: {value},
              onSelectionChanged: (selection) => onChanged(selection.first),
            ),
          ),
        ],
      ),
    );
  }
}

class _FitRow extends StatelessWidget {
  const _FitRow({required this.value, required this.onChanged});

  final PreviewFit value;
  final ValueChanged<PreviewFit> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Spacing.xs),
      child: Row(
        children: [
          const SizedBox(width: 72, child: Text('Fit')),
          Expanded(
            child: SegmentedButton<PreviewFit>(
              key: const Key('preview-fit-segmented'),
              segments: [
                for (final fit in PreviewFit.values)
                  ButtonSegment(value: fit, label: Text(fit.wireValue)),
              ],
              selected: {value},
              onSelectionChanged: (selection) => onChanged(selection.first),
            ),
          ),
        ],
      ),
    );
  }
}

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
    required this.rowKey,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final Key rowKey;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(label)),
        Switch(key: rowKey, value: value, onChanged: onChanged),
      ],
    );
  }
}

class _SliderRow extends StatelessWidget {
  const _SliderRow({
    required this.sliderKey,
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });

  final Key sliderKey;
  final String label;
  final double value;
  final double min;
  final double max;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(width: 72, child: Text(label)),
        Expanded(
          child: Slider(
            key: sliderKey,
            value: value,
            min: min,
            max: max,
            divisions: 60,
            label: value.toStringAsFixed(2),
            onChanged: onChanged,
          ),
        ),
        SizedBox(width: 44, child: Text(value.toStringAsFixed(2), textAlign: TextAlign.end)),
      ],
    );
  }
}
