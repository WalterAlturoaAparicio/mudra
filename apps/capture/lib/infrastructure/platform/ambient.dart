/// Ambient adapters: clock, identity, and structured logging.
library;

import 'dart:developer' as developer;

import 'package:capture/domain/ports/ports.dart';
import 'package:uuid/uuid.dart';

/// Wall-clock time from the host.
class SystemClock implements Clock {
  /// Creates a system clock.
  const SystemClock();

  @override
  DateTime nowUtc() => DateTime.now().toUtc();
}

/// UUID v4 identities.
class UuidV4Factory implements UuidFactory {
  /// Creates a factory.
  UuidV4Factory([Uuid? uuid]) : _uuid = uuid ?? const Uuid();

  final Uuid _uuid;

  @override
  String create() => _uuid.v4();
}

/// Structured logger.
///
/// The engine uses Loguru; Dart has no Loguru, so this emits the same
/// structured field-map shape Loguru's `bind()` produces, keeping the two
/// applications' logs directly comparable (Principle V). Per-frame events are
/// debug-only — never info — so a real-time loop cannot flood the log.
class StructuredAppLogger implements AppLogger {
  /// Creates a logger writing to the developer log channel.
  const StructuredAppLogger({this.minimumLevel = LogLevel.debug});

  /// Lowest level that is emitted.
  final LogLevel minimumLevel;

  @override
  void debug(String message, [Map<String, Object?> fields = const {}]) =>
      _emit(LogLevel.debug, message, fields);

  @override
  void info(String message, [Map<String, Object?> fields = const {}]) =>
      _emit(LogLevel.info, message, fields);

  @override
  void error(String message, [Map<String, Object?> fields = const {}]) =>
      _emit(LogLevel.error, message, fields);

  @override
  void startup(StartupRecord record) =>
      _emit(LogLevel.info, 'Mudra Capture started.', record.toFields());

  @override
  void shutdown(ShutdownRecord record) =>
      _emit(LogLevel.info, 'Mudra Capture stopped.', record.toFields());

  void _emit(LogLevel level, String message, Map<String, Object?> fields) {
    if (level.index < minimumLevel.index) return;
    final rendered = fields.isEmpty
        ? message
        : '$message ${_renderFields(fields)}';
    developer.log(
      rendered,
      name: 'mudra.capture',
      level: level.developerLevel,
    );
  }

  String _renderFields(Map<String, Object?> fields) =>
      fields.entries.map((e) => '${e.key}=${e.value}').join(' ');
}

/// Log severities, ordered.
enum LogLevel {
  /// Diagnostic detail, including per-frame events.
  debug(500),

  /// Notable lifecycle events.
  info(800),

  /// Failures worth investigating.
  error(1000);

  const LogLevel(this.developerLevel);

  /// Level value understood by `dart:developer`.
  final int developerLevel;
}
