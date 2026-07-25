/// Normalization parity with the Mudra engine.
///
/// The fixtures these tests read are produced by the engine's own Python
/// implementation (`scripts/export_capture_fixtures.py`). Comparing against real
/// engine output — rather than a Dart restatement of the same formula — is the
/// only thing that actually proves the port is faithful.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/normalization/translation_scale_normalizer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const normalizer = TranslationScaleNormalizer();

  Map<String, Object?> loadCases() {
    final file = File('test/fixtures/normalization_cases.json');
    expect(
      file.existsSync(),
      isTrue,
      reason: 'Run: python scripts/export_capture_fixtures.py',
    );
    return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  }

  HandLandmarks handFrom(List<Object?> points) => HandLandmarks([
    for (final p in points)
      Landmark(
        x: (p! as Map<String, Object?>)['x']! as double,
        y: (p as Map<String, Object?>)['y']! as double,
        z: (p)['z']! as double,
      ),
  ]);

  test('strategy and version match the engine fixture', () {
    final data = loadCases();
    expect(normalizer.strategy, data['strategy']);
    expect(normalizer.version, data['version']);
  });

  test('every engine fixture case is reproduced exactly', () {
    final data = loadCases();
    final cases = data['cases']! as List<Object?>;
    expect(cases, isNotEmpty);

    for (final entry in cases) {
      final testCase = entry! as Map<String, Object?>;
      final name = testCase['name']! as String;
      final raw = handFrom(testCase['raw']! as List<Object?>);
      final expected = handFrom(testCase['normalized']! as List<Object?>);

      final actual = normalizer.normalize(raw);

      for (var i = 0; i < handLandmarkCount; i++) {
        expect(
          actual.points[i].x,
          expected.points[i].x,
          reason: 'case "$name", landmark $i, x',
        );
        expect(
          actual.points[i].y,
          expected.points[i].y,
          reason: 'case "$name", landmark $i, y',
        );
        expect(
          actual.points[i].z,
          expected.points[i].z,
          reason: 'case "$name", landmark $i, z',
        );
      }
    }
  });

  test('wrist becomes the origin', () {
    final data = loadCases();
    final cases = data['cases']! as List<Object?>;
    for (final entry in cases) {
      final testCase = entry! as Map<String, Object?>;
      final normalized = normalizer.normalize(
        handFrom(testCase['raw']! as List<Object?>),
      );
      expect(normalized.points[wristLandmarkIndex].x, 0.0);
      expect(normalized.points[wristLandmarkIndex].y, 0.0);
      expect(normalized.points[wristLandmarkIndex].z, 0.0);
    }
  });

  test('degenerate span falls back to translation only, never infinities', () {
    final collapsed = HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        const Landmark(x: 0.25, y: 0.75, z: 0),
    ]);

    final normalized = normalizer.normalize(collapsed);

    expect(normalized.allFinite, isTrue);
    for (final point in normalized.points) {
      expect(point.x, 0.0);
      expect(point.y, 0.0);
      expect(point.z, 0.0);
    }
  });

  test('normalization is translation and scale invariant', () {
    // The same pose recorded closer, and further left, must normalize the same.
    HandLandmarks build(double offset, double scale) => HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        Landmark(
          x: offset + scale * (0.01 * i),
          y: offset + scale * (0.02 * i),
          z: scale * (0.005 * i),
        ),
    ]);

    final near = normalizer.normalize(build(0.1, 1));
    final far = normalizer.normalize(build(0.6, 0.4));

    for (var i = 0; i < handLandmarkCount; i++) {
      expect(near.points[i].x, closeTo(far.points[i].x, 1e-12));
      expect(near.points[i].y, closeTo(far.points[i].y, 1e-12));
      expect(near.points[i].z, closeTo(far.points[i].z, 1e-12));
    }
  });

  test('input is never mutated', () {
    final raw = HandLandmarks([
      for (var i = 0; i < handLandmarkCount; i++)
        Landmark(x: 0.1 * i, y: 0.2 * i, z: 0.05 * i),
    ]);
    final before = raw.points.first;

    normalizer.normalize(raw);

    expect(raw.points.first, before);
  });
}
