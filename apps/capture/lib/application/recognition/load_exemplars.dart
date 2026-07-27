/// Loads exemplars for the current recognition-screen visit.
///
/// A thin seam over [ExemplarSource.load] (research D6) — kept as its own use
/// case, rather than calling the port directly from presentation, so a
/// structured observability record can be emitted the same way every other
/// use case in this application does.
library;

import 'package:capture/domain/ports/ports.dart';

/// Loads exemplars once per screen entry, logging what it found.
class LoadExemplars {
  /// Creates the use case.
  LoadExemplars({required ExemplarSource source, required AppLogger logger})
      : _source = source,
        _logger = logger;

  final ExemplarSource _source;
  final AppLogger _logger;

  /// Reads the current dataset and builds this visit's exemplar set.
  Future<ExemplarLoadResult> call() async {
    final result = await _source.load();
    _logger.info('exemplars_loaded', {
      'ready_poses': result.readiness.readyCount,
      'total_poses': result.readiness.entries.length,
    });
    return result;
  }
}
