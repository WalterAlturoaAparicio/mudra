/// Neutral hand-detection value objects.
///
/// These immutable classes are the backend-agnostic shape produced by any
/// `CameraSession` and consumed by a recording session. They mirror the Mudra
/// engine's landmark model exactly so a sample recorded on a phone means the
/// same thing as one recorded on the desktop.
///
/// Nothing here imports Flutter, plugins, or `dart:io` — that is what keeps the
/// whole capture pipeline testable on the host.
library;

import 'dart:math' as math;

import 'package:capture/domain/camera/camera.dart';

/// The fixed number of landmarks MediaPipe reports for one hand.
const int handLandmarkCount = 21;

/// Index of the wrist landmark — the normalization origin.
const int wristLandmarkIndex = 0;

/// Index of the middle-finger MCP landmark — the normalization scale reference.
const int middleFingerMcpLandmarkIndex = 9;

/// The physical hand a detection corresponds to.
///
/// Correct under selfie mirroring: MediaPipe assumes a mirrored input image, so
/// with the mirrored front-camera preview the reported label already names the
/// user's physical hand (FR-037a). A rear-lens capture is in the opposite
/// convention, and [flipped] is what puts it back — see `CanonicalViewConverter`.
enum Handedness {
  /// The user's physical left hand.
  left('left'),

  /// The user's physical right hand.
  right('right'),

  /// Reported when the detector gives no usable label.
  unknown('unknown');

  const Handedness(this.wireValue);

  /// The lowercase value written to and read from JSON.
  final String wireValue;

  /// The label under the opposite mirroring convention.
  ///
  /// `left ↔ right`; [unknown] stays [unknown]. Used **only** by the canonical
  /// conversion (FR-054): mirroring the geometry without relabelling would name
  /// the wrong physical hand, which is the silent corruption FR-044 exists to
  /// prevent.
  Handedness get flipped => switch (this) {
    Handedness.left => Handedness.right,
    Handedness.right => Handedness.left,
    Handedness.unknown => Handedness.unknown,
  };

  /// Maps a detector label (`"Left"`/`"Right"`) to a member.
  ///
  /// Unknown, empty, or missing labels map to [Handedness.unknown]; this never
  /// throws, because a strange label must not abort a capture session.
  static Handedness fromLabel(String? label) {
    switch (label?.trim().toLowerCase()) {
      case 'left':
        return Handedness.left;
      case 'right':
        return Handedness.right;
      default:
        return Handedness.unknown;
    }
  }
}

/// A single tracked point on a hand.
///
/// [x] and [y] are normalized to `[0, 1]` in (already mirrored) frame space;
/// [z] is relative depth (smaller is closer). [visibility] is reserved for
/// backends that provide it — MediaPipe Hands does not.
class Landmark {
  /// Creates a landmark from normalized coordinates.
  const Landmark({
    required this.x,
    required this.y,
    required this.z,
    this.visibility,
  });

  /// Horizontal position, normalized against the analysis frame width.
  final double x;

  /// Vertical position, normalized against the analysis frame height.
  final double y;

  /// Relative depth; smaller values are closer to the camera.
  final double z;

  /// Optional per-point visibility, `null` for MediaPipe Hands.
  final double? visibility;

  /// Whether every coordinate is finite (neither NaN nor infinite).
  bool get isFinite => x.isFinite && y.isFinite && z.isFinite;

  @override
  bool operator ==(Object other) =>
      other is Landmark &&
      other.x == x &&
      other.y == y &&
      other.z == z &&
      other.visibility == visibility;

  @override
  int get hashCode => Object.hash(x, y, z, visibility);

  @override
  String toString() => 'Landmark($x, $y, $z)';
}

/// The fixed set of 21 landmarks for one hand.
class HandLandmarks {
  /// Creates a hand from exactly [handLandmarkCount] points.
  ///
  /// Throws [ArgumentError] otherwise — the invariant every downstream layer
  /// relies on is enforced once, here at the boundary.
  HandLandmarks(List<Landmark> points) : points = List.unmodifiable(points) {
    if (points.length != handLandmarkCount) {
      throw ArgumentError.value(
        points.length,
        'points',
        'HandLandmarks requires exactly $handLandmarkCount points',
      );
    }
  }

  /// The 21 landmarks, in MediaPipe's canonical order.
  final List<Landmark> points;

  /// The wrist landmark — the normalization origin.
  Landmark get wrist => points[wristLandmarkIndex];

  /// Whether every point of this hand has finite coordinates.
  bool get allFinite => points.every((p) => p.isFinite);

  @override
  bool operator ==(Object other) {
    if (other is! HandLandmarks) return false;
    for (var i = 0; i < handLandmarkCount; i++) {
      if (other.points[i] != points[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hashAll(points);
}

/// One detected hand: its handedness, confidence, and landmarks.
class HandDetection {
  /// Creates a detected hand.
  const HandDetection({
    required this.handedness,
    required this.confidence,
    required this.landmarks,
  });

  /// Which physical hand this is.
  final Handedness handedness;

  /// Handedness classification confidence in `[0, 1]`.
  final double confidence;

  /// The 21 landmarks of this hand.
  final HandLandmarks landmarks;

  @override
  bool operator ==(Object other) =>
      other is HandDetection &&
      other.handedness == handedness &&
      other.confidence == confidence &&
      other.landmarks == landmarks;

  @override
  int get hashCode => Object.hash(handedness, confidence, landmarks);
}

/// The full result of processing one camera frame (0..N hands).
///
/// Frames are ephemeral: they never reach storage, only the samples derived
/// from them do (Principle II — coordinates, never images).
class LandmarkFrame {
  /// Creates a frame result.
  LandmarkFrame({
    required List<HandDetection> hands,
    required this.frameWidth,
    required this.frameHeight,
    required this.timestampMicros,
    this.convention = ViewConvention.canonical,
  }) : hands = List.unmodifiable(hands);

  /// The hands detected in this frame, in detector order.
  final List<HandDetection> hands;

  /// Analysis frame width the coordinates are normalized against.
  final int frameWidth;

  /// Analysis frame height the coordinates are normalized against.
  final int frameHeight;

  /// Monotonic capture instant, in microseconds, from the native side.
  final int timestampMicros;

  /// Which viewing convention these coordinates are in.
  ///
  /// Carried **on the frame** so the canonical conversion is a total function on
  /// data rather than a decision made from ambient state. Everything above the
  /// camera seam only ever observes [ViewConvention.canonical] frames.
  final ViewConvention convention;

  /// Whether these coordinates are already in the canonical convention.
  bool get isCanonical => convention == ViewConvention.canonical;

  /// Returns a copy with [hands] and [convention] replaced.
  ///
  /// Used by the canonical conversion; every other field is carried through
  /// unchanged, because conversion changes coordinates, never provenance.
  LandmarkFrame withHands(
    List<HandDetection> hands, {
    required ViewConvention convention,
  }) => LandmarkFrame(
    hands: hands,
    frameWidth: frameWidth,
    frameHeight: frameHeight,
    timestampMicros: timestampMicros,
    convention: convention,
  );

  /// Number of hands detected; `0` is valid and means "no hands".
  int get handCount => hands.length;

  /// Euclidean distance helper used by normalization and tests.
  static double distance(Landmark a, Landmark b) {
    final dx = b.x - a.x;
    final dy = b.y - a.y;
    final dz = b.z - a.z;
    return math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
