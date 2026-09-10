/**
 * Capture configuration validates at load (FR-072), and the label pattern is a rule (FR-005).
 *
 * The last describe block is the point of the file: "a contributor label cannot hold personal
 * data" is a claim, and the only way it stays true is a test that tries to enter some.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CAPTURE_CONFIG,
  parseCaptureConfig,
} from '../../src/domain/config/capture-config';
import { ConfigError } from '../../src/domain/config/session-config';
import { loadCaptureConfig } from '../../src/infrastructure/config/capture-config-loader';
import { APP_ROOT } from '../support/source-scan';

const shipped = JSON.parse(
  readFileSync(join(APP_ROOT, 'config/capture.json'), 'utf-8'),
) as unknown;

describe('parseCaptureConfig', () => {
  it('accepts the configuration the application actually ships', () => {
    // Without this, every assertion below could pass against a file nobody loads.
    const config = parseCaptureConfig(shipped);
    expect(config.burstSize).toBeGreaterThanOrEqual(1);
    expect(config.countdownMs).toBeGreaterThanOrEqual(0);
  });

  it('fills omitted fields from the defaults', () => {
    expect(parseCaptureConfig({})).toEqual(DEFAULT_CAPTURE_CONFIG);
  });

  it('rejects an unknown key, naming it', () => {
    expect(() => parseCaptureConfig({ burstSizes: 5 })).toThrow(ConfigError);
    expect(() => parseCaptureConfig({ burstSizes: 5 })).toThrow(/burstSizes/);
  });

  it('rejects a non-object document', () => {
    expect(() => parseCaptureConfig([])).toThrow(ConfigError);
    expect(() => parseCaptureConfig(null)).toThrow(ConfigError);
  });

  it('rejects out-of-range and non-finite numbers', () => {
    expect(() => parseCaptureConfig({ countdownMs: -1 })).toThrow(/countdownMs/);
    expect(() => parseCaptureConfig({ countdownMs: 60_000 })).toThrow(/countdownMs/);
    expect(() => parseCaptureConfig({ burstSize: 0 })).toThrow(/burstSize/);
    expect(() => parseCaptureConfig({ burstIntervalMs: Number.NaN })).toThrow(/burstIntervalMs/);
  });

  it('rejects a fractional burst size or undo depth', () => {
    expect(() => parseCaptureConfig({ burstSize: 2.5 })).toThrow(/whole number/);
    expect(() => parseCaptureConfig({ undoDepth: 10.5 })).toThrow(/whole number/);
  });

  it('permits a countdown of zero, which means disabled', () => {
    expect(parseCaptureConfig({ countdownMs: 0 }).countdownMs).toBe(0);
  });

  it('rejects a pattern that is not a valid regular expression', () => {
    // Caught at load rather than at the first keystroke a contributor types.
    expect(() => parseCaptureConfig({ poseIdPattern: '[' })).toThrow(/not a valid regular/);
  });

  it('rejects an empty pattern', () => {
    expect(() => parseCaptureConfig({ contributorLabelPattern: '' })).toThrow(/non-empty string/);
  });
});

describe('the shipped contributor-label pattern (FR-005)', () => {
  const label = new RegExp(parseCaptureConfig(shipped).contributorLabelPattern);

  it('accepts a short self-chosen handle', () => {
    for (const value of ['walter', 'w', 'a1', 'collab-2', 'lab_three']) {
      expect(label.test(value), value).toBe(true);
    }
  });

  it('cannot hold an email address or a full name', () => {
    // The whole reason the pattern is configuration rather than a comment.
    for (const value of [
      'someone@example.com',
      'Walter Alturo',
      'walter alturo',
      'Walter',
      'walter.alturo',
      '+34600000000',
      'a'.repeat(64),
    ]) {
      expect(label.test(value), value).toBe(false);
    }
  });
});

describe('the shipped pose-id pattern (FR-013)', () => {
  const poseId = new RegExp(parseCaptureConfig(shipped).poseIdPattern);

  it('accepts the dataset’s existing identity shape', () => {
    for (const value of ['dragon', 'militar_hi', 'tp', 'domain_expansion']) {
      expect(poseId.test(value), value).toBe(true);
    }
  });

  it('rejects anything the dataset would not accept', () => {
    for (const value of ['Dragon', 'dragon!', 'dragon-1', 'two words', '']) {
      expect(poseId.test(value), value).toBe(false);
    }
  });
});

describe('loadCaptureConfig', () => {
  it('reads and validates through an injected fetcher', async () => {
    const config = await loadCaptureConfig({ fetcher: async () => ({ burstSize: 3 }) });
    expect(config.burstSize).toBe(3);
    expect(config.countdownMs).toBe(DEFAULT_CAPTURE_CONFIG.countdownMs);
  });

  it('names the file when validation fails', async () => {
    await expect(
      loadCaptureConfig({ url: '/config/capture.json', fetcher: async () => ({ nope: 1 }) }),
    ).rejects.toThrow(/config\/capture\.json is invalid/);
  });

  it('reports a read failure as a configuration error', async () => {
    await expect(
      loadCaptureConfig({
        fetcher: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow(/Could not read capture configuration/);
  });
});
