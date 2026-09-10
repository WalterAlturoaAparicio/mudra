/**
 * The particle simulation, as one pure function over configuration data (item 4).
 *
 * **There is exactly one formula.** Circle, cone, burst, directional, spiral, random and
 * fountain are not seven behaviours — they are seven sets of numbers fed to the expression
 * below. `PARTICLE_PRESETS` is a table of parameter values, applied through the ordinary
 * inspector edit path, and nothing at runtime ever learns which preset (if any) produced the
 * values it is simulating. A new look is a new row in that table, or an author moving
 * sliders; neither is a code change here, and neither is a branch in the renderer.
 *
 * **Deterministic by construction.** Every per-particle variation is a pure function of
 * `(seed, index)` — a hash, not a stateful generator — so the same burst is the same picture
 * on every run, and a test can assert the whole of it without seeding anything. That property
 * predates this pass (`test/domain/effect-runtime.test.ts` asserts it) and is preserved.
 *
 * **Shared with the editor's preview** (item 5). `presentation/editor/particle-preview.ts`
 * does not re-implement any of this: it calls the shipped action's own `update()`, which
 * calls this function, and hands the resulting render commands to the same `Canvas2DRenderer`
 * the stage uses. There is no second particle runtime to drift.
 *
 * Angles are in **degrees, screen-oriented**: `0` points right, `90` points down, `270`
 * points up — the same y-down space every render command already uses.
 */

/** One particle, at one instant. */
export interface SimulatedParticle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** `0..1`. */
  readonly alpha: number;
  /** `#rrggbb`. */
  readonly color: string;
}

/** How a burst distributes its colours across particles and time. */
export type ColorMixMode = 'single' | 'gradient' | 'alternate';

/** Everything the simulation reads. Plain numbers and strings — no action, no registry. */
export interface ParticleConfig {
  readonly count: number;
  /** Where the emission arc is centred, in degrees. */
  readonly directionDeg: number;
  /** How wide the emission arc is. `360` emits in every direction. */
  readonly arcDeg: number;
  /** How far, in pixels, a particle at full speed travels over its own lifetime. */
  readonly spread: number;
  /** `0..1` — how much slower the slowest particle is than the fastest. */
  readonly speedVariation: number;
  /** Pixels of downward drift accumulated over a particle's lifetime, quadratically. */
  readonly gravity: number;
  /** Degrees a particle's direction rotates over its own lifetime. */
  readonly swirlDeg: number;
  /** Particle radius at birth, in pixels. */
  readonly radius: number;
  /** Radius multiplier at the end of a particle's life. */
  readonly endScale: number;
  readonly color: string;
  /** The second colour, for `gradient` and `alternate`. Ignored when `colorMix` is `single`. */
  readonly colorEnd: string;
  readonly colorMix: ColorMixMode;
  readonly startOpacity: number;
  readonly endOpacity: number;
  /** A particle's own lifetime, as a fraction of the clip's duration. */
  readonly lifetimeFraction: number;
  /** Over what fraction of the clip's duration particles are emitted. `0` = all at once. */
  readonly emissionFraction: number;
  /** `0..1` — how much angle and speed are randomized per particle. */
  readonly randomness: number;
  /** Chooses which deterministic variation this burst gets. */
  readonly seed: number;
}

/** Golden-angle spacing, so a full-circle emission never visibly clusters. */
const GOLDEN_ANGLE_DEG = 180 * (3 - Math.sqrt(5));
/** The irrational step the per-particle speed variation walks in. */
const PHI_FRACTION = 0.61803398875;

const DEG_TO_RAD = Math.PI / 180;

function fraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * A deterministic `[0,1)` value for one particle and one purpose.
 *
 * A hash rather than a sequence: `hashUnit(seed, i, 'angle')` does not depend on how many
 * particles were asked for before it, so changing `count` never reshuffles the particles that
 * were already there.
 */
function hashUnit(seed: number, index: number, channel: number): number {
  const x = Math.sin((index + 1) * 127.1 + seed * 311.7 + channel * 74.7) * 43758.5453;
  return fraction(Math.abs(x));
}

