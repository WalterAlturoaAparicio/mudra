import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  DEFAULT_SESSION_CONFIG,
  defaultLandmarkWeights,
  parseSessionConfig,
} from '../../src/domain/config/session-config';
import { FINGERTIPS, HAND_LANDMARK_COUNT, WRIST } from '../../src/domain/landmarks/topology';
import { loadSessionConfig } from '../../src/infrastructure/config/session-config-loader';

const SHIPPED_CONFIG = JSON.parse(
  readFileSync(resolve(__dirname, '../../config/session.json'), 'utf-8'),
) as unknown;

/**
 * Hand requirements are a property of the dataset, not of configuration, so the guard
 * below states them explicitly and the bundle-loader suite asserts the same split against
 * the generated manifest (FR-023c).
 */
const ONE_HANDED = ['hi', 'militar_hi', 'ok', 'peace', 'tp'];
const TWO_HANDED = [
  'bird',
  'dog',
  'dragon',
  'hare',
  'horse',
  'monkey',
  'ox',
  'ram',
  'rat',
  'snake',
  'tiger',
  'wild_boar',
];

describe('defaults', () => {
  it('weights the wrist least and the fingertips most', () => {
    const { values } = defaultLandmarkWeights();
    expect(values).toHaveLength(HAND_LANDMARK_COUNT);
    expect(values[WRIST]).toBe(0.5);
    for (const tip of FINGERTIPS) {
      expect(values[tip]).toBe(2);
    }
    const others = values.filter((_, i) => i !== WRIST && !FINGERTIPS.includes(i));
    expect(new Set(others)).toEqual(new Set([1]));
  });

  it('holds the thresholds the specification fixes (FR-026, FR-027, FR-033)', () => {
    expect(DEFAULT_SESSION_CONFIG.recognition.confidenceFloor).toBe(0.5);
    expect(DEFAULT_SESSION_CONFIG.recognition.ambiguityMargin).toBe(0.12);
    expect(DEFAULT_SESSION_CONFIG.events.holdDurationMs).toBe(1000);
    expect(DEFAULT_SESSION_CONFIG.bundle.minSamples).toBe(20);
  });
});

describe('the shipped config/session.json', () => {
  it('parses', () => {
    expect(() => parseSessionConfig(SHIPPED_CONFIG)).not.toThrow();
  });

  it('carries the thresholds the specification fixes, unaltered (FR-028)', () => {
    const config = parseSessionConfig(SHIPPED_CONFIG);
    expect(config.recognition.confidenceFloor).toBe(0.5);
    expect(config.recognition.ambiguityMargin).toBe(0.12);
    expect(config.events.holdDurationMs).toBe(1000);
  });

  it('activates at least one one-handed AND one two-handed pose (FR-023c)', () => {
    const { activePoseSet } = parseSessionConfig(SHIPPED_CONFIG);
    // A future edit that dropped either would leave one whole matching path — hand-agnostic
    // or like-for-like — unexercised by the default experience, and nothing else would say so.
    expect(activePoseSet.some((id) => ONE_HANDED.includes(id))).toBe(true);
    expect(activePoseSet.some((id) => TWO_HANDED.includes(id))).toBe(true);
  });
});

describe('validation', () => {
  it('rejects an unknown top-level key', () => {
    expect(() => parseSessionConfig({ activePoseSet: ['hi'], nonsense: 1 })).toThrow(ConfigError);
  });

  it('rejects an unknown nested key', () => {
    expect(() => parseSessionConfig({ recognition: { confidenceFloor: 0.5, floor: 1 } })).toThrow(
      /unknown key "floor"/,
    );
  });

  it('rejects an out-of-range threshold', () => {
    expect(() => parseSessionConfig({ recognition: { confidenceFloor: 1.4 } })).toThrow(
      /confidenceFloor must lie in \[0, 1\]/,
    );
    expect(() => parseSessionConfig({ recognition: { ambiguityMargin: -0.1 } })).toThrow(
      ConfigError,
    );
    expect(() => parseSessionConfig({ recognition: { softmaxTemperature: 0 } })).toThrow(
      ConfigError,
    );
  });

  it('rejects a non-numeric threshold rather than coercing it', () => {
    expect(() => parseSessionConfig({ recognition: { confidenceFloor: '0.5' } })).toThrow(
      /must be a finite number/,
    );
  });

  it('rejects an empty active pose set', () => {
    expect(() => parseSessionConfig({ activePoseSet: [] })).toThrow(/must not be empty/);
  });

  it('rejects a duplicated pose id', () => {
    expect(() => parseSessionConfig({ activePoseSet: ['hi', 'hi'] })).toThrow(/duplicates/);
  });

  it('rejects an unknown pose id when the bundle contents are known', () => {
    expect(() =>
      parseSessionConfig({ activePoseSet: ['hi', 'nope'] }, { knownPoseIds: ['hi', 'peace'] }),
    ).toThrow(/does not contain: nope/);
  });

  it('accepts an active pose set the bundle does contain', () => {
    const config = parseSessionConfig(
      { activePoseSet: ['hi', 'peace'] },
      { knownPoseIds: ['hi', 'peace', 'tp'] },
    );
    expect(config.activePoseSet).toEqual(['hi', 'peace']);
  });

  it('rejects a weight vector of the wrong length', () => {
    expect(() => parseSessionConfig({ recognition: { weights: [1, 2, 3] } })).toThrow(
      /exactly 21 values/,
    );
  });

  it('rejects a negative weight', () => {
    const weights = new Array<number>(HAND_LANDMARK_COUNT).fill(1);
    weights[3] = -1;
    expect(() => parseSessionConfig({ recognition: { weights } })).toThrow(/non-negative/);
  });

  it('rejects an all-zero weight vector', () => {
    const weights = new Array<number>(HAND_LANDMARK_COUNT).fill(0);
    expect(() => parseSessionConfig({ recognition: { weights } })).toThrow(/all zero/);
  });

  it('rejects a non-object document', () => {
    expect(() => parseSessionConfig([1, 2, 3])).toThrow(ConfigError);
    expect(() => parseSessionConfig(null)).toThrow(ConfigError);
  });
});

describe('the loader', () => {
  it('validates what it read, naming the file (T013a)', async () => {
    await expect(
      loadSessionConfig({
        url: '/config/session.json',
        fetcher: () => Promise.resolve({ recognition: { confidenceFloor: 3 } }),
      }),
    ).rejects.toThrow(/\/config\/session\.json is invalid/);
  });

  it('reports an unreadable file rather than falling back to defaults', async () => {
    await expect(
      loadSessionConfig({
        url: '/config/session.json',
        fetcher: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow(/offline/);
  });

  it('returns the parsed configuration on success', async () => {
    const config = await loadSessionConfig({ fetcher: () => Promise.resolve(SHIPPED_CONFIG) });
    expect(config.activePoseSet).toEqual(['hi', 'peace', 'tp', 'dragon']);
  });
});
