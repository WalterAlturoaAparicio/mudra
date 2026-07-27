/// Confidence derivation: softmax over negative distances (research D3).
///
/// Pure, deterministic, and the only place this feature turns raw distances
/// into a bounded, comparable confidence value.
library;

import 'dart:math' as math;

/// Converts [distances] into confidences that sum to 1 across every entry —
/// what makes "confidence" mean the same thing for every pose in the catalog,
/// regardless of its intrinsic shape complexity.
///
/// [temperature] controls how sharply softmax separates close distances;
/// smaller values sharpen the distribution, larger values flatten it.
/// Numerically stabilized by subtracting the maximum scaled value before
/// exponentiating, so it never overflows for large distances.
List<double> softmaxConfidence(
  List<double> distances, {
  double temperature = 1.0,
}) {
  if (distances.isEmpty) return const [];

  final scaled = [for (final d in distances) -d / temperature];
  final maxScaled = scaled.reduce(math.max);
  final exps = [for (final s in scaled) math.exp(s - maxScaled)];
  final sum = exps.reduce((a, b) => a + b);
  return [for (final e in exps) e / sum];
}
