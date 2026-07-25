/// The capture session state machine and its result type.
///
/// `idle → countdown → capturing → saving → summary → idle`, with `cancelled`
/// and `failed` as alternative terminal states. The preview keeps rendering
/// throughout — no state here ever blocks (FR-011).
library;

import 'package:capture/domain/capture/capture_session.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/errors/failures.dart';

/// The outcome of one capture session, as shown to the user.
class CaptureResult {
  /// Creates a capture result.
  CaptureResult({
    required this.sessionUuid,
    required this.poseId,
    required this.accepted,
    required this.discarded,
    required this.duration,
    required this.endReason,
    Map<RejectionReason, int> rejectionCounts = const {},
    List<SampleRef> refs = const [],
  })  : rejectionCounts = Map.unmodifiable(rejectionCounts),
        refs = List.unmodifiable(refs);

  /// The session that produced this result.
  final String sessionUuid;

  /// The pose that was collected.
  final String poseId;

  /// Samples stored.
  final int accepted;

  /// Frames rejected by validation.
  final int discarded;

  /// Why each rejected frame was dropped.
  final Map<RejectionReason, int> rejectionCounts;

  /// How long the capture window actually ran.
  final Duration duration;

  /// How the session ended.
  final SessionEndReason endReason;

  /// Handles to what was written.
  final List<SampleRef> refs;

  /// Total frames observed during the window.
  int get observed => accepted + discarded;

  /// Whether anything at all was stored.
  bool get isEmpty => accepted == 0;

  /// Whether the session stopped because the configured cap was reached.
  bool get hitLimit => endReason == SessionEndReason.limitReached;

  /// The most common rejection reason, or `null` when nothing was rejected.
  ///
  /// Drives the plain-language hint in the summary — telling the user *why* a
  /// take was poor is what lets them fix it on the next press.
  RejectionReason? get dominantRejection {
    RejectionReason? worst;
    var worstCount = 0;
    rejectionCounts.forEach((reason, count) {
      if (count > worstCount) {
        worst = reason;
        worstCount = count;
      }
    });
    return worst;
  }
}

/// The state of the capture workflow at one instant.
sealed class CaptureSessionState {
  /// Base constructor.
  const CaptureSessionState();

  /// Whether a session is in flight (countdown, capturing, or saving).
  bool get isActive =>
      this is CountdownState || this is CapturingState || this is SavingState;
}

/// Nothing is happening; Record is enabled.
class IdleState extends CaptureSessionState {
  /// Creates the idle state.
  const IdleState();
}

/// Counting down before capture; the preview stays live (FR-011).
class CountdownState extends CaptureSessionState {
  /// Creates a countdown state.
  const CountdownState({required this.remaining, required this.total});

  /// Time left before capture starts.
  final Duration remaining;

  /// Configured countdown length.
  final Duration total;

  /// The number to show on screen: 3, 2, 1, then 0.
  int get displayValue {
    final seconds = (remaining.inMilliseconds / 1000).ceil();
    return seconds < 0 ? 0 : seconds;
  }

  /// Fraction of the countdown elapsed, in `[0, 1]`.
  double get progress {
    if (total.inMicroseconds <= 0) return 1;
    final elapsed = total.inMicroseconds - remaining.inMicroseconds;
    return (elapsed / total.inMicroseconds).clamp(0.0, 1.0);
  }
}

/// Capturing frames automatically; accepted/discarded tallies update live.
class CapturingState extends CaptureSessionState {
  /// Creates a capturing state.
  const CapturingState({
    required this.elapsed,
    required this.window,
    required this.accepted,
    required this.discarded,
  });

  /// How long the window has been running.
  final Duration elapsed;

  /// Configured window length.
  final Duration window;

  /// Frames accepted so far.
  final int accepted;

  /// Frames discarded so far.
  final int discarded;

  /// Fraction of the capture window elapsed, in `[0, 1]`.
  double get progress {
    if (window.inMicroseconds <= 0) return 1;
    return (elapsed.inMicroseconds / window.inMicroseconds).clamp(0.0, 1.0);
  }
}

/// Persisting the buffered samples.
class SavingState extends CaptureSessionState {
  /// Creates a saving state.
  const SavingState({required this.accepted});

  /// How many samples are being written.
  final int accepted;
}

/// The session finished; its result is on screen.
class SummaryState extends CaptureSessionState {
  /// Creates a summary state.
  const SummaryState(this.result);

  /// What the session produced.
  final CaptureResult result;
}

/// The session was aborted; nothing was written.
class CancelledState extends CaptureSessionState {
  /// Creates a cancelled state.
  const CancelledState(this.reason);

  /// Why the session ended.
  final SessionEndReason reason;
}

/// The session failed; nothing partial was written.
class FailedState extends CaptureSessionState {
  /// Creates a failed state.
  const FailedState(this.failure);

  /// What went wrong, in terms fit to show a user.
  final Failure failure;
}
