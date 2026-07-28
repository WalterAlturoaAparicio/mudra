/// The debug overlay's runtime toggle (FR-123, FR-126): off by default, the
/// user's choice and nothing else, scoped to one container like every other
/// application-run setting.
library;

import 'package:capture/application/debug/debug_overlay_notifier.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late ProviderContainer container;
  late NotifierProvider<DebugOverlayNotifier, bool> provider;

  setUp(() {
    provider = NotifierProvider<DebugOverlayNotifier, bool>(
      DebugOverlayNotifier.new,
    );
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  bool read() => container.read(provider);
  DebugOverlayNotifier notifier() => container.read(provider.notifier);

  test('starts disabled', () {
    expect(read(), isFalse);
  });

  test('toggle flips both directions', () {
    notifier().toggle();
    expect(read(), isTrue);

    notifier().toggle();
    expect(read(), isFalse);
  });

  test('setEnabled sets the state explicitly, idempotently', () {
    notifier().setEnabled(enabled: true);
    expect(read(), isTrue);

    notifier().setEnabled(enabled: true);
    expect(read(), isTrue);

    notifier().setEnabled(enabled: false);
    expect(read(), isFalse);
  });

  test('a fresh container starts disabled regardless of another one', () {
    notifier().setEnabled(enabled: true);

    final fresh = ProviderContainer();
    addTearDown(fresh.dispose);

    expect(fresh.read(provider), isFalse);
  });
}
