/// The recording-session state machine and its result type.
///
/// One press of Record runs:
///
/// ```text
///                     countdown enabled
/// idle ──press Record──┬──► countdown ──reaches zero──┐
///                      │                              ▼
///                      └──────────────────────────► capturing ──window ends──► saving ──► summary
///                             countdown disabled          │                                  │
///                             (FR-010)                    │                       dismissed / confirm off
///                             │                           │                                  │
///                             └────── cancel ─────────────┴──► cancelled ────────────────────┤
///                                                         └──► failed ─────────────────────► idle
/// ```
///
/// Two properties matter and both are R1:
///
/// - the countdown is **conditional** — with it disabled, [CountdownState] is
///   never entered at all (FR-010);
/// - **no terminal state releases the camera or leaves the screen**. Every
///   terminal state returns to [IdleState] on the same screen with the camera
///   still held, so the next take needs no reacquisition (FR-076). Leaving is an
///   explicit user action, never a consequence of finishing a take.
///
/// The preview keeps rendering throughout — no state here ever blocks (FR-011).
///
/// Named `CaptureSessionState` before revision R1.1; renamed because "capture
/// session" now names the screen-level scope, not a take.
library;

import 'package:capture/domain/capture/recording_session.dart';
import 'package:capture/domain/samples/pose_sample.dart';
import 'package:capture/shared/errors/failures.dart';

/// The outcome of one recording session, as shown to the user.
class RecordingResult {
  /// Creates a recording result.
  RecordingResult({
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

  /// The take that produced this result.
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

  /// How the take ended.
  final SessionEndReason endReason;

  /// Handles to what was written.
  final List<SampleRef> refs;

  /// Total frames observed during the window.
  int get observed => accepted + discarded;

  /// Whether anything at all was stored.
  bool get isEmpty => accepted == 0;

  /// Whether the take stopped because the configured cap was reached.
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

/// The state of one take at one instant.
sealed class RecordingSessionState {
  /// Base constructor.
  const RecordingSessionState();

  /// Whether a take is in flight (countdown, capturing, or saving).
  bool get isActive =>
      this is CountdownState || this is CapturingState || this is SavingState;

  /// Whether this state ends the take.
  bool get isTerminal =>
      this is SummaryState || this is CancelledState || this is FailedState;
}

/// Nothing is happening; Record is enabled and the camera is live.
class IdleState extends RecordingSessionState {
  /// Creates the idle state.
  const IdleState();
}

/// Counting down before capture; the preview stays live (FR-011).
///
/// **Skipped entirely** when the countdown is disabled for the capture session
/// (FR-010) — this state is never entered, rather than entered with a zero
/// duration.
class CountdownState extends RecordingSessionState {
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
class CapturingState extends RecordingSessionState {
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
class SavingState extends RecordingSessionState {
  /// Creates a saving state.
  const SavingState({required this.accepted});

  /// How many samples are being written.
  final int accepted;
}

/// The take finished; its result is on screen.
///
/// Blocks the next take until dismissed when take confirmation is on (FR-077);
/// otherwise the screen passes straight through to [IdleState] while still
/// conveying the result (FR-078). Either way the camera stays acquired.
class SummaryState extends RecordingSessionState {
  /// Creates a summary state.
  const SummaryState(this.result);

  /// What the take produced.
  final RecordingResult result;
}

/// The take was abandoned; nothing was written.
class CancelledState extends RecordingSessionState {
  /// Creates a cancelled state.
  const CancelledState(this.reason);

  /// Why the take ended.
  final SessionEndReason reason;
}

/// The take failed; nothing partial was written.
class FailedState extends RecordingSessionState {
  /// Creates a failed state.
  const FailedState(this.failure);

  /// What went wrong, in terms fit to show a user.
  final Failure failure;
}
