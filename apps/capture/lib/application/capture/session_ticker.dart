/// Non-blocking session clock.
///
/// The countdown and the capture window advance by polling this ticker, never
/// by sleeping — the camera preview must keep rendering throughout (FR-011,
/// SC-010). Injected so tests can drive time by hand instead of waiting.
library;

import 'dart:async';

/// Emits cumulative elapsed time at a fixed interval.
abstract interface class SessionTicker {
  /// Elapsed time since subscription, emitted every [interval].
  Stream<Duration> ticks(Duration interval);
}

/// Wall-clock ticker used in the running application.
class PeriodicSessionTicker implements SessionTicker {
  /// Creates a periodic ticker.
  const PeriodicSessionTicker();

  @override
  Stream<Duration> ticks(Duration interval) =>
      Stream<Duration>.periodic(interval, (count) => interval * (count + 1));
}
