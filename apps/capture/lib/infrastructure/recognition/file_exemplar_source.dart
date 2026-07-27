/// Reads the existing dataset into exemplars — read-only, never a second
/// scan for readiness (research D6/D10).
library;

import 'package:capture/domain/ports/ports.dart';
import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/domain/recognition/exemplar.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/config/recognition_config.dart';
import 'package:capture/shared/errors/failures.dart';

/// Builds exemplars and catalog readiness from [SampleRepository.readAll].
///
/// Depends only on [SampleRepository]'s read methods (`readAll`, never
/// `save`/`saveAll`) — the usage discipline that makes FR-004's read-only
/// contract true, verified by a test that fails `save`/`saveAll` outright.
class FileExemplarSource implements ExemplarSource {
  /// Creates an exemplar source over [repository] and [catalog].
  FileExemplarSource({
    required SampleRepository repository,
    required PoseCatalog catalog,
    required RecognitionConfig config,
  })  : _repository = repository,
        _catalog = catalog,
        _config = config;

  final SampleRepository _repository;
  final PoseCatalog _catalog;
  final RecognitionConfig _config;

  @override
  Future<ExemplarLoadResult> load() async {
    final exemplarsByPose = <String, List<Exemplar>>{};
    final readinessEntries = <PoseReadiness>[];

    for (final pose in _catalog.poses) {
      final samples = await _readSamples(pose.poseId);

      readinessEntries.add(
        PoseReadiness(
          poseId: pose.poseId,
          exemplarCount: samples.length,
          minRequired: _config.minExemplarsPerPose,
        ),
      );

      // Below the threshold, a pose is excluded from matching entirely
      // (FR-006) — no key at all, rather than an empty list, so the matcher
      // never has to distinguish "no key" from "empty list".
      if (samples.length < _config.minExemplarsPerPose) continue;

      exemplarsByPose[pose.poseId] = [
        for (final sample in samples)
          for (final hand in sample.hands)
            Exemplar(
              poseId: pose.poseId,
              sampleId: sample.sampleUuid,
              handedness: hand.handedness,
              landmarks: hand.normalized,
            ),
      ];
    }

    return ExemplarLoadResult(
      exemplarsByPose: exemplarsByPose,
      readiness: CatalogReadiness(readinessEntries),
    );
  }

  Future<List<PoseSample>> _readSamples(String poseId) async {
    try {
      return await _repository.readAll(poseId);
    } on Object catch (error) {
      throw ExemplarLoadFailure(
        'Could not read recorded samples for "$poseId".',
        debugDetail: error,
      );
    }
  }
}
