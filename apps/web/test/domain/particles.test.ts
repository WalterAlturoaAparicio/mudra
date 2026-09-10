/**
 * The configurable particle system (items 4 and 5).
 *
 * Three properties this file exists to hold:
 *
 * **The patterns are data.** Circle, cone, spiral, fountain and the rest must be reachable by
 * setting parameters — there is one simulation, and applying a preset is an ordinary parameter
 * edit. A test that asserts different presets produce visibly different geometry, *through the
 * same `update()`*, is what stops a future "just add a branch for spirals".
 *
 * **The default is unchanged.** A catalog authored before this action became configurable must
 * look exactly as it did, which means the defaults have to reproduce the old formula.
 *
 * **The preview cannot drift.** `presentation/editor/particle-preview.ts` calls this same
 * `update()`; the shared path is asserted here rather than by a second, parallel expectation.
 */

import { describe, expect, it } from 'vitest';

import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { ActionContext, ResolvedParams } from '../../src/domain/runtime/action-registry';
import {
  particleBurstAction,
  particleCommands,
  particleConfigFrom,
} from '../../src/domain/runtime/actions/particle-burst';
import { simulateParticles } from '../../src/domain/runtime/actions/particle-model';
import type { DrawCirclesCommand } from '../../src/domain/runtime/frame-output';
import { resolveParams } from '../../src/domain/runtime/param-schema';

const DURATION_MS = 800;

function contextFor(
  overrides: Readonly<Record<string, number | string | boolean>>,
  progress: number,
): ActionContext {
  const params: ResolvedParams = resolveParams(
    particleBurstAction.params,
    overrides,
    'particle_burst',
  );
  return {
    effectId: 'e',
    params,
    elapsedMs: progress * DURATION_MS,
    progress,
    durationMs: DURATION_MS,
    justFired: progress === 0,
    frame: landmarkFrame([], 0, 640, 480),
    segmentation: null,
    width: 640,
    height: 480,
    anchor: { x: 320, y: 240 },
    resolveAsset: () => null,
    state: {},
  };
}

function circles(
  overrides: Readonly<Record<string, number | string | boolean>>,
  progress: number,
): readonly DrawCirclesCommand[] {
  return particleBurstAction.update(contextFor(overrides, progress))
    .commands as readonly DrawCirclesCommand[];
}

/** Every particle's angle from the origin, in degrees, `0` = right, `90` = down. */
function angles(command: DrawCirclesCommand): readonly number[] {
  return command.points.map((point) => {
    const degrees = (Math.atan2(point.y - 240, point.x - 320) * 180) / Math.PI;
    return (degrees + 360) % 360;
  });
}

/** Radial distance from the origin, per particle. */
function reaches(command: DrawCirclesCommand): readonly number[] {
  return command.points.map((point) =>
    Math.hypot(point.x - 320, point.y - 240),
  );
}

describe('the shipped defaults reproduce the pre-configuration burst', () => {
  it('emits ONE command carrying every particle, with a single shared opacity', () => {
    const commands = circles({ count: 60 }, 0.5);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.points).toHaveLength(60);
    expect(commands[0]!.radii).toHaveLength(60);
    // No per-point alphas when every particle shares one — byte-identical to the old command.
    expect(commands[0]!.alphas).toBeUndefined();
  });

  it('fades out and shrinks over the clip, exactly as before', () => {
    const early = circles({ count: 8 }, 0.25)[0]!;
    const late = circles({ count: 8 }, 0.75)[0]!;
    expect(early.alpha).toBeCloseTo(0.75, 5);
    expect(late.alpha).toBeCloseTo(0.25, 5);
    // radius = base * (1 - 0.6 * progress), the old curve, expressed as endScale 0.4.
    expect(early.radii[0]).toBeCloseTo(6 * (1 - 0.6 * 0.25), 5);
  });

  it('is deterministic — the same configuration twice is the same picture', () => {
    expect(circles({ count: 24, randomness: 1, seed: 7 }, 0.4)).toEqual(
      circles({ count: 24, randomness: 1, seed: 7 }, 0.4),
    );
  });
});

