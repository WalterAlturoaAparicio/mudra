/// Pose catalog loading and validation.
///
/// The catalog is configuration (FR-001), so a malformed one must fail loudly
/// and name the offending entry — a silently skipped pose means a dataset with
/// a missing class, discovered far too late.
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/infrastructure/catalog/asset_pose_catalog_source.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const config = CaptureConfig();

  String catalogJson({
    List<Map<String, Object?>>? poses,
    int version = 1,
    Map<String, Object?>? defaults,
  }) => jsonEncode({
    'catalog_version': version,
    'defaults': defaults ?? {'target_sample_count': 500, 'required_hands': 1},
    'poses':
        poses ??
        [
          {
            'pose_id': 'peace',
            'display_name': 'Peace',
            'required_hands': 1,
          },
        ],
  });

  group('the shipped catalog asset', () {
    late String shipped;

    setUpAll(() {
      shipped = File('assets/config/pose_catalog.json').readAsStringSync();
    });

    test('contains exactly the 18 specified poses in order (FR-003)', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(shipped, config);

      expect(catalog.poses.map((p) => p.poseId).toList(), [
        'bird',
        'dog',
        'domain_expansion',
        'dragon',
        'hare',
        'hi',
        'horse',
        'militar_hi',
        'monkey',
        'ok',
        'ox',
        'peace',
        'ram',
        'rat',
        'snake',
        'tiger',
        'tp',
        'wild_boar',
      ]);
      expect(catalog.size, 18);
    });

    test('every pose has a display name, target, and hand count', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(shipped, config);
      for (final pose in catalog.poses) {
        expect(pose.displayName, isNotEmpty);
        expect(pose.targetSampleCount, greaterThan(0));
        expect(pose.requiredHands, anyOf(1, 2));
        expect(pose.referenceImage, isNotNull);
      }
    });

    test('single-hand gestures are declared one-handed', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(shipped, config);
      // 'tp' is one hand's index and middle fingers on the forehead — a
      // one-handed seal, unlike the two-handed group below.
      for (final id in ['hi', 'militar_hi', 'ok', 'peace', 'tp']) {
        expect(catalog.byId(id)!.requiredHands, 1, reason: id);
      }
    });

    test('hand seals are declared two-handed', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(shipped, config);
      for (final id in ['dragon', 'tiger', 'domain_expansion']) {
        expect(catalog.byId(id)!.requiredHands, 2, reason: id);
      }
    });
  });

  group('defaults', () {
    test('are applied when an entry omits them', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(
        catalogJson(
          poses: [
            {'pose_id': 'peace', 'display_name': 'Peace'},
          ],
          defaults: {'target_sample_count': 250, 'required_hands': 2},
        ),
        config,
      );

      final pose = catalog.first;
      expect(pose.targetSampleCount, 250);
      expect(pose.requiredHands, 2);
    });

    test('fall back to configuration when the file omits them', () {
      final catalog = AssetPoseCatalogSource.parseCatalog(
        jsonEncode({
          'catalog_version': 1,
          'poses': [
            {'pose_id': 'peace', 'display_name': 'Peace'},
          ],
        }),
        config,
      );

      expect(catalog.first.targetSampleCount, config.defaultTargetSampleCount);
      expect(catalog.first.requiredHands, config.defaultRequiredHands);
    });
  });

  group('validation failures name the problem', () {
    void expectCatalogFailure(String json, Matcher messageMatcher) {
      expect(
        () => AssetPoseCatalogSource.parseCatalog(json, config),
        throwsA(
          isA<CatalogFailure>().having((f) => f.message, 'message', messageMatcher),
        ),
      );
    }

    test('duplicate pose_id', () {
      expectCatalogFailure(
        catalogJson(
          poses: [
            {'pose_id': 'peace', 'display_name': 'Peace'},
            {'pose_id': 'peace', 'display_name': 'Peace Again'},
          ],
        ),
        contains('duplicate'),
      );
    });

    test('pose_id violating the identifier pattern', () {
      expectCatalogFailure(
        catalogJson(
          poses: [
            {'pose_id': 'Not Valid!', 'display_name': 'Bad'},
          ],
        ),
        contains('Not Valid!'),
      );
    });

    test('empty display name', () {
      expectCatalogFailure(
        catalogJson(
          poses: [
            {'pose_id': 'peace', 'display_name': ''},
          ],
        ),
        contains('peace'),
      );
    });

    test('zero target sample count', () {
      expectCatalogFailure(
        catalogJson(
          poses: [
            {
              'pose_id': 'peace',
              'display_name': 'Peace',
              'target_sample_count': 0,
            },
          ],
        ),
        contains('peace'),
      );
    });

    test('required_hands outside 1..2', () {
      expectCatalogFailure(
        catalogJson(
          poses: [
            {'pose_id': 'peace', 'display_name': 'Peace', 'required_hands': 3},
          ],
        ),
        contains('peace'),
      );
    });

    test('unknown catalog version', () {
      expectCatalogFailure(catalogJson(version: 99), contains('99'));
    });

    test('empty pose list', () {
      expectCatalogFailure(catalogJson(poses: []), contains('at least one'));
    });

    test('malformed JSON', () {
      expectCatalogFailure('{not json', contains('valid JSON'));
    });
  });

  test('a missing reference image is legal — the UI shows a placeholder', () {
    final catalog = AssetPoseCatalogSource.parseCatalog(
      catalogJson(
        poses: [
          {'pose_id': 'peace', 'display_name': 'Peace'},
        ],
      ),
      config,
    );

    expect(catalog.first.referenceImage, isNull);
  });
}
