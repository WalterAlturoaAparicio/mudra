/// The Sync action: validate, package, and hand over the dataset.
///
/// "Sync" is what the button says; a **dataset export** is what happens. There
/// is no server, account, or network anywhere in this path (FR-034).
library;

import 'package:capture/application/lifecycle/record_app_lifecycle.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/errors/failures.dart';

/// What the Sync button is currently doing.
sealed class ExportState {
  /// Base constructor.
  const ExportState();
}

/// Nothing in progress.
class ExportIdle extends ExportState {
  /// Creates the idle state.
  const ExportIdle();
}

/// Checking the dataset before packaging (FR-048).
class ExportValidating extends ExportState {
  /// Creates the validating state.
  const ExportValidating();
}

/// Writing the archive.
class ExportPackaging extends ExportState {
  /// Creates the packaging state.
  const ExportPackaging();
}

/// The archive is ready and has been offered to the user.
class ExportSucceeded extends ExportState {
  /// Creates a success state.
  const ExportSucceeded(this.result);

  /// What was produced.
  final ExportResult result;
}

/// There was nothing to export (FR-036).
class ExportEmpty extends ExportState {
  /// Creates the empty state.
  const ExportEmpty();
}

/// The export failed, or was refused by integrity validation.
class ExportFailed extends ExportState {
  /// Creates a failure state.
  const ExportFailed(this.failure);

  /// Why it failed, in terms fit to show a user.
  final Failure failure;
}

/// Hands the finished archive to the user.
abstract interface class SharePresenter {
  /// Offers the file at [path] through the system share mechanism (FR-035).
  Future<void> share(String path, {String? subject});
}

/// Runs an export and reports its progress.
class ExportDataset {
  /// Creates the use case.
  ExportDataset({
    required DatasetExporter exporter,
    required SharePresenter sharePresenter,
    required AppLogger logger,
    RecordAppLifecycle? lifecycle,
  })  : _exporter = exporter,
        _share = sharePresenter,
        _logger = logger,
        _lifecycle = lifecycle;

  final DatasetExporter _exporter;
  final SharePresenter _share;
  final AppLogger _logger;
  final RecordAppLifecycle? _lifecycle;

  /// Exports the dataset, emitting each stage.
  ///
  /// Never throws into the caller: every failure arrives as [ExportFailed] so
  /// the UI can explain it without a crash.
  Stream<ExportState> run() async* {
    yield const ExportValidating();
    try {
      yield const ExportPackaging();
      final result = await _exporter.export();

      if (result.isEmpty) {
        yield const ExportEmpty();
        return;
      }

      await _share.share(
        result.archivePath,
        subject: 'Mudra Capture dataset '
            '(${result.totalSamples} samples, ${result.poseCount} poses)',
      );
      _lifecycle?.recordExport();
      yield ExportSucceeded(result);
    } on Failure catch (failure) {
      _logger.error('Export failed.', {'reason': failure.message});
      yield ExportFailed(failure);
    } on Object catch (error) {
      _logger.error('Export failed unexpectedly.', {'error': '$error'});
      yield ExportFailed(
        ExportFailure(
          'The dataset could not be exported.',
          debugDetail: error,
        ),
      );
    }
  }
}
