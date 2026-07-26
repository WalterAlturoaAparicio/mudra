/// Filesystem implementation of [SessionStore].
///
/// Session records live **outside** `datasets/poses/`, so nothing here can ever
/// be mistaken for a sample by the engine or by the integrity validator. Only
/// sessions that actually produced samples are recorded, so no orphan
/// `session_uuid` ever reaches the dataset (FR-046).
library;

import 'dart:convert';
import 'dart:io';

import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/ports/ports.dart';
import 'package:capture/shared/config/capture_config.dart';
import 'package:capture/shared/errors/failures.dart';
import 'package:capture/shared/time/iso_timestamp.dart';

/// Append-only session records stored as a single JSON document.
class FileSessionStore implements SessionStore {
  /// Creates a session store rooted at [rootPath].
  FileSessionStore({required this.rootPath, required CaptureConfig config})
      : _config = config;

  /// Directory containing the `datasets/` tree.
  final String rootPath;

  final CaptureConfig _config;

  File get _file => File(
    '$rootPath${Platform.pathSeparator}${_config.datasetRoot}'
    '${Platform.pathSeparator}${_config.sessionsFileName}',
  );

  @override
  Future<void> record(RecordingSession session) async {
    if (!session.isRecordable) return;

    final sessions = await all()
      ..removeWhere((s) => s.sessionUuid == session.sessionUuid)
      ..add(session);

    try {
      await _file.parent.create(recursive: true);
      await _file.writeAsString(
        const JsonEncoder.withIndent('  ').convert({
          'sessions': [for (final s in sessions) _toMap(s)],
        }),
        flush: true,
      );
    } on FileSystemException catch (error) {
      throw RepositoryFailure(
        'Could not record the capture session.',
        debugDetail: error,
      );
    }
  }

  @override
  Future<List<RecordingSession>> all() async {
    if (!await _file.exists()) return [];
    try {
      final decoded = jsonDecode(await _file.readAsString());
      final entries = (decoded as Map<String, Object?>)['sessions'] as List?;
      return [
        for (final entry in entries ?? const [])
          _fromMap((entry as Map).cast<String, Object?>()),
      ];
    } on Object catch (error) {
      // A corrupt session file must not block recording; it is metadata, not
      // dataset content. Report nothing rather than crashing the app.
      throw RepositoryFailure(
        'The session history could not be read.',
        debugDetail: error,
      );
    }
  }

  Map<String, Object?> _toMap(RecordingSession session) => {
    'session_uuid': session.sessionUuid,
    'pose_id': session.poseId,
    'started_at': formatEngineTimestamp(session.startedAt),
    'finished_at': session.finishedAt == null
        ? null
        : formatEngineTimestamp(session.finishedAt!),
    'total_samples': session.totalSamples,
    'discarded_samples': session.discardedSamples,
    'end_reason': session.endReason.wireValue,
  };

  RecordingSession _fromMap(Map<String, Object?> data) {
    final finishedAt = data['finished_at'] as String?;
    return RecordingSession(
      sessionUuid: data['session_uuid']! as String,
      poseId: data['pose_id']! as String,
      startedAt: DateTime.parse(data['started_at']! as String).toUtc(),
      finishedAt: finishedAt == null ? null : DateTime.parse(finishedAt).toUtc(),
      totalSamples: (data['total_samples'] as int?) ?? 0,
      discardedSamples: (data['discarded_samples'] as int?) ?? 0,
      endReason: SessionEndReason.values.firstWhere(
        (r) => r.wireValue == data['end_reason'],
        orElse: () => SessionEndReason.completed,
      ),
    );
  }
}
