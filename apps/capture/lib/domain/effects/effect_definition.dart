/// Data-driven confirmed-pose visual effects (research D8, FR-019/FR-020).
///
/// A small, fixed, shared set of [EffectKind]s, each parameterized by an
/// [EffectDefinition] read from `assets/config/effect_catalog.json` — the
/// same "configuration, not code" discipline the pose catalog itself already
/// follows. Authoring or changing an effect is a data edit, never a Dart
/// change.
///
/// Nothing here imports Flutter: [EffectColor] is a plain RGB value so this
/// stays testable on the host with no rendering engine, exactly like every
/// other domain type. The presentation layer converts it to a UI color.
library;

/// The small, fixed set of parameterized effect overlays (research D8).
///
/// Eighteen catalog poses do not need eighteen bespoke painters — a handful of
/// parameterized kinds covers every pose named in the milestone description
/// and any future one, with no new code required to add a pose's effect.
enum EffectKind {
  /// A soft colored glow.
  glow,

  /// A pair of shapes anchored near the hand (e.g. ears).
  spritePair,

  /// A burst of particles.
  particleBurst,

  /// A fade-out accompanied by drawn lines.
  fadeWithLines,

  /// The fallback effect for a pose with no themed entry (FR-020).
  genericConfirm,
}

/// A plain RGB color value, independent of any UI framework.
///
/// Domain types must not import Flutter (constitution, capture standards);
/// the presentation layer converts this to its own color type at render time.
class EffectColor {
  /// Creates a color from three 0–255 channel values.
  ///
  /// Throws [ArgumentError] for any channel outside `[0, 255]` — the same
  /// "assert the invariant once, at the boundary" pattern used throughout this
  /// domain.
  const EffectColor({required this.red, required this.green, required this.blue})
      : assert(red >= 0 && red <= 255, 'red must be in [0, 255]'),
        assert(green >= 0 && green <= 255, 'green must be in [0, 255]'),
        assert(blue >= 0 && blue <= 255, 'blue must be in [0, 255]');

  /// Red channel, `[0, 255]`.
  final int red;

  /// Green channel, `[0, 255]`.
  final int green;

  /// Blue channel, `[0, 255]`.
  final int blue;

  @override
  bool operator ==(Object other) =>
      other is EffectColor &&
      other.red == red &&
      other.green == green &&
      other.blue == blue;

  @override
  int get hashCode => Object.hash(red, green, blue);

  @override
  String toString() =>
      '#${red.toRadixString(16).padLeft(2, '0')}'
      '${green.toRadixString(16).padLeft(2, '0')}'
      '${blue.toRadixString(16).padLeft(2, '0')}';
}

/// The confirmed-pose effect for one pose, or the generic fallback.
class EffectDefinition {
  /// Creates an effect definition.
  ///
  /// Throws [ArgumentError] when [intensity] is outside `[0, 1]`.
  EffectDefinition({
    this.poseId,
    required this.kind,
    this.color,
    this.spriteAssetPath,
    this.intensity = 0.7,
  }) {
    if (intensity < 0 || intensity > 1) {
      throw ArgumentError.value(intensity, 'intensity', 'must be in [0, 1]');
    }
  }

  /// Which pose this is for; `null` represents the generic fallback entry,
  /// keyed by absence rather than a sentinel string.
  final String? poseId;

  /// Which shared painter renders this effect.
  final EffectKind kind;

  /// Used by [EffectKind.glow]/[EffectKind.particleBurst]/
  /// [EffectKind.fadeWithLines]; `null` falls back to a kind-specific default.
  final EffectColor? color;

  /// Used by [EffectKind.spritePair]. Absence is legal — the same
  /// placeholder-safety pattern specification 003's reference images already
  /// establish: a missing sprite falls back to a drawn shape, never a broken
  /// screen.
  final String? spriteAssetPath;

  /// `[0, 1]`; controls the duration/scale of the playback.
  final double intensity;

  @override
  bool operator ==(Object other) =>
      other is EffectDefinition &&
      other.poseId == poseId &&
      other.kind == kind &&
      other.color == color &&
      other.spriteAssetPath == spriteAssetPath &&
      other.intensity == intensity;

  @override
  int get hashCode =>
      Object.hash(poseId, kind, color, spriteAssetPath, intensity);
}
