/// `AssetEffectCatalogSource`: validate-once loading, generic fallback, and
/// loud failure on a malformed entry (contracts/effect-catalog.md).
library;

import 'dart:convert';

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/infrastructure/effects/asset_effect_catalog_source.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter_test/flutter_test.dart';

const _validJson = '''
{
  "catalog_version": 1,
  "effects": [
    {"pose_id": "horse", "kind": "spritePair", "color": "#D9A066", "intensity": 0.8},
    {"pose_id": "dog", "kind": "spritePair", "color": "#8B6B4A", "intensity": 0.8},
    {"pose_id": "snake", "kind": "glow", "color": "#2BB673", "intensity": 0.9},
    {"pose_id": "dragon", "kind": "particleBurst", "color": "#FF7A3D", "intensity": 1.0},
    {"pose_id": "bird", "kind": "spritePair", "color": "#F2E9D8", "intensity": 0.7},
    {"pose_id": "tp", "kind": "fadeWithLines", "color": "#4C6FFF", "intensity": 0.9}
  ],
  "generic_fallback": {"kind": "genericConfirm", "color": "#4C6FFF", "intensity": 0.7}
}
''';

void main() {
  test('loads the six milestone entries plus the generic fallback', () {
    final source = AssetEffectCatalogSource.parse(_validJson);

    expect(source.effectFor('horse').kind, EffectKind.spritePair);
    expect(source.effectFor('dog').kind, EffectKind.spritePair);
    expect(source.effectFor('snake').kind, EffectKind.glow);
    expect(source.effectFor('dragon').kind, EffectKind.particleBurst);
    expect(source.effectFor('bird').kind, EffectKind.spritePair);
    expect(source.effectFor('tp').kind, EffectKind.fadeWithLines);
  });

  test('a pose_id absent from the file returns the generic fallback, never null', () {
    final source = AssetEffectCatalogSource.parse(_validJson);
    final effect = source.effectFor('nonexistent_pose');
    expect(effect.kind, EffectKind.genericConfirm);
  });

  test('rejects an unsupported catalog_version', () {
    final json = jsonEncode({
      'catalog_version': 999,
      'effects': [],
      'generic_fallback': {'kind': 'genericConfirm'},
    });
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(isA<EffectCatalogFailure>()),
    );
  });

  test('rejects an unknown kind, naming the offending entry', () {
    final json = jsonEncode({
      'catalog_version': 1,
      'effects': [
        {'pose_id': 'horse', 'kind': 'not_a_real_kind'},
      ],
      'generic_fallback': {'kind': 'genericConfirm'},
    });
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(
        isA<EffectCatalogFailure>().having(
          (e) => e.message,
          'message',
          contains('horse'),
        ),
      ),
    );
  });

  test('rejects an out-of-range intensity', () {
    final json = jsonEncode({
      'catalog_version': 1,
      'effects': [
        {'pose_id': 'horse', 'kind': 'glow', 'intensity': 1.5},
      ],
      'generic_fallback': {'kind': 'genericConfirm'},
    });
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(isA<EffectCatalogFailure>()),
    );
  });

  test('rejects an unparseable color', () {
    final json = jsonEncode({
      'catalog_version': 1,
      'effects': [
        {'pose_id': 'horse', 'kind': 'glow', 'color': 'not-a-color'},
      ],
      'generic_fallback': {'kind': 'genericConfirm'},
    });
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(isA<EffectCatalogFailure>()),
    );
  });

  test('rejects a duplicate pose_id', () {
    final json = jsonEncode({
      'catalog_version': 1,
      'effects': [
        {'pose_id': 'horse', 'kind': 'glow'},
        {'pose_id': 'horse', 'kind': 'spritePair'},
      ],
      'generic_fallback': {'kind': 'genericConfirm'},
    });
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(isA<EffectCatalogFailure>()),
    );
  });

  test('rejects a missing generic_fallback', () {
    final json = jsonEncode({'catalog_version': 1, 'effects': []});
    expect(
      () => AssetEffectCatalogSource.parse(json),
      throwsA(isA<EffectCatalogFailure>()),
    );
  });
}
