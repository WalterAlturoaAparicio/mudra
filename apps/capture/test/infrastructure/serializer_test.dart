/// Schema parity with the Mudra engine.
///
/// Golden fixtures are real engine output (`scripts/export_capture_fixtures.py`).
/// If these tests pass, a dataset recorded on a phone is readable by the engine
/// with zero manual processing (SC-005) — which is the whole point of the app.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/infrastructure/serialization/pose_sample_serializer.dart';
import 'package:capture/shared/time/iso_timestamp.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/sample_factories.dart';

void main() {
  const serializer = PoseSampleSerializer();

  String fixtureText(String name) {
    final file = File('test/fixtures/$name');
    expect(
      file.existsSync(),
      isTrue,
      reason: 'Run: python scripts/export_capture_fixtures.py',
    );
    return file.readAsStringSync();
  }

  group('engine golden fixtures', () {
    for (final name in ['sample_one_hand.json', 'sample_two_hands.json']) {
      test('$name is parsed and re-serialized identically', () {
        final original = fixtureText(name);
        final sample = serializer.fromJson(original);
        final roundTripped = serializer.toJson(sample);

        // Compare parsed structures: both spell doubles their own way, but the
        // schema constrains values, not their textual representation.
        expect(
          jsonDecode(roundTripped),
          equals(jsonDecode(original)),
          reason: 'Capture must reproduce the engine document exactly',
        );
      });

      test('$name round-trips through the domain model without loss', () {
        final sample = serializer.fromJson(fixtureText(name));
        expect(serializer.fromMap(serializer.toMap(sample)), equals(sample));
      });
    }

    test('two-handed fixture carries both hands with 21 landmarks each', () {
      final sample = serializer.fromJson(fixtureText('sample_two_hands.json'));
      expect(sample.hands, hasLength(2));
      expect(sample.metadata.numHands, 2);
      for (final hand in sample.hands) {
        expect(hand.raw.points, hasLength(handLandmarkCount));
        expect(hand.normalized.points, hasLength(handLandmarkCount));
      }
    });
  });

  group('field order and shape', () {
    test('top-level keys are in the engine order', () {
      final map = serializer.toMap(makeSample());
      expect(map.keys.toList(), [
        'schema_version',
        'pose_id',
        'display_name',
        'description',
        'sample_uuid',
        'sample_number',
        'timestamp',
        'normalization',
        'metadata',
        'hands',
      ]);
    });

    test('metadata carries the reproducibility block the engine expects', () {
      final metadata =
          serializer.toMap(makeSample())['metadata']! as Map<String, Object?>;
      expect(metadata['camera'], {'index': 1, 'width': 640, 'height': 480});
      expect(metadata['versions'], {
        'application': 'mudra-capture/0.1.0',
        'mediapipe': '0.10.14',
      });
      expect(metadata['num_hands'], 1);
    });

    test('camera index records the front lens (FR-044)', () {
      final metadata =
          serializer.toMap(makeSample())['metadata']! as Map<String, Object?>;
      final camera = metadata['camera']! as Map<String, Object?>;
      expect(
        camera['index'],
        1,
        reason: 'front-facing lens must be recoverable from the dataset',
      );
    });

    test('application version preserves producer provenance', () {
      final sample = makeSample();
      expect(sample.metadata.applicationVersion, startsWith('mudra-capture/'));
    });

    test('output is indented for human reading', () {
      expect(serializer.toJson(makeSample()), contains('\n  '));
    });
  });

  group('session_uuid additive extension', () {
    test('is written inside metadata.capture', () {
      final map = serializer.toMap(makeSample(sessionUuid: 'session-abc'));
      final metadata = map['metadata']! as Map<String, Object?>;
      final capture = metadata['capture']! as Map<String, Object?>;

      expect(capture['session_uuid'], 'session-abc');
      expect(capture['capture_time'], isNotNull);
      expect(
        map['schema_version'],
        sampleSchemaVersion,
        reason: 'an additive field must not bump the schema version',
      );
    });

    test('is omitted entirely when there is no session', () {
      final map = serializer.toMap(makeSample());
      final metadata = map['metadata']! as Map<String, Object?>;
      final capture = metadata['capture']! as Map<String, Object?>;
      expect(capture.containsKey('session_uuid'), isFalse);
    });

    test('a document without it still loads (backwards compatible)', () {
      final engineDocument = fixtureText('sample_one_hand.json');
      final sample = serializer.fromJson(engineDocument);
      expect(sample.metadata.capture, isNotNull);
      expect(sample.metadata.capture!.sessionUuid, isNull);
    });

    test('survives a Capture round trip', () {
      final sample = makeSample(sessionUuid: 'session-xyz');
      final parsed = serializer.fromJson(serializer.toJson(sample));
      expect(parsed.metadata.capture!.sessionUuid, 'session-xyz');
    });
  });

  group('timestamps', () {
    test('use the engine +00:00 spelling, not a trailing Z', () {
      final value = formatEngineTimestamp(
        DateTime.utc(2026, 7, 24, 13, 20, 0, 123, 456),
      );
      expect(value, '2026-07-24T13:20:00.123456+00:00');
    });

    test('omit the fractional part when microseconds are zero, like Python', () {
      final value = formatEngineTimestamp(DateTime.utc(2026, 7, 24, 13, 20));
      expect(value, '2026-07-24T13:20:00+00:00');
    });

    test('local times are converted to UTC', () {
      final local = DateTime.utc(2026, 7, 24, 13, 20).toLocal();
      expect(formatEngineTimestamp(local), '2026-07-24T13:20:00+00:00');
    });
  });

  group('malformed documents', () {
    test('an unsupported schema version is rejected', () {
      final map = serializer.toMap(makeSample())..['schema_version'] = 999;
      expect(
        () => serializer.fromMap(map),
        throwsA(isA<PoseSchemaException>()),
      );
    });

    test('a missing section is rejected', () {
      final map = serializer.toMap(makeSample())..remove('hands');
      expect(
        () => serializer.fromMap(map),
        throwsA(isA<PoseSchemaException>()),
      );
    });

    test('a short landmark array is rejected', () {
      final map = serializer.toMap(makeSample());
      final hands = map['hands']! as List<Object?>;
      final hand = hands.first! as Map<String, Object?>;
      hand['raw'] = (hand['raw']! as List<Object?>).sublist(0, 20);
      expect(
        () => serializer.fromMap(map),
        throwsA(isA<PoseSchemaException>()),
      );
    });

    test('invalid JSON is rejected', () {
      expect(
        () => serializer.fromJson('{not json'),
        throwsA(isA<PoseSchemaException>()),
      );
    });
  });
}
