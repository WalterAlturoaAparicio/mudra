/// The coordinate-diagnostics toggle (research D24): off by default, and
/// independent of [DebugOverlayNotifier] — mirrors that notifier's own test
/// exactly, since both follow the same pattern deliberately.
library;

import 'package:capture/application/debug/coordinate_debug_notifier.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late ProviderContainer container;
  late NotifierProvider<CoordinateDebugNotifier, bool> provider;

  setUp(() {
    provider = NotifierProvider<CoordinateDebugNotifier, bool>(
      CoordinateDebugNotifier.new,
    );
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  test('starts disabled', () {
    expect(container.read(provider), isFalse);
  });

  test('toggle flips both directions', () {
    final notifier = container.read(provider.notifier);

    notifier.toggle();
    expect(container.read(provider), isTrue);

    notifier.toggle();
    expect(container.read(provider), isFalse);
  });

  test('a fresh container starts disabled regardless of another one', () {
    container.read(provider.notifier).toggle();

    final fresh = ProviderContainer();
    addTearDown(fresh.dispose);

    expect(fresh.read(provider), isFalse);
  });
}
