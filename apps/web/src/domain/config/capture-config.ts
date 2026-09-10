/**
 * Capture Mode's tunable values, in one validated place (constitution Principle V, FR-072).
 *
 * The same rule and the same shape as {@link ./session-config.ts}: nothing downstream may write
 * `3000` or a label pattern at a call site, and {@link parseCaptureConfig} is the only way to build
 * a config from untrusted input. Validation happens **at load**, so a bad value is a startup error
 * naming the field rather than a session that silently records nothing an hour later.
 *
 * The two patterns are configuration rather than constants on purpose: "a contributor label cannot
 * hold an email address" (FR-005) is then a rule the test suite can state and check, not a hope.
 */

import { ConfigError } from './session-config';

/** How a take behaves, how a label is shaped, and how deep editor history goes. */
export interface CaptureConfig {
  /** Delay before a take's first sample, in milliseconds. `0` disables the countdown. */
  readonly countdownMs: number;
  /** Samples recorded per take. At least 1. */
  readonly burstSize: number;
  /** Spacing between a burst's samples, in milliseconds. */
  readonly burstIntervalMs: number;
  /**
   * What a contributor label may look like (FR-005).
   *
   * Deliberately narrow: lower-case, no `@`, no dot, and short. An email address or a full name
   * cannot be entered, which is how "provenance, not identity" stays true in practice.
   */
  readonly contributorLabelPattern: string;
  /** The dataset's existing pose-identity rule (FR-013). */
  readonly poseIdPattern: string;
  /** Editor undo history bound (FR-075a). Capture Mode does not use it. */
  readonly undoDepth: number;
}

/** Values used when `config/capture.json` omits a field. */
export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  countdownMs: 3000,
  burstSize: 5,
  burstIntervalMs: 200,
  contributorLabelPattern: '^[a-z0-9][a-z0-9_-]{1,23}$',
  poseIdPattern: '^[a-z0-9_]+$',
  undoDepth: 50,
};

const ALLOWED_KEYS: readonly string[] = [
  'countdownMs',
  'burstSize',
  'burstIntervalMs',
  'contributorLabelPattern',
  'poseIdPattern',
  'undoDepth',
];

type Json = Record<string, unknown>;

function asObject(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(path + ' must be an object.');
  }
  return value as Json;
}

function rejectUnknownKeys(raw: Json, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path + ': unknown key ' + JSON.stringify(key) + '. Allowed: ' + allowed.join(', ') + '.',
      );
    }
  }
}

function num(
  raw: Json,
  key: string,
  fallback: number,
  path: string,
  min: number,
  max: number,
): number {
  const value = raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(
      path + '.' + key + ' must be a finite number, got ' + JSON.stringify(value) + '.',
    );
  }
  if (value < min || value > max) {
    throw new ConfigError(
      path + '.' + key + ' must lie in [' + min + ', ' + max + '], got ' + value + '.',
    );
  }
  return value;
}

/**
 * A pattern is validated by *compiling* it, not by inspecting it.
 *
 * An invalid regular expression in configuration would otherwise throw at the first keystroke a
 * contributor typed, which is exactly the "surprise an hour later" this module exists to prevent.
 */
function pattern(raw: Json, key: string, fallback: string, path: string): string {
  const value = raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(
      path + '.' + key + ' must be a non-empty string, got ' + JSON.stringify(value) + '.',
    );
  }
  try {
    new RegExp(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(path + '.' + key + ' is not a valid regular expression: ' + detail);
  }
  return value;
}

/**
 * Build a {@link CaptureConfig} from parsed JSON, rejecting unknown keys and bad values.
 *
 * @throws ConfigError naming the offending field.
 */
export function parseCaptureConfig(raw: unknown): CaptureConfig {
  const root = asObject(raw, 'capture config');
  rejectUnknownKeys(root, ALLOWED_KEYS, 'capture config');

  const config: CaptureConfig = {
    // 0 disables the countdown; the upper bound keeps a typo from arming a five-minute wait.
    countdownMs: num(root, 'countdownMs', DEFAULT_CAPTURE_CONFIG.countdownMs, 'capture config', 0, 30_000),
    burstSize: num(root, 'burstSize', DEFAULT_CAPTURE_CONFIG.burstSize, 'capture config', 1, 100),
    burstIntervalMs: num(
      root,
      'burstIntervalMs',
      DEFAULT_CAPTURE_CONFIG.burstIntervalMs,
      'capture config',
      0,
      5_000,
    ),
    contributorLabelPattern: pattern(
      root,
      'contributorLabelPattern',
      DEFAULT_CAPTURE_CONFIG.contributorLabelPattern,
      'capture config',
    ),
    poseIdPattern: pattern(
      root,
      'poseIdPattern',
      DEFAULT_CAPTURE_CONFIG.poseIdPattern,
      'capture config',
    ),
    undoDepth: num(root, 'undoDepth', DEFAULT_CAPTURE_CONFIG.undoDepth, 'capture config', 1, 1_000),
  };

  if (!Number.isInteger(config.burstSize)) {
    throw new ConfigError('capture config.burstSize must be a whole number of samples.');
  }
  if (!Number.isInteger(config.undoDepth)) {
    throw new ConfigError('capture config.undoDepth must be a whole number of steps.');
  }
  return config;
}
