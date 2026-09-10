/**
 * `particle_burst` — particles thrown from an anchor (FR-054), now genuinely configurable
 * (item 4).
 *
 * The action itself is thin on purpose: it reads its registered parameters into a
 * {@link ParticleConfig}, asks `particle-model.ts` where every particle is, and groups the
 * result into render commands. **One `drawCircles` command per colour**, never one per
 * particle (contracts/render-commands.md) — sixty per-particle commands would make
 * command-list length a function of visual density, which the renderer would then have to
 * optimize around, and an alternative renderer would inherit the same problem.
 *
 * Every shipped emission pattern — circle, cone, burst, directional, spiral, random,
 * fountain — is a {@link ActionPreset}: a bundle of values for these same parameters, applied
 * through the ordinary inspector edit path. There is no `switch (pattern)` here, in the model,
 * or in the renderer, and a burst that came from a preset is indistinguishable at runtime from
 * one an author dialled in by hand.
 *
 * The defaults reproduce, exactly, the burst this action produced before it was configurable:
 * a full-circle golden-angle spray, `speedVariation` `0.45`, radius shrinking to `0.4`, opacity
 * fading `1 → 0` over the clip. An existing catalog therefore looks identical, and
 * `test/domain/effect-runtime.test.ts`'s single-command and determinism assertions still hold.
 */

import type { ActionContext, ActionDescriptor, ActionOutput, ActionPreset } from '../action-registry';
import type { DrawCirclesCommand, Point } from '../frame-output';
import { numberParam, stringParam } from '../param-schema';
import { simulateParticles } from './particle-model';
import type { ColorMixMode, ParticleConfig, SimulatedParticle } from './particle-model';

/** Read the registered parameters into the simulation's own configuration shape. */
export function particleConfigFrom(params: ActionContext['params']): ParticleConfig {
  return {
    count: numberParam(params, 'count'),
    directionDeg: numberParam(params, 'directionDeg'),
    arcDeg: numberParam(params, 'arcDeg'),
    spread: numberParam(params, 'spread'),
    speedVariation: numberParam(params, 'speedVariation'),
    gravity: numberParam(params, 'gravity'),
    swirlDeg: numberParam(params, 'swirlDeg'),
    radius: numberParam(params, 'radius'),
    endScale: numberParam(params, 'endScale'),
    color: stringParam(params, 'color'),
    colorEnd: stringParam(params, 'colorEnd'),
    colorMix: stringParam(params, 'colorMix') as ColorMixMode,
    startOpacity: numberParam(params, 'startOpacity'),
    endOpacity: numberParam(params, 'endOpacity'),
    lifetimeFraction: numberParam(params, 'lifetimeFraction'),
    emissionFraction: numberParam(params, 'emissionFraction'),
    randomness: numberParam(params, 'randomness'),
    seed: numberParam(params, 'seed'),
  };
}

/**
 * Group simulated particles into render commands.
 *
 * One command per distinct colour. Within a command, a uniform opacity is expressed once (the
 * command's own `alpha`) and per-particle opacity only when the particles actually differ —
 * which keeps the common case byte-identical to what this action emitted before staggered
 * emission existed.
 */
export function particleCommands(
  particles: readonly SimulatedParticle[],
): readonly DrawCirclesCommand[] {
  const byColor = new Map<string, SimulatedParticle[]>();
  for (const particle of particles) {
    const bucket = byColor.get(particle.color);
    if (bucket === undefined) {
      byColor.set(particle.color, [particle]);
    } else {
      bucket.push(particle);
    }
  }

  const commands: DrawCirclesCommand[] = [];
  for (const [color, bucket] of byColor) {
    const points: Point[] = bucket.map((particle) => ({ x: particle.x, y: particle.y }));
    const radii = bucket.map((particle) => particle.radius);
    const alphas = bucket.map((particle) => particle.alpha);
    const uniform = alphas.every((alpha) => alpha === alphas[0]);
    commands.push(
      uniform
        ? { kind: 'drawCircles', points, radii, color, alpha: alphas[0] ?? 0 }
        : { kind: 'drawCircles', points, radii, color, alpha: 1, alphas },
    );
  }
  return commands;
}

/** The emission patterns offered as one-click presets — data, not behaviour. */
const PRESETS: readonly ActionPreset[] = [
  {
    name: 'Circle',
    description: 'An even ring expanding in every direction.',
    params: {
      directionDeg: 0,
      arcDeg: 360,
      speedVariation: 0,
      swirlDeg: 0,
      gravity: 0,
      randomness: 0,
      emissionFraction: 0,
    },
  },
  {
    name: 'Cone',
    description: 'A narrow spray upward from the anchor.',
    params: {
      directionDeg: 270,
      arcDeg: 45,
      speedVariation: 0.4,
      swirlDeg: 0,
      gravity: 0,
      randomness: 0.15,
      emissionFraction: 0,
    },
  },
  {
    name: 'Burst',
    description: 'The classic all-at-once cloud in every direction.',
    params: {
      directionDeg: 0,
      arcDeg: 360,
      speedVariation: 0.45,
      swirlDeg: 0,
      gravity: 0,
      randomness: 0,
      emissionFraction: 0,
    },
  },
  {
    name: 'Directional',
    description: 'A tight stream travelling one way.',
    params: {
      directionDeg: 0,
      arcDeg: 12,
      speedVariation: 0.2,
      swirlDeg: 0,
      gravity: 0,
      randomness: 0.1,
      emissionFraction: 0.4,
    },
  },
  {
    name: 'Spiral',
    description: 'Particles curling outward as they travel.',
    params: {
      directionDeg: 0,
      arcDeg: 360,
      speedVariation: 0.6,
      swirlDeg: 540,
      gravity: 0,
      randomness: 0,
      emissionFraction: 0.3,
    },
  },
  {
    name: 'Random',
    description: 'Scattered angles and speeds, emitted over time.',
    params: {
      directionDeg: 0,
      arcDeg: 360,
      speedVariation: 0.8,
      swirlDeg: 0,
      gravity: 0,
      randomness: 1,
      emissionFraction: 0.5,
    },
  },
  {
    name: 'Fountain',
    description: 'Thrown upward and pulled back down.',
    params: {
      directionDeg: 270,
      arcDeg: 60,
      speedVariation: 0.5,
      swirlDeg: 0,
      gravity: 900,
      randomness: 0.2,
      emissionFraction: 0.6,
    },
  },
];

