/// Loads and validates the effect catalog from a bundled asset.
///
/// Mirrors `AssetPoseCatalogSource` deliberately: validate once, here at the
/// boundary, so `effectFor` never has to fail — a malformed entry is a
/// developer error and fails loudly at construction, naming the offending
/// entry, per contracts/effect-catalog.md.
library;

import 'dart:convert';

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;

/// Effect catalog format version this loader understands.
const int supportedEffectCatalogVersion = 1;

/// Default asset path of the effect catalog configuration.
const String effectCatalogAssetPath = 'assets/config/effect_catalog.json';

/// Reads the effect catalog from the application's asset bundle.
class AssetEffectCatalogSource implements EffectCatalogSource {
  /// Creates an effect catalog source, loading and validating [assetPath]
  /// once via [load] before [effectFor] can be called.
  AssetEffectCatalogSource._(this._byPoseId, this._fallback);

  final Map<String, EffectDefinition> _byPoseId;
  final EffectDefinition _fallback;

  /// Loads and validates the effect catalog asset.
  ///
  /// Throws [EffectCatalogFailure] naming the offending entry on any
  /// validation failure — the same "a config error is a developer error, not
  /// a runtime condition to paper over" rule [AssetPoseCatalogSource] follows.
  static Future<AssetEffectCatalogSource> load({
    AssetBundle? bundle,
    String assetPath = effectCatalogAssetPath,
  }) async {
    final String text;
    try {
      text = await (bundle ?? rootBundle).loadString(assetPath);
    } on Object catch (error) {
      throw EffectCatalogFailure(
        'The effect catalog could not be loaded from $assetPath.',
        debugDetail: error,
      );
    }
    return parse(text);
  }

  /// Parses and validates catalog [text]; exposed for tests and tooling.
  static AssetEffectCatalogSource parse(String text) {
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException catch (error) {
      throw EffectCatalogFailure(
        'The effect catalog is not valid JSON.',
        debugDetail: error,
      );
    }

    if (decoded is! Map) {
      throw const EffectCatalogFailure(
        'The effect catalog must be a JSON object.',
      );
    }
    final data = decoded.cast<String, Object?>();

    final version = data['catalog_version'];
    if (version != supportedEffectCatalogVersion) {
      throw EffectCatalogFailure(
        'Unsupported catalog_version $version '
        '(expected $supportedEffectCatalogVersion).',
      );
    }

    final rawFallback = data['generic_fallback'];
    if (rawFallback is! Map) {
      throw const EffectCatalogFailure(
        'The effect catalog is missing "generic_fallback".',
      );
    }
    final fallback = _parseEntry(
      rawFallback.cast<String, Object?>(),
      label: 'generic_fallback',
    );

    final rawEffects = data['effects'];
    if (rawEffects is! List) {
      throw const EffectCatalogFailure(
        'The effect catalog must contain an "effects" array.',
      );
    }

    final byPoseId = <String, EffectDefinition>{};
    for (var i = 0; i < rawEffects.length; i++) {
      final entry = rawEffects[i];
      if (entry is! Map) {
        throw EffectCatalogFailure('Effect entry #${i + 1} is not an object.');
      }
      final map = entry.cast<String, Object?>();
      final poseId = map['pose_id'];
      if (poseId is! String) {
        throw EffectCatalogFailure('Effect entry #${i + 1} has no pose_id.');
      }
      if (byPoseId.containsKey(poseId)) {
        throw EffectCatalogFailure('Duplicate effect entry for "$poseId".');
      }
      byPoseId[poseId] = _parseEntry(map, label: '"$poseId"');
    }

    return AssetEffectCatalogSource._(byPoseId, fallback);
  }

  static EffectDefinition _parseEntry(
    Map<String, Object?> entry, {
    required String label,
  }) {
    final kindName = entry['kind'];
    if (kindName is! String) {
      throw EffectCatalogFailure('Effect $label has no kind.');
    }
    EffectKind? kind;
    for (final candidate in EffectKind.values) {
      if (candidate.name == kindName) {
        kind = candidate;
        break;
      }
    }
    if (kind == null) {
      throw EffectCatalogFailure('Effect $label has an unknown kind "$kindName".');
    }

    final colorText = entry['color'];
    EffectColor? color;
    if (colorText is String) {
      color = _parseColor(colorText, label);
    }

    final intensity = entry['intensity'];
    final intensityValue = switch (intensity) {
      null => 0.7,
      final num n => n.toDouble(),
      _ => throw EffectCatalogFailure('Effect $label has a non-numeric intensity.'),
    };

    try {
      return EffectDefinition(
        poseId: entry['pose_id'] as String?,
        kind: kind,
        color: color,
        spriteAssetPath: entry['sprite_asset'] as String?,
        intensity: intensityValue,
      );
    } on ArgumentError catch (error) {
      throw EffectCatalogFailure(
        'Effect $label is invalid: ${error.message}.',
        debugDetail: error,
      );
    }
  }

  static EffectColor _parseColor(String text, String label) {
    final hex = text.startsWith('#') ? text.substring(1) : text;
    if (hex.length != 6) {
      throw EffectCatalogFailure('Effect $label has an invalid color "$text".');
    }
    final value = int.tryParse(hex, radix: 16);
    if (value == null) {
      throw EffectCatalogFailure('Effect $label has an invalid color "$text".');
    }
    return EffectColor(
      red: (value >> 16) & 0xFF,
      green: (value >> 8) & 0xFF,
      blue: value & 0xFF,
    );
  }

  @override
  EffectDefinition effectFor(String poseId) => _byPoseId[poseId] ?? _fallback;
}
