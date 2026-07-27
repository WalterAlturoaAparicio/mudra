/// The recognition preview's primary content (FR-014): live prediction,
/// confidence, top-3, latency, and the continuously-updating stability
/// indicator.
///
/// FR-013's three "not a confident prediction" states — no hand, unrecognized,
/// ambiguous — are rendered distinctly from a real `Recognized` result, never
/// as a low-quality guess dressed up as one.
library;

import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/candidate.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/recognition_result.dart';
import 'package:capture/domain/recognition/stability.dart';
import 'package:capture/presentation/design/design.dart';
import 'package:flutter/material.dart';

/// Overlay showing the live recognition result and stability progress.
class PredictionHud extends StatelessWidget {
  /// Creates the prediction HUD.
  const PredictionHud({
    required this.result,
    required this.stability,
    required this.stabilityDuration,
    required this.catalog,
    required this.now,
    required this.readiness,
    super.key,
  });

  /// The most recent frame's result, or `null` before the first frame.
  final RecognitionResult? result;

  /// The current stability hold, for the continuously-updating indicator.
  final StabilityState stability;

  /// How long a hold must last to confirm (FR-017).
  final Duration stabilityDuration;

  /// Used to resolve a `pose_id` into a display name.
  final PoseCatalog catalog;

  /// The instant to measure stability progress against.
  final DateTime now;

  /// Catalog-wide sample readiness, so "not enough data" (FR-023) can be told
  /// apart from "attempted but not recognized" — the two are different
  /// findings for a contributor debugging their dataset (FR-025).
  final CatalogReadiness readiness;

  String _displayName(String poseId) => catalog.byId(poseId)?.displayName ?? poseId;

  @override
  Widget build(BuildContext context) {
    final current = result;
    return Align(
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.only(top: Spacing.md),
        child: Container(
          key: const Key('prediction-hud'),
          padding: const EdgeInsets.all(Spacing.md),
          constraints: const BoxConstraints(maxWidth: 340),
          decoration: BoxDecoration(
            color: Palette.surface.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (readiness.readyCount == 0)
                const _StatusLine(
                  key: Key('hud-status-insufficient-data'),
                  text: 'No pose in the catalog has enough recorded samples yet',
                )
              else if (current == null)
                const _StatusLine(key: Key('hud-status-loading'), text: 'Recognizing…')
              else
                _body(current),
              if (readiness.readyCount != 0 && current != null) ...[
                const SizedBox(height: Spacing.xs),
                Text(
                  '${current.latency.inMilliseconds} ms',
                  key: const Key('hud-latency'),
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontSize: 11, color: Colors.white38),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(RecognitionResult result) {
    return switch (result) {
      NoHandDetected() =>
        const _StatusLine(key: Key('hud-status-no-hand'), text: 'Show your hand to the camera'),
      Unrecognized() => const _StatusLine(
          key: Key('hud-status-unrecognized'),
          text: 'Not confident yet — hold a pose steady',
        ),
      Ambiguous(:final topCandidates) => _AmbiguousBody(candidates: topCandidates, name: _displayName),
      Recognized() => _RecognizedBody(
          result: result,
          stability: stability,
          stabilityDuration: stabilityDuration,
          now: now,
          name: _displayName,
          catalog: catalog,
        ),
    };
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: TextAlign.center,
    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
  );
}

class _AmbiguousBody extends StatelessWidget {
  const _AmbiguousBody({required this.candidates, required this.name});

  final List<Candidate> candidates;
  final String Function(String) name;

  @override
  Widget build(BuildContext context) {
    final top = candidates.isNotEmpty ? candidates.take(2).map((c) => name(c.poseId)).join(' vs ') : '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _StatusLine(key: Key('hud-status-ambiguous'), text: 'Too similar to tell apart'),
        if (top.isNotEmpty) ...[
          const SizedBox(height: Spacing.xs),
          Text(
            top,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, color: Colors.white60),
          ),
        ],
      ],
    );
  }
}

class _RecognizedBody extends StatelessWidget {
  const _RecognizedBody({
    required this.result,
    required this.stability,
    required this.stabilityDuration,
    required this.now,
    required this.name,
    required this.catalog,
  });

  final Recognized result;
  final StabilityState stability;
  final Duration stabilityDuration;
  final DateTime now;
  final String Function(String) name;
  final PoseCatalog catalog;

  @override
  Widget build(BuildContext context) {
    final top = result.topCandidates.first;
    final confirmed = stability.confirmedAt != null && stability.predictedPoseId == top.poseId;
    final requiredHands = catalog.byId(top.poseId)?.requiredHands;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          name(top.poseId),
          key: const Key('hud-top-pose'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        if (requiredHands != null) ...[
          const SizedBox(height: Spacing.xs),
          Center(
            child: RequiredHandsBadge(
              key: const Key('hud-required-hands'),
              requiredHands: requiredHands,
            ),
          ),
        ],
        Text(
          '${(top.confidence * 100).round()}%',
          key: const Key('hud-top-confidence'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, color: Colors.white70),
        ),
        const SizedBox(height: Spacing.sm),
        for (final candidate in result.topCandidates.skip(1))
          Text(
            '${name(candidate.poseId)} · ${(candidate.confidence * 100).round()}%',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: Colors.white38),
          ),
        const SizedBox(height: Spacing.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            key: const Key('hud-stability-progress'),
            value: stability.predictedPoseId == top.poseId
                ? stability.progress(now, stabilityDuration)
                : 0,
            minHeight: 8,
            backgroundColor: Palette.elevated,
            valueColor: AlwaysStoppedAnimation<Color>(
              confirmed ? Palette.accepted : Palette.primary,
            ),
          ),
        ),
        if (confirmed) ...[
          const SizedBox(height: Spacing.xs),
          const Text(
            'Confirmed',
            key: Key('hud-confirmed'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Palette.accepted,
            ),
          ),
        ],
      ],
    );
  }
}
