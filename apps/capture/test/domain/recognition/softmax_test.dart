/// `softmaxConfidence`: normalization, ordering, numerical stability.
library;

import 'package:capture/domain/recognition/softmax.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('confidences sum to 1', () {
    final confidences = softmaxConfidence([0.1, 0.5, 2.0]);
    expect(confidences.reduce((a, b) => a + b), closeTo(1.0, 1e-9));
  });

  test('smaller distance yields higher confidence', () {
    final confidences = softmaxConfidence([0.1, 0.5, 2.0]);
    expect(confidences[0], greaterThan(confidences[1]));
    expect(confidences[1], greaterThan(confidences[2]));
  });

  test('equal distances yield equal confidence', () {
    final confidences = softmaxConfidence([1.0, 1.0, 1.0]);
    expect(confidences[0], closeTo(1 / 3, 1e-9));
    expect(confidences[1], closeTo(1 / 3, 1e-9));
    expect(confidences[2], closeTo(1 / 3, 1e-9));
  });

  test('a single candidate gets full confidence', () {
    expect(softmaxConfidence([3.7]), [1.0]);
  });

  test('large distances do not overflow to NaN', () {
    final confidences = softmaxConfidence([1e6, 1e6 + 1, 1e6 + 2]);
    for (final c in confidences) {
      expect(c.isNaN, isFalse);
      expect(c.isFinite, isTrue);
    }
    expect(confidences.reduce((a, b) => a + b), closeTo(1.0, 1e-6));
  });

  test('temperature scales the sharpness of the distribution', () {
    final sharp = softmaxConfidence([0.1, 1.0], temperature: 0.1);
    final soft = softmaxConfidence([0.1, 1.0], temperature: 10);
    expect(sharp[0] - sharp[1], greaterThan(soft[0] - soft[1]));
  });
}
