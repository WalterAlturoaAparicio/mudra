/// `CatalogReadinessSheet`: every catalog pose appears, ready/not-ready
/// matches the seeded exemplar counts (T052), including two-handed poses
/// (T058).
library;

import 'package:capture/domain/poses/pose_catalog.dart';
import 'package:capture/domain/recognition/catalog_readiness.dart';
import 'package:capture/presentation/recognition/catalog_readiness_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/sample_factories.dart';

void main() {
  testWidgets('all catalog poses appear, ready/not-ready matches seeded counts', (tester) async {
    final catalog = PoseCatalog([
      makePose(poseId: 'peace', displayName: 'Peace'),
      makePose(poseId: 'ok', displayName: 'Ok'),
      makePose(poseId: 'empty', displayName: 'Empty'),
    ]);
    final readiness = CatalogReadiness(const [
      PoseReadiness(poseId: 'peace', exemplarCount: 25, minRequired: 20),
      PoseReadiness(poseId: 'ok', exemplarCount: 5, minRequired: 20),
      PoseReadiness(poseId: 'empty', exemplarCount: 0, minRequired: 20),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: CatalogReadinessSheet(catalog: catalog, readiness: readiness),
      ),
    );

    expect(find.byKey(const Key('readiness-row-peace')), findsOneWidget);
    expect(find.byKey(const Key('readiness-row-ok')), findsOneWidget);
    expect(find.byKey(const Key('readiness-row-empty')), findsOneWidget);
    expect(find.text('Peace'), findsOneWidget);
    expect(find.text('Ok'), findsOneWidget);
    expect(find.text('Empty'), findsOneWidget);

    expect(find.descendant(of: find.byKey(const Key('readiness-row-peace')), matching: find.text('25 / 20')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('readiness-row-ok')), matching: find.text('5 / 20')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('readiness-row-empty')), matching: find.text('0 / 20')), findsOneWidget);

    expect(find.text('1 / 3 ready'), findsOneWidget);
  });

  testWidgets('a two-handed pose reports readiness from its per-sample hand-count '
      'data, exactly like a one-handed pose (T058)', (tester) async {
    final catalog = PoseCatalog([
      makePose(poseId: 'peace', displayName: 'Peace'),
      makeTwoHandedPose(poseId: 'dragon'),
    ]);
    // A two-handed pose's exemplar count reflects samples where both hands
    // were present — `FileExemplarSource` already produces this count the
    // same way for every pose regardless of `requiredHands`; this sheet has
    // no special case for it either.
    final readiness = CatalogReadiness(const [
      PoseReadiness(poseId: 'peace', exemplarCount: 25, minRequired: 20),
      PoseReadiness(poseId: 'dragon', exemplarCount: 22, minRequired: 20),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: CatalogReadinessSheet(catalog: catalog, readiness: readiness),
      ),
    );

    expect(find.byKey(const Key('readiness-row-dragon')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('readiness-row-dragon')),
        matching: find.text('22 / 20'),
      ),
      findsOneWidget,
    );
    expect(find.text('2 / 2 ready'), findsOneWidget);
  });
}
