/// `EffectOverlay` and its five painters: each renders without throwing, and
/// a `spritePair` definition with no `sprite_asset` falls back to a drawn
/// shape rather than a missing-asset error (contracts/effect-catalog.md).
library;

import 'package:capture/domain/effects/effect_definition.dart';
import 'package:capture/presentation/recognition/effect_overlay.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> pumpOverlay(WidgetTester tester, EffectDefinition definition) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 400,
          height: 800,
          child: EffectOverlay(
            definition: definition,
            anchor: const Offset(0.5, 0.4),
            onCompleted: () {},
          ),
        ),
      ),
    );
  }

  for (final kind in EffectKind.values) {
    testWidgets('${kind.name} renders without throwing at start, mid, and end of playback',
        (tester) async {
      await pumpOverlay(tester, EffectDefinition(kind: kind));
      expect(tester.takeException(), isNull);

      await tester.pump(effectPlaybackDuration ~/ 2);
      expect(tester.takeException(), isNull);

      await tester.pump(effectPlaybackDuration);
      expect(tester.takeException(), isNull);

      expect(find.byKey(const Key('effect-overlay-paint')), findsOneWidget);
    });
  }

  testWidgets('a spritePair definition with no sprite_asset falls back to a drawn shape',
      (tester) async {
    await pumpOverlay(
      tester,
      EffectDefinition(kind: EffectKind.spritePair, spriteAssetPath: null),
    );
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('effect-overlay-paint')), findsOneWidget);
  });

  testWidgets('calls onCompleted exactly once when playback finishes', (tester) async {
    var completedCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 400,
          height: 800,
          child: EffectOverlay(
            definition: EffectDefinition(kind: EffectKind.glow),
            anchor: const Offset(0.5, 0.4),
            onCompleted: () => completedCount++,
          ),
        ),
      ),
    );

    await tester.pump(effectPlaybackDuration + const Duration(milliseconds: 50));
    expect(completedCount, 1);

    // Holding past completion must not fire a second time.
    await tester.pump(const Duration(milliseconds: 500));
    expect(completedCount, 1);
  });

  testWidgets('an absent color falls back to a kind-specific default, never throws',
      (tester) async {
    for (final kind in EffectKind.values) {
      await pumpOverlay(tester, EffectDefinition(kind: kind, color: null));
      expect(tester.takeException(), isNull);
    }
  });
}
