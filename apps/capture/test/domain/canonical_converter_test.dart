/// The canonical viewing convention (FR-053–FR-058).
///
/// This is the transform that lets the dataset contain both lenses without
/// fragmenting. Getting it wrong does not crash anything — it silently mislabels
/// hands, which is precisely the failure FR-044 exists to prevent and which no
/// downstream consumer could detect. So it is tested from every angle.
library;

import 'package:capture/domain/camera/camera.dart';
import 'package:capture/domain/canonical/canonical_view_converter.dart';
import 'package:capture/domain/landmarks/landmarks.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const converter = MirrorCanonicalViewConverter();

  /// A hand whose landmarks are asymmetric about x, so mirroring is visible.
  HandLandmarks handAt(double baseX) => HandLandmarks([
    for (var i = 0; i < handLandmarkCount; i++)
      Landmark(x: baseX + i * 0.01, y: 0.4 + i * 0.005, z: -0.01 * i),
  ]);

  LandmarkFrame frame({
    required ViewConvention convention,
    List<HandDetection>? hands,
  }) => LandmarkFrame(
    hands: hands ??
        [
          HandDetection(
            handedness: Handedness.left,
            confidence: 0.97,
            landmarks: handAt(0.2),
          ),
        ],
    frameWidth: 640,
    frameHeight: 480,
    timestampMicros: 1000,
    convention: convention,
  );

  group('a canonical frame is left alone', () {
    test('returns the identical instance, not a copy', () {
      final input = frame(convention: ViewConvention.canonical);
      expect(identical(converter.toCanonical(input), input), isTrue);
    });

    test('handedness and geometry are untouched', () {
      final input = frame(convention: ViewConvention.canonical);
      final output = converter.toCanonical(input);

      expect(output.hands.single.handedness, Handedness.left);
      expect(output.hands.single.landmarks, input.hands.single.landmarks);
    });
  });

  group('an unmirrored frame is converted (FR-053/FR-054)', () {
    test('x is reflected and y, z are untouched', () {
      final input = frame(convention: ViewConvention.unmirrored);
      final output = converter.toCanonical(input);

      final before = input.hands.single.landmarks.points;
      final after = output.hands.single.landmarks.points;

      for (var i = 0; i < handLandmarkCount; i++) {
        expect(after[i].x, closeTo(1.0 - before[i].x, 1e-12));
        expect(after[i].y, before[i].y);
        expect(after[i].z, before[i].z);
      }
    });

    test('handedness flips, because MediaPipe assumes a mirrored input', () {
      final input = frame(convention: ViewConvention.unmirrored);
      expect(converter.toCanonical(input).hands.single.handedness,
          Handedness.right);
    });

    test('unknown handedness stays unknown', () {
      final input = frame(
        convention: ViewConvention.unmirrored,
        hands: [
          HandDetection(
            handedness: Handedness.unknown,
            confidence: 0.5,
            landmarks: handAt(0.3),
          ),
        ],
      );

      expect(converter.toCanonical(input).hands.single.handedness,
          Handedness.unknown);
    });

    test('the frame reports the canonical convention afterwards', () {
      final output = converter.toCanonical(
        frame(convention: ViewConvention.unmirrored),
      );
      expect(output.convention, ViewConvention.canonical);
      expect(output.isCanonical, isTrue);
    });

    test('provenance is carried through unchanged', () {
      final input = frame(convention: ViewConvention.unmirrored);
      final output = converter.toCanonical(input);

      // Conversion changes coordinates, never where they came from.
      expect(output.frameWidth, input.frameWidth);
      expect(output.frameHeight, input.frameHeight);
      expect(output.timestampMicros, input.timestampMicros);
      expect(output.confidenceOfSingleHand, input.confidenceOfSingleHand);
    });

    test('the input is not mutated', () {
      final input = frame(convention: ViewConvention.unmirrored);
      final originalX = input.hands.single.landmarks.points.first.x;

      converter.toCanonical(input);

      expect(input.hands.single.landmarks.points.first.x, originalX);
      expect(input.convention, ViewConvention.unmirrored);
      expect(input.hands.single.handedness, Handedness.left);
    });
  });

  group('two hands keep their identity, never swap (FR-054)', () {
    test('each entry keeps its own geometry with its own relabelled hand', () {
      final left = handAt(0.1);
      final right = handAt(0.6);
      final input = frame(
        convention: ViewConvention.unmirrored,
        hands: [
          HandDetection(
            handedness: Handedness.left,
            confidence: 0.91,
            landmarks: left,
          ),
          HandDetection(
            handedness: Handedness.right,
            confidence: 0.88,
            landmarks: right,
          ),
        ],
      );

      final output = converter.toCanonical(input);

      expect(output.hands, hasLength(2));
      // Entry 0 was the left hand at x≈0.1; it is now labelled right, and its
      // geometry is *its own* mirrored geometry — not the other hand's.
      expect(output.hands[0].handedness, Handedness.right);
      expect(output.hands[0].confidence, 0.91);
      expect(output.hands[0].landmarks.points.first.x,
          closeTo(1.0 - left.points.first.x, 1e-12));

      expect(output.hands[1].handedness, Handedness.left);
      expect(output.hands[1].confidence, 0.88);
      expect(output.hands[1].landmarks.points.first.x,
          closeTo(1.0 - right.points.first.x, 1e-12));
    });

    test('the list order is preserved', () {
      final input = frame(
        convention: ViewConvention.unmirrored,
        hands: [
          HandDetection(
            handedness: Handedness.left,
            confidence: 0.9,
            landmarks: handAt(0.1),
          ),
          HandDetection(
            handedness: Handedness.right,
            confidence: 0.8,
            landmarks: handAt(0.6),
          ),
        ],
      );

      final output = converter.toCanonical(input);

      // Confidence is the fingerprint here: it identifies which input entry
      // each output entry came from, independently of the relabelling.
      expect(output.hands.map((h) => h.confidence).toList(), [0.9, 0.8]);
    });
  });

  test('conversion is involutive: converting twice changes nothing more', () {
    final once = converter.toCanonical(
      frame(convention: ViewConvention.unmirrored),
    );
    final twice = converter.toCanonical(once);

    expect(identical(twice, once), isTrue);
    expect(twice.hands.single.landmarks, once.hands.single.landmarks);
    expect(twice.hands.single.handedness, once.hands.single.handedness);
  });

  group('Self and Operator agree on the same physical hand (SC-031)', () {
    test('the same hand recorded through either lens converges', () {
      // The same physical right hand. The front lens delivers it already
      // mirrored and labelled `right`; the rear lens delivers the reflected
      // geometry labelled `left`.
      final asSeenBySelf = handAt(0.25);
      final asSeenByOperator = HandLandmarks([
        for (final p in asSeenBySelf.points)
          Landmark(x: 1.0 - p.x, y: p.y, z: p.z),
      ]);

      final selfCapture = converter.toCanonical(
        frame(
          convention: ViewConvention.canonical,
          hands: [
            HandDetection(
              handedness: Handedness.right,
              confidence: 0.95,
              landmarks: asSeenBySelf,
            ),
          ],
        ),
      );
      final operatorCapture = converter.toCanonical(
        frame(
          convention: ViewConvention.unmirrored,
          hands: [
            HandDetection(
              handedness: Handedness.left,
              confidence: 0.95,
              landmarks: asSeenByOperator,
            ),
          ],
        ),
      );

      expect(
        operatorCapture.hands.single.handedness,
        selfCapture.hands.single.handedness,
        reason: 'SC-031: both modes must agree on handedness',
      );
      for (var i = 0; i < handLandmarkCount; i++) {
        expect(
          operatorCapture.hands.single.landmarks.points[i].x,
          closeTo(selfCapture.hands.single.landmarks.points[i].x, 1e-12),
          reason: 'SC-031: geometry must match after conversion',
        );
      }
    });
  });
}

/// Small helper so a test can assert provenance survived without reaching into
/// the hand list twice.
extension on LandmarkFrame {
  double get confidenceOfSingleHand => hands.single.confidence;
}
