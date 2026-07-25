/// Loads and validates the pose catalog from a bundled asset.
///
/// Validation happens once, here at the boundary, so every other layer may
/// assume a [PoseDefinition] it receives is valid. A malformed catalog is a
/// developer error and fails loudly, naming the offending entry — silently
/// skipping a bad pose would produce a dataset with a missing class.
library;

import 'dart:convert';

import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;

/// Catalog format version this loader understands.
const int supportedCatalogVersion = 1;

/// Default asset path of the catalog configuration.
const String poseCatalogAssetPath = 'assets/config/pose_catalog.json';

/// Reads the catalog from the application's asset bundle.
class AssetPoseCatalogSource implements PoseCatalogSource {
  /// Creates a catalog source.
  AssetPoseCatalogSource({
    required CaptureConfig config,
    AssetBundle? bundle,
    this.assetPath = poseCatalogAssetPath,
  })  : _config = config,
        _bundle = bundle;

  /// Asset path to read.
  final String assetPath;

  final CaptureConfig _config;
  final AssetBundle? _bundle;

  AssetBundle get _assets => _bundle ?? rootBundle;

  @override
  Future<PoseCatalog> load() async {
    final String text;
    try {
      text = await _assets.loadString(assetPath);
    } on Object catch (error) {
      throw CatalogFailure(
        'The pose catalog could not be loaded from $assetPath.',
        debugDetail: error,
      );
    }
    return parseCatalog(text, _config);
  }

  /// Parses and validates catalog [text]; exposed for tests and tooling.
  static PoseCatalog parseCatalog(String text, CaptureConfig config) {
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException catch (error) {
      throw CatalogFailure(
        'The pose catalog is not valid JSON.',
        debugDetail: error,
      );
    }

    if (decoded is! Map) {
      throw const CatalogFailure('The pose catalog must be a JSON object.');
    }
    final data = decoded.cast<String, Object?>();

    final version = data['catalog_version'];
    if (version != supportedCatalogVersion) {
      throw CatalogFailure(
        'Unsupported catalog_version $version '
        '(expected $supportedCatalogVersion).',
      );
    }

    final defaults = (data['defaults'] as Map?)?.cast<String, Object?>() ?? {};
    final defaultTarget =
        (defaults['target_sample_count'] as int?) ??
        config.defaultTargetSampleCount;
    final defaultHands =
        (defaults['required_hands'] as int?) ?? config.defaultRequiredHands;

    final rawPoses = data['poses'];
    if (rawPoses is! List || rawPoses.isEmpty) {
      throw const CatalogFailure(
        'The pose catalog must contain at least one pose.',
      );
    }

    final poses = <PoseDefinition>[];
    for (var i = 0; i < rawPoses.length; i++) {
      final entry = rawPoses[i];
      if (entry is! Map) {
        throw CatalogFailure('Catalog entry #${i + 1} is not an object.');
      }
      poses.add(_parsePose(entry.cast<String, Object?>(), i, defaultTarget, defaultHands));
    }

    try {
      return PoseCatalog(poses);
    } on ArgumentError catch (error) {
      throw CatalogFailure(
        'The pose catalog is invalid: ${error.message}.',
        debugDetail: error,
      );
    }
  }

  static PoseDefinition _parsePose(
    Map<String, Object?> entry,
    int index,
    int defaultTarget,
    int defaultHands,
  ) {
    final poseId = entry['pose_id'];
    final label = poseId is String ? '"$poseId"' : 'entry #${index + 1}';
    if (poseId is! String) {
      throw CatalogFailure('Catalog $label is missing a pose_id.');
    }

    try {
      return PoseDefinition(
        poseId: poseId,
        displayName: (entry['display_name'] as String?) ?? '',
        description: (entry['description'] as String?) ?? '',
        referenceImage: entry['reference_image'] as String?,
        targetSampleCount:
            (entry['target_sample_count'] as int?) ?? defaultTarget,
        requiredHands: (entry['required_hands'] as int?) ?? defaultHands,
      );
    } on ArgumentError catch (error) {
      throw CatalogFailure(
        'Catalog $label is invalid: ${error.message} '
        '(${error.name} = ${error.invalidValue}).',
        debugDetail: error,
      );
    }
  }
}