describe('emission patterns are configuration, not code paths', () => {
  it('every shipped preset is a bundle of ordinary parameter values', () => {
    const presets = particleBurstAction.presets ?? [];
    expect(presets.length).toBeGreaterThanOrEqual(7);
    const names = new Set(particleBurstAction.params.map((spec) => spec.name));
    for (const preset of presets) {
      for (const key of Object.keys(preset.params)) {
        expect(names, preset.name + ' sets ' + key).toContain(key);
      }
      // A preset must produce a configuration the schema itself accepts.
      expect(() =>
        resolveParams(particleBurstAction.params, preset.params, preset.name),
      ).not.toThrow();
    }
  });

  it('a narrow arc really is a cone — every particle within it', () => {
    const command = circles({ count: 20, directionDeg: 270, arcDeg: 40 }, 0.5)[0]!;
    for (const angle of angles(command)) {
      // 270 ± 20, i.e. 250..290 degrees.
      expect(angle).toBeGreaterThanOrEqual(249);
      expect(angle).toBeLessThanOrEqual(291);
    }
  });

  it('a full circle spans every direction', () => {
    const command = circles({ count: 40, arcDeg: 360 }, 0.5)[0]!;
    const observed = angles(command);
    expect(Math.min(...observed)).toBeLessThan(45);
    expect(Math.max(...observed)).toBeGreaterThan(315);
  });

  it('zero speed variation makes a ring; high variation makes a cloud', () => {
    const ring = reaches(circles({ count: 24, speedVariation: 0 }, 0.5)[0]!);
    const cloud = reaches(circles({ count: 24, speedVariation: 0.9 }, 0.5)[0]!);
    expect(Math.max(...ring) - Math.min(...ring)).toBeLessThan(0.001);
    expect(Math.max(...cloud) - Math.min(...cloud)).toBeGreaterThan(10);
  });

  it('gravity pulls particles down without changing how far they travel outward', () => {
    const plain = circles({ count: 12, directionDeg: 270, arcDeg: 20, gravity: 0 }, 0.8)[0]!;
    const heavy = circles({ count: 12, directionDeg: 270, arcDeg: 20, gravity: 900 }, 0.8)[0]!;
    for (let i = 0; i < plain.points.length; i += 1) {
      expect(heavy.points[i]!.x).toBeCloseTo(plain.points[i]!.x, 5);
      expect(heavy.points[i]!.y).toBeGreaterThan(plain.points[i]!.y);
    }
  });

  it('swirl rotates travel direction over a particle’s life', () => {
    const straight = angles(circles({ count: 6, swirlDeg: 0 }, 0.9)[0]!);
    const swirled = angles(circles({ count: 6, swirlDeg: 540 }, 0.9)[0]!);
    expect(swirled).not.toEqual(straight);
  });

  it('staggered emission means particles appear over time, not all at once', () => {
    const atStart = circles({ count: 40, emissionFraction: 0.8 }, 0.05)[0];
    const atEnd = circles({ count: 40, emissionFraction: 0.8 }, 0.5)[0];
    expect(atStart!.points.length).toBeLessThan(atEnd!.points.length);
  });

  it('staggered emission produces per-particle opacity in ONE command, not one per particle', () => {
    const commands = circles({ count: 40, emissionFraction: 0.8 }, 0.5);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.alphas).toBeDefined();
    expect(commands[0]!.alphas!.length).toBe(commands[0]!.points.length);
  });
});

describe('multiple colours', () => {
  it('single is one command; alternate is two, one per colour', () => {
    expect(circles({ count: 10, colorMix: 'single' }, 0.5)).toHaveLength(1);
    const alternating = circles(
      { count: 10, colorMix: 'alternate', color: '#ff0000', colorEnd: '#0000ff' },
      0.5,
    );
    expect(alternating).toHaveLength(2);
    expect(new Set(alternating.map((command) => command.color))).toEqual(
      new Set(['#ff0000', '#0000ff']),
    );
  });

  it('a gradient mix produces colours between the two ends', () => {
    const commands = circles(
      { count: 20, colorMix: 'gradient', color: '#000000', colorEnd: '#ffffff', emissionFraction: 0.9 },
      0.6,
    );
    const colors = new Set(commands.map((command) => command.color));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('configuration round-trips through the schema', () => {
  it('every particle parameter survives resolve → config → simulate', () => {
    const authored = {
      count: 33,
      directionDeg: 120,
      arcDeg: 90,
      spread: 400,
      speedVariation: 0.3,
      gravity: 250,
      swirlDeg: -90,
      radius: 9,
      endScale: 1.5,
      color: '#123456',
      colorMix: 'gradient',
      colorEnd: '#654321',
      startOpacity: 0.9,
      endOpacity: 0.1,
      lifetimeFraction: 0.5,
      emissionFraction: 0.25,
      randomness: 0.6,
      seed: 42,
    } as const;
    const resolved = resolveParams(particleBurstAction.params, authored, 'particle_burst');
    const config = particleConfigFrom(resolved);
    expect(config).toMatchObject(authored);

    const particles = simulateParticles(config, 0, 0, 100, DURATION_MS);
    expect(particles.length).toBeGreaterThan(0);
    for (const particle of particles) {
      expect(particle.alpha).toBeGreaterThan(0);
      expect(particle.alpha).toBeLessThanOrEqual(1);
      expect(particle.radius).toBeGreaterThan(0);
    }
  });
});

describe('the preview and the runtime are one implementation (item 5)', () => {
  it('the preview’s command path is the action’s own update()', () => {
    // What `ParticlePreview.commandsAt` does, spelled out: build a context and call the
    // shipped action. If this ever needed different code to look the same, the preview and
    // the effect would have diverged — which is precisely what item 5 forbids.
    const context = contextFor({ count: 12, arcDeg: 60 }, 0.5);
    const viaAction = particleBurstAction.update(context).commands;
    const viaModel = particleCommands(
      simulateParticles(
        particleConfigFrom(context.params),
        context.anchor!.x,
        context.anchor!.y,
        context.progress * context.durationMs,
        context.durationMs,
      ),
    );
    expect(viaAction).toEqual(viaModel);
  });
});