/** Mix two `#rrggbb` colours. `t` is clamped to `[0,1]`. */
export function mixHexColors(from: string, to: string, t: number): string {
  const amount = t < 0 ? 0 : t > 1 ? 1 : t;
  const parse = (hex: string, offset: number): number => {
    const value = parseInt(hex.slice(1 + offset * 2, 3 + offset * 2), 16);
    return Number.isNaN(value) ? 0 : value;
  };
  if (!/^#[0-9a-fA-F]{6}$/.test(from) || !/^#[0-9a-fA-F]{6}$/.test(to)) {
    return from;
  }
  const channels = [0, 1, 2].map((offset) => {
    const a = parse(from, offset);
    const b = parse(to, offset);
    return Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0');
  });
  return '#' + channels.join('');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Where every particle is, how big, how opaque and what colour, at `elapsedMs` into a clip of
 * `clipDurationMs`.
 *
 * @param originX Emission origin in device pixels — the already-resolved anchor (FR-060).
 * @returns Only the particles currently alive and visible. An empty array is a legitimate
 *   answer (before the first birth, after the last death, at zero opacity).
 */
export function simulateParticles(
  config: ParticleConfig,
  originX: number,
  originY: number,
  elapsedMs: number,
  clipDurationMs: number,
): readonly SimulatedParticle[] {
  const count = Math.max(0, Math.round(config.count));
  if (count === 0 || clipDurationMs <= 0) {
    return [];
  }

  const emissionMs = clamp01(config.emissionFraction) * clipDurationMs;
  const lifetimeMs = Math.max(1, clamp01(config.lifetimeFraction) * clipDurationMs);
  const fullCircle = config.arcDeg >= 360;
  const particles: SimulatedParticle[] = [];

  for (let index = 0; index < count; index += 1) {
    const birthMs = count <= 1 ? 0 : (index / count) * emissionMs;
    const age = (elapsedMs - birthMs) / lifetimeMs;
    if (age < 0 || age > 1) {
      continue;
    }

    const alpha =
      config.startOpacity + (config.endOpacity - config.startOpacity) * age;
    if (alpha <= 0) {
      continue;
    }

    // Full-circle emission uses golden-angle spacing; a narrower arc spreads evenly across it,
    // because an author who asked for a 20° cone wants a cone, not twenty scattered angles.
    const arcOffsetDeg = fullCircle
      ? index * GOLDEN_ANGLE_DEG
      : -config.arcDeg / 2 + (count <= 1 ? config.arcDeg / 2 : (index / (count - 1)) * config.arcDeg);
    const angleJitterDeg =
      config.randomness * (hashUnit(config.seed, index, 1) - 0.5) * config.arcDeg;
    const eased = 1 - (1 - age) * (1 - age);
    const angleDeg =
      config.directionDeg + arcOffsetDeg + angleJitterDeg + config.swirlDeg * eased;
    const angle = angleDeg * DEG_TO_RAD;

    // At `randomness: 0` this is the evenly-walked irrational sequence a burst has always
    // used; raising randomness blends continuously toward the per-particle hash, so the
    // control has no step in it.
    const evenVariation = fraction(index * PHI_FRACTION);
    const variationSource =
      evenVariation +
      clamp01(config.randomness) * (hashUnit(config.seed, index, 2) - evenVariation);
    const speedScale = 1 - config.speedVariation + config.speedVariation * variationSource;
    const reach = config.spread * eased * speedScale;

    const radius = config.radius * (1 + (config.endScale - 1) * age);
    if (radius <= 0) {
      continue;
    }

    particles.push({
      x: originX + Math.cos(angle) * reach,
      y: originY + Math.sin(angle) * reach + config.gravity * age * age,
      radius,
      alpha: clamp01(alpha),
      color: colorFor(config, index, age),
    });
  }

  return particles;
}

function colorFor(config: ParticleConfig, index: number, age: number): string {
  switch (config.colorMix) {
    case 'gradient':
      return mixHexColors(config.color, config.colorEnd, age);
    case 'alternate':
      return index % 2 === 0 ? config.color : config.colorEnd;
    default:
      return config.color;
  }
}