/** The registration record for `particle_burst`. */
export const particleBurstAction: ActionDescriptor = {
  type: 'particle_burst',
  behaviour: 'duration',
  presets: PRESETS,
  params: [
    {
      name: 'count',
      kind: 'number',
      defaultValue: 40,
      min: 1,
      max: 400,
      group: 'Emission',
      description: 'How many particles the burst throws.',
    },
    {
      name: 'anchor',
      kind: 'anchor',
      defaultValue: { kind: 'screen', x: 0.5, y: 0.5 },
      group: 'Emission',
      description: 'Where the burst originates.',
    },
    {
      name: 'directionDeg',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 360,
      group: 'Emission',
      description: 'Which way the emission arc points: 0 right, 90 down, 180 left, 270 up.',
    },
    {
      name: 'arcDeg',
      kind: 'number',
      defaultValue: 360,
      min: 1,
      max: 360,
      group: 'Emission',
      description: 'How wide the emission arc is. 360 emits in every direction.',
    },
    {
      name: 'emissionFraction',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 1,
      group: 'Emission',
      description:
        'Over what fraction of the clip particles appear. 0 emits them all on the first frame.',
    },
    {
      name: 'spread',
      kind: 'number',
      defaultValue: 220,
      min: 1,
      max: 4000,
      group: 'Motion',
      description: 'How far, in pixels, the fastest particle travels over its own lifetime.',
    },
    {
      name: 'speedVariation',
      kind: 'number',
      defaultValue: 0.45,
      min: 0,
      max: 1,
      group: 'Motion',
      description: 'How much slower the slowest particle is than the fastest. 0 makes a ring.',
    },
    {
      name: 'gravity',
      kind: 'number',
      defaultValue: 0,
      min: -4000,
      max: 4000,
      group: 'Motion',
      description: 'Pixels of downward drift accumulated over a particle’s lifetime.',
    },
    {
      name: 'swirlDeg',
      kind: 'number',
      defaultValue: 0,
      min: -1440,
      max: 1440,
      group: 'Motion',
      description: 'Degrees a particle’s direction rotates as it travels — a spiral.',
    },
    {
      name: 'lifetimeFraction',
      kind: 'number',
      defaultValue: 1,
      min: 0.05,
      max: 1,
      group: 'Motion',
      description: 'A particle’s own lifetime, as a fraction of the clip’s duration.',
    },
    {
      name: 'radius',
      kind: 'number',
      defaultValue: 6,
      min: 0.5,
      max: 200,
      group: 'Appearance',
      description: 'Particle radius in pixels at the start of the burst.',
    },
    {
      name: 'endScale',
      kind: 'number',
      defaultValue: 0.4,
      min: 0,
      max: 4,
      group: 'Appearance',
      description: 'Radius multiplier at the end of a particle’s life. Above 1 grows it.',
    },
    {
      name: 'color',
      kind: 'color',
      defaultValue: '#FFD166',
      group: 'Appearance',
      description: 'Colour of every particle, or the first colour when mixing.',
    },
    {
      name: 'colorMix',
      kind: 'enum',
      defaultValue: 'single',
      values: ['single', 'gradient', 'alternate'],
      group: 'Appearance',
      description:
        'single: one colour. gradient: fades toward the second over a particle’s life. ' +
        'alternate: every other particle takes the second colour.',
    },
    {
      name: 'colorEnd',
      kind: 'color',
      defaultValue: '#FF6B6B',
      group: 'Appearance',
      visibleWhen: { param: 'colorMix', values: ['gradient', 'alternate'] },
      description: 'The second colour, used by the gradient and alternate mixes.',
    },
    {
      name: 'startOpacity',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 1,
      group: 'Appearance',
      description: 'Particle opacity at birth.',
    },
    {
      name: 'endOpacity',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 1,
      group: 'Appearance',
      description: 'Particle opacity at the end of its life.',
    },
    {
      name: 'randomness',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 1,
      group: 'Appearance',
      description: 'How much angle and speed scatter per particle. Still deterministic.',
    },
    {
      name: 'seed',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 9999,
      group: 'Appearance',
      description: 'Chooses which deterministic scatter this burst gets.',
    },
  ],

  update(context: ActionContext): ActionOutput {
    const origin = context.anchor;
    if (origin === null) {
      // Unreachable in practice — the runtime skips an action whose anchor did not resolve
      // and reports it — but an action must never invent a position of its own (FR-060).
      return { commands: [] };
    }

    // `progress` is the clip's; the model needs elapsed-within-the-clip so a particle's own
    // lifetime and birth time are expressible. `durationMs` is the clip's window, which is
    // exactly what `progress` was computed against.
    const clipDurationMs = context.durationMs;
    const elapsedInClipMs = context.progress * clipDurationMs;

    const particles = simulateParticles(
      particleConfigFrom(context.params),
      origin.x,
      origin.y,
      elapsedInClipMs,
      clipDurationMs,
    );
    return { commands: particleCommands(particles) };
  },
};
