/// Layer boundaries, enforced rather than observed (FR-115, Principle I).
///
/// A convention nobody checks is a convention that drifts, and this particular
/// one has **no visible symptom** until it is expensive to undo: an application
/// still works perfectly when camera code starts reaching into storage. By the
/// time anyone notices, the camera is no longer replaceable and FR-112–FR-116
/// are quietly false.
///
/// So the boundary is a test. It reads the actual import directives of every
/// source file and fails with the offending file and import named, because a
/// failure that does not say *what* to fix teaches nobody anything.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// One forbidden dependency edge.
class _Rule {
  const _Rule({
    required this.from,
    required this.forbidden,
    required this.because,
  });

  /// Path prefix (under `lib/`) the rule applies to.
  final String from;

  /// Path prefixes those files may not import.
  final List<String> forbidden;

  /// Why the edge is forbidden, quoted in the failure message.
  final String because;
}

void main() {
  const rules = <_Rule>[
    _Rule(
      from: 'application/camera/',
      forbidden: [
        'infrastructure/storage/',
        'infrastructure/serialization/',
        'infrastructure/export/',
      ],
      because: 'FR-115: camera management must not read from or write to '
          'dataset storage. The only coupling is the descriptive metadata the '
          'camera reports for a sample.',
    ),
    _Rule(
      from: 'infrastructure/camera/',
      forbidden: [
        'infrastructure/storage/',
        'infrastructure/serialization/',
        'infrastructure/export/',
        'application/',
        'presentation/',
      ],
      because: 'FR-115: the camera implementation must not know the dataset '
          'exists, and must not reach upward into application or presentation.',
    ),
    _Rule(
      from: 'infrastructure/storage/',
      forbidden: ['camera/', 'infrastructure/camera/'],
      because: 'FR-115: dataset recording must not reach into camera '
          'internals.',
    ),
    _Rule(
      from: 'infrastructure/export/',
      forbidden: ['infrastructure/camera/'],
      because: 'FR-115: export must not depend on the camera.',
    ),
    _Rule(
      from: 'domain/',
      forbidden: ['infrastructure/', 'presentation/', 'application/'],
      because: 'Principle I: dependencies point inward only. The domain is the '
          'centre; nothing it imports may point outward.',
    ),
    _Rule(
      from: 'application/',
      forbidden: ['presentation/', 'infrastructure/'],
      because: 'Principle I: the application layer orchestrates the domain '
          'through ports, and never depends on widgets or plugins.',
    ),
  ];

  /// Packages the domain must never import, so it stays host-testable and
  /// portable (constitution, capture standards).
  const forbiddenInDomain = <String>[
    'package:flutter/',
    'package:flutter_riverpod/',
    'dart:io',
    'dart:ui',
    'package:path_provider/',
    'package:permission_handler/',
    'package:share_plus/',
  ];

  final libDir = Directory('lib');

  List<({String path, String import})> importsUnder(String prefix) {
    final results = <({String path, String import})>[];
    for (final entity in libDir.listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final relative = entity.path
          .replaceAll(r'\', '/')
          .split('lib/')
          .last;
      if (!relative.startsWith(prefix)) continue;

      for (final line in entity.readAsLinesSync()) {
        final match = RegExp(
          r'''^\s*(?:import|export)\s+['"]([^'"]+)['"]''',
        ).firstMatch(line);
        if (match != null) {
          results.add((path: relative, import: match.group(1)!));
        }
      }
    }
    return results;
  }

  test('lib/ exists and is non-empty', () {
    expect(libDir.existsSync(), isTrue);
    expect(importsUnder(''), isNotEmpty);
  });

  for (final rule in rules) {
    test('${rule.from} respects its boundaries', () {
      final violations = <String>[];

      for (final entry in importsUnder(rule.from)) {
        for (final forbidden in rule.forbidden) {
          final target = 'package:capture/$forbidden';
          if (entry.import.startsWith(target)) {
            violations.add('  lib/${entry.path}\n    imports ${entry.import}');
          }
        }
      }

      expect(
        violations,
        isEmpty,
        reason: '${rule.because}\n\nOffending imports:\n'
            '${violations.join('\n')}',
      );
    });
  }

  test('domain/ imports no framework, plugin, or dart:io', () {
    final violations = <String>[];

    for (final entry in importsUnder('domain/')) {
      for (final forbidden in forbiddenInDomain) {
        if (entry.import.startsWith(forbidden)) {
          violations.add('  lib/${entry.path}\n    imports ${entry.import}');
        }
      }
    }

    expect(
      violations,
      isEmpty,
      reason: 'The domain layer must import nothing from Flutter, a plugin, or '
          'dart:io — that is what keeps it testable on the host and portable to '
          'another platform.\n\nOffending imports:\n${violations.join('\n')}',
    );
  });

  test('the camera boundary is the only platform-specific camera code', () {
    // FR-112/FR-114: adding another platform must mean supplying one
    // implementation, not editing recording, dataset, or presentation logic.
    final channelUsers = <String>[];

    for (final entry in importsUnder('')) {
      if (entry.import != 'package:flutter/services.dart') continue;
      if (entry.path.startsWith('infrastructure/')) continue;
      channelUsers.add('  lib/${entry.path}');
    }

    expect(
      channelUsers,
      isEmpty,
      reason: 'Platform channels belong in infrastructure/ alone.\n'
          '${channelUsers.join('\n')}',
    );
  });
}
