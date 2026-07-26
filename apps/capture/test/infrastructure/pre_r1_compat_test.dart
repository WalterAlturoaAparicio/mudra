/// Samples recorded before revision R1 must stay readable (FR-052, SC-026).
///
/// The engine's golden fixtures *are* pre-R1 documents — they carry none of the
/// five additive fields — which makes them the honest test subject rather than
/// something written to pass.
///
/// The rule being defended: **the new fields are absent, never wrong.** A reader
/// that invents a default for a lens it was never told about would quietly
/// relabel history, which is worse than admitting it does not know.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/infrastructure/serialization/pose_sample_serializer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const serializer = PoseSampleSerializer();

  String fixtureText(String name) =>
      File('test/fixtures/$name').readAsStringSync();

  group('a pre-R1 sample loads with the new fields absent (SC-026)', () {
    for (final name in ['sample_one_hand.json', 'sample_two_hands.json']) {
      test('$name has no camera metadata rather than invented metadata', () {
        final sample = serializer.fromJson(fixtureText(name));

        expect(
          sample.metadata.camera,
          isNull,
          reason: 'FR-052: the new fields must be absent, not guessed. A '
              'fabricated lens would silently relabel the historical dataset.',
        );
      });

      test('$name still exposes everything the engine schema promised', () {
        final sample = serializer.fromJson(fixtureText(name));

        expect(sample.schemaVersion, 1);
        expect(sample.pose.poseId, isNotEmpty);
        expect(sample.hands, isNotEmpty);
        expect(sample.metadata.cameraIndex, isNotNull);
        expect(sample.metadata.capture, isNotNull);
        for (final hand in sample.hands) {
          expect(hand.canonicalRaw.points, hasLength(21));
          expect(hand.normalized.points, hasLength(21));
        }
      });

      test('$name round-trips without acquiring fabricated fields', () {
        final sample = serializer.fromJson(fixtureText(name));
        final map = serializer.toMap(sample);
        final camera =
            (map['metadata']! as Map<String, Object?>)['camera']!
                as Map<String, Object?>;

        expect(camera.containsKey('position'), isFalse);
        expect(camera.containsKey('mirrored_preview'), isFalse);
        expect(camera.containsKey('lens_facing'), isFalse);
        // The engine's own keys survive untouched.
        expect(camera['index'], isNotNull);
        expect(camera['width'], isNotNull);
        expect(camera['height'], isNotNull);
      });
    }
  });

  group('countdown_enabled is inferred, not guessed, on old samples', () {
    test('a pre-R1 sample with a 3s countdown reads as having had one', () {
      final sample = serializer.fromJson(fixtureText('sample_one_hand.json'));

      // The fixture records `countdown_seconds: 3.0` and no `countdown_enabled`.
      // Reading that as "no countdown" would be actively wrong.
      expect(sample.metadata.capture!.countdownSeconds, 3.0);
      expect(sample.metadata.capture!.countdownEnabled, isTrue);
    });

    test('a pre-R1 sample with a zero countdown reads as having had none', () {
      final document =
          jsonDecode(fixtureText('sample_one_hand.json')) as Map<String, Object?>;
      final metadata = document['metadata']! as Map<String, Object?>;
      final capture = metadata['capture']! as Map<String, Object?>;
      capture['countdown_seconds'] = 0.0;
      capture.remove('countdown_start_time');

      final sample = serializer.fromJson(jsonEncode(document));

      expect(sample.metadata.capture!.countdownEnabled, isFalse);
    });
  });

  group('an R1 sample round-trips its camera metadata', () {
    test('all five additive fields survive a write and re-read', () {
      final original = serializer.fromJson(fixtureText('sample_one_hand.json'));
      final document =
          jsonDecode(fixtureText('sample_one_hand.json')) as Map<String, Object?>;
      final metadata = document['metadata']! as Map<String, Object?>;
      (metadata['camera']! as Map<String, Object?>).addAll({
        'position': 'rear',
        'mirrored_preview': false,
        'lens_facing': 0,
      });
      (metadata['capture']! as Map<String, Object?>)['countdown_enabled'] =
          false;

      final sample = serializer.fromJson(jsonEncode(document));

      expect(sample.metadata.camera, isNotNull);
      expect(sample.metadata.camera!.position, LensPosition.rear);
      expect(sample.metadata.camera!.mirroredPreview, isFalse);
      expect(sample.metadata.camera!.platformLensId, 0);
      expect(sample.metadata.camera!.countdownEnabled, isFalse);

      // And a full round trip preserves them.
      final again = serializer.fromMap(serializer.toMap(sample));
      expect(again.metadata.camera, sample.metadata.camera);

      // The landmark payload is untouched by any of this.
      expect(again.hands.first.canonicalRaw, original.hands.first.canonicalRaw);
    });

    test('lens_facing falls back to index when only index is present', () {
      final document =
          jsonDecode(fixtureText('sample_one_hand.json')) as Map<String, Object?>;
      final camera = (document['metadata']! as Map<String, Object?>)['camera']!
          as Map<String, Object?>;
      camera['position'] = 'front';
      camera['mirrored_preview'] = true;
      // `lens_facing` deliberately omitted.

      final sample = serializer.fromJson(jsonEncode(document));

      expect(sample.metadata.camera!.platformLensId, camera['index']);
    });
  });
}
