/// Engine-compatible ISO-8601 timestamp formatting.
///
/// Dart's `toIso8601String()` emits a trailing `Z` and always includes
/// milliseconds; Python's `datetime.isoformat()` emits a `+00:00` offset and
/// omits the fractional part entirely when microseconds are zero. Samples from
/// both applications land in the same dataset, so Capture matches Python's
/// spelling exactly rather than leaving a gratuitous textual difference for
/// whoever diffs the files later.
library;

/// Formats [value] as UTC ISO-8601 the way the Mudra engine writes it.
///
/// Examples: `2026-07-24T13:20:00.123456+00:00`, `2026-07-24T13:20:00+00:00`.
String formatEngineTimestamp(DateTime value) {
  final utc = value.toUtc();
  final buffer = StringBuffer()
    ..write(_pad(utc.year, 4))
    ..write('-')
    ..write(_pad(utc.month, 2))
    ..write('-')
    ..write(_pad(utc.day, 2))
    ..write('T')
    ..write(_pad(utc.hour, 2))
    ..write(':')
    ..write(_pad(utc.minute, 2))
    ..write(':')
    ..write(_pad(utc.second, 2));

  final micros = utc.millisecond * 1000 + utc.microsecond;
  if (micros != 0) {
    buffer
      ..write('.')
      ..write(_pad(micros, 6));
  }
  buffer.write('+00:00');
  return buffer.toString();
}

String _pad(int value, int width) => value.toString().padLeft(width, '0');
